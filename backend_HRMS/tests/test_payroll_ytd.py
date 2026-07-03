"""Unit tests for payroll YTD aggregation."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website" / "commands"


def _load_payroll_logic():
    path = ROOT / "payroll_logic.py"
    spec = importlib.util.spec_from_file_location("website.commands.payroll_logic", path)
    mod = importlib.util.module_from_spec(spec)
    if "website" not in sys.modules:
        sys.modules["website"] = types.ModuleType("website")
    if "website.commands" not in sys.modules:
        sys.modules["website.commands"] = types.ModuleType("website.commands")
    sys.modules["website.commands.payroll_logic"] = mod
    spec.loader.exec_module(mod)
    return mod


payroll_logic = _load_payroll_logic()


class _Row:
    def __init__(self, year, month_num, **kwargs):
        self.year = str(year)
        self.month_num = month_num
        for k, v in kwargs.items():
            setattr(self, k, v)


class TestPayrollYtd(unittest.TestCase):
    def test_fy_april_through_june(self):
        rows = [
            _Row(2026, 4, gross_salary_for_month=10000, arrears_gross_final=500,
                 epf_final=1200, esic_final=0, ptax_final=200, lwf_final=25,
                 tds_final=800, net_salary_final=8475),
            _Row(2026, 5, gross_salary_for_month=10000, arrears_gross_final=0,
                 epf_final=1200, esic_final=0, ptax_final=200, lwf_final=0,
                 tds_final=800, net_salary_final=7800),
            _Row(2025, 12, gross_salary_for_month=99999, epf_final=9999,
                 esic_final=0, ptax_final=0, lwf_final=0, tds_final=0,
                 net_salary_final=90000),
        ]
        ytd = payroll_logic.sum_payroll_ytd(rows, through_year=2026, through_month=5)
        self.assertEqual(ytd["months_included"], 2)
        self.assertEqual(ytd["gross_salary_for_month"], 20000.0)
        self.assertEqual(ytd["arrears_gross_final"], 500.0)
        self.assertEqual(ytd["total_gross"], 20500.0)
        self.assertEqual(ytd["epf_final"], 2400.0)
        self.assertEqual(ytd["lwf_final"], 25.0)
        self.assertEqual(ytd["fy_label"], "2026-27")


if __name__ == "__main__":
    unittest.main()
