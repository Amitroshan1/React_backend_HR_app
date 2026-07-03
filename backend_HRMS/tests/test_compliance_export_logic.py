"""Unit tests for compliance export logic."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website" / "commands"


def _load_ctc():
    path = ROOT / "ctc_breakup_logic.py"
    spec = importlib.util.spec_from_file_location("website.commands.ctc_breakup_logic", path)
    mod = importlib.util.module_from_spec(spec)
    if "website" not in sys.modules:
        sys.modules["website"] = types.ModuleType("website")
    if "website.commands" not in sys.modules:
        sys.modules["website.commands"] = types.ModuleType("website.commands")
    sys.modules["website.commands.ctc_breakup_logic"] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_compliance():
    _load_ctc()
    path = ROOT / "compliance_export_logic.py"
    spec = importlib.util.spec_from_file_location("website.commands.compliance_export_logic", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["website.commands.compliance_export_logic"] = mod
    spec.loader.exec_module(mod)
    return mod


ce = _load_compliance()


class TestComplianceExportLogic(unittest.TestCase):
    def test_pf_ecr_eps_split(self):
        out = ce.compute_pf_ecr_amounts(
            basic=20000,
            dearness_allowance=0,
            gross_wages=20000,
            payable_days=30,
            calendar_days=30,
            epf_employee_paid=1800,
        )
        self.assertEqual(out["epf_wages"], 15000)
        self.assertEqual(out["eps_contribution_er"], 1250)
        self.assertEqual(out["epf_er_diff"], 550)
        self.assertEqual(out["epf_contribution_ee"], 1800)

    def test_esic_not_applicable_above_cap(self):
        out = ce.compute_esic_amounts(25000)
        self.assertFalse(out["applicable"])

    def test_quarter_months_q1(self):
        months = ce.quarter_month_pairs("2025-26", 1)
        self.assertEqual(months, [(2025, 4), (2025, 5), (2025, 6)])

    def test_pt_remittance_half_yearly_state(self):
        self.assertTrue(ce.pt_remittance_due_in_month("TN", 6))
        self.assertFalse(ce.pt_remittance_due_in_month("TN", 7))

    def test_form_24q_csv_header(self):
        csv_text = ce.form_24q_csv_rows(
            [{"pan": "ABCDE1234F", "employee_name": "Test", "emp_id": "E1", "gross_salary": 100, "tds_deducted": 10}],
            financial_year="2025-26",
            quarter=1,
        )
        self.assertIn("FINANCIAL YEAR", csv_text)
        self.assertIn("ABCDE1234F", csv_text)


if __name__ == "__main__":
    unittest.main()
