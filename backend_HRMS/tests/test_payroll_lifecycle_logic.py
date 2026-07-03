"""Unit tests for payroll lifecycle logic."""
import importlib.util
import sys
import types
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website" / "commands"


def _load():
    path = ROOT / "payroll_lifecycle_logic.py"
    spec = importlib.util.spec_from_file_location("website.commands.payroll_lifecycle_logic", path)
    mod = importlib.util.module_from_spec(spec)
    if "website" not in sys.modules:
        sys.modules["website"] = types.ModuleType("website")
    if "website.commands" not in sys.modules:
        sys.modules["website.commands"] = types.ModuleType("website.commands")
    sys.modules["website.commands.payroll_lifecycle_logic"] = mod
    spec.loader.exec_module(mod)
    return mod


plc = _load()


class TestPayrollLifecycleLogic(unittest.TestCase):
    def test_loan_emi_capped_by_balance(self):
        self.assertEqual(plc.loan_emi_for_month(emi_monthly=5000, balance_remaining=1200), 1200.0)

    def test_leave_encashment_pl_only(self):
        out = plc.leave_encashment_amount(pl_days=10, cl_days=5, one_day_salary=1000, include_cl=False)
        self.assertEqual(out["total_encashment"], 10000.0)
        self.assertEqual(out["cl_encashment"], 0.0)

    def test_gratuity_not_eligible_under_5_years(self):
        g = plc.gratuity_fnf_amount(basic=30000, dearness_allowance=0, years_of_service=4.5)
        self.assertFalse(g["eligible"])
        self.assertEqual(g["gratuity_amount"], 0.0)

    def test_fnf_net_payable(self):
        out = plc.compute_fnf_settlement(
            one_day_salary=1000,
            pending_salary_days=15,
            pl_leave_balance=5,
            cl_leave_balance=0,
            include_cl_encashment=False,
            basic=20000,
            dearness_allowance=0,
            years_of_service_val=6,
            loan_recovery=2000,
            notice_recovery_days=2,
        )
        self.assertGreater(out["net_payable"], 0)
        self.assertEqual(out["earnings"]["pending_salary"], 15000.0)
        self.assertEqual(out["deductions"]["notice_recovery"], 2000.0)

    def test_bank_csv_has_header(self):
        csv_text = plc.bank_neft_csv_rows([
            {"beneficiary_name": "A", "account_number": "123", "ifsc": "HDFC0001234", "amount": 100, "emp_id": "E1"},
        ])
        self.assertIn("Beneficiary Name", csv_text)
        self.assertIn("HDFC0001234", csv_text)

    def test_years_of_service(self):
        yrs = plc.years_of_service(date(2020, 1, 1), date(2026, 1, 1))
        self.assertGreaterEqual(yrs, 5.9)


if __name__ == "__main__":
    unittest.main()
