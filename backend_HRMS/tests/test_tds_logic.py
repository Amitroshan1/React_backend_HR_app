import importlib.util
import unittest
from datetime import date
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parent.parent
    / "website"
    / "commands"
    / "tds_logic.py"
)
spec = importlib.util.spec_from_file_location("tds_logic", MODULE_PATH)
logic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(logic)


class TestTdsLogic(unittest.TestCase):
    def test_normalize_regime(self):
        self.assertEqual(logic.normalize_regime("New Tax Regime"), "new")
        self.assertEqual(logic.normalize_regime("Old Tax regime"), "old")
        self.assertEqual(logic.normalize_regime(None), "new")

    def test_financial_year_for_date(self):
        self.assertEqual(logic.financial_year_for_date(date(2026, 6, 8)), "2026-27")
        self.assertEqual(logic.financial_year_for_date(date(2026, 2, 1)), "2025-26")

    def test_low_income_new_regime_zero_tax(self):
        result = logic.run_tds_projection(
            monthly_gross=14300,
            monthly_basic=13000,
            monthly_hra=1300,
            monthly_epf=1560,
            tax_regime="New Tax Regime",
            financial_year="2025-26",
            pan="ABCDE1234F",
            as_of=date(2026, 6, 1),
        )
        self.assertEqual(result["regime"], "new")
        self.assertEqual(result["tds"]["monthly_tds"], 0)

    def test_old_regime_loads_rules(self):
        result = logic.run_tds_projection(
            monthly_gross=50000,
            monthly_basic=25000,
            monthly_hra=10000,
            monthly_epf=1800,
            tax_regime="Old Tax regime",
            financial_year="2025-26",
            pan="ABCDE1234F",
            rent_paid_annual=120000,
            as_of=date(2026, 6, 1),
        )
        self.assertEqual(result["regime"], "old")
        self.assertGreater(result["deductions"]["hra_exemption"], 0)
        self.assertGreater(result["deductions"]["section_80c"], 0)

    def test_missing_pan_warning(self):
        result = logic.run_tds_projection(
            monthly_gross=14300,
            monthly_basic=13000,
            monthly_hra=1300,
            monthly_epf=1560,
            tax_regime="New Tax Regime",
            financial_year="2025-26",
            pan="",
            as_of=date(2026, 6, 1),
        )
        self.assertTrue(any("PAN" in w for w in result["warnings"]))

    def test_old_regime_extended_deductions_reduce_tax(self):
        base = logic.run_tds_projection(
            monthly_gross=80000,
            monthly_basic=40000,
            monthly_hra=16000,
            monthly_epf=1800,
            tax_regime="Old Tax regime",
            financial_year="2025-26",
            pan="ABCDE1234F",
            as_of=date(2026, 6, 1),
        )
        with_extra = logic.run_tds_projection(
            monthly_gross=80000,
            monthly_basic=40000,
            monthly_hra=16000,
            monthly_epf=1800,
            tax_regime="Old Tax regime",
            financial_year="2025-26",
            pan="ABCDE1234F",
            section_80ccd1b=50000,
            section_24_interest=150000,
            other_income=50000,
            as_of=date(2026, 6, 1),
        )
        self.assertGreater(base["tax"]["annual_tax"], with_extra["tax"]["annual_tax"])
        self.assertGreater(with_extra["deductions"]["section_80ccd1b"], 0)
        self.assertGreater(with_extra["deductions"]["other_income"], 0)

    def test_tax_savings_old_regime(self):
        base = logic.run_tds_projection(
            monthly_gross=60000,
            monthly_basic=30000,
            monthly_hra=12000,
            monthly_epf=1800,
            tax_regime="Old Tax regime",
            financial_year="2025-26",
            pan="ABCDE1234F",
            ptax_annual=2400,
            as_of=date(2026, 6, 1),
        )
        with_decl = logic.run_tds_projection(
            monthly_gross=60000,
            monthly_basic=30000,
            monthly_hra=12000,
            monthly_epf=1800,
            tax_regime="Old Tax regime",
            financial_year="2025-26",
            pan="ABCDE1234F",
            rent_paid_annual=120000,
            is_metro=True,
            section_80c_extra=50000,
            section_80d=25000,
            ptax_annual=2400,
            as_of=date(2026, 6, 1),
        )
        tax_saved = base["tax"]["annual_tax"] - with_decl["tax"]["annual_tax"]
        self.assertGreater(tax_saved, 0)

    def test_previous_employer_taxable_increases_taxable(self):
        base = logic.run_tds_projection(
            monthly_gross=80000,
            monthly_basic=40000,
            monthly_hra=16000,
            monthly_epf=1800,
            tax_regime="New Tax Regime",
            financial_year="2026-27",
            pan="ABCDE1234F",
            as_of=date(2026, 10, 1),
        )
        with_prev = logic.run_tds_projection(
            monthly_gross=80000,
            monthly_basic=40000,
            monthly_hra=16000,
            monthly_epf=1800,
            tax_regime="New Tax Regime",
            financial_year="2026-27",
            pan="ABCDE1234F",
            previous_employer_taxable=400000,
            previous_employer_tds=20000,
            as_of=date(2026, 10, 1),
        )
        self.assertGreater(with_prev["taxable_income"], base["taxable_income"])
        self.assertEqual(with_prev["income"]["previous_employer_taxable"], 400000)

    def test_employer_nps_autofill_new_regime(self):
        without = logic.run_tds_projection(
            monthly_gross=100000,
            monthly_basic=50000,
            monthly_hra=20000,
            monthly_epf=1800,
            tax_regime="New Tax Regime",
            financial_year="2026-27",
            pan="ABCDE1234F",
            as_of=date(2026, 10, 1),
        )
        with_nps = logic.run_tds_projection(
            monthly_gross=100000,
            monthly_basic=50000,
            monthly_hra=20000,
            monthly_epf=1800,
            tax_regime="New Tax Regime",
            financial_year="2026-27",
            pan="ABCDE1234F",
            employer_nps_annual=60000,
            as_of=date(2026, 10, 1),
        )
        self.assertGreater(with_nps["deductions"]["section_80ccd2"], 0)
        self.assertLessEqual(with_nps["deductions"]["section_80ccd2"], 50000 * 12 * 0.14)
        self.assertLess(with_nps["taxable_income"], without["taxable_income"])

    def test_87a_marginal_relief_new_regime(self):
        just_over = logic.compute_annual_tax(1200100, logic.load_tax_rules("2026-27", "new"))
        at_limit = logic.compute_annual_tax(1200000, logic.load_tax_rules("2026-27", "new"))
        self.assertEqual(at_limit["annual_tax"], 0)
        extra = 1200100 - 1200000
        self.assertLessEqual(just_over["tax_after_rebate"], extra + 1)

    def test_80d_caps_and_80g_pct(self):
        result = logic.run_tds_projection(
            monthly_gross=150000,
            monthly_basic=75000,
            monthly_hra=30000,
            monthly_epf=1800,
            tax_regime="Old Tax regime",
            financial_year="2026-27",
            pan="ABCDE1234F",
            section_80d_self=80000,
            section_80d_parents=80000,
            parents_senior=True,
            section_80g=10000,
            section_80g_pct=100,
            as_of=date(2026, 10, 1),
        )
        self.assertEqual(result["deductions"]["section_80d"], 25000 + 50000)
        self.assertEqual(result["deductions"]["section_80g"], 10000)

    def test_old_regime_senior_slab(self):
        junior = logic.compute_annual_tax(
            520000, logic.load_tax_rules("2026-27", "old"), age=40
        )
        senior = logic.compute_annual_tax(
            520000, logic.load_tax_rules("2026-27", "old"), age=62
        )
        self.assertGreater(junior["annual_tax"], senior["annual_tax"])
        self.assertGreater(senior["annual_tax"], 0)

    def test_surcharge_applies_above_50l(self):
        mid = logic.compute_annual_tax(6000000, logic.load_tax_rules("2026-27", "new"))
        self.assertGreater(mid["surcharge"], 0)
        self.assertEqual(mid["surcharge_rate_pct"], 10)


if __name__ == "__main__":
    unittest.main()
