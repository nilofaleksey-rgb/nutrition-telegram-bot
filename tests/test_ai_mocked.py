"""ИИ-слой с подменённым клиентом OpenAI: проверяем разбор ответов, без сети."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from bot.ai import AIService


def _resp(content: str):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class AIMockedTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.ai = AIService(api_key="sk-test", chat_model="m", stt_model="w")
        self.create = AsyncMock()
        self.ai.client.chat.completions.create = self.create

    def test_disabled_without_key(self):
        self.assertFalse(AIService(api_key=None, chat_model="m", stt_model="w").enabled)

    async def test_estimate_meal_parses_json(self):
        self.create.return_value = _resp(json.dumps(
            {"name": "Борщ", "kcal": "320", "protein": 12.5, "fat": 9, "carbs": 40}
        ))
        m = await self.ai.estimate_meal("борщ 300 г")
        self.assertEqual(m["name"], "Борщ")
        self.assertEqual(m["kcal"], 320.0)
        kwargs = self.create.call_args.kwargs
        self.assertEqual(kwargs["response_format"], {"type": "json_object"})

    async def test_bad_json_becomes_zero_kcal(self):
        self.create.return_value = _resp("не JSON")
        m = await self.ai.estimate_meal("что-то")
        self.assertEqual(m["kcal"], 0.0)  # обработчик это увидит и попросит ввести ккал вручную

    async def test_photo_sends_image_part(self):
        self.create.return_value = _resp('{"name": "Омлет", "kcal": 280, "protein": 20, "fat": 20, "carbs": 6}')
        m = await self.ai.analyze_food_photo(b"\xff\xd8fake")
        self.assertEqual(m["name"], "Омлет")
        content = self.create.call_args.kwargs["messages"][1]["content"]
        self.assertTrue(any(p.get("type") == "image_url" for p in content))

    async def test_labs_extraction_filters_bad_rows(self):
        self.create.return_value = _resp(json.dumps({"indicators": [
            {"name": "Гемоглобин", "value": "135", "unit": "г/л", "ref": "120-150"},
            {"value": "10"},  # без названия — отбрасываем
        ]}))
        items = await self.ai.extract_labs(b"img")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["name"], "Гемоглобин")

    async def test_transcribe_returns_text(self):
        self.ai.client.audio.transcriptions.create = AsyncMock(return_value=SimpleNamespace(text=" Овсянка 200 ккал "))
        text = await self.ai.transcribe(b"ogg-bytes")
        self.assertEqual(text, "Овсянка 200 ккал")

    async def test_consult_style_depends_on_detail(self):
        self.create.return_value = _resp("ответ")
        await self.ai.consult("вопрос", "ctx", detailed=True)
        self.assertIn("развёрнуто", self.create.call_args.kwargs["messages"][0]["content"])
        await self.ai.consult("вопрос", "ctx", detailed=False)
        self.assertIn("кратко", self.create.call_args.kwargs["messages"][0]["content"])


if __name__ == "__main__":
    unittest.main()
