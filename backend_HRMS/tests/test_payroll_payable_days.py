import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parent.parent
    / "website"
    / "commands"
    / "payroll_logic.py"
)
spec = importlib.util.spec_from_file_location("payroll_logic", MODULE_PATH)
logic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(logic)


class TestPayrollPayableDays(unittest.TestCase):
    def test_normalize_payable_days_never_negative(self):
        self.assertEqual(logic.normalize_payable_days(-4, 30), 0.0)
        self.assertEqual(logic.normalize_payable_days(18, 30), 18.0)

    def test_normalize_payable_days_caps_at_calendar(self):
        self.assertEqual(logic.normalize_payable_days(35, 30), 30.0)

    def test_payroll_earnings_factor(self):
        self.assertEqual(logic.payroll_earnings_factor(0, 30), 0.0)
        self.assertAlmostEqual(logic.payroll_earnings_factor(15, 30), 0.5)
        self.assertEqual(logic.payroll_earnings_factor(30, 30), 1.0)


if __name__ == "__main__":
    unittest.main()
