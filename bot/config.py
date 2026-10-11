"""Настройки из переменных окружения (на Amvera задаются в панели, локально — через export)."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    bot_token: str
    openai_api_key: str | None
    openai_model: str
    whisper_model: str
    db_path: str
    timezone: str


def load_settings() -> Settings:
    token = os.getenv("BOT_TOKEN", "").strip()
    if not token:
        raise RuntimeError(
            "Не задан BOT_TOKEN. Получите токен у @BotFather и добавьте переменную окружения."
        )
    return Settings(
        bot_token=token,
        openai_api_key=os.getenv("OPENAI_API_KEY", "").strip() or None,
        openai_model=os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip(),
        whisper_model=os.getenv("WHISPER_MODEL", "whisper-1").strip(),
        # На Amvera укажите DB_PATH=/data/bot.db — папка /data сохраняется между деплоями
        db_path=os.getenv("DB_PATH", "data/bot.db").strip(),
        timezone=os.getenv("TIMEZONE", "Europe/Moscow").strip(),
    )
