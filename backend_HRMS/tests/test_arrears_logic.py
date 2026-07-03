"""Unit tests for salary revision arrears."""
import importlib.util
import sys
import types
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website" / "commands"


def _load_arrears():
    path = ROOT / "arrears_logic.py"
    spec = importlib.util.spec_from_file_location("website.commands.arrears_logic", path)
    mod = importlib.util.module_from_spec(spec)
    if "website" not in sys.modules:
        sys.modules["website"] = types.ModuleType("website")
    if "website.commands" not in sys.modules:
        sys.modules["website.commands"] = types.ModuleType("website.commands")
    sys.modules["website.commands.arrears_logic"] = mod
    spec.loader.exec_module(mod)
    return mod


arrears = _load_arrears()


class TestArrearsLogic(unittest.TestCase):
    def test_no_arrears_when_new_not_higher(self):
        result = arrears.compute_salary_arrears(
            effective_from=date(2026, 1, 1),
            through_year=2026,
            through_month=3,
            old_gross_monthly=50000,
            new_gross_monthly=48000,
        )
        self.assertEqual(result["total_arrears_gross"], 0.0)
        self.assertEqual(result["month_count"], 0)

    def test_full_month_delta_without_payroll_days(self):
        result = arrears.compute_salary_arrears(
            effective_from=date(2026, 1, 1),
            through_year=2026,
            through_month=2,
            old_gross_monthly=40000,
            new_gross_monthly=45000,
        )
        self.assertEqual(result["month_count"], 2)
        self.assertEqual(result["total_arrears_gross"], 10000.0)
        self.assertEqual(result["months"][0]["arrears_gross"], 5000.0)

    def test_prorated_by_payable_days(self):
        result = arrears.compute_salary_arrears(
            effective_from=date(2026, 3, 1),
            through_year=2026,
            through_month=3,
            old_gross_monthly=30000,
            new_gross_monthly=31000,
            payroll_days_by_month={(2026, 3): 15},
            calendar_days_by_month={(2026, 3): 31},
        )
        self.assertEqual(result["month_count"], 1)
        old_one = 30000 / 31
        new_one = 31000 / 31
        expected = round((new_one - old_one) * 15, 2)
        self.assertEqual(result["months"][0]["arrears_gross"], expected)
        self.assertEqual(result["total_arrears_gross"], expected)


if __name__ == "__main__":
    unittest.main()
