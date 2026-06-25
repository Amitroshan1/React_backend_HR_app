"""P7 regression tests — variance alerts, amendment limits, compliance settings."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parent.parent
WEBSITE = ROOT / "website"


def _load_tds_settings_module():
    path = WEBSITE / "tds_settings.py"
    spec = importlib.util.spec_from_file_location("website.tds_settings", path)
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "website"
    sys.modules["website.tds_settings"] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_variance_service():
    sys.path.insert(0, str(ROOT))
    pkg = types.ModuleType("website")
    pkg.db = MagicMock()
    pkg.__path__ = [str(WEBSITE)]
    sys.modules["website"] = pkg

    mock_tds = _load_tds_settings_module()
    sys.modules["website.tds_settings"] = mock_tds
    sys.modules["website.models"] = types.ModuleType("website.models")
    sys.modules["website.models.Admin_models"] = MagicMock()

    mock_form16 = types.ModuleType("website.form16_service")
    mock_form16.build_form16_summary = MagicMock()
    mock_form16.build_form16_reconciliation = MagicMock()
    sys.modules["website.form16_service"] = mock_form16

    mock_admin_models = types.ModuleType("website.models.Admin_models")
    mock_admin_models.Admin = MagicMock()
    sys.modules["website.models.Admin_models"] = mock_admin_models

    email_mod = types.ModuleType("website.email")
    email_mod.send_form16_variance_alert_email = MagicMock(return_value=(True, "sent"))
    sys.modules["website.email"] = email_mod

    path = WEBSITE / "form16_variance_service.py"
    spec = importlib.util.spec_from_file_location("website.form16_variance_service", path)
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "website"
    sys.modules["website.form16_variance_service"] = mod
    spec.loader.exec_module(mod)
    return mod, mock_form16, mock_tds


def _load_amend_helpers():
    sys.path.insert(0, str(ROOT))
    mock_flask = types.ModuleType("flask")
    mock_flask.jsonify = lambda x: x
    mock_flask.request = MagicMock()
    mock_flask.current_app = MagicMock()
    sys.modules["flask"] = mock_flask
    sys.modules["flask_jwt_extended"] = MagicMock()
    sys.modules["werkzeug"] = MagicMock()
    sys.modules["werkzeug.utils"] = MagicMock()

    pkg = types.ModuleType("website")
    pkg.db = MagicMock()
    pkg.__path__ = [str(WEBSITE)]
    sys.modules["website"] = pkg

    logic_path = WEBSITE / "commands" / "tds_logic.py"
    spec_logic = importlib.util.spec_from_file_location("website.commands.tds_logic", logic_path)
    logic = importlib.util.module_from_spec(spec_logic)
    spec_logic.loader.exec_module(logic)
    sys.modules["website.commands"] = types.ModuleType("website.commands")
    sys.modules["website.commands.tds_logic"] = logic

    dt = types.ModuleType("website.datetime_utils")
    dt.isoformat_api = lambda x: x
    dt.utc_now = lambda: None
    sys.modules["website.datetime_utils"] = dt

    pf = types.ModuleType("website.plan_features")
    pf.has_feature = lambda x: True
    pf.plan_forbidden_response = lambda x: None
    sys.modules["website.plan_features"] = pf

    mock_tds = _load_tds_settings_module()
    sys.modules["website.tds_settings"] = mock_tds

    for m in (
        "website.models.Admin_models",
        "website.models.ctc_breakup",
        "website.models.emp_detail_models",
        "website.models.employee_accounts",
        "website.models.employee_tax_declaration",
    ):
        sys.modules[m] = MagicMock()

    path = WEBSITE / "tax_declaration_service.py"
    spec = importlib.util.spec_from_file_location("website.tax_declaration_service", path)
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "website"
    sys.modules["website.tax_declaration_service"] = mod
    spec.loader.exec_module(mod)
    return mod


class TestP7TdsSettings(unittest.TestCase):
    def test_save_variance_and_amendment_settings(self):
        tds = _load_tds_settings_module()
        with patch.object(tds, "_SETTINGS_PATH") as mock_path:
            mock_path.is_file.return_value = False
            mock_path.parent.mkdir = MagicMock()
            mock_path.open = MagicMock()
            written = {}

            class FakeFH:
                def __enter__(self):
                    return self

                def __exit__(self, *args):
                    pass

                def write(self, data):
                    written["data"] = data

            mock_path.open.return_value = FakeFH()
            result = tds.save_tds_settings({
                "form16_variance_tolerance_inr": 250,
                "form16_variance_alert_enabled": False,
                "max_declaration_amendments_per_fy": 3,
            })
            self.assertEqual(result["form16_variance_tolerance_inr"], 250)
            self.assertFalse(result["form16_variance_alert_enabled"])
            self.assertEqual(result["max_declaration_amendments_per_fy"], 3)


class TestP7VarianceAlerts(unittest.TestCase):
    def test_notify_skips_when_within_tolerance(self):
        var_svc, form16, tds = _load_variance_service()
        form16.build_form16_summary.return_value = {
            "financial_year": "2025-26",
            "employee": {"name": "Test", "emp_id": "E1"},
            "reconciliation": {
                "has_uploaded_figures": True,
                "match_status": "matched",
            },
        }
        with patch.object(tds, "load_tds_settings", return_value={"form16_variance_alert_enabled": True}):
            result = var_svc.notify_form16_variance_if_needed(1, "2025-26")
        self.assertFalse(result["notified"])
        self.assertEqual(result["reason"], "within_tolerance")

    def test_notify_when_variance_exceeds_tolerance(self):
        var_svc, form16, tds = _load_variance_service()
        recon = {
            "has_uploaded_figures": True,
            "match_status": "variance",
            "differences": {"tds_deducted": 5000},
        }
        form16.build_form16_summary.return_value = {
            "financial_year": "2025-26",
            "employee": {"name": "Test", "emp_id": "E1"},
            "reconciliation": recon,
        }
        admin = MagicMock()
        admin.email = "test@example.com"
        with patch.object(tds, "load_tds_settings", return_value={"form16_variance_alert_enabled": True}):
            from website.models.Admin_models import Admin
            Admin.query.get.return_value = admin
            result = var_svc.notify_form16_variance_if_needed(1, "2025-26")
        self.assertTrue(result["notified"])


class TestP7AmendmentLimits(unittest.TestCase):
    def test_count_amend_unlocks(self):
        tax_decl = _load_amend_helpers()
        row = MagicMock()
        row.approval_history.all.return_value = [
            MagicMock(action="amend_unlock"),
            MagicMock(action="approve"),
            MagicMock(action="amend_unlock"),
        ]
        self.assertEqual(tax_decl._count_amend_unlocks(row), 2)


if __name__ == "__main__":
    unittest.main()
