import importlib.util
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website" / "commands"


def _load_logic():
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
    path = ROOT / "professional_tax.py"
    spec = importlib.util.spec_from_file_location("website.commands.professional_tax", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["website.commands.professional_tax"] = mod
    spec.loader.exec_module(mod)
    return mod


logic = _load_logic()
pt = _load_professional_tax()


class TestProfessionalTax(unittest.TestCase):
    def test_all_states_listed(self):
        states = pt.list_ptax_states()
        self.assertEqual(len(states), 36)
        codes = {s["code"] for s in states}
        self.assertIn("MH", codes)
        self.assertIn("DL", codes)
        self.assertIn("PY", codes)

    def test_karnataka_2025_threshold(self):
        self.assertEqual(pt.professional_tax(24999, None, 6, "KA"), 0.0)
        self.assertEqual(pt.professional_tax(25000, None, 6, "KA"), 200.0)
        self.assertEqual(pt.professional_tax(25000, None, 2, "KA"), 300.0)

    def test_tamil_nadu_half_yearly(self):
        self.assertEqual(pt.professional_tax(3500, None, 6, "TN"), 0.0)
        self.assertAlmostEqual(pt.professional_tax(20000, None, 6, "TN"), 208.33, places=2)

    def test_maharashtra_unknown_gender(self):
        self.assertEqual(pt.professional_tax(94735, None, "2026-06", "MH"), 200.0)
        self.assertEqual(pt.professional_tax(7500, None, "2026-06", "MH"), 0.0)

    def test_delhi_no_pt(self):
        self.assertEqual(pt.professional_tax(100000, None, 6, "DL"), 0.0)

    def test_telangana_slabs(self):
        self.assertEqual(pt.professional_tax(15000, None, 6, "TS"), 0.0)
        self.assertEqual(pt.professional_tax(17500, None, 6, "TS"), 150.0)
        self.assertEqual(pt.professional_tax(25000, None, 6, "TS"), 200.0)

    def test_location_alias(self):
        self.assertEqual(pt.normalize_ptax_state("Bangalore"), "KA")
        self.assertEqual(pt.normalize_ptax_state("Chennai"), "TN")
        self.assertEqual(pt.normalize_ptax_state("Navi Mumbai"), "MH")
        self.assertEqual(pt.normalize_ptax_state("Jaipur"), "RJ")

    def test_resolve_ptax_state_priority(self):
        self.assertEqual(
            pt.resolve_ptax_state_for_employee(
                explicit_state="TN",
                saved_state="KA",
                location="Mumbai",
                default_state="MH",
            ),
            "TN",
        )
        self.assertEqual(
            pt.resolve_ptax_state_for_employee(
                explicit_state=None,
                saved_state="GJ",
                location="Mumbai",
                default_state="MH",
            ),
            "GJ",
        )


if __name__ == "__main__":
    unittest.main()
