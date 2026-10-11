"""Разбор текстового ввода блюда: «Гречка 200 ккал Б8 Ж3 У60»."""

from __future__ import annotations

import re
from dataclasses import dataclass

KCAL_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:ккал|kcal)\b", re.IGNORECASE)
# Б/Ж/У как сокращения или полные слова: «Б 10», «белки: 10», «жиры5», «углеводы 60»
MACRO_RE = re.compile(
    r"(?<![а-яёa-z])(белк\w*|жир\w*|углевод\w*|б|ж|у)\s*[:=]?\s*(\d+(?:[.,]\d+)?)",
    re.IGNORECASE,
)


@dataclass
class ParsedMeal:
    name: str
    kcal: float | None
    protein: float | None = None
    fat: float | None = None
    carbs: float | None = None

    @property
    def needs_estimate(self) -> bool:
        """Калорий нет и не из чего их посчитать — нужна оценка ИИ."""
        return self.kcal is None


def _num(s: str) -> float:
    return float(s.replace(",", "."))


def parse_meal_text(text: str) -> ParsedMeal | None:
    text = " ".join((text or "").split())
    if not text:
        return None

    kcal_match = KCAL_RE.search(text)
    kcal = _num(kcal_match.group(1)) if kcal_match else None

    protein = fat = carbs = None
    for m in MACRO_RE.finditer(text):
        key = m.group(1).lower()
        value = _num(m.group(2))
        if key.startswith("бел") or key == "б":
            protein = value
        elif key.startswith("жир") or key == "ж":
            fat = value
        else:
            carbs = value

    # Если ккал не указаны, но есть БЖУ — считаем калории по энергетической ценности
    if kcal is None and any(v is not None for v in (protein, fat, carbs)):
        kcal = 4 * (protein or 0) + 9 * (fat or 0) + 4 * (carbs or 0)

    name = KCAL_RE.sub(" ", text)
    name = MACRO_RE.sub(" ", name)
    name = " ".join(name.split()).strip(" ,;:-–—")

    return ParsedMeal(
        name=name or "Блюдо",
        kcal=kcal,
        protein=protein,
        fat=fat,
        carbs=carbs,
    )


def parse_number(text: str | None) -> float | None:
    """Число из текста: '82,5' -> 82.5. Не число -> None."""
    if text is None:
        return None
    try:
        return float(text.strip().replace(",", "."))
    except ValueError:
        return None
