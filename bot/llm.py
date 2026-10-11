"""Бэкенды нейросетей.

GigaChat (Сбер) — основной вариант: работает из России, для физлиц есть бесплатная квота токенов.
OpenAI — запасной вариант, если ключ есть, а сервис доступен с вашего сервера.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import ssl
import time
import uuid
from dataclasses import dataclass, field

import httpx
from openai import AsyncOpenAI

log = logging.getLogger(__name__)


@dataclass
class ChatMessage:
    role: str                       # system | user | assistant
    text: str
    images: list[bytes] = field(default_factory=list)


class ChatBackend:
    """Общий интерфейс. Конкретный бэкенд переопределяет chat и, при необходимости, transcribe."""

    supports_voice: bool = False

    async def chat(self, messages: list[ChatMessage], json_mode: bool = False, temperature: float = 0.4) -> str:
        raise NotImplementedError

    async def transcribe(self, audio: bytes, filename: str) -> str:
        raise NotImplementedError("Распознавание речи этим бэкендом не поддерживается")

    async def aclose(self) -> None:
        return None


JSON_HINT = "\n\nОтветь только JSON-объектом, без пояснений и без markdown-оформления."


class GigaChatBackend(ChatBackend):
    """Клиент GigaChat API для физлиц: OAuth-токен (живёт 30 минут), чат, загрузка изображений."""

    OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
    API_URL = "https://gigachat.devices.sberbank.ru/api/v1"

    def __init__(
        self,
        auth_key: str,
        *,
        scope: str = "GIGACHAT_API_PERS",
        model: str = "GigaChat-2",
        vision_model: str = "GigaChat-2-Max",
        ca_cert: str | None = None,
        verify_ssl: bool = True,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.auth_key = auth_key.strip()
        self.scope = scope
        self.model = model
        self.vision_model = vision_model
        self._token: str | None = None
        self._expires_at = 0.0
        self._token_lock = asyncio.Lock()
        # Физлицу выдаётся один поток запросов: запросы идут строго по одному
        self._one_at_a_time = asyncio.Semaphore(1)

        if transport is not None:
            verify: ssl.SSLContext | bool = True
        elif not verify_ssl:
            verify = False
        elif ca_cert:
            # Сертификат Минцифры нужен для доступа к GigaChat (из-за российского УЦ)
            verify = ssl.create_default_context(cafile=ca_cert)
        else:
            verify = True
        self._client = httpx.AsyncClient(verify=verify, timeout=90, transport=transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _get_token(self) -> str:
        async with self._token_lock:
            if self._token and time.time() < self._expires_at - 60:
                return self._token
            resp = await self._client.post(
                self.OAUTH_URL,
                headers={
                    "Authorization": f"Basic {self.auth_key}",
                    "RqUID": str(uuid.uuid4()),
                    "Accept": "application/json",
                },
                data={"scope": self.scope},
            )
            resp.raise_for_status()
            data = resp.json()
            self._token = data["access_token"]
            # expires_at приходит в миллисекундах
            self._expires_at = float(data.get("expires_at", 0)) / 1000 or time.time() + 1500
            return self._token

    async def _post(self, url: str, **kwargs) -> httpx.Response:
        """POST с авторизацией; при 401 — обновляем токен и повторяем; при 429 — ждём и повторяем."""
        for attempt in range(3):
            token = await self._get_token()
            headers = {"Authorization": f"Bearer {token}", **kwargs.pop("headers", {})}
            resp = await self._client.post(url, headers=headers, **kwargs)
            if resp.status_code == 401:
                self._token = None
                continue
            if resp.status_code == 429:
                await asyncio.sleep(2 * (attempt + 1))
                continue
            resp.raise_for_status()
            return resp
        resp.raise_for_status()  # выбросит ошибку с кодом последнего ответа
        return resp

    async def _upload_image(self, image: bytes) -> str:
        resp = await self._post(
            f"{self.API_URL}/files",
            files={"file": ("photo.jpg", image, "image/jpeg")},
            data={"purpose": "general"},
        )
        return resp.json()["id"]

    async def chat(self, messages: list[ChatMessage], json_mode: bool = False, temperature: float = 0.4) -> str:
        payload = []
        has_images = any(m.images for m in messages)
        for m in messages:
            text = m.text
            if json_mode and m.role == "user" and m is messages[-1]:
                text += JSON_HINT
            item: dict = {"role": m.role, "content": text}
            if m.images:
                async with self._one_at_a_time:
                    item["attachments"] = [await self._upload_image(img) for img in m.images]
            payload.append(item)

        body = {
            "model": self.vision_model if has_images else self.model,
            "messages": payload,
            "temperature": temperature,
        }
        async with self._one_at_a_time:
            resp = await self._post(f"{self.API_URL}/chat/completions", json=body)
        return resp.json()["choices"][0]["message"]["content"] or ""


class OpenAIBackend(ChatBackend):
    supports_voice = True

    def __init__(self, api_key: str, chat_model: str = "gpt-4o-mini", stt_model: str = "whisper-1"):
        self.client = AsyncOpenAI(api_key=api_key)
        self.chat_model = chat_model
        self.stt_model = stt_model

    async def chat(self, messages: list[ChatMessage], json_mode: bool = False, temperature: float = 0.4) -> str:
        conv = []
        for m in messages:
            if m.images:
                parts: list[dict] = [{"type": "text", "text": m.text}]
                for img in m.images:
                    b64 = base64.b64encode(img).decode("ascii")
                    parts.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
                conv.append({"role": m.role, "content": parts})
            else:
                conv.append({"role": m.role, "content": m.text})
        kwargs: dict = {"model": self.chat_model, "messages": conv, "temperature": temperature}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = await self.client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content or ""

    async def transcribe(self, audio: bytes, filename: str) -> str:
        resp = await self.client.audio.transcriptions.create(
            model=self.stt_model,
            file=(filename, audio),
            language="ru",
        )
        return (resp.text or "").strip()

    async def aclose(self) -> None:
        await self.client.close()
