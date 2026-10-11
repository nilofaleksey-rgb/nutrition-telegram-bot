import os
import tempfile
import unittest

from bot.calc import Totals
from bot.db import Repo


class RepoTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Repo(os.path.join(self.tmp.name, "sub", "bot.db"))
        self.uid = 42
        self.repo.save_profile(
            self.uid, sex="m", age=30, height=180, weight=80, goal_weight=75, activity="light", day="2026-10-10"
        )

    def tearDown(self):
        self.tmp.cleanup()

    def test_profile_saved_and_weight_logged(self):
        user = self.repo.get_user(self.uid)
        self.assertEqual(user["goal_weight"], 75)
        self.assertEqual(self.repo.weights(self.uid), [("2026-10-10", 80)])

    def test_meals_totals_and_edit_delete(self):
        mid = self.repo.add_meal(self.uid, "2026-10-11", "lunch", "Гречка", 300, 10, 4, 55)
        self.repo.add_meal(self.uid, "2026-10-11", "dinner", "Курица", 250, 35, 8, 2)
        self.assertEqual(len(self.repo.list_meals(self.uid, "2026-10-11")), 2)

        t = self.repo.day_totals(self.uid, "2026-10-11")
        self.assertEqual(t.kcal, 550)
        self.assertEqual(t.protein, 45)

        self.assertTrue(self.repo.update_meal(self.uid, mid, name="Гречка 200", kcal=220, protein=9, fat=3, carbs=45))
        self.assertEqual(self.repo.day_totals(self.uid, "2026-10-11").kcal, 470)

        self.assertTrue(self.repo.delete_meal(self.uid, mid))
        self.assertEqual(self.repo.day_totals(self.uid, "2026-10-11").kcal, 250)

    def test_other_user_cannot_touch_meal(self):
        mid = self.repo.add_meal(self.uid, "2026-10-11", "snack", "Яблоко", 80)
        self.assertIsNone(self.repo.get_meal(999, mid))
        self.assertFalse(self.repo.delete_meal(999, mid))

    def test_totals_by_day_range(self):
        self.repo.add_meal(self.uid, "2026-10-05", "lunch", "A", 500)
        self.repo.add_meal(self.uid, "2026-10-07", "lunch", "B", 700)
        self.repo.add_meal(self.uid, "2026-10-20", "lunch", "C", 900)
        by_day = self.repo.totals_by_day(self.uid, "2026-10-05", "2026-10-10")
        self.assertEqual(set(by_day), {"2026-10-05", "2026-10-07"})
        self.assertEqual(by_day["2026-10-07"], Totals(kcal=700))

    def test_first_activity_day(self):
        self.assertEqual(self.repo.first_activity_day(self.uid), "2026-10-10")

    def test_labs_roundtrip(self):
        self.assertIsNone(self.repo.last_labs(self.uid))
        self.repo.add_labs(self.uid, "2026-09-01", [{"name": "Гемоглобин", "value": "130", "unit": "г/л", "ref": ""}])
        last = self.repo.last_labs(self.uid)
        self.assertEqual(last["day"], "2026-09-01")
        self.assertEqual(last["indicators"][0]["name"], "Гемоглобин")

    def test_set_detailed(self):
        self.repo.set_detailed(self.uid, True)
        self.assertEqual(self.repo.get_user(self.uid)["detailed"], 1)


if __name__ == "__main__":
    unittest.main()
