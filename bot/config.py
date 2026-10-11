"""Настройки из переменных окружения (на Amvera задаются в панели, локально — через export)."""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_CA_CERT = "certs/russian_trusted_root_ca.pem"


@dataclass(frozen=True)
class Settings:
    bot_token: str
    timezone: str
    db_path: str
    # GigaChat (основной, из России работает, есть бесплатная квота)
    gigachat_auth_key: str | None
    gigachat_scope: str
    gigachat_model: str
    gigachat_vision_model: str
    gigachat_ca_cert: str | None
    gigachat_verify_ssl: bool
    # OpenAI (запасной)
    openai_api_key: str | None
    openai_model: str
    whisper_model: str


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def load_settings() -> Settings:
    token = _env("BOT_TOKEN")
    if not token:
        raise RuntimeError(
            "Не задан BOT_TOKEN. Получите токен у @BotFather и добавьте переменную окружения."
        )
    ca = _env("GIGACHAT_CA_CERT") or (DEFAULT_CA_CERT if os.path.exists(DEFAULT_CA_CERT) else "")
    return Settings(
        bot_token=token,
        timezone=_env("TIMEZONE", "Europe/Moscow"),
        # На Amvera укажите DB_PATH=/data/bot.db — папка /data сохраняется между деплоями
        db_path=_env("DB_PATH", "data/bot.db"),
        gigachat_auth_key=_env("GIGACHAT_AUTH_KEY") or None,
        gigachat_scope=_env("GIGACHAT_SCOPE", "GIGACHAT_API_PERS"),
        gigachat_model=_env("GIGACHAT_MODEL", "GigaChat-2"),
        gigachat_vision_model=_env("GIGACHAT_VISION_MODEL", "GigaChat-2-Max"),
        gigachat_ca_cert=ca or None,
        gigachat_verify_ssl=_env("GIGACHAT_VERIFY_SSL", "true").lower() not in {"0", "false", "no"},
        openai_api_key=_env("OPENAI_API_KEY") or None,
        openai_model=_env("OPENAI_MODEL", "gpt-4o-mini"),
        whisper_model=_env("WHISPER_MODEL", "whisper-1"),
    )
