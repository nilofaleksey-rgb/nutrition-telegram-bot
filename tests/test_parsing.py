import unittest

from bot.parsing import parse_meal_text, parse_number


class ParsingTests(unittest.TestCase):
    def test_full_entry(self):
        m = parse_meal_text("Каша овсяная 350 ккал Б 10 Ж 5 У 60")
        self.assertEqual(m.name, "Каша овсяная")
        self.assertEqual((m.kcal, m.protein, m.fat, m.carbs), (350, 10, 5, 60))
        self.assertFalse(m.needs_estimate)

    def test_kcal_from_macros(self):
        m = parse_meal_text("Творог Б20 Ж5 У3")
        self.assertEqual(m.kcal, 4 * 20 + 9 * 5 + 4 * 3)

    def test_full_words_for_macros(self):
        m = parse_meal_text("Курица 200 ккал белки 40 жиры 6 углеводы 0")
        self.assertEqual((m.protein, m.fat, m.carbs), (40, 6, 0))

    def test_needs_estimate_when_no_kcal(self):
        m = parse_meal_text("Борщ с мясом 300 г")
        self.assertTrue(m.needs_estimate)
        self.assertEqual(m.name, "Борщ с мясом 300 г")

    def test_decimal_comma(self):
        m = parse_meal_text("Йогурт 120,5 ккал")
        self.assertEqual(m.kcal, 120.5)

    def test_empty(self):
        self.assertIsNone(parse_meal_text("   "))

    def test_number_parser(self):
        self.assertEqual(parse_number("82,5"), 82.5)
        self.assertIsNone(parse_number("много"))
        self.assertIsNone(parse_number(None))


if __name__ == "__main__":
    unittest.main()
