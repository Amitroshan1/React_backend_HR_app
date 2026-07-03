"""Unit tests for state-wise LWF employee deduction."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website" / "commands"


def _load_ctc_breakup_logic():
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


def _load_professional_tax():
    _load_ctc_breakup_logic()
    path = ROOT / "professional_tax.py"
    spec = importlib.util.spec_from_file_location("website.commands.professional_tax", path)
    mod = importlib.util.module_from_spec(spec)
    if "website" not in sys.modules:
        sys.modules["website"] = types.ModuleType("website")
    if "website.commands" not in sys.modules:
        sys.modules["website.commands"] = types.ModuleType("website.commands")
    sys.modules["website.commands.professional_tax"] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_lwf():
    _load_professional_tax()
    path = ROOT / "lwf.py"
    spec = importlib.util.spec_from_file_location("website.commands.lwf", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["website.commands.lwf"] = mod
    spec.loader.exec_module(mod)
    return mod


lwf = _load_lwf()


class TestLwf(unittest.TestCase):
    def test_maharashtra_half_yearly(self):
        amt = lwf.lwf_employee_monthly("MH", month=6)
        self.assertGreater(amt, 0)
        self.assertEqual(amt, round(amt, 2))
        self.assertEqual(lwf.lwf_employee_monthly("MH", month=7), 0.0)

    def test_delhi_half_yearly(self):
        june = lwf.lwf_employee_monthly("DL", month=6)
        july = lwf.lwf_employee_monthly("DL", month=7)
        self.assertGreater(june, 0)
        self.assertEqual(july, 0.0)

    def test_karnataka_annual_december_only(self):
        self.assertEqual(lwf.lwf_employee_monthly("KA", month=6), 0.0)
        self.assertEqual(lwf.lwf_employee_monthly("KA", month=12), 20.0)

    def test_policy_fallback_when_state_has_no_lwf(self):
        amt = lwf.lwf_employee_monthly("AN", month=3, policy_employee_yearly=1200)
        self.assertEqual(amt, 100.0)

    def test_list_lwf_states_nonempty(self):
        states = lwf.list_lwf_states()
        self.assertGreater(len(states), 0)
        codes = {s["code"] for s in states}
        self.assertIn("MH", codes)


if __name__ == "__main__":
    unittest.main()
