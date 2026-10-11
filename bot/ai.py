"""ИИ-функции через OpenAI: оценка блюда по фото/тексту, голос, консультации, анализы.

Если OPENAI_API_KEY не задан, enabled = False и бот работает без ИИ (ручной ввод).
"""

from __future__ import annotations

import base64
import json
import logging

from openai import AsyncOpenAI

log = logging.getLogger(__name__)

PERSONA = (
    "Ты — ИИ-ассистент по питанию: нутрициолог, диетолог и фитнес-тренер с 10-летним опытом. "
    "Отвечай по-русски, дружелюбно, с эмодзи (например 🥒). "
    "Ты не заменяешь врача: при симптомах и результатах анализов советуй показать их врачу."
)

MEAL_JSON_HINT = (
    'Верни ТОЛЬКО JSON вида {"name": "краткое название блюда", "kcal": число, '
    '"protein": число, "fat": число, "carbs": число}. '
    "Значения — на всю порцию, которая видна или описана; если порция не указана, "
    "считай стандартную. Числа без единиц измерения."
)


class AIService:
    def __init__(self, api_key: str | None, chat_model: str, stt_model: str):
        self.enabled = bool(api_key)
        self.chat_model = chat_model
        self.stt_model = stt_model
        self.client = AsyncOpenAI(api_key=api_key) if api_key else None

    async def _chat(self, messages: list[dict], json_mode: bool = False, temperature: float = 0.4) -> str:
        kwargs = {"model": self.chat_model, "messages": messages, "temperature": temperature}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        resp = await self.client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content or ""

    async def _chat_json(self, messages: list[dict]) -> dict:
        raw = await self._chat(messages, json_mode=True, temperature=0.1)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            log.warning("ИИ вернул не JSON: %s", raw[:200])
            return {}

    @staticmethod
    def _image_part(image: bytes) -> dict:
        b64 = base64.b64encode(image).decode("ascii")
        return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}

    @staticmethod
    def _normalize_meal(data: dict, fallback_name: str) -> dict:
        def num(key: str) -> float:
            try:
                return float(str(data.get(key, 0)).replace(",", "."))
            except ValueError:
                return 0.0

        return {
            "name": str(data.get("name") or fallback_name)[:80],
            "kcal": num("kcal"),
            "protein": num("protein"),
            "fat": num("fat"),
            "carbs": num("carbs"),
        }

    # ---------- питание ----------

    async def estimate_meal(self, description: str) -> dict:
        """Оценка КБЖУ по текстовому описанию блюда."""
        data = await self._chat_json(
            [
                {"role": "system", "content": PERSONA + " " + MEAL_JSON_HINT},
                {"role": "user", "content": description},
            ]
        )
        return self._normalize_meal(data, description)

    async def analyze_food_photo(self, image: bytes) -> dict:
        """Распознавание блюда и КБЖУ по фото."""
        data = await self._chat_json(
            [
                {"role": "system", "content": PERSONA + " " + MEAL_JSON_HINT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Что на фото? Оцени КБЖУ."},
                        self._image_part(image),
                    ],
                },
            ]
        )
        return self._normalize_meal(data, "Блюдо с фото")

    async def transcribe(self, audio: bytes, filename: str = "voice.ogg") -> str:
        """Голос -> текст (Whisper)."""
        resp = await self.client.audio.transcriptions.create(
            model=self.stt_model,
            file=(filename, audio),
            language="ru",
        )
        return (resp.text or "").strip()

    async def consult(self, question: str, context: str, detailed: bool) -> str:
        style = (
            "Отвечай развёрнуто: разбей по пунктам, приведи примеры блюд с граммовками "
            "и объясни причины."
            if detailed
            else "Отвечай кратко: 2–4 предложения по сути."
        )
        return await self._chat(
            [
                {"role": "system", "content": f"{PERSONA} {style}\nДанные клиента: {context}"},
                {"role": "user", "content": question},
            ]
        )

    async def dinner_ideas(self, remaining: str, context: str) -> str:
        return await self._chat(
            [
                {
                    "role": "system",
                    "content": (
                        f"{PERSONA} Предложи 3 варианта ужина, которые впишутся в остаток КБЖУ "
                        "на сегодня. Для каждого — название, ~ккал и БЖУ. Коротко.\n"
                        f"Данные клиента: {context}"
                    ),
                },
                {"role": "user", "content": f"Остаток на сегодня: {remaining}"},
            ]
        )

    # ---------- анализы ----------

    async def extract_labs(self, image: bytes) -> list[dict]:
        """Показатели из скриншота/фото анализов: [{name, value, unit, ref}]."""
        data = await self._chat_json(
            [
                {
                    "role": "system",
                    "content": (
                        "Извлеки показатели из медицинского анализа на изображении. "
                        'Верни JSON {"indicators": [{"name": "название показателя", '
                        '"value": "значение как строка", "unit": "единицы", '
                        '"ref": "референсный диапазон или пусто"}]}. Только то, что видно.'
                    ),
                },
                {"role": "user", "content": [self._image_part(image)]},
            ]
        )
        items = data.get("indicators", []) if isinstance(data, dict) else []
        return [
            {
                "name": str(i.get("name", "")).strip(),
                "value": str(i.get("value", "")).strip(),
                "unit": str(i.get("unit", "")).strip(),
                "ref": str(i.get("ref", "")).strip(),
            }
            for i in items
            if isinstance(i, dict) and i.get("name")
        ]

    async def lab_advice(self, summary: str, context: str, detailed: bool) -> str:
        style = "Разбери по пунктам, с продуктами." if detailed else "Коротко: 3–4 рекомендации по питанию."
        return await self._chat(
            [
                {
                    "role": "system",
                    "content": (
                        f"{PERSONA} Дай рекомендации по питанию на основе анализов. {style} "
                        "Не ставь диагнозы, в конце напомни про консультацию врача.\n"
                        f"Данные клиента: {context}"
                    ),
                },
                {"role": "user", "content": summary},
            ]
        )
