"""Хранилище на SQLite: профили, дневник питания, замеры веса, анализы."""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from typing import Iterator

from .calc import Totals

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id     INTEGER PRIMARY KEY,
    sex         TEXT,
    age         INTEGER,
    height      REAL,
    weight      REAL,
    goal_weight REAL,
    activity    TEXT,
    detailed    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meals (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    day        TEXT NOT NULL,            -- YYYY-MM-DD
    meal_type  TEXT NOT NULL,            -- breakfast / lunch / dinner / snack
    name       TEXT NOT NULL,
    kcal       REAL NOT NULL,
    protein    REAL NOT NULL DEFAULT 0,
    fat        REAL NOT NULL DEFAULT 0,
    carbs      REAL NOT NULL DEFAULT 0,
    source     TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meals_user_day ON meals (user_id, day);

CREATE TABLE IF NOT EXISTS weights (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    day        TEXT NOT NULL,
    weight     REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_weights_user ON weights (user_id, day);

CREATE TABLE IF NOT EXISTS labs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    day         TEXT NOT NULL,
    indicators  TEXT NOT NULL,           -- JSON-список показателей
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_labs_user ON labs (user_id, id);
"""


class Repo:
    def __init__(self, path: str):
        folder = os.path.dirname(path)
        if folder:
            os.makedirs(folder, exist_ok=True)
        self.path = path
        with self._db() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ---------- профиль ----------

    def get_user(self, user_id: int) -> dict | None:
        with self._db() as c:
            row = c.execute("SELECT * FROM users WHERE user_id = ?", (user_id,)).fetchone()
            return dict(row) if row else None

    def save_profile(
        self,
        user_id: int,
        *,
        sex: str,
        age: int,
        height: float,
        weight: float,
        goal_weight: float,
        activity: str,
        day: str,
    ) -> None:
        with self._db() as c:
            c.execute(
                """
                INSERT INTO users (user_id, sex, age, height, weight, goal_weight, activity)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    sex = excluded.sex, age = excluded.age, height = excluded.height,
                    weight = excluded.weight, goal_weight = excluded.goal_weight,
                    activity = excluded.activity
                """,
                (user_id, sex, age, height, weight, goal_weight, activity),
            )
        # Текущий вес тоже попадает в историю замеров
        self.add_weight(user_id, day, weight)

    def update_weight(self, user_id: int, weight: float) -> None:
        """Текущий вес в профиле — от него считается норма калорий."""
        with self._db() as c:
            c.execute("UPDATE users SET weight = ? WHERE user_id = ?", (weight, user_id))

    def set_detailed(self, user_id: int, detailed: bool) -> None:
        with self._db() as c:
            c.execute(
                "UPDATE users SET detailed = ? WHERE user_id = ?",
                (1 if detailed else 0, user_id),
            )

    # ---------- дневник ----------

    def add_meal(
        self,
        user_id: int,
        day: str,
        meal_type: str,
        name: str,
        kcal: float,
        protein: float = 0,
        fat: float = 0,
        carbs: float = 0,
        source: str = "manual",
    ) -> int:
        with self._db() as c:
            cur = c.execute(
                """
                INSERT INTO meals (user_id, day, meal_type, name, kcal, protein, fat, carbs, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, day, meal_type, name, kcal, protein, fat, carbs, source),
            )
            return int(cur.lastrowid)

    def get_meal(self, user_id: int, meal_id: int) -> dict | None:
        with self._db() as c:
            row = c.execute(
                "SELECT * FROM meals WHERE id = ? AND user_id = ?", (meal_id, user_id)
            ).fetchone()
            return dict(row) if row else None

    def list_meals(self, user_id: int, day: str) -> list[dict]:
        with self._db() as c:
            rows = c.execute(
                "SELECT * FROM meals WHERE user_id = ? AND day = ? ORDER BY id",
                (user_id, day),
            ).fetchall()
            return [dict(r) for r in rows]

    def update_meal(
        self,
        user_id: int,
        meal_id: int,
        *,
        name: str,
        kcal: float,
        protein: float,
        fat: float,
        carbs: float,
    ) -> bool:
        with self._db() as c:
            cur = c.execute(
                """
                UPDATE meals SET name = ?, kcal = ?, protein = ?, fat = ?, carbs = ?
                WHERE id = ? AND user_id = ?
                """,
                (name, kcal, protein, fat, carbs, meal_id, user_id),
            )
            return cur.rowcount > 0

    def delete_meal(self, user_id: int, meal_id: int) -> bool:
        with self._db() as c:
            cur = c.execute(
                "DELETE FROM meals WHERE id = ? AND user_id = ?", (meal_id, user_id)
            )
            return cur.rowcount > 0

    def day_totals(self, user_id: int, day: str) -> Totals:
        return self.totals_by_day(user_id, day, day).get(day, Totals())

    def totals_by_day(self, user_id: int, start: str, end: str) -> dict[str, Totals]:
        """Суммы КБЖУ по дням в диапазоне [start, end] (даты YYYY-MM-DD)."""
        with self._db() as c:
            rows = c.execute(
                """
                SELECT day,
                       SUM(kcal) AS kcal, SUM(protein) AS protein,
                       SUM(fat) AS fat, SUM(carbs) AS carbs
                FROM meals
                WHERE user_id = ? AND day BETWEEN ? AND ?
                GROUP BY day
                """,
                (user_id, start, end),
            ).fetchall()
        return {
            r["day"]: Totals(r["kcal"] or 0, r["protein"] or 0, r["fat"] or 0, r["carbs"] or 0)
            for r in rows
        }

    def first_activity_day(self, user_id: int) -> str | None:
        with self._db() as c:
            row = c.execute(
                """
                SELECT MIN(d) AS first FROM (
                    SELECT MIN(day) AS d FROM meals WHERE user_id = ?
                    UNION ALL
                    SELECT MIN(day) AS d FROM weights WHERE user_id = ?
                )
                """,
                (user_id, user_id),
            ).fetchone()
            return row["first"] if row and row["first"] else None

    # ---------- вес ----------

    def add_weight(self, user_id: int, day: str, weight: float) -> None:
        with self._db() as c:
            c.execute(
                "INSERT INTO weights (user_id, day, weight) VALUES (?, ?, ?)",
                (user_id, day, weight),
            )

    def weights(self, user_id: int) -> list[tuple[str, float]]:
        with self._db() as c:
            rows = c.execute(
                "SELECT day, weight FROM weights WHERE user_id = ? ORDER BY day, id",
                (user_id,),
            ).fetchall()
            return [(r["day"], r["weight"]) for r in rows]

    # ---------- анализы ----------

    def add_labs(self, user_id: int, day: str, indicators: list[dict]) -> None:
        with self._db() as c:
            c.execute(
                "INSERT INTO labs (user_id, day, indicators) VALUES (?, ?, ?)",
                (user_id, day, json.dumps(indicators, ensure_ascii=False)),
            )

    def last_labs(self, user_id: int) -> dict | None:
        """Последний сохранённый анализ: {'day': ..., 'indicators': [...]}."""
        with self._db() as c:
            row = c.execute(
                "SELECT day, indicators FROM labs WHERE user_id = ? ORDER BY id DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            if not row:
                return None
            return {"day": row["day"], "indicators": json.loads(row["indicators"])}

