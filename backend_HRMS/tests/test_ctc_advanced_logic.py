"""Phase 7 — advanced CTC logic tests."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website" / "commands"


def _load_ctc_advanced_logic():
    ctc_path = ROOT / "ctc_breakup_logic.py"
    adv_path = ROOT / "ctc_advanced_logic.py"
    if "website" not in sys.modules:
        sys.modules["website"] = types.ModuleType("website")
    if "website.commands" not in sys.modules:
        sys.modules["website.commands"] = types.ModuleType("website.commands")
    ctc_spec = importlib.util.spec_from_file_location(
        "website.commands.ctc_breakup_logic", ctc_path
    )
    ctc_mod = importlib.util.module_from_spec(ctc_spec)
    sys.modules["website.commands.ctc_breakup_logic"] = ctc_mod
    ctc_spec.loader.exec_module(ctc_mod)
    adv_spec = importlib.util.spec_from_file_location(
        "website.commands.ctc_advanced_logic", adv_path
    )
    adv_mod = importlib.util.module_from_spec(adv_spec)
    sys.modules["website.commands.ctc_advanced_logic"] = adv_mod
    adv_spec.loader.exec_module(adv_mod)
    return adv_mod


adv = _load_ctc_advanced_logic()


class TestCtcAdvancedLogic(unittest.TestCase):
    def test_metro_from_location(self):
        self.assertTrue(adv.resolve_is_metro_hra(location="Mumbai Office"))
        self.assertFalse(adv.resolve_is_metro_hra(location="Jaipur"))

    def test_metro_explicit_override(self):
        self.assertTrue(adv.resolve_is_metro_hra(location="Jaipur", explicit=True))
        self.assertFalse(adv.resolve_is_metro_hra(location="Mumbai", explicit=False))

    def test_eps_split_capped(self):
        split = adv.employer_pf_eps_split(basic_salary=15000, dearness_allowance=0)
        self.assertEqual(split["employer_pf_total_monthly"], 1800.0)
        self.assertEqual(split["eps_contribution_monthly"], 1250.0)
        self.assertEqual(split["epf_er_contribution_monthly"], 550.0)

    def test_vpf_monthly(self):
        self.assertEqual(
            adv.vpf_monthly_amount(basic_salary=10000, dearness_allowance=0, vpf_monthly=500),
            500.0,
        )

    def test_nps_employer_capped_at_ten_pct(self):
        self.assertEqual(
            adv.nps_employer_monthly(basic_salary=50000, nps_employer_pct_of_basic=15),
            5000.0,
        )


if __name__ == "__main__":
    unittest.main()
