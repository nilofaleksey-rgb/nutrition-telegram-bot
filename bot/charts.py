"""Графики в PNG (matplotlib, без GUI). Подписи на русском — шрифт DejaVu поддерживает кириллицу."""

from __future__ import annotations

from io import BytesIO

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

GREEN = "#2ecc71"
RED = "#e74c3c"
DARK = "#34495e"


def _to_png(fig) -> bytes:
    buf = BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=120)
    plt.close(fig)
    return buf.getvalue()


def day_progress_png(eaten: dict[str, tuple[float, float]]) -> bytes:
    """Горизонтальные полоски: ключ — подпись, значение — (съедено, норма)."""
    labels = list(eaten.keys())
    ratios = [min(v / t, 1.5) if t else 0 for v, t in eaten.values()]
    colors = [RED if v > t else GREEN for v, t in eaten.values()]

    fig, ax = plt.subplots(figsize=(7, 3.5))
    ax.barh(labels, ratios, color=colors)
    ax.axvline(1.0, color=DARK, linestyle="--", label="норма")
    ax.set_xlim(0, 1.5)
    ax.invert_yaxis()
    ax.set_xlabel("доля от нормы")
    for i, (label, (v, t)) in enumerate(eaten.items()):
        ax.text(min(ratios[i], 1.5) + 0.02, i, f"{v:.0f} / {t:.0f}", va="center")
    ax.set_title("Прогресс за день")
    ax.legend(loc="lower right")
    return _to_png(fig)


def week_kcal_png(days: list[tuple[str, float]], target: float) -> bytes:
    labels = [d for d, _ in days]
    values = [v for _, v in days]
    colors = [RED if v > target else GREEN for v in values]

    fig, ax = plt.subplots(figsize=(7, 3.5))
    ax.bar(labels, values, color=colors)
    ax.axhline(target, color=DARK, linestyle="--", label=f"норма {target:.0f} ккал")
    ax.set_ylabel("ккал")
    ax.set_title("Калории за 7 дней")
    ax.legend()
    plt.setp(ax.get_xticklabels(), rotation=30, ha="right")
    return _to_png(fig)


def weight_png(points: list[tuple[str, float]], goal: float | None) -> bytes:
    labels = [d[5:] for d, _ in points]  # ММ-ДД
    values = [w for _, w in points]

    fig, ax = plt.subplots(figsize=(7, 3.5))
    ax.plot(labels, values, marker="o", color=GREEN)
    if goal:
        ax.axhline(goal, color=DARK, linestyle="--", label=f"цель {goal:.1f} кг")
        ax.legend()
    ax.set_ylabel("кг")
    ax.set_title("Динамика веса")
    plt.setp(ax.get_xticklabels(), rotation=30, ha="right")
    return _to_png(fig)
