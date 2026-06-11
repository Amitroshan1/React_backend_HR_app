"""Unit tests for full CTC breakup logic."""
import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "website"
    / "commands"
    / "ctc_breakup_logic.py"
)
spec = importlib.util.spec_from_file_location("ctc_breakup_logic", MODULE_PATH)
logic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(logic)


class CtcBreakupLogicTests(unittest.TestCase):
    def test_gratuity_formula(self):
        self.assertAlmostEqual(logic.gratuity_yearly(13000), 7500.0, places=2)

    def test_employer_esic_below_cap(self):
        self.assertAlmostEqual(
            logic.employer_esic_yearly(14244), 5555.16, delta=1.0
        )

    def _assert_basic_at_least_min_ctc_band(self, b, hra_pct, other, mediclaim=0):
        pct = logic.basic_pct_of_monthly_ctc(b, hra_pct, other, mediclaim)
        self.assertGreaterEqual(pct, logic.BASIC_MIN_PCT_OF_CTC - 0.5)

    def test_mediclaim_adds_to_annual_ctc_without_slashing_basic(self):
        b0, _, _, g0 = logic.monthly_components(
            13000, 8, 0, apply_floor=True, mediclaim_yearly=0
        )
        b1, _, _, g1 = logic.monthly_components(
            13000, 8, 0, apply_floor=True, mediclaim_yearly=4000
        )
        ann0 = logic._annual_ctc_raw(b0, 8, 0, 0)
        ann1 = logic._annual_ctc_raw(b1, 8, 0, 4000)
        self.assertAlmostEqual(b0, 13000, places=0)
        self.assertAlmostEqual(b1, 13000, places=0)
        self.assertAlmostEqual(g0, g1, places=0)
        self.assertAlmostEqual(ann1 - ann0, 4000, delta=1)

    def test_other_allowance_not_modified_by_band_enforcement(self):
        b, hra, other, gross = logic.monthly_components(1500, 40, 0, apply_floor=True)
        self.assertEqual(other, 0.0)
        self.assertAlmostEqual(hra, b * 0.4, places=2)
        self.assertAlmostEqual(gross, b + hra + other, places=2)

        b2, hra2, other2, gross2 = logic.monthly_components(13000, 10, 500, apply_floor=True)
        self.assertEqual(other2, 500.0)
        self.assertAlmostEqual(hra2, b2 * 0.1, places=2)
        self.assertAlmostEqual(gross2, b2 + hra2 + other2, places=2)

    def test_hra_change_affects_annual_ctc(self):
        b = 13000
        other = 1
        med = 4000
        ctc_10 = logic.annual_ctc_from_monthly(b, 10, other, med)
        ctc_40 = logic.annual_ctc_from_monthly(b, 40, other, med)
        self.assertGreater(ctc_40, ctc_10)

    def test_reverse_2_lpa_respects_basic_band(self):
        solved = logic.reverse_ctc_breakup(
            200000, hra_pct=9.57, mediclaim_yearly=4000
        )
        self._assert_basic_at_least_min_ctc_band(
            solved["basic_salary"],
            solved["hra_pct"],
            solved["other_allowance"],
            4000,
        )
        annual = logic.annual_ctc_from_monthly(
            solved["basic_salary"],
            solved["hra_pct"],
            solved["other_allowance"],
            4000,
        )
        self.assertAlmostEqual(annual, solved["annual_ctc_computed"], delta=50)

    def test_reverse_6_lpa_fixed_other(self):
        other = 13035.0
        solved = logic.reverse_ctc_breakup(
            600000, hra_pct=50, other_allowance=other, mediclaim_yearly=0
        )
        annual = logic.annual_ctc_from_monthly(
            solved["basic_salary"],
            solved["hra_pct"],
            other,
            0,
        )
        self.assertAlmostEqual(annual, 600000, delta=500)
        self.assertAlmostEqual(solved["other_allowance"], other, delta=1)
        self._assert_basic_at_least_min_ctc_band(
            solved["basic_salary"],
            solved["hra_pct"],
            other,
            0,
        )

    def test_maharashtra_ptax_male_slabs(self):
        self.assertEqual(logic.maharashtra_professional_tax(7500, "Male", "2026-06"), 0.0)
        self.assertEqual(logic.maharashtra_professional_tax(7501, "Male", "2026-06"), 175.0)
        self.assertEqual(logic.maharashtra_professional_tax(10000, "Male", "2026-06"), 175.0)
        self.assertEqual(logic.maharashtra_professional_tax(10001, "Male", "2026-06"), 200.0)
        self.assertEqual(logic.maharashtra_professional_tax(10001, "Male", "2026-02"), 300.0)

    def test_maharashtra_ptax_female_slabs(self):
        self.assertEqual(logic.maharashtra_professional_tax(25000, "Female", "2026-06"), 0.0)
        self.assertEqual(logic.maharashtra_professional_tax(25001, "Female", "2026-06"), 200.0)
        self.assertEqual(logic.maharashtra_professional_tax(25001, "Female", "2026-02"), 300.0)

    def test_maharashtra_ptax_unknown_gender(self):
        self.assertEqual(logic.maharashtra_professional_tax(50000, None, "2026-06"), 0.0)


if __name__ == "__main__":
    unittest.main()
