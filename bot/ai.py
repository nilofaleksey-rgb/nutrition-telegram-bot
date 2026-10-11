"""ИИ-функции поверх выбранного бэкенда (GigaChat или OpenAI): фото, консультации, анализы, оценка блюд.

Если бэкенд не настроен, enabled = False и бот работает без ИИ (ручной ввод).
"""

from __future__ import annotations

import json
import logging

from .llm import ChatBackend, ChatMessage

log = logging.getLogger(__name__)

PERSONA = (
    "Ты — ИИ-ассистент по питанию: нутрициолог, диетолог и фитнес-тренер с 10-летним опытом. "
    "Отвечай по-русски, дружелюбно, с эмодзи (например 🥒). "
    "Ты не заменяешь врача: при симптомах и результатах анализов советуй показать их врачу."
)

MEAL_JSON_HINT = (
    'Верни JSON вида {"name": "краткое название блюда", "kcal": число, '
    '"protein": число, "fat": число, "carbs": число}. '
    "Значения — на всю порцию, которая видна или описана; если порция не указана, "
    "считай стандартную. Числа без единиц измерения."
)


def _extract_json(raw: str) -> dict:
    """Достаёт JSON из ответа модели, даже если он обёрнут в ```json ... ``` или с пояснениями."""
    text = (raw or "").strip()
    if "```" in text:
        text = text.split("```json")[-1].split("```")[0] if "```json" in text else text.split("```")[1]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        log.warning("ИИ вернул не JSON: %s", raw[:200])
        return {}
    try:
        data = json.loads(text[start:end + 1])
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        log.warning("ИИ вернул битый JSON: %s", raw[:200])
        return {}


class AIService:
    def __init__(self, backend: ChatBackend | None):
        self.backend = backend

    @property
    def enabled(self) -> bool:
        return self.backend is not None

    @property
    def supports_voice(self) -> bool:
        return self.enabled and self.backend.supports_voice

    async def close(self) -> None:
        if self.backend:
            await self.backend.aclose()

    async def _chat(self, messages: list[ChatMessage], temperature: float = 0.4) -> str:
        return await self.backend.chat(messages, temperature=temperature)

    async def _chat_json(self, messages: list[ChatMessage]) -> dict:
        raw = await self.backend.chat(messages, json_mode=True, temperature=0.1)
        return _extract_json(raw)

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
        data = await self._chat_json([
            ChatMessage("system", f"{PERSONA} {MEAL_JSON_HINT}"),
            ChatMessage("user", description),
        ])
        return self._normalize_meal(data, description)

    async def analyze_food_photo(self, image: bytes) -> dict:
        """Распознавание блюда и КБЖУ по фото."""
        data = await self._chat_json([
            ChatMessage("system", f"{PERSONA} {MEAL_JSON_HINT}"),
            ChatMessage("user", "Что на фото? Оцени КБЖУ.", images=[image]),
        ])
        return self._normalize_meal(data, "Блюдо с фото")

    async def transcribe(self, audio: bytes, filename: str = "voice.ogg") -> str:
        return (await self.backend.transcribe(audio, filename)).strip()

    async def consult(self, question: str, context: str, detailed: bool) -> str:
        style = (
            "Отвечай развёрнуто: разбей по пунктам, приведи примеры блюд с граммовками "
            "и объясни причины."
            if detailed
            else "Отвечай кратко: 2–4 предложения по сути."
        )
        return await self._chat([
            ChatMessage("system", f"{PERSONA} {style}\nДанные клиента: {context}"),
            ChatMessage("user", question),
        ])

    async def dinner_ideas(self, remaining: str, context: str) -> str:
        return await self._chat([
            ChatMessage("system", (
                f"{PERSONA} Предложи 3 варианта ужина, которые впишутся в остаток КБЖУ "
                "на сегодня. Для каждого — название, ~ккал и БЖУ. Коротко.\n"
                f"Данные клиента: {context}"
            )),
            ChatMessage("user", f"Остаток на сегодня: {remaining}"),
        ])

    # ---------- анализы ----------

    async def extract_labs(self, image: bytes) -> list[dict]:
        """Показатели из скриншота/фото анализов: [{name, value, unit, ref}]."""
        data = await self._chat_json([
            ChatMessage("system", (
                "Извлеки показатели из медицинского анализа на изображении. "
                'Верни JSON {"indicators": [{"name": "название показателя", '
                '"value": "значение как строка", "unit": "единицы", '
                '"ref": "референсный диапазон или пусто"}]}. Только то, что видно.'
            )),
            ChatMessage("user", "Покажи показатели с изображения.", images=[image]),
        ])
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
        return await self._chat([
            ChatMessage("system", (
                f"{PERSONA} Дай рекомендации по питанию на основе анализов. {style} "
                "Не ставь диагнозы, в конце напомни про консультацию врача.\n"
                f"Данные клиента: {context}"
            )),
            ChatMessage("user", summary),
        ])
