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


if __name__ == "__main__":
    unittest.main()
