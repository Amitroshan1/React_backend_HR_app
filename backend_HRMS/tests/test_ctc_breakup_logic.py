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

    def test_basic_floor_raises_low_basic(self):
        b, hra, other, gross = logic.monthly_components(10000, 40, 0, apply_floor=True)
        self.assertGreaterEqual(b, logic.BASIC_MIN_MONTHLY)
        self.assertAlmostEqual(hra, b * 0.4, places=2)
        self.assertAlmostEqual(gross, b + hra + other, places=2)

    def test_basic_13000_unchanged_when_above_floor(self):
        b, hra, other, gross = logic.monthly_components(13000, 10, 1, apply_floor=True)
        self.assertAlmostEqual(b, 13000, places=2)
        self.assertAlmostEqual(hra, 1300, places=2)
        self.assertAlmostEqual(gross, 14301, places=2)

    def test_hra_change_affects_annual_ctc(self):
        b = 13000
        other = 1
        med = 4000
        ctc_10 = logic.annual_ctc_from_monthly(b, 10, other, med)
        ctc_40 = logic.annual_ctc_from_monthly(b, 40, other, med)
        self.assertGreater(ctc_40, ctc_10)

    def test_reverse_2_lpa_respects_floor(self):
        solved = logic.reverse_ctc_breakup(
            200000, hra_pct=9.57, mediclaim_yearly=4000
        )
        self.assertGreaterEqual(solved["basic_salary"], logic.BASIC_MIN_MONTHLY)
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
        self.assertGreater(solved["basic_salary"], 12500)


if __name__ == "__main__":
    unittest.main()
