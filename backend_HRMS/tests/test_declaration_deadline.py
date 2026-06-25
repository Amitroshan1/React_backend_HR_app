"""Tests for tax declaration submission deadline."""
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
WEBSITE = ROOT / "website"


def _load_tds_settings_module():
    logic_path = WEBSITE / "commands" / "tds_logic.py"
    logic_spec = importlib.util.spec_from_file_location("website.commands.tds_logic", logic_path)
    logic_mod = importlib.util.module_from_spec(logic_spec)
    logic_mod.__package__ = "website.commands"
    logic_spec.loader.exec_module(logic_mod)

    pkg = types.ModuleType("website")
    pkg.__path__ = [str(WEBSITE)]
    sys.modules["website"] = pkg
    sys.modules["website.commands"] = types.ModuleType("website.commands")
    sys.modules["website.commands"].__path__ = [str(WEBSITE / "commands")]
    sys.modules["website.commands.tds_logic"] = logic_mod

    path = WEBSITE / "tds_settings.py"
    spec = importlib.util.spec_from_file_location("website.tds_settings", path)
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "website"
    sys.modules["website.tds_settings"] = mod
    spec.loader.exec_module(mod)
    return mod


class TestDeclarationDeadline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tds = _load_tds_settings_module()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings_file = Path(self.tmp.name) / "tds_settings.json"
        self.settings_file.write_text(
            json.dumps(
                {
                    "declaration_deadline_default_day": 25,
                    "declaration_deadline_default_month": 2,
                    "declaration_deadline_overrides": {},
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        self.tmp.cleanup()

    def test_default_deadline_fy_2026_27(self):
        with patch.object(self.tds, "_SETTINGS_PATH", self.settings_file):
            deadline = self.tds.default_declaration_deadline("2026-2027")
        self.assertEqual(deadline, date(2027, 2, 25))

    def test_override_extends_deadline(self):
        with patch.object(self.tds, "_SETTINGS_PATH", self.settings_file):
            self.tds.save_tds_settings(
                {"declaration_deadline_overrides": {"2026-27": "2027-03-03"}}
            )
            deadline = self.tds.effective_declaration_deadline("2026-2027")
            payload = self.tds.declaration_deadline_payload(
                "2026-2027", as_of=date(2027, 3, 1)
            )
        self.assertEqual(deadline, date(2027, 3, 3))
        self.assertTrue(payload["is_open"])
        self.assertTrue(payload["is_extended"])

    def test_closed_after_deadline(self):
        with patch.object(self.tds, "_SETTINGS_PATH", self.settings_file):
            payload = self.tds.declaration_deadline_payload(
                "2026-2027", as_of=date(2027, 2, 26)
            )
        self.assertFalse(payload["is_open"])
        self.assertIn("closed", payload["notice"].lower())

    def test_reset_override(self):
        with patch.object(self.tds, "_SETTINGS_PATH", self.settings_file):
            self.tds.set_declaration_deadline_override("2026-2027", date(2027, 3, 3))
            self.tds.set_declaration_deadline_override("2026-2027", None)
            deadline = self.tds.effective_declaration_deadline("2026-2027")
        self.assertEqual(deadline, date(2027, 2, 25))


if __name__ == "__main__":
    unittest.main()
