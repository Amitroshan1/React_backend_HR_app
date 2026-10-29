"""Statutory pack + date-aware PF ceiling."""
import importlib.util
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website" / "commands"


def _load(name):
    path = ROOT / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sp = _load("statutory_pack")
logic_spec = importlib.util.spec_from_file_location("ctc_breakup_logic", ROOT / "ctc_breakup_logic.py")
logic = importlib.util.module_from_spec(logic_spec)
logic_spec.loader.exec_module(logic)


class TestStatutoryPack(unittest.TestCase):
    def test_sep_16_uses_15000(self):
        pack = sp.pack_for_date(date(2026, 9, 16))
        self.assertEqual(pack["pf_wage_cap_monthly"], 15000)
        self.assertEqual(pack["eps_contrib_max"], 1250)

    def test_sep_17_uses_25000(self):
        pack = sp.pack_for_date(date(2026, 9, 17))
        self.assertEqual(pack["pf_wage_cap_monthly"], 25000)
        self.assertEqual(pack["eps_contrib_max"], 2082.5)

    def test_month_yyyy_mm_uses_month_end(self):
        self.assertEqual(sp.parse_as_of("2026-09"), date(2026, 9, 30))
        self.assertEqual(sp.pack_for_date("2026-09")["pf_wage_cap_monthly"], 25000)

    def test_pf_wage_capped_date_aware(self):
        self.assertEqual(logic.pf_wage_capped(20000, as_of="2026-08-01"), 15000)
        self.assertEqual(logic.pf_wage_capped(20000, as_of="2026-10-01"), 20000)
        self.assertEqual(logic.pf_wage_capped(40000, as_of="2026-10-01"), 25000)
        self.assertEqual(logic.pf_wage_capped(40000, as_of="2026-10-01", unrestricted=True), 40000)

    def test_medical_cap_large_value_treated_annual(self):
        heads, _ = logic.apply_allowance_caps(
            medical_allowance=10000, medical_cap_monthly=40000
        )
        self.assertAlmostEqual(heads["medical_allowance"], 40000 / 12.0, places=2)

    def test_esic_once_covered(self):
        self.assertEqual(logic.employee_esic_monthly(25000), 0.0)
        self.assertGreater(logic.employee_esic_monthly(25000, once_covered=True), 0.0)


if __name__ == "__main__":
    unittest.main()
