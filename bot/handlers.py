"""Все сценарии бота: онбординг, дневник, блюда (текст/голос/фото), вес, отчёты, анализы, консультации."""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta
from html import escape as esc
from io import BytesIO
from zoneinfo import ZoneInfo

from aiogram import Router, F
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command, CommandStart, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import BufferedInputFile, CallbackQuery, Message

from . import calc, charts
from . import keyboards as kb
from .ai import AIService
from .calc import Totals
from .db import Repo
from .parsing import parse_meal_text, parse_number

log = logging.getLogger(__name__)
router = Router(name="nutrition")


# ---------- состояния диалога ----------

class Onboarding(StatesGroup):
    height = State()
    weight = State()
    sex = State()
    age = State()
    goal = State()
    activity = State()


class MealInput(StatesGroup):
    waiting = State()    # ждём блюдо: текст, голос или фото
    choosing = State()   # блюдо распознано, выбираем приём пищи
    editing = State()    # редактируем существующую запись


class WeightInput(StatesGroup):
    value = State()


class LabsInput(StatesGroup):
    photo = State()


ADD_HINT = (
    "🍽 Что съели? Пришлите:\n"
    "• текст: <i>Гречка 200 г 300 ккал Б10 Ж4 У55</i>\n"
    "• 🎤 голосовое сообщение\n"
    "• 📸 фото блюда\n\n"
)
ADD_HINT_NO_AI = "Если ккал не знаете — укажите хотя бы примерные.\n"


# ---------- общие помощники ----------

def _today(tz: ZoneInfo) -> date:
    return datetime.now(tz).date()


def _targets(user: dict) -> calc.Targets:
    return calc.calc_targets(
        user["sex"], user["weight"], user["height"], user["age"], user["goal_weight"], user["activity"]
    )


def _sum_meals(meals: list[dict]) -> Totals:
    t = Totals()
    for m in meals:
        t = t + Totals(m["kcal"], m["protein"], m["fat"], m["carbs"])
    return t


def _day_label(day: str, today: str) -> str:
    d = date.fromisoformat(day)
    label = d.strftime("%d.%m.%Y")
    if day == today:
        return f"сегодня, {label}"
    if day == (date.fromisoformat(today) - timedelta(days=1)).isoformat():
        return f"вчера, {label}"
    return label


def _fmt_day(day: str) -> str:
    return date.fromisoformat(day).strftime("%d.%m.%Y")


def _guess_meal_type(hour: int) -> str:
    if hour < 11:
        return "breakfast"
    if hour < 16:
        return "lunch"
    if hour < 22:
        return "dinner"
    return "snack"


def _summary_block(t: calc.Targets, totals: Totals) -> str:
    left = t.kcal - totals.kcal
    status = f"✅ Осталось {left:.0f} ккал" if left >= 0 else f"⚠️ Перебор {-left:.0f} ккал"
    return (
        f"🔥 <b>Итого: {totals.kcal:.0f} / {t.kcal} ккал</b>\n"
        f"{calc.progress_bar(totals.kcal, t.kcal)}\n"
        f"{status}\n"
        f"Белки {totals.protein:.0f}/{t.protein} г · Жиры {totals.fat:.0f}/{t.fat} г · "
        f"Углеводы {totals.carbs:.0f}/{t.carbs} г"
    )


def _profile_context(user: dict, t: calc.Targets) -> str:
    sex = "мужской" if user["sex"] == "m" else "женский"
    return (
        f"пол {sex}, возраст {user['age']}, рост {user['height']:.0f} см, вес {user['weight']:.1f} кг, "
        f"цель {user['goal_weight']:.1f} кг, норма {t.kcal} ккал, Б {t.protein} г, Ж {t.fat} г, "
        f"У {t.carbs} г, активность: {calc.ACTIVITY_LEVELS[user['activity']][1]}"
    )


def build_day_text(repo: Repo, user: dict, day: str, today: str, with_advice: bool = True) -> tuple[str, list[dict]]:
    t = _targets(user)
    meals = repo.list_meals(user["user_id"], day)
    totals = _sum_meals(meals)

    lines = [f"🥒 <b>Дневник питания</b> — {_day_label(day, today)}", ""]
    if not meals:
        lines.append("Пока пусто. Добавьте блюдо кнопкой «➕ Добавить на эту дату» или пришлите его 📸🎤✍️")
        lines.append("")
    for key, title in kb.MEAL_TYPES.items():
        items = [m for m in meals if m["meal_type"] == key]
        if not items:
            continue
        sub = sum(m["kcal"] for m in items)
        lines.append(f"<b>{title}</b> — {sub:.0f} ккал")
        for m in items:
            lines.append(
                f"  • {esc(m['name'])}: {m['kcal']:.0f} ккал "
                f"(Б{m['protein']:.0f} Ж{m['fat']:.0f} У{m['carbs']:.0f})"
            )
        lines.append("")

    lines.append(_summary_block(t, totals))
    if with_advice:
        lines += ["", f"💡 {calc.advice_for_day(t, totals, detailed=bool(user['detailed']))}"]
    return "\n".join(lines), meals


async def send_day(msg: Message, repo: Repo, user: dict, day: str, today: str, edit: bool = False) -> None:
    text, meals = build_day_text(repo, user, day, today)
    d = date.fromisoformat(day)
    prev_day = (d - timedelta(days=1)).isoformat()
    next_day = min(d + timedelta(days=1), date.fromisoformat(today)).isoformat()
    markup = kb.diary_kb(day, prev_day, next_day, today, meals)
    if edit:
        try:
            await msg.edit_text(text, reply_markup=markup)
            return
        except TelegramBadRequest:
            pass  # текст не изменился или сообщение нельзя редактировать — отправим новое
    await msg.answer(text, reply_markup=markup)


async def send_long(msg: Message, text: str, markup=None) -> None:
    """Разбивает длинный текст на части (лимит Telegram — 4096 символов)."""
    chunks = [text[i:i + 3500] for i in range(0, len(text), 3500)] or [""]
    for i, chunk in enumerate(chunks):
        await msg.answer(chunk, reply_markup=markup if i == len(chunks) - 1 else None)


async def _require_user(user_id: int, msg: Message, state: FSMContext, repo: Repo) -> dict | None:
    user = repo.get_user(user_id)
    if not user:
        await start_onboarding(msg, state)
    return user


def _targets_text(user: dict, t: calc.Targets) -> str:
    goal = user["goal_weight"]
    diff = goal - user["weight"]
    if abs(diff) < 0.5:
        goal_line = f"🎯 Цель: поддерживать {goal:.1f} кг"
    elif diff < 0:
        goal_line = f"🎯 Цель: {goal:.1f} кг (минус {-diff:.1f} кг)"
    else:
        goal_line = f"🎯 Цель: {goal:.1f} кг (плюс {diff:.1f} кг)"
    return (
        f"🔥 Норма: <b>{t.kcal} ккал в день</b>\n"
        f"🥩 Белки {t.protein} г · 🥑 Жиры {t.fat} г · 🍞 Углеводы {t.carbs} г\n"
        f"{goal_line}"
    )


async def start_onboarding(msg: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(Onboarding.height)
    await msg.answer(
        "🥒 <b>Привет! Я ИИ-ассистент по питанию.</b>\n"
        "Настроим профиль — это займёт минуту. Потом рассчитаю норму калорий и БЖУ.\n\n"
        "📏 Укажите рост в сантиметрах, например <i>175</i>"
    )


async def _parse_meal_or_estimate(text: str, ai: AIService) -> tuple[dict | None, str | None]:
    """Текст -> блюдо с КБЖУ. Если ккал нет, оценивает ИИ. Возвращает (блюдо, ошибка)."""
    parsed = parse_meal_text(text)
    if parsed is None:
        return None, "Не понял блюдо 🤔 Пример: <i>Гречка 200 г 300 ккал Б10 Ж4 У55</i>"
    if not parsed.needs_estimate:
        return {
            "name": parsed.name,
            "kcal": parsed.kcal,
            "protein": parsed.protein or 0,
            "fat": parsed.fat or 0,
            "carbs": parsed.carbs or 0,
            "source": "manual",
        }, None
    if not ai.enabled:
        return None, (
            f"Укажите калорийность, например: <i>{esc(parsed.name)} 250 ккал</i>\n"
            "(если подключить ИИ, он оценит КБЖУ сам)"
        )
    try:
        est = await ai.estimate_meal(parsed.name)
    except Exception:
        log.exception("Ошибка оценки блюда ИИ")
        return None, "Не получилось оценить блюдо. Укажите ккал вручную, например: <i>Суп 300 ккал</i>"
    if est["kcal"] <= 0:
        return None, "Не смог определить калорийность. Напишите ккал вручную: <i>Суп 300 ккал</i>"
    est["source"] = "ai-text"
    return est, None


def _pending_card(p: dict) -> str:
    note = "\n<i>КБЖУ оценил ИИ — примерно.</i>" if p.get("source", "").startswith("ai") else ""
    return (
        f"🍽 <b>{esc(p['name'])}</b>\n"
        f"🔥 {p['kcal']:.0f} ккал · Б {p['protein']:.0f} г · Ж {p['fat']:.0f} г · У {p['carbs']:.0f} г"
        f"{note}\n\nВыберите приём пищи 👇"
    )


async def _show_pending(msg: Message, state: FSMContext, pending: dict, tz: ZoneInfo) -> None:
    await state.update_data(pending=pending)
    await state.set_state(MealInput.choosing)
    default = _guess_meal_type(datetime.now(tz).hour)
    await msg.answer(_pending_card(pending), reply_markup=kb.meal_type_kb(default))


async def _ensure_meal_state(state: FSMContext, tz: ZoneInfo) -> None:
    """Если блюдо прислали без кнопки «Добавить» (голос/фото), сразу переходим к вводу на сегодня."""
    if await state.get_state() is None:
        await state.set_state(MealInput.waiting)
        await state.update_data(day=_today(tz).isoformat())


# ---------- команды ----------

@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext, repo: Repo):
    await state.clear()
    if repo.get_user(message.from_user.id):
        await message.answer("🥒 С возвращением! Выберите действие в меню 👇", reply_markup=kb.main_menu())
        return
    await start_onboarding(message, state)


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext):
    await state.clear()
    await message.answer("❌ Отменено. Меню ниже 👇", reply_markup=kb.main_menu())


@router.message(Command("help"))
async def cmd_help(message: Message):
    await message.answer(
        "🥒 <b>Как пользоваться</b>\n\n"
        "🥒 Дневник — блюда за день, правка и удаление записей\n"
        "➕ Добавить блюдо — текст, голос или фото\n"
        "⚖️ Вес — промежуточный замер\n"
        "📊 Отчёты — за день, за неделю, с начала\n"
        "🍽 Что на ужин — подбор под остаток КБЖУ\n"
        "🧪 Анализы — фото анализов, сравнение с прошлыми\n"
        "💬 Консультация — напишите любой вопрос по питанию\n"
        "👤 Профиль — данные и норма\n\n"
        "Чтобы получить развёрнутый ответ, напишите: <i>дай более развернутый ответ</i>. "
        "Вернуть короткий: <i>коротко</i>.",
        reply_markup=kb.main_menu(),
    )


# ---------- главное меню (кнопки) ----------
# Регистрируются раньше обработчиков состояний: кнопка меню всегда выходит из текущего шага.

@router.message(F.text == kb.BTN_DIARY)
async def menu_diary(message: Message, state: FSMContext, repo: Repo, tz: ZoneInfo):
    await state.clear()
    user = await _require_user(message.from_user.id, message, state, repo)
    if not user:
        return
    today = _today(tz).isoformat()
    await send_day(message, repo, user, today, today)


@router.message(F.text == kb.BTN_ADD)
async def menu_add(message: Message, state: FSMContext, repo: Repo, tz: ZoneInfo, ai: AIService):
    await state.clear()
    user = await _require_user(message.from_user.id, message, state, repo)
    if not user:
        return
    await state.set_state(MealInput.waiting)
    await state.update_data(day=_today(tz).isoformat())
    hint = ADD_HINT + (ADD_HINT_NO_AI if not ai.enabled else "Ккал можно не писать: ИИ оценит блюдо сам.\n")
    await message.answer(hint + "\n/cancel — отмена")


@router.message(F.text == kb.BTN_WEIGHT)
async def menu_weight(message: Message, state: FSMContext, repo: Repo):
    await state.clear()
    user = await _require_user(message.from_user.id, message, state, repo)
    if not user:
        return
    await state.set_state(WeightInput.value)
    history = repo.weights(user["user_id"])
    last = f"\nПоследний замер: {history[-1][1]:.1f} кг ({_fmt_day(history[-1][0])})" if history else ""
    await message.answer(f"⚖️ Введите текущий вес в кг, например <i>81.4</i>.{last}\n/cancel — отмена")


@router.message(F.text == kb.BTN_REPORTS)
async def menu_reports(message: Message, state: FSMContext, repo: Repo):
    await state.clear()
    user = await _require_user(message.from_user.id, message, state, repo)
    if not user:
        return
    await message.answer("📊 Какой отчёт показать?", reply_markup=kb.reports_kb())


@router.message(F.text == kb.BTN_DINNER)
async def menu_dinner(message: Message, state: FSMContext, repo: Repo, tz: ZoneInfo, ai: AIService):
    await state.clear()
    user = await _require_user(message.from_user.id, message, state, repo)
    if not user:
        return
    t = _targets(user)
    today = _today(tz).isoformat()
    totals = _sum_meals(repo.list_meals(user["user_id"], today))
    left = t.kcal - totals.kcal
    if left <= 100:
        await message.answer(
            f"🍽 На сегодня норма почти закрыта (осталось {left:.0f} ккал).\n"
            "На ужин — лёгкий овощной салат с белком, около 200 ккал 🥒"
        )
        return

    remaining = (
        f"{left:.0f} ккал, белки {max(0, t.protein - totals.protein):.0f} г, "
        f"жиры {max(0, t.fat - totals.fat):.0f} г, углеводы {max(0, t.carbs - totals.carbs):.0f} г"
    )
    text = None
    if ai.enabled:
        try:
            text = esc(await ai.dinner_ideas(remaining, _profile_context(user, t)))
        except Exception:
            log.exception("Ошибка подбора ужина ИИ")
    if text is None:
        items = calc.dinner_suggestions(t, totals)
        text = "\n".join(items) if items else "Подходящих вариантов из базы нет — попробуйте ИИ-режим."
        text += "\n\n<i>Значения примерные. Точный подсчёт — когда добавите блюдо фото или текстом.</i>"
    await message.answer(f"🍽 <b>Ужин под остаток</b>: {remaining}\n\n{text}")


@router.message(F.text == kb.BTN_LABS)
async def menu_labs(message: Message, state: FSMContext, repo: Repo, ai: AIService):
    await state.clear()
    user = await _require_user(message.from_user.id, message, state, repo)
    if not user:
        return
    if not ai.enabled:
        await message.answer("🧪 Анализы распознаёт ИИ, а он пока не подключён (нужен OPENAI_API_KEY).")
        return
    await state.set_state(LabsInput.photo)
    await message.answer(
        "🧪 Пришлите фото или скриншот анализов (общий анализ крови, биохимия и т.п.).\n"
        "Я сравню показатели с прошлым анализом и дам рекомендации по питанию.\n\n/cancel — отмена"
    )


@router.message(F.text == kb.BTN_CONSULT)
async def menu_consult(message: Message, state: FSMContext, repo: Repo):
    await state.clear()
    user = await _require_user(message.from_user.id, message, state, repo)
    if not user:
        return
    await message.answer(
        "💬 Напишите вопрос по питанию, например: <i>что съесть перед тренировкой?</i>\n"
        "Для развёрнутого ответа добавьте: <i>дай более развернутый ответ</i>."
    )


@router.message(F.text == kb.BTN_PROFILE)
async def menu_profile(message: Message, state: FSMContext, repo: Repo, tz: ZoneInfo):
    await state.clear()
    user = await _require_user(message.from_user.id, message, state, repo)
    if not user:
        return
    await _send_profile(message, user)


async def _send_profile(msg: Message, user: dict) -> None:
    t = _targets(user)
    sex = "👨 мужской" if user["sex"] == "m" else "👩 женский"
    text = (
        "👤 <b>Ваш профиль</b>\n"
        f"Пол: {sex}\n"
        f"Возраст: {user['age']} лет · рост {user['height']:.0f} см\n"
        f"Вес: {user['weight']:.1f} кг\n"
        f"Активность: {calc.ACTIVITY_LEVELS[user['activity']][1]}\n\n"
        f"{_targets_text(user, t)}\n"
        f"Базовый обмен: {t.bmr} ккал · расход: {t.tdee} ккал"
    )
    await msg.answer(text, reply_markup=kb.profile_kb(bool(user["detailed"])))


# ---------- онбординг ----------

@router.message(Onboarding.height, F.text)
async def ob_height(message: Message, state: FSMContext):
    v = parse_number(message.text)
    if v is None or not 120 <= v <= 250:
        return await message.answer("Введите рост числом в сантиметрах (120–250), например <i>175</i>")
    await state.update_data(height=v)
    await state.set_state(Onboarding.weight)
    await message.answer("⚖️ Текущий вес в кг, например <i>82.5</i>")


@router.message(Onboarding.weight, F.text)
async def ob_weight(message: Message, state: FSMContext):
    v = parse_number(message.text)
    if v is None or not 30 <= v <= 300:
        return await message.answer("Введите вес числом в кг (30–300), например <i>82.5</i>")
    await state.update_data(weight=v)
    await state.set_state(Onboarding.sex)
    await message.answer("👤 Укажите пол:", reply_markup=kb.sex_kb())


@router.callback_query(Onboarding.sex, F.data.startswith("sex:"))
async def ob_sex(cb: CallbackQuery, state: FSMContext):
    await state.update_data(sex=cb.data.split(":")[1])
    await state.set_state(Onboarding.age)
    await cb.answer()
    await cb.message.answer("🎂 Сколько вам лет?")


@router.message(Onboarding.age, F.text)
async def ob_age(message: Message, state: FSMContext):
    v = parse_number(message.text)
    if v is None or not 10 <= v <= 100 or v != int(v):
        return await message.answer("Введите возраст целым числом (10–100)")
    await state.update_data(age=int(v))
    await state.set_state(Onboarding.goal)
    await message.answer("🎯 Желаемый вес в кг (если хотите просто поддерживать текущий — укажите его же)")


@router.message(Onboarding.goal, F.text)
async def ob_goal(message: Message, state: FSMContext):
    v = parse_number(message.text)
    if v is None or not 30 <= v <= 300:
        return await message.answer("Введите желаемый вес числом в кг (30–300)")
    await state.update_data(goal=v)
    await state.set_state(Onboarding.activity)
    await message.answer(
        "🏃 Как вы двигаетесь обычно? Это нужно, чтобы точнее посчитать норму калорий:",
        reply_markup=kb.activity_kb(),
    )


@router.callback_query(Onboarding.activity, F.data.startswith("act:"))
async def ob_activity(cb: CallbackQuery, state: FSMContext, repo: Repo, tz: ZoneInfo):
    d = await state.get_data()
    repo.save_profile(
        cb.from_user.id,
        sex=d["sex"],
        age=d["age"],
        height=d["height"],
        weight=d["weight"],
        goal_weight=d["goal"],
        activity=cb.data.split(":")[1],
        day=_today(tz).isoformat(),
    )
    await state.clear()
    user = repo.get_user(cb.from_user.id)
    await cb.answer()
    await cb.message.answer(
        "✅ <b>Профиль сохранён!</b>\n\n"
        f"{_targets_text(user, _targets(user))}\n\n"
        "Теперь ведите дневник: присылайте блюда текстом, голосом или фото 📸",
        reply_markup=kb.main_menu(),
    )


# ---------- дневник и правка ----------

@router.callback_query(F.data.startswith("dnav:"))
async def cb_diary_nav(cb: CallbackQuery, repo: Repo, tz: ZoneInfo):
    day = cb.data.split(":", 1)[1]
    user = repo.get_user(cb.from_user.id)
    await cb.answer()
    if user:
        await send_day(cb.message, repo, user, day, _today(tz).isoformat(), edit=True)


@router.callback_query(F.data.startswith("dadd:"))
async def cb_diary_add(cb: CallbackQuery, state: FSMContext, repo: Repo, ai: AIService):
    day = cb.data.split(":", 1)[1]
    if not repo.get_user(cb.from_user.id):
        await cb.answer()
        return await start_onboarding(cb.message, state)
    await state.clear()
    await state.set_state(MealInput.waiting)
    await state.update_data(day=day)
    await cb.answer()
    hint = ADD_HINT + (ADD_HINT_NO_AI if not ai.enabled else "Ккал можно не писать: ИИ оценит блюдо сам.\n")
    await cb.message.answer(f"Добавляем на <b>{date.fromisoformat(day).strftime('%d.%m.%Y')}</b>.\n\n{hint}/cancel — отмена")


@router.callback_query(F.data.startswith("dgraph:"))
async def cb_day_graph(cb: CallbackQuery, repo: Repo, tz: ZoneInfo):
    day = cb.data.split(":", 1)[1]
    user = repo.get_user(cb.from_user.id)
    await cb.answer()
    if not user:
        return
    t = _targets(user)
    totals = _sum_meals(repo.list_meals(user["user_id"], day))
    png = charts.day_progress_png({
        "Калории, ккал": (totals.kcal, t.kcal),
        "Белки, г": (totals.protein, t.protein),
        "Жиры, г": (totals.fat, t.fat),
        "Углеводы, г": (totals.carbs, t.carbs),
    })
    await cb.message.answer_photo(
        BufferedInputFile(png, filename="day.png"),
        caption=f"📈 Прогресс за {_day_label(day, _today(tz).isoformat())}",
    )


@router.callback_query(F.data.startswith("medit:"))
async def cb_meal_edit(cb: CallbackQuery, state: FSMContext, repo: Repo):
    meal_id = int(cb.data.split(":", 1)[1])
    meal = repo.get_meal(cb.from_user.id, meal_id)
    if not meal:
        return await cb.answer("Запись не найдена", show_alert=True)
    await state.clear()
    await state.set_state(MealInput.editing)
    await state.update_data(edit_id=meal_id, day=meal["day"])
    await cb.answer()
    await cb.message.answer(
        f"✏️ Новые данные для «{esc(meal['name'])}»: название, ккал и БЖУ.\n"
        "Например: <i>Гречка 220 ккал Б9 Ж3 У45</i>\n/cancel — отмена"
    )


@router.callback_query(F.data.startswith("mdel:"))
async def cb_meal_delete(cb: CallbackQuery, repo: Repo, tz: ZoneInfo):
    meal_id = int(cb.data.split(":", 1)[1])
    meal = repo.get_meal(cb.from_user.id, meal_id)
    if not meal:
        return await cb.answer("Запись не найдена", show_alert=True)
    repo.delete_meal(cb.from_user.id, meal_id)
    user = repo.get_user(cb.from_user.id)
    await cb.answer("Удалено 🗑")
    if user:
        await send_day(cb.message, repo, user, meal["day"], _today(tz).isoformat(), edit=True)


# ---------- ввод блюд: текст, голос, фото ----------

@router.message(StateFilter(MealInput.waiting, MealInput.editing), F.text)
async def meal_text_input(message: Message, state: FSMContext, repo: Repo, ai: AIService, tz: ZoneInfo):
    await _handle_meal_text(message, state, repo, ai, tz, message.text)


async def _handle_meal_text(message: Message, state: FSMContext, repo: Repo, ai: AIService, tz: ZoneInfo, text: str):
    current = await state.get_state()
    pending, error = await _parse_meal_or_estimate(text, ai)
    if error:
        return await message.answer(error)

    if current == MealInput.editing.state:
        d = await state.get_data()
        ok = repo.update_meal(
            message.from_user.id,
            d["edit_id"],
            name=pending["name"],
            kcal=pending["kcal"],
            protein=pending["protein"],
            fat=pending["fat"],
            carbs=pending["carbs"],
        )
        await state.clear()
        user = repo.get_user(message.from_user.id)
        if not ok or not user:
            return await message.answer("Не нашёл эту запись 🤷", reply_markup=kb.main_menu())
        await message.answer("✅ Запись обновлена")
        return await send_day(message, repo, user, d["day"], _today(tz).isoformat())

    await _show_pending(message, state, pending, tz)


@router.message(StateFilter(None, MealInput.waiting, MealInput.editing), F.voice)
async def meal_voice_input(message: Message, state: FSMContext, repo: Repo, ai: AIService, tz: ZoneInfo, bot):
    if not repo.get_user(message.from_user.id):
        return await start_onboarding(message, state)
    if not ai.enabled:
        return await message.answer(
            "🎤 Голос распознаёт ИИ, а он пока не подключён. Напишите блюдо текстом."
        )
    await _ensure_meal_state(state, tz)
    buf = BytesIO()
    await bot.download(message.voice, destination=buf)
    try:
        text = await ai.transcribe(buf.getvalue())
    except Exception:
        log.exception("Ошибка распознавания голоса")
        return await message.answer("Не получилось распознать голос. Попробуйте ещё раз или напишите текстом.")
    if not text:
        return await message.answer("Не расслышал 🤔 Попробуйте ещё раз.")
    await message.answer(f"🎤 Распознал: <i>{esc(text)}</i>")
    await _handle_meal_text(message, state, repo, ai, tz, text)


@router.message(StateFilter(None, MealInput.waiting), F.photo)
async def meal_photo_input(message: Message, state: FSMContext, repo: Repo, ai: AIService, tz: ZoneInfo, bot):
    if not repo.get_user(message.from_user.id):
        return await start_onboarding(message, state)
    if not ai.enabled:
        return await message.answer(
            "📸 Анализ фото требует подключения ИИ (OPENAI_API_KEY). Пока опишите блюдо текстом."
        )
    await _ensure_meal_state(state, tz)
    buf = BytesIO()
    await bot.download(message.photo[-1], destination=buf)
    await message.answer("🔍 Смотрю на фото…")
    try:
        pending = await ai.analyze_food_photo(buf.getvalue())
    except Exception:
        log.exception("Ошибка анализа фото блюда")
        return await message.answer("Не получилось разобрать фото. Попробуйте другое или напишите блюдо текстом.")
    if pending["kcal"] <= 0:
        return await message.answer("Не вижу блюдо на фото 🤔 Пришлите фото поближе или опишите текстом.")
    pending["source"] = "ai-photo"
    await _show_pending(message, state, pending, tz)


@router.callback_query(MealInput.choosing, F.data.startswith("mt:"))
async def meal_pick_type(cb: CallbackQuery, state: FSMContext, repo: Repo, tz: ZoneInfo):
    key = cb.data.split(":", 1)[1]
    if key == "cancel":
        await state.clear()
        await cb.answer("Отменено")
        return await cb.message.edit_text("❌ Добавление отменено")

    data = await state.get_data()
    p, day = data["pending"], data["day"]
    repo.add_meal(
        cb.from_user.id, day, key, p["name"], p["kcal"], p["protein"], p["fat"], p["carbs"],
        source=p.get("source", "manual"),
    )
    await state.clear()
    user = repo.get_user(cb.from_user.id)
    await cb.answer("Записано ✅")
    await cb.message.edit_text(
        f"✅ {kb.MEAL_TYPES[key]} · {_day_label(day, _today(tz).isoformat())}: "
        f"{esc(p['name'])} — {p['kcal']:.0f} ккал"
    )
    if user:
        t = _targets(user)
        totals = _sum_meals(repo.list_meals(user["user_id"], day))
        advice = calc.advice_for_day(t, totals, detailed=bool(user["detailed"]))
        await cb.message.answer(
            f"{_summary_block(t, totals)}\n\n💡 {advice}",
            reply_markup=kb.main_menu(),
        )


# ---------- вес ----------

@router.message(StateFilter(WeightInput.value), F.text)
async def weight_value(message: Message, state: FSMContext, repo: Repo, tz: ZoneInfo):
    w = parse_number(message.text)
    if w is None or not 30 <= w <= 300:
        return await message.answer("Введите вес числом в кг (30–300), например <i>81.4</i>")
    uid = message.from_user.id
    user = repo.get_user(uid)
    if not user:
        await state.clear()
        return await start_onboarding(message, state)

    prev = repo.weights(uid)
    today = _today(tz).isoformat()
    repo.add_weight(uid, today, w)
    repo.update_weight(uid, w)
    await state.clear()

    lines = [f"✅ Вес {w:.1f} кг записан"]
    if prev:
        diff = w - prev[-1][1]
        lines.append(f"С прошлым замером ({_fmt_day(prev[-1][0])}): {diff:+.1f} кг")
    goal = user["goal_weight"]
    if w > goal + 0.5:
        lines.append(f"🎯 До цели осталось {w - goal:.1f} кг")
    elif w < goal - 0.5:
        lines.append(f"🎯 Цель — набрать ещё {goal - w:.1f} кг")
    else:
        lines.append("🎯 Цель достигнута! Так держать 🥒")

    points = repo.weights(uid)
    if len(points) >= 2:
        png = charts.weight_png(points[-30:], goal)
        return await message.answer_photo(
            BufferedInputFile(png, filename="weight.png"),
            caption="\n".join(lines),
            reply_markup=kb.main_menu(),
        )
    await message.answer("\n".join(lines), reply_markup=kb.main_menu())


# ---------- отчёты ----------

@router.callback_query(F.data == "rep:day")
async def rep_day(cb: CallbackQuery, repo: Repo, tz: ZoneInfo):
    user = repo.get_user(cb.from_user.id)
    await cb.answer()
    if not user:
        return
    today = _today(tz).isoformat()
    text, _ = build_day_text(repo, user, today, today, with_advice=False)
    await cb.message.answer(text)


@router.callback_query(F.data == "rep:week")
async def rep_week(cb: CallbackQuery, repo: Repo, tz: ZoneInfo):
    user = repo.get_user(cb.from_user.id)
    await cb.answer()
    if not user:
        return
    t = _targets(user)
    today = _today(tz)
    start = today - timedelta(days=6)
    totals = repo.totals_by_day(user["user_id"], start.isoformat(), today.isoformat())

    days, lines, filled = [], [], []
    for i in range(7):
        d = (start + timedelta(days=i)).isoformat()
        kcal = totals[d].kcal if d in totals else 0.0
        days.append((date.fromisoformat(d).strftime("%d.%m"), kcal))
        if kcal == 0:
            mark = "· нет записей"
        else:
            filled.append(kcal)
            mark = "🟥" if kcal > t.kcal * 1.1 else "🟩"
            mark += f" {kcal - t.kcal:+.0f}"
        lines.append(f"{days[-1][0]} · {kcal:>5.0f} ккал {mark}")

    avg = sum(filled) / len(filled) if filled else 0
    text = (
        "📆 <b>За 7 дней</b> (норма " + f"{t.kcal} ккал)\n<pre>" + esc("\n".join(lines)) + "</pre>\n"
        f"Среднее за дни с записями: <b>{avg:.0f} ккал</b>"
    )
    png = charts.week_kcal_png(days, t.kcal)
    await cb.message.answer_photo(BufferedInputFile(png, filename="week.png"), caption=text)


@router.callback_query(F.data == "rep:all")
async def rep_all(cb: CallbackQuery, repo: Repo, tz: ZoneInfo):
    user = repo.get_user(cb.from_user.id)
    await cb.answer()
    if not user:
        return
    uid = user["user_id"]
    first = repo.first_activity_day(uid)
    if not first:
        return await cb.message.answer("Данных пока нет. Добавьте первое блюдо или замер веса 🥒")

    today = _today(tz)
    t = _targets(user)
    totals = repo.totals_by_day(uid, first, today.isoformat())
    days_count = len(totals)
    span = (today - date.fromisoformat(first)).days + 1
    if days_count:
        avg_kcal = sum(v.kcal for v in totals.values()) / days_count
        avg_p = sum(v.protein for v in totals.values()) / days_count
        avg_f = sum(v.fat for v in totals.values()) / days_count
        avg_c = sum(v.carbs for v in totals.values()) / days_count
        food = (
            f"🔥 В среднем: <b>{avg_kcal:.0f} ккал/день</b> (норма {t.kcal})\n"
            f"🥩 Белки {avg_p:.0f} г · 🥑 Жиры {avg_f:.0f} г · 🍞 Углеводы {avg_c:.0f} г"
        )
    else:
        food = "Записей о еде пока нет."

    weights = repo.weights(uid)
    weight_line = ""
    if weights:
        first_w, last_w = weights[0][1], weights[-1][1]
        weight_line = (
            f"\n⚖️ Вес: {first_w:.1f} → {last_w:.1f} кг ({last_w - first_w:+.1f})\n"
            f"🎯 До цели: {user['goal_weight'] - last_w:+.1f} кг"
        )

    text = (
        f"🏁 <b>С начала ведения</b> (с {date.fromisoformat(first).strftime('%d.%m.%Y')})\n"
        f"📅 Дней в пути: {span}, из них с записями: {days_count}\n\n"
        f"{food}{weight_line}"
    )
    await cb.message.answer(text)
    if len(weights) >= 2:
        png = charts.weight_png(weights[-60:], user["goal_weight"])
        await cb.message.answer_photo(BufferedInputFile(png, filename="weight.png"), caption="⚖️ Динамика веса")


# ---------- анализы ----------

@router.message(StateFilter(LabsInput.photo), F.photo)
async def labs_photo(message: Message, state: FSMContext, repo: Repo, ai: AIService, tz: ZoneInfo, bot):
    uid = message.from_user.id
    user = repo.get_user(uid)
    if not user:
        await state.clear()
        return await start_onboarding(message, state)
    buf = BytesIO()
    await bot.download(message.photo[-1], destination=buf)
    await message.answer("🔍 Читаю показатели…")
    try:
        indicators = await ai.extract_labs(buf.getvalue())
    except Exception:
        log.exception("Ошибка распознавания анализов")
        await state.clear()
        return await message.answer("Не получилось прочитать анализ. Попробуйте более чёткое фото.", reply_markup=kb.main_menu())
    if not indicators:
        await state.clear()
        return await message.answer("Не нашёл показатели на фото 🤔 Пришлите более чёткий скриншот.", reply_markup=kb.main_menu())

    today = _today(tz).isoformat()
    prev = repo.last_labs(uid)
    comparison = calc.compare_labs(prev["indicators"] if prev else None, indicators)
    repo.add_labs(uid, today, indicators)
    await state.clear()

    listing = "\n".join(
        f"• {esc(i['name'])}: {esc(i['value'])} {esc(i['unit'])}".rstrip()
        + (f" (норма {esc(i['ref'])})" if i["ref"] else "")
        for i in indicators
    )
    if not prev:
        compare_text = "📌 Это первый анализ: сохранил его как базу для сравнения. Пришлите следующий — сравню."
    elif comparison:
        compare_text = f"📈 <b>Сравнение с анализом от {prev['day']}</b>\n" + "\n".join(esc(c) for c in comparison)
    else:
        compare_text = f"Совпадающих показателей с анализом от {prev['day']} не нашёл."
    await message.answer(f"🧪 <b>Показатели</b>\n{listing}\n\n{compare_text}", reply_markup=kb.main_menu())

    t = _targets(user)
    summary = "\n".join(f"{i['name']}: {i['value']} {i['unit']} (норма: {i['ref']})" for i in indicators)
    try:
        advice = await ai.lab_advice(summary, _profile_context(user, t), bool(user["detailed"]))
    except Exception:
        log.exception("Ошибка рекомендаций по анализам")
        return
    await send_long(message, f"🥒 <b>Рекомендации по питанию</b>\n{esc(advice)}")


# ---------- состояния-заглушки и консультации ----------

@router.message(StateFilter(Onboarding, MealInput, WeightInput, LabsInput))
async def wrong_input_hint(message: Message, state: FSMContext):
    current = await state.get_state() or ""
    if current.startswith("Onboarding"):
        return await message.answer("Ответьте, пожалуйста, текстом или кнопкой выше 🙂")
    if current == MealInput.choosing.state:
        return await message.answer("Выберите приём пищи кнопкой выше или нажмите ❌ Отмена (/cancel).")
    if current == LabsInput.photo.state:
        return await message.answer("Пришлите фото или скриншот анализов. Отмена — /cancel")
    await message.answer("Не понял ввод. Отмена — /cancel")


DETAIL_ON = re.compile(r"(развернут|подробн|детальн)\w*", re.IGNORECASE)
DETAIL_OFF = re.compile(r"(коротк|кратк)\w*", re.IGNORECASE)
STYLE_PHRASE = re.compile(
    r"(дай(те)?|сделай|напиши)?\s*(пожалуйста\s*)?(более\s+)?"
    r"(развернут\w*|подробн\w*|детальн\w*|коротк\w*|кратк\w*)\s*(ответ\w*)?",
    re.IGNORECASE,
)


@router.message(StateFilter(None), F.text)
async def free_text(message: Message, state: FSMContext, repo: Repo, ai: AIService, tz: ZoneInfo):
    """Свободный текст вне сценариев — это вопрос для ИИ-консультанта."""
    uid = message.from_user.id
    user = repo.get_user(uid)
    if not user:
        return await start_onboarding(message, state)

    text = message.text.strip()
    detailed = bool(user["detailed"])
    question = text
    if DETAIL_ON.search(text) or DETAIL_OFF.search(text):
        detailed = bool(DETAIL_ON.search(text))
        repo.set_detailed(uid, detailed)
        question = STYLE_PHRASE.sub(" ", text).strip(" ,.:!?-")
        if len(question) < 3:
            return await message.answer(
                "🧠 Включил развёрнутые ответы." if detailed else "⚡ Буду отвечать коротко."
            )

    if not ai.enabled:
        return await message.answer(
            "💬 Консультации работают через ИИ, а он пока не подключён (нужен OPENAI_API_KEY).\n"
            "Пока доступны дневник, расчёт нормы и отчёты — кнопки в меню 👇",
            reply_markup=kb.main_menu(),
        )

    await message.bot.send_chat_action(message.chat.id, "typing")
    try:
        answer = await ai.consult(question, _profile_context(user, _targets(user)), detailed)
    except Exception:
        log.exception("Ошибка консультации ИИ")
        return await message.answer("Не получилось ответить, попробуйте чуть позже 🙏")
    await send_long(message, f"🥒 {esc(answer)}")


# ---------- профиль (инлайн-кнопки) ----------

@router.callback_query(F.data == "prof:edit")
async def cb_profile_edit(cb: CallbackQuery, state: FSMContext):
    await cb.answer()
    await start_onboarding(cb.message, state)


@router.callback_query(F.data == "prof:detail")
async def cb_profile_detail(cb: CallbackQuery, repo: Repo):
    user = repo.get_user(cb.from_user.id)
    if not user:
        return await cb.answer()
    repo.set_detailed(cb.from_user.id, not bool(user["detailed"]))
    user = repo.get_user(cb.from_user.id)
    await cb.answer("Готово")
    await cb.message.edit_reply_markup(reply_markup=kb.profile_kb(bool(user["detailed"])))
