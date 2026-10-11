import unittest

from bot import calc
from bot.calc import Totals


class CalcTests(unittest.TestCase):
    def test_mifflin_male_female(self):
        # 80 кг, 180 см, 30 лет
        self.assertAlmostEqual(calc.bmr_mifflin("m", 80, 180, 30), 1780.0)
        self.assertAlmostEqual(calc.bmr_mifflin("f", 80, 180, 30), 1614.0)

    def test_cut_is_below_maintenance(self):
        maintain = calc.calc_targets("m", 80, 180, 30, 80, "light")
        cut = calc.calc_targets("m", 80, 180, 30, 72, "light")
        self.assertLess(cut.kcal, maintain.kcal)
        self.assertEqual(maintain.kcal, round(maintain.tdee, -1))

    def test_gain_is_above_maintenance(self):
        maintain = calc.calc_targets("m", 70, 180, 25, 70, "light")
        gain = calc.calc_targets("m", 70, 180, 25, 78, "light")
        self.assertGreater(gain.kcal, maintain.kcal)

    def test_floor_for_women(self):
        t = calc.calc_targets("f", 45, 150, 60, 40, "low")
        self.assertGreaterEqual(t.kcal, 1200)

    def test_macros_add_up_to_kcal(self):
        t = calc.calc_targets("f", 65, 168, 32, 60, "medium")
        kcal_from_macros = t.protein * 4 + t.fat * 9 + t.carbs * 4
        self.assertAlmostEqual(kcal_from_macros, t.kcal, delta=15)

    def test_totals_add(self):
        s = Totals(100, 10, 5, 20) + Totals(50, 2, 1, 8)
        self.assertEqual((s.kcal, s.protein, s.fat, s.carbs), (150, 12, 6, 28))

    def test_advice_empty_day(self):
        t = calc.calc_targets("m", 80, 180, 30, 80, "light")
        self.assertIn("Записей", calc.advice_for_day(t, Totals()))

    def test_advice_overeat(self):
        t = calc.calc_targets("m", 80, 180, 30, 80, "light")
        text = calc.advice_for_day(t, Totals(kcal=t.kcal + 300))
        self.assertIn("Перебор", text)

    def test_advice_is_short_by_default(self):
        t = calc.calc_targets("m", 80, 180, 30, 80, "light")
        short = calc.advice_for_day(t, Totals(kcal=500, protein=10))
        detailed = calc.advice_for_day(t, Totals(kcal=500, protein=10), detailed=True)
        self.assertLess(len(short), len(detailed))
        self.assertLessEqual(short.count("."), 2)

    def test_progress_bar(self):
        self.assertEqual(calc.progress_bar(50, 100, width=10), "🟩" * 5 + "⬜" * 5)
        self.assertEqual(calc.progress_bar(200, 100, width=4), "🟥" * 4)

    def test_dinner_suggestions_fit_budget(self):
        t = calc.calc_targets("m", 80, 180, 30, 80, "light")
        totals = Totals(kcal=t.kcal - 500, protein=t.protein - 30)
        items = calc.dinner_suggestions(t, totals)
        self.assertTrue(items)
        self.assertEqual(calc.dinner_suggestions(t, Totals(kcal=t.kcal)), [])

    def test_compare_labs(self):
        prev = [{"name": "Глюкоза", "value": "5.1", "unit": "ммоль/л", "ref": ""}]
        cur = [{"name": "глюкоза", "value": "5,4", "unit": "ммоль/л", "ref": ""},
               {"name": "Холестерин", "value": "5.0", "unit": "", "ref": ""}]
        lines = calc.compare_labs(prev, cur)
        self.assertEqual(len(lines), 1)
        self.assertIn("▲", lines[0])
        self.assertEqual(calc.compare_labs(None, cur), [])


if __name__ == "__main__":
    unittest.main()
