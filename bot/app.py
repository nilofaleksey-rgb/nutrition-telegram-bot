"""Запуск бота: подключение к Telegram, база, ИИ, обработчики."""

from __future__ import annotations

import asyncio
import logging
from zoneinfo import ZoneInfo

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand

from .ai import AIService
from .config import load_settings
from .db import Repo
from .handlers import router


async def run() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    settings = load_settings()

    repo = Repo(settings.db_path)
    ai = AIService(settings.openai_api_key, settings.openai_model, settings.whisper_model)
    if not ai.enabled:
        logging.getLogger(__name__).warning(
            "OPENAI_API_KEY не задан: фото, голос, консультации и анализы отключены."
        )

    bot = Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dp = Dispatcher(storage=MemoryStorage())
    dp.include_router(router)
    # Эти объекты доступны обработчикам по имени аргумента: repo, ai, tz
    dp["repo"] = repo
    dp["ai"] = ai
    dp["tz"] = ZoneInfo(settings.timezone)

    await bot.set_my_commands([
        BotCommand(command="start", description="🥒 Главное меню"),
        BotCommand(command="help", description="Как пользоваться"),
        BotCommand(command="cancel", description="Отменить текущий шаг"),
    ])
    await bot.delete_webhook(drop_pending_updates=True)
    logging.getLogger(__name__).info("Бот запущен, начинаю polling…")
    await dp.start_polling(bot)


def main() -> None:
    asyncio.run(run())
