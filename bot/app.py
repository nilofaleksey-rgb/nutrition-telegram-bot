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
from .config import Settings, load_settings
from .db import Repo
from .handlers import router
from .llm import GigaChatBackend, OpenAIBackend


def build_ai(settings: Settings) -> AIService:
    log = logging.getLogger(__name__)
    if settings.gigachat_auth_key:
        log.info("ИИ: GigaChat (%s / фото: %s)", settings.gigachat_model, settings.gigachat_vision_model)
        return AIService(GigaChatBackend(
            settings.gigachat_auth_key,
            scope=settings.gigachat_scope,
            model=settings.gigachat_model,
            vision_model=settings.gigachat_vision_model,
            ca_cert=settings.gigachat_ca_cert,
            verify_ssl=settings.gigachat_verify_ssl,
        ))
    if settings.openai_api_key:
        log.info("ИИ: OpenAI (%s)", settings.openai_model)
        return AIService(OpenAIBackend(settings.openai_api_key, settings.openai_model, settings.whisper_model))
    log.warning("Ключ ИИ не задан (GIGACHAT_AUTH_KEY / OPENAI_API_KEY): фото, консультации и анализы отключены.")
    return AIService(None)


async def run() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    settings = load_settings()

    repo = Repo(settings.db_path)
    ai = build_ai(settings)

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
    try:
        await dp.start_polling(bot)
    finally:
        await ai.close()


def main() -> None:
    asyncio.run(run())
