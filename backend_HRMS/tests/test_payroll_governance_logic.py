"""Phase 8 — payroll governance logic tests."""
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website" / "commands"


def _load():
    path = ROOT / "payroll_governance_logic.py"
    spec = importlib.util.spec_from_file_location("payroll_governance_logic", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


gov = _load()


class TestPayrollGovernanceLogic(unittest.TestCase):
    def test_valid_transitions(self):
        self.assertIn("reviewed", gov.VALID_TRANSITIONS["draft"])
        self.assertIn("paid", gov.VALID_TRANSITIONS["reviewed"])
        self.assertIn("locked", gov.VALID_TRANSITIONS["paid"])
        self.assertEqual(len(gov.VALID_TRANSITIONS["locked"]), 0)

    def test_invalid_transition_raises(self):
        with self.assertRaises(ValueError):
            gov.assert_status_transition("locked", "draft")

    def test_diff_payroll_fields(self):
        before = {"epf_final": 100.0, "tds_final": 0.0}
        after = {"epf_final": 120.0, "tds_final": 0.0}
        diff = gov.diff_payroll_fields(before, after)
        self.assertEqual(diff["epf_final"]["from"], 100.0)
        self.assertEqual(diff["epf_final"]["to"], 120.0)


if __name__ == "__main__":
    unittest.main()
