"""Кнопки бота: главное меню (внизу экрана) и инлайн-кнопки под сообщениями."""

from __future__ import annotations

from aiogram.types import InlineKeyboardMarkup, KeyboardButton, ReplyKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

BTN_DIARY = "🥒 Дневник"
BTN_ADD = "➕ Добавить блюдо"
BTN_WEIGHT = "⚖️ Вес"
BTN_REPORTS = "📊 Отчёты"
BTN_DINNER = "🍽 Что на ужин"
BTN_LABS = "🧪 Анализы"
BTN_CONSULT = "💬 Консультация"
BTN_PROFILE = "👤 Профиль"

MEAL_TYPES: dict[str, str] = {
    "breakfast": "🌅 Завтрак",
    "lunch": "🍲 Обед",
    "dinner": "🍽 Ужин",
    "snack": "🍎 Перекус",
}


def main_menu() -> ReplyKeyboardMarkup:
    rows = [
        [KeyboardButton(text=BTN_DIARY), KeyboardButton(text=BTN_ADD)],
        [KeyboardButton(text=BTN_WEIGHT), KeyboardButton(text=BTN_REPORTS)],
        [KeyboardButton(text=BTN_DINNER), KeyboardButton(text=BTN_LABS)],
        [KeyboardButton(text=BTN_CONSULT), KeyboardButton(text=BTN_PROFILE)],
    ]
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)


def sex_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="👨 Мужской", callback_data="sex:m")
    b.button(text="👩 Женский", callback_data="sex:f")
    b.adjust(2)
    return b.as_markup()


def activity_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="🛋 Сидячий", callback_data="act:low")
    b.button(text="🚶 1–3 тренировки", callback_data="act:light")
    b.button(text="🏋️ 3–5 тренировок", callback_data="act:medium")
    b.button(text="🔥 6–7 тренировок", callback_data="act:high")
    b.adjust(2)
    return b.as_markup()


def meal_type_kb(default: str) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    for key, title in MEAL_TYPES.items():
        label = f"✅ {title}" if key == default else title
        b.button(text=label, callback_data=f"mt:{key}")
    b.button(text="❌ Отмена", callback_data="mt:cancel")
    b.adjust(2, 2, 1)
    return b.as_markup()


def diary_kb(day: str, prev_day: str, next_day: str, today: str, meals: list[dict]) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    for m in meals:
        short = m["name"][:18]
        b.button(text=f"✏️ {short}", callback_data=f"medit:{m['id']}")
        b.button(text="🗑", callback_data=f"mdel:{m['id']}")
    if meals:
        b.adjust(*([2] * len(meals)))
    nav = [
        ("◀️", f"dnav:{prev_day}"),
        ("📅 Сегодня", f"dnav:{today}"),
        ("▶️", f"dnav:{next_day}"),
    ]
    for text, data in nav:
        b.button(text=text, callback_data=data)
    b.button(text="➕ Добавить на эту дату", callback_data=f"dadd:{day}")
    b.button(text="📈 График дня", callback_data=f"dgraph:{day}")
    # Навигация — 3 в ряд, действия — по одной кнопке
    rows = [2] * len(meals) if meals else []
    rows += [3, 1, 1]
    b.adjust(*rows)
    return b.as_markup()


def reports_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="🍴 Сегодня по приёмам", callback_data="rep:day")
    b.button(text="📆 Неделя", callback_data="rep:week")
    b.button(text="🏁 С начала", callback_data="rep:all")
    b.adjust(1)
    return b.as_markup()


def profile_kb(detailed: bool) -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="✏️ Заполнить заново", callback_data="prof:edit")
    state = "выкл" if detailed else "вкл"
    b.button(text=f"🧠 Развёрнутые ответы: {state}", callback_data="prof:detail")
    b.adjust(1)
    return b.as_markup()
