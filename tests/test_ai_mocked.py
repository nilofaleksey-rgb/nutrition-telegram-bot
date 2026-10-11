"""ИИ-слой без сети: разбор ответов и формат запросов GigaChat и OpenAI."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from bot.ai import AIService, _extract_json
from bot.llm import ChatBackend, ChatMessage, GigaChatBackend, OpenAIBackend


class ScriptedBackend(ChatBackend):
    """Бэкенд, который отдаёт заранее заданный ответ и запоминает запросы."""

    supports_voice = True

    def __init__(self, reply: str):
        self.reply = reply
        self.calls: list[dict] = []

    async def chat(self, messages, json_mode=False, temperature=0.4):
        self.calls.append({"messages": messages, "json_mode": json_mode})
        return self.reply

    async def transcribe(self, audio, filename):
        return " Овсянка 200 ккал "


class AIServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_disabled_without_backend(self):
        ai = AIService(None)
        self.assertFalse(ai.enabled)
        self.assertFalse(ai.supports_voice)

    def test_extract_json_variants(self):
        self.assertEqual(_extract_json('{"a": 1}'), {"a": 1})
        self.assertEqual(_extract_json('Вот ответ:\n```json\n{"kcal": 300}\n```'), {"kcal": 300})
        self.assertEqual(_extract_json("совсем не json"), {})

    async def test_estimate_meal_normalizes_numbers(self):
        backend = ScriptedBackend('{"name": "Борщ", "kcal": "320", "protein": 12.5, "fat": 9, "carbs": 40}')
        m = await AIService(backend).estimate_meal("борщ 300 г")
        self.assertEqual((m["name"], m["kcal"], m["protein"]), ("Борщ", 320.0, 12.5))
        self.assertTrue(backend.calls[0]["json_mode"])

    async def test_bad_json_gives_zero_kcal(self):
        m = await AIService(ScriptedBackend("не JSON")).estimate_meal("что-то")
        self.assertEqual(m["kcal"], 0.0)

    async def test_photo_passes_image_bytes(self):
        backend = ScriptedBackend('{"name": "Омлет", "kcal": 280}')
        m = await AIService(backend).analyze_food_photo(b"jpeg")
        self.assertEqual(m["name"], "Омлет")
        self.assertEqual(backend.calls[0]["messages"][1].images, [b"jpeg"])

    async def test_labs_filter_bad_rows(self):
        backend = ScriptedBackend(json.dumps({"indicators": [
            {"name": "Гемоглобин", "value": "135", "unit": "г/л", "ref": "120-150"},
            {"value": "10"},
        ]}))
        items = await AIService(backend).extract_labs(b"img")
        self.assertEqual([i["name"] for i in items], ["Гемоглобин"])

    async def test_voice_goes_to_backend(self):
        ai = AIService(ScriptedBackend(""))
        self.assertEqual(await ai.transcribe(b"ogg"), "Овсянка 200 ккал")

    async def test_consult_style(self):
        backend = ScriptedBackend("ответ")
        ai = AIService(backend)
        await ai.consult("вопрос", "ctx", detailed=True)
        self.assertIn("развёрнуто", backend.calls[-1]["messages"][0].text)
        await ai.consult("вопрос", "ctx", detailed=False)
        self.assertIn("кратко", backend.calls[-1]["messages"][0].text)


def _gigachat_transport(log: list, chat_reply: str = "ok", expire_first_chat: bool = False):
    """Фейковый GigaChat: OAuth, загрузка файлов, чат."""
    state = {"chat_calls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        log.append((request.method, url, dict(request.headers)))
        if url.endswith("/api/v2/oauth"):
            return httpx.Response(200, json={"access_token": f"tok{len(log)}", "expires_at": 9999999999999})
        if url.endswith("/api/v1/files"):
            return httpx.Response(200, json={"id": "file-123"})
        if url.endswith("/api/v1/chat/completions"):
            state["chat_calls"] += 1
            if expire_first_chat and state["chat_calls"] == 1:
                return httpx.Response(401, json={"message": "token expired"})
            return httpx.Response(200, json={"choices": [{"message": {"content": chat_reply}}]})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


class GigaChatBackendTests(unittest.IsolatedAsyncioTestCase):
    async def test_oauth_then_chat_with_bearer_and_model(self):
        log: list = []
        backend = GigaChatBackend("BASE64KEY", transport=_gigachat_transport(log, '{"kcal": 1}'))
        reply = await backend.chat([ChatMessage("system", "s"), ChatMessage("user", "u")], json_mode=True)
        self.assertEqual(reply, '{"kcal": 1}')

        oauth = log[0]
        self.assertEqual(oauth[0], "POST")
        self.assertTrue(oauth[1].endswith("/api/v2/oauth"))
        self.assertEqual(oauth[2]["authorization"], "Basic BASE64KEY")
        self.assertIn("rquid", oauth[2])

        chat = log[-1]
        self.assertTrue(chat[2]["authorization"].startswith("Bearer tok"))
        await backend.aclose()

    async def test_token_is_cached_between_calls(self):
        log: list = []
        backend = GigaChatBackend("K", transport=_gigachat_transport(log))
        await backend.chat([ChatMessage("user", "a")])
        await backend.chat([ChatMessage("user", "b")])
        oauth_calls = [c for c in log if c[1].endswith("/oauth")]
        self.assertEqual(len(oauth_calls), 1)
        await backend.aclose()

    async def test_photo_is_uploaded_and_attached_with_vision_model(self):
        log: list = []
        seen_bodies: list = []
        base = _gigachat_transport(log, "{}")

        def spy(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/chat/completions"):
                seen_bodies.append(json.loads(request.content))
            return base.handle_request(request)

        backend = GigaChatBackend("K", transport=httpx.MockTransport(spy), vision_model="VISION")
        await backend.chat([ChatMessage("user", "что на фото", images=[b"jpg-bytes"])])
        self.assertTrue(any(c[1].endswith("/api/v1/files") for c in log))
        body = seen_bodies[-1]
        self.assertEqual(body["model"], "VISION")
        self.assertEqual(body["messages"][0]["attachments"], ["file-123"])
        await backend.aclose()

    async def test_expired_token_is_refreshed_once(self):
        log: list = []
        backend = GigaChatBackend("K", transport=_gigachat_transport(log, "ok", expire_first_chat=True))
        reply = await backend.chat([ChatMessage("user", "a")])
        self.assertEqual(reply, "ok")
        oauth_calls = [c for c in log if c[1].endswith("/oauth")]
        self.assertEqual(len(oauth_calls), 2)
        await backend.aclose()


class OpenAIBackendTests(unittest.IsolatedAsyncioTestCase):
    async def test_chat_uses_json_mode_and_images(self):
        backend = OpenAIBackend("sk-test")
        create = AsyncMock(return_value=SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"name": "x"}'))]
        ))
        backend.client.chat.completions.create = create
        out = await backend.chat([ChatMessage("user", "фото", images=[b"img"])], json_mode=True)
        self.assertEqual(out, '{"name": "x"}')
        kwargs = create.call_args.kwargs
        self.assertEqual(kwargs["response_format"], {"type": "json_object"})
        self.assertEqual(kwargs["messages"][0]["content"][1]["type"], "image_url")
        await backend.aclose()


if __name__ == "__main__":
    unittest.main()
