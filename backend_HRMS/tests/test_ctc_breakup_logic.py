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
        self.assertAlmostEqual(logic.gratuity_yearly(10000, 3000), 7500.0, places=2)

    def test_employer_esic_below_cap(self):
        self.assertAlmostEqual(
            logic.employer_esic_yearly(14244), 5555.16, delta=1.0
        )

    def _assert_basic_at_least_min_ctc_band(self, b, da, hra_pct, other, mediclaim=0):
        pct = logic.basic_pct_of_monthly_ctc(b, da, hra_pct, other, mediclaim)
        self.assertGreaterEqual(pct, logic.BASIC_MIN_PCT_OF_CTC - 0.5)

    def test_mediclaim_adds_to_annual_ctc_without_slashing_basic(self):
        b0, d0, _, _, g0 = logic.monthly_components(
            13000, 0, 8, 0, apply_floor=True, mediclaim_yearly=0
        )
        b1, d1, _, _, g1 = logic.monthly_components(
            13000, 0, 8, 0, apply_floor=True, mediclaim_yearly=4000
        )
        ann0 = logic._annual_ctc_raw(b0, d0, 8, 0, 0)
        ann1 = logic._annual_ctc_raw(b1, d1, 8, 0, 4000)
        self.assertAlmostEqual(b0, 13000, places=0)
        self.assertAlmostEqual(b1, 13000, places=0)
        self.assertAlmostEqual(g0, g1, places=0)
        self.assertAlmostEqual(ann1 - ann0, 4000, delta=1)

    def test_allowance_heads_not_modified_by_band_enforcement(self):
        b, da, hra, other, gross = logic.monthly_components(1500, 0, 40, 0, apply_floor=True)
        self.assertEqual(other, 0.0)
        self.assertAlmostEqual(hra, logic.pf_wage_monthly(b, da) * 0.4, places=2)
        self.assertAlmostEqual(gross, logic.pf_wage_monthly(b, da) + hra + other, places=2)

        b2, da2, hra2, other2, gross2 = logic.monthly_components(
            13000, 0, 10, 500, apply_floor=True
        )
        self.assertEqual(other2, 500.0)
        self.assertAlmostEqual(hra2, logic.pf_wage_monthly(b2, da2) * 0.1, places=2)
        self.assertAlmostEqual(gross2, logic.pf_wage_monthly(b2, da2) + hra2 + other2, places=2)

    def test_split_allowance_heads_sum(self):
        heads, total = logic.normalize_allowance_heads(
            special_allowance=1000,
            conveyance_allowance=1600,
            medical_allowance=500,
            lta_allowance=200,
        )
        self.assertEqual(total, 3300)
        self.assertEqual(heads["conveyance_allowance"], 1600)

    def test_legacy_other_allowance_maps_to_special(self):
        heads, total = logic.normalize_allowance_heads(other_allowance=5000)
        self.assertEqual(total, 5000)
        self.assertEqual(heads["special_allowance"], 5000)

    def test_variable_ctc_added_to_total(self):
        self.assertEqual(logic.total_ctc_annual(200000, 50000), 250000)

    def test_pf_admin_and_edli_on_capped_wage(self):
        # PF wage cap 15000 => admin 75/mo, edli 75/mo yearly 900 each
        self.assertAlmostEqual(logic.pf_admin_yearly(20000), 900.0, places=0)
        self.assertAlmostEqual(logic.edli_yearly(20000), 900.0, places=0)

    def test_pf_admin_excluded_from_ctc_when_disabled(self):
        with_admin = logic._annual_ctc_raw(13000, 0, 40, 0, 0, True, True)
        without = logic._annual_ctc_raw(13000, 0, 40, 0, 0, False, False)
        self.assertGreater(with_admin, without)
        self.assertAlmostEqual(with_admin - without, 1560.0, delta=5.0)

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
            solved["dearness_allowance"],
            solved["hra_pct"],
            solved["other_allowance"],
            4000,
        )
        annual = logic.annual_ctc_from_monthly(
            solved["basic_salary"],
            solved["hra_pct"],
            solved["other_allowance"],
            4000,
            dearness_allowance=solved["dearness_allowance"],
        )
        self.assertAlmostEqual(annual, solved["annual_ctc_computed"], delta=50)

    def test_reverse_6_lpa_fixed_other(self):
        other = 13035.0
        solved = logic.reverse_ctc_breakup(
            600000, hra_pct=50, allowance_total=other, mediclaim_yearly=0
        )
        annual = logic.annual_ctc_from_monthly(
            solved["basic_salary"],
            solved["hra_pct"],
            other,
            0,
            dearness_allowance=solved["dearness_allowance"],
        )
        self.assertAlmostEqual(annual, 600000, delta=500)
        self.assertAlmostEqual(solved["other_allowance"], other, delta=1)
        self._assert_basic_at_least_min_ctc_band(
            solved["basic_salary"],
            solved["dearness_allowance"],
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
        self.assertEqual(logic.maharashtra_professional_tax(50000, None, "2026-06"), 200.0)
        self.assertEqual(logic.maharashtra_professional_tax(9000, None, "2026-06"), 175.0)

    def test_statutory_bonus_in_fixed_ctc(self):
        without = logic.annual_ctc_from_monthly(
            50000, 40, 10000, 0,
            dearness_allowance=0,
            include_statutory_bonus_in_ctc=False,
        )
        with_bonus = logic.annual_ctc_from_monthly(
            50000, 40, 10000, 0,
            dearness_allowance=0,
            include_statutory_bonus_in_ctc=True,
            statutory_bonus_pct=8.33,
        )
        expected_bonus = logic.statutory_bonus_yearly(50000, 0, 8.33)
        self.assertAlmostEqual(with_bonus - without, expected_bonus, places=1)

    def test_lwf_in_fixed_ctc(self):
        without = logic.annual_ctc_from_monthly(
            50000, 40, 10000, 0,
            include_lwf_in_ctc=False,
        )
        with_lwf = logic.annual_ctc_from_monthly(
            50000, 40, 10000, 0,
            include_lwf_in_ctc=True,
            lwf_employer_yearly_amount=12.0,
        )
        self.assertAlmostEqual(with_lwf - without, 12.0, places=2)


if __name__ == "__main__":
    unittest.main()
