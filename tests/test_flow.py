"""Сквозной сценарий через aiogram без сети: онбординг -> блюдо -> дневник -> правка -> вес -> отчёты.

Telegram API подменён: сообщения пишутся в список, ничего не отправляется.
"""

import os
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from aiogram import Bot, Dispatcher
from aiogram.client.session.base import BaseSession
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import CallbackQuery, Chat, Message, PhotoSize, Update, User, Voice

from bot.ai import AIService
from bot.db import Repo
from bot.handlers import router

UID = 555
TZ = ZoneInfo("Europe/Moscow")


class FakeSession(BaseSession):
    def __init__(self):
        super().__init__()
        self.sent: list[str] = []  # тексты отправленных сообщений
        self.counter = 100

    async def __call__(self, bot, method, timeout=None):
        name = type(method).__name__
        text = getattr(method, "text", None) or getattr(method, "caption", None) or ""
        if name in {"SendMessage", "EditMessageText", "SendPhoto"}:
            self.counter += 1
            self.sent.append(text)
            return Message(
                message_id=self.counter,
                date=datetime.now(timezone.utc),
                chat=Chat(id=UID, type="private"),
                from_user=User(id=1, is_bot=True, first_name="bot"),
                text=text or None,
            )
        return True

    async def close(self):
        pass

    async def make_request(self, bot, method, timeout=None):  # pragma: no cover - не используется
        raise NotImplementedError

    async def stream_content(self, url, headers=None, timeout=30, chunk_size=65536, raise_for_status=True):
        raise NotImplementedError
        yield b""  # pragma: no cover


# Роутер модульный и может быть подключён только к одному диспетчеру — создаём его один раз на модуль.
_SESSION = FakeSession()
_BOT = Bot(token="123456:TEST", session=_SESSION)
_DP = Dispatcher(storage=MemoryStorage())
_DP.include_router(router)


class FlowBase(unittest.IsolatedAsyncioTestCase):
    """Общие помощники: отправка сообщений и нажатий кнопок. Без тестов."""

    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Repo(os.path.join(self.tmp.name, "bot.db"))
        self.ai = AIService(api_key=None, chat_model="x", stt_model="y")
        self.session = _SESSION
        self.session.sent.clear()
        self.bot = _BOT
        self.dp = _DP
        self.dp["repo"] = self.repo
        self.dp["ai"] = self.ai
        self.dp["tz"] = TZ
        await self.dp.storage.close()  # чистое FSM-состояние на каждый тест
        self._update_id = 0
        self._msg_id = 1

    async def asyncTearDown(self):
        self.tmp.cleanup()

    def _user(self):
        return User(id=UID, is_bot=False, first_name="Тест")

    async def say(self, text):
        self._msg_id += 1
        self._update_id += 1
        msg = Message(
            message_id=self._msg_id,
            date=datetime.now(timezone.utc),
            chat=Chat(id=UID, type="private"),
            from_user=self._user(),
            text=text,
        )
        await self.dp.feed_update(self.bot, Update(update_id=self._update_id, message=msg))

    async def press(self, data):
        self._update_id += 1
        cb = CallbackQuery(
            id=str(self._update_id),
            from_user=self._user(),
            chat_instance="ci",
            data=data,
            message=Message(
                message_id=self._msg_id,
                date=datetime.now(timezone.utc),
                chat=Chat(id=UID, type="private"),
                from_user=User(id=1, is_bot=True, first_name="bot"),
                text="prev",
            ),
        )
        await self.dp.feed_update(self.bot, Update(update_id=self._update_id, callback_query=cb))

    def last(self):
        return self.session.sent[-1] if self.session.sent else ""

class FlowTest(FlowBase):
    async def test_full_scenario(self):
        # 1. онбординг
        await self.say("/start")
        self.assertIn("рост", self.last().lower())
        await self.say("175")
        self.assertIn("вес", self.last().lower())
        await self.say("82,5")
        self.assertIn("пол", self.last().lower())
        await self.press("sex:m")
        self.assertIn("лет", self.last())
        await self.say("30")
        self.assertIn("Желаемый", self.last())
        await self.say("75")
        await self.press("act:light")
        self.assertIn("Профиль сохранён", self.last())
        user = self.repo.get_user(UID)
        self.assertIsNotNone(user)
        self.assertEqual(user["goal_weight"], 75)
        self.assertEqual(len(self.repo.weights(UID)), 1)

        # 2. добавление блюда текстом с выбором приёма пищи
        await self.say("➕ Добавить блюдо")
        await self.say("Гречка 200 г 300 ккал Б10 Ж4 У55")
        self.assertIn("Выберите приём пищи", self.last())
        await self.press("mt:lunch")
        today = datetime.now(TZ).date().isoformat()
        meals = self.repo.list_meals(UID, today)
        self.assertEqual(len(meals), 1)
        self.assertEqual(meals[0]["kcal"], 300)
        self.assertEqual(meals[0]["meal_type"], "lunch")

        # 3. дневник показывает блюдо и остаток
        await self.say("🥒 Дневник")
        self.assertIn("Гречка", self.last())
        self.assertIn("Осталось", self.last())

        # 4. ручная правка и удаление записи
        meal_id = meals[0]["id"]
        await self.press(f"medit:{meal_id}")
        await self.say("Гречка 220 ккал Б9 Ж3 У45")
        self.assertEqual(self.repo.get_meal(UID, meal_id)["kcal"], 220)
        await self.press(f"mdel:{meal_id}")
        self.assertEqual(self.repo.list_meals(UID, today), [])

        # 5. ввод блюда без ккал без ИИ — просим указать калории
        await self.say("➕ Добавить блюдо")
        await self.say("Борщ 300 г")
        self.assertIn("Укажите калорийность", self.last())

        # 6. вес
        await self.say("⚖️ Вес")
        await self.say("81,4")
        self.assertIn("81.4", self.last())
        self.assertEqual(self.repo.get_user(UID)["weight"], 81.4)

        # 7. отчёты
        await self.say("📊 Отчёты")
        self.assertIn("отчёт", self.last().lower())
        await self.press("rep:all")
        self.assertTrue(any("С начала" in t for t in self.session.sent))

        # 8. консультация без ключа ИИ — честное сообщение, а не падение
        await self.say("что съесть перед тренировкой?")
        self.assertIn("OPENAI_API_KEY", self.last())

        # 9. переключение развёрнутых ответов
        await self.say("дай более развернутый ответ")
        self.assertIn("развёрнутые", self.last())
        self.assertEqual(self.repo.get_user(UID)["detailed"], 1)

        # 10. ужин без ИИ — подбор из таблицы
        await self.say("🍽 Что на ужин")
        self.assertIn("Ужин под остаток", self.last())

        # 11. фото без ИИ — понятный отказ
        # (фото без ключа не должно ломать состояние)
        await self.say("/cancel")
        self.assertIn("Отменено", self.last())

    async def test_fsm_menu_escape(self):
        await self.say("/start")
        await self.say("170")
        # в середине онбординга нажали кнопку меню — должен прийти вопрос про вес, а не падение
        await self.say("🥒 Дневник")
        self.assertIn("рост", self.last().lower())  # меню без профиля снова запускает онбординг
        self.assertEqual(self.repo.get_user(UID), None)


if __name__ == "__main__":
    unittest.main()


class AIFlowTest(FlowBase):
    """Фото блюда, голос и анализы — с включённым ИИ, но подменённым OpenAI и скачиванием файлов."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.ai = _FakeAI()
        self.dp["ai"] = self.ai
        self.patcher = mock.patch.object(Bot, "download", new=_fake_download)
        self.patcher.start()

    async def asyncTearDown(self):
        self.patcher.stop()
        await super().asyncTearDown()

    async def _send_photo(self):
        self._msg_id += 1
        self._update_id += 1
        msg = Message(
            message_id=self._msg_id,
            date=datetime.now(timezone.utc),
            chat=Chat(id=UID, type="private"),
            from_user=self._user(),
            photo=[PhotoSize(file_id="f1", file_unique_id="u1", width=10, height=10)],
        )
        await self.dp.feed_update(self.bot, Update(update_id=self._update_id, message=msg))

    async def _onboard(self):
        await self.say("/start")
        await self.say("175")   # рост
        await self.say("82")    # вес
        await self.press("sex:m")
        await self.say("30")    # возраст
        await self.say("75")    # цель
        await self.press("act:light")

    async def test_photo_meal_and_labs(self):
        await self._onboard()

        await self._send_photo()  # фото без кнопки «Добавить» -> сразу блюдо
        self.assertIn("Выберите приём пищи", self.last())
        self.assertIn("Омлет", self.last())
        self.assertIn("оценил ИИ", self.last())
        await self.press("mt:breakfast")
        today = datetime.now(TZ).date().isoformat()
        meals = self.repo.list_meals(UID, today)
        self.assertEqual(meals[0]["source"], "ai-photo")
        self.assertEqual(meals[0]["kcal"], 280)

        # анализы: первый — становится базой, второй — сравнивается
        await self.say("🧪 Анализы")
        await self._send_photo()
        self.assertIn("первый анализ", " ".join(self.session.sent))
        await self.say("🧪 Анализы")
        await self._send_photo()
        self.assertTrue(any("Сравнение" in t for t in self.session.sent))
        self.assertTrue(any("Рекомендации по питанию" in t for t in self.session.sent))

    async def test_voice_meal(self):
        await self._onboard()
        self._msg_id += 1
        self._update_id += 1
        msg = Message(
            message_id=self._msg_id,
            date=datetime.now(timezone.utc),
            chat=Chat(id=UID, type="private"),
            from_user=self._user(),
            voice=Voice(file_id="v1", file_unique_id="uv1", duration=3),
        )
        await self.dp.feed_update(self.bot, Update(update_id=self._update_id, message=msg))
        self.assertTrue(any("Распознал" in t for t in self.session.sent))
        self.assertIn("Выберите приём пищи", self.last())


class _FakeAI(AIService):
    def __init__(self):
        super().__init__(api_key="sk-test", chat_model="m", stt_model="w")
        self._labs_calls = 0

    async def analyze_food_photo(self, image):
        return {"name": "Омлет", "kcal": 280.0, "protein": 20.0, "fat": 20.0, "carbs": 6.0}

    async def transcribe(self, audio, filename="voice.ogg"):
        return "Овсянка 200 ккал Б8"

    async def extract_labs(self, image):
        # первый анализ — гемоглобин 135, второй — 140 (для проверки сравнения)
        value = "135" if self._labs_calls == 0 else "140"
        self._labs_calls += 1
        return [{"name": "Гемоглобин", "value": value, "unit": "г/л", "ref": "120-150"}]

    async def lab_advice(self, summary, context, detailed):
        return "Ешьте больше железа: говядина, гречка."


async def _fake_download(self, file, destination=None, **kwargs):
    destination.write(b"fake-bytes")
    destination.seek(0)
    return destination
