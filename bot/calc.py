"""Расчёты: норма калорий и БЖУ, итоги дня, рекомендации. Без внешних зависимостей."""

from __future__ import annotations

from dataclasses import dataclass

# Коэффициент активности для формулы TDEE: (множитель, описание для пользователя)
ACTIVITY_LEVELS: dict[str, tuple[float, str]] = {
    "low": (1.2, "сидячая работа, почти без тренировок"),
    "light": (1.375, "тренировки 1–3 раза в неделю"),
    "medium": (1.55, "тренировки 3–5 раз в неделю"),
    "high": (1.725, "тренировки 6–7 раз в неделю"),
}


@dataclass(frozen=True)
class Targets:
    bmr: int       # базовый обмен, ккал
    tdee: int      # расход с учётом активности, ккал
    kcal: int      # целевая норма на день, ккал
    protein: int   # белки, г
    fat: int       # жиры, г
    carbs: int     # углеводы, г


@dataclass(frozen=True)
class Totals:
    kcal: float = 0.0
    protein: float = 0.0
    fat: float = 0.0
    carbs: float = 0.0

    def __add__(self, other: "Totals") -> "Totals":
        return Totals(
            self.kcal + other.kcal,
            self.protein + other.protein,
            self.fat + other.fat,
            self.carbs + other.carbs,
        )


def bmr_mifflin(sex: str, weight: float, height: float, age: int) -> float:
    """Формула Миффлина–Сан Жеора. sex: 'm' или 'f'."""
    base = 10 * weight + 6.25 * height - 5 * age
    return base + 5 if sex == "m" else base - 161


def calc_targets(
    sex: str,
    weight: float,
    height: float,
    age: int,
    goal_weight: float,
    activity: str,
) -> Targets:
    """Норма калорий и БЖУ под цель: похудение −15%, набор +10%, поддержание — как есть."""
    bmr = bmr_mifflin(sex, weight, height, age)
    tdee = bmr * ACTIVITY_LEVELS[activity][0]

    diff = goal_weight - weight
    if diff <= -1:
        kcal = tdee * 0.85  # мягкий дефицит
    elif diff >= 1:
        kcal = tdee * 1.10  # мягкий профицит
    else:
        kcal = tdee

    # Не опускаемся ниже безопасного минимума
    floor = 1200 if sex == "f" else 1500
    kcal = round(max(kcal, floor) / 10) * 10

    # Белок ~1.6 г на кг, но не больше 35% калорий; жиры ~28%; остальное — углеводы
    protein = min(1.6 * weight, 0.35 * kcal / 4)
    fat = 0.28 * kcal / 9
    carbs = max(0.0, (kcal - protein * 4 - fat * 9) / 4)

    return Targets(
        bmr=round(bmr),
        tdee=round(tdee),
        kcal=int(kcal),
        protein=round(protein),
        fat=round(fat),
        carbs=round(carbs),
    )


def bmi(weight: float, height: float) -> float:
    return weight / ((height / 100) ** 2)


def progress_bar(value: float, target: float, width: int = 10) -> str:
    """Полоска прогресса из эмодзи: 🟩 — в норме, 🟥 — перебор."""
    if target <= 0:
        return "⬜" * width
    if value > target:
        return "🟥" * width
    filled = round(value / target * width)
    return "🟩" * filled + "⬜" * (width - filled)


def advice_for_day(targets: Targets, totals: Totals, detailed: bool = False) -> str:
    """Короткая рекомендация (1–2 предложения). В detailed-режиме добавляется подробнее."""
    if totals.kcal <= 0:
        return "Записей за день пока нет. Добавьте завтрак — и я начну считать."

    left = targets.kcal - totals.kcal
    protein_left = targets.protein - totals.protein

    if left < 0:
        main = (
            f"Перебор на {-left:.0f} ккал: на ужин выберите лёгкий вариант "
            "с овощами и белком."
        )
    elif left < 150:
        main = f"Почти в норме: осталось {left:.0f} ккал, не переедайте."
    elif totals.kcal < 0.3 * targets.kcal:
        main = (
            f"Хорошее начало, осталось {left:.0f} ккал: в каждом приёме пищи "
            "добавляйте белок (яйца, творог, мясо или рыбу) и овощи."
        )
    elif protein_left > 20:
        main = (
            f"Осталось {left:.0f} ккал, а белка не хватает ещё {protein_left:.0f} г: "
            "добавьте творог, яйца, курицу или рыбу."
        )
    else:
        main = (
            f"Осталось {left:.0f} ккал, белок в норме: "
            "добавьте овощи и цельные крупы."
        )

    if not detailed:
        return main

    fat_left = targets.fat - totals.fat
    carbs_left = targets.carbs - totals.carbs
    extra = (
        f" Жиры: осталось {fat_left:.0f} г, углеводы: осталось {carbs_left:.0f} г. "
        "Овощи и фрукты дают витамины C, K и фолат, старайтесь съедать их каждый день."
    )
    return main + extra


# Примерные блюда для раздела «что на ужин»: (название, ккал, белок, жиры, углеводы)
DISHES: list[tuple[str, int, int, int, int]] = [
    ("Омлет из 2 яиц с овощами", 280, 20, 20, 6),
    ("Куриная грудка с гречкой и огурцом", 420, 40, 8, 45),
    ("Творог 5% с ягодами", 220, 25, 5, 15),
    ("Лосось с брокколи на пару", 380, 35, 20, 12),
    ("Индейка с салатом из овощей", 350, 38, 10, 20),
    ("Салат с тунцом и яйцом", 300, 30, 15, 10),
    ("Овсянка на воде с творогом", 350, 30, 8, 45),
    ("Суп-пюре из чечевицы", 300, 18, 6, 42),
    ("Тушёные овощи с говядиной 150 г", 380, 35, 18, 20),
    ("Греческий салат с курицей", 340, 32, 16, 14),
    ("Овощной салат с брынзой", 250, 12, 18, 10),
    ("Кефир 1% с зеленью и огурцом", 150, 12, 3, 18),
]


def dinner_suggestions(targets: Targets, totals: Totals, limit: int = 3) -> list[str]:
    """Подбор ужина из таблицы DISHES под остаток КБЖУ (без ИИ)."""
    left = targets.kcal - totals.kcal
    protein_left = targets.protein - totals.protein
    if left <= 100:
        return []

    fitting = [d for d in DISHES if d[1] <= left + 50]
    if protein_left > 20:
        fitting.sort(key=lambda d: -d[2])  # сначала самые белковые
    else:
        ideal = left * 0.8
        fitting.sort(key=lambda d: abs(d[1] - ideal))

    result = []
    for name, kcal, p, f, c in fitting[:limit]:
        result.append(f"🍽 {name} — ~{kcal} ккал (Б{p} Ж{f} У{c})")
    return result


def _to_float(value: str) -> float | None:
    try:
        return float(str(value).replace(",", ".").strip())
    except ValueError:
        return None


def compare_labs(prev: list[dict] | None, cur: list[dict]) -> list[str]:
    """Строки сравнения показателей с предыдущим анализом (совпадение по названию)."""
    if not prev:
        return []
    prev_map = {p["name"].strip().lower(): p for p in prev}
    lines = []
    for item in cur:
        old = prev_map.get(item["name"].strip().lower())
        if not old:
            continue
        new_v, old_v = _to_float(item["value"]), _to_float(old["value"])
        if new_v is None or old_v is None:
            continue
        diff = new_v - old_v
        arrow = "▲" if diff > 0 else "▼" if diff < 0 else "＝"
        unit = f" {item['unit']}" if item.get("unit") else ""
        lines.append(f"• {item['name']}: {old['value']} → {item['value']}{unit} ({arrow} {diff:+.2f})")
    return lines
