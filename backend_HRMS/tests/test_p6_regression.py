"""P6 regression tests — Form 16 reconciliation, TRACES CSV, declaration rollup, FY rules."""
import importlib.util
import sys
import types
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parent.parent
WEBSITE = ROOT / "website"


def _load_tds_logic():
    path = WEBSITE / "commands" / "tds_logic.py"
    spec = importlib.util.spec_from_file_location("tds_logic", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_form16_reconcile():
    """Load reconcile_form16_figures with heavy deps mocked."""
    sys.path.insert(0, str(ROOT))
    for name in list(sys.modules):
        if name.startswith("reportlab"):
            del sys.modules[name]

    mock_flask = types.ModuleType("flask")
    mock_flask.jsonify = lambda x: x
    sys.modules.setdefault("flask", mock_flask)

    pkg = types.ModuleType("website")
    pkg.db = MagicMock()
    pkg.__path__ = [str(WEBSITE)]
    sys.modules["website"] = pkg

    for sub in (
        "website.payroll_tds_service",
        "website.tax_declaration_service",
        "website.tds_settings",
        "website.models",
        "website.models.Admin_models",
        "website.models.ctc_breakup",
        "website.models.employee_accounts",
        "website.models.monthly_payroll",
        "website.models.news_feed",
    ):
        sys.modules[sub] = MagicMock()

    mock_tds = types.ModuleType("website.tds_settings")
    mock_tds.employer_details = lambda: {"name": "Test Co", "tan": "TAN1", "pan": "PAN1"}
    mock_tds.load_tds_settings = lambda: {}
    sys.modules["website.tds_settings"] = mock_tds

    reportlab = types.ModuleType("reportlab")
    lib = types.ModuleType("reportlab.lib")
    pagesizes = types.ModuleType("reportlab.lib.pagesizes")
    pagesizes.A4 = (595, 842)
    pdfgen = types.ModuleType("reportlab.pdfgen")
    canvas_mod = types.ModuleType("reportlab.pdfgen.canvas")
    canvas_mod.Canvas = MagicMock
    sys.modules["reportlab"] = reportlab
    sys.modules["reportlab.lib"] = lib
    sys.modules["reportlab.lib.pagesizes"] = pagesizes
    sys.modules["reportlab.pdfgen"] = pdfgen
    sys.modules["reportlab.pdfgen.canvas"] = canvas_mod

    path = WEBSITE / "form16_service.py"
    spec = importlib.util.spec_from_file_location("website.form16_service", path)
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "website"
    sys.modules["website.form16_service"] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_traces_parser():
    sys.path.insert(0, str(ROOT))
    pkg = types.ModuleType("website")
    pkg.db = MagicMock()
    pkg.__path__ = [str(WEBSITE)]
    sys.modules["website"] = pkg
    sys.modules["website.models"] = types.ModuleType("website.models")
    sys.modules["website.models.Admin_models"] = MagicMock()
    sys.modules["website.models.news_feed"] = MagicMock()

    path = WEBSITE / "traces_import_service.py"
    spec = importlib.util.spec_from_file_location("website.traces_import_service", path)
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "website"
    sys.modules["website.traces_import_service"] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_tax_rollup():
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
    sys.modules["website.commands"] = types.ModuleType("website.commands")
    logic = _load_tds_logic()
    sys.modules["website.commands.tds_logic"] = logic
    dt = types.ModuleType("website.datetime_utils")
    dt.isoformat_api = lambda x: x
    dt.utc_now = lambda: None
    sys.modules["website.datetime_utils"] = dt
    pf = types.ModuleType("website.plan_features")
    pf.has_feature = lambda x: True
    pf.plan_forbidden_response = lambda x: None
    sys.modules["website.plan_features"] = pf
    sys.modules["website.models"] = types.ModuleType("website.models")
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


class TestP6FinancialYearRules(unittest.TestCase):
    def test_2026_27_rules_load(self):
        logic = _load_tds_logic()
        old_rules = logic.load_tax_rules("2026-27", "old")
        new_rules = logic.load_tax_rules("2026-27", "new")
        self.assertEqual(old_rules["financial_year"], "2026-27")
        self.assertEqual(new_rules["regime"], "new")
        self.assertGreater(float(new_rules["standard_deduction"]), 0)


class TestP6Form16Reconciliation(unittest.TestCase):
    def test_reconcile_matched_within_tolerance(self):
        f16 = _load_form16_reconcile()
        computed = {
            "gross_salary": 500000,
            "tds_deducted": 25000,
            "taxable_income": 400000,
            "annual_tax": 30000,
        }
        uploaded = {
            "gross_salary": 500050,
            "tds_deducted": 25050,
            "taxable_income": 400080,
            "annual_tax": 30070,
        }
        result = f16.reconcile_form16_figures(
            computed, uploaded, financial_year="2025-26", tolerance=100
        )
        self.assertEqual(result["match_status"], "matched")

    def test_reconcile_variance(self):
        f16 = _load_form16_reconcile()
        computed = {"gross_salary": 500000, "tds_deducted": 25000, "taxable_income": 400000, "annual_tax": 30000}
        uploaded = {"gross_salary": 450000, "tds_deducted": 20000, "taxable_income": 350000, "annual_tax": 25000}
        result = f16.reconcile_form16_figures(computed, uploaded, financial_year="2025-26")
        self.assertEqual(result["match_status"], "variance")
        self.assertGreater(abs(result["differences"]["gross_salary"]), 100)

    def test_chapter_via_schedule(self):
        f16 = _load_form16_reconcile()
        rows = f16.build_chapter_via_schedule({
            "standard_deduction": 50000,
            "section_80c_total": 150000,
            "hra_exemption": 0,
        })
        labels = [r["section"] for r in rows]
        self.assertIn("Standard deduction", labels)
        self.assertIn("Section 80C (incl. EPF)", labels)


class TestP6TracesCsv(unittest.TestCase):
    def test_parse_traces_csv_by_emp_id(self):
        traces = _load_traces_parser()
        csv_text = (
            "Employee ID,Gross Salary,TDS Deducted,Taxable Income\n"
            "EMP001,600000,45000,500000\n"
        )
        rows = traces.parse_traces_csv(csv_text)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["emp_id"], "EMP001")
        self.assertEqual(rows[0]["parsed_gross_salary"], 600000.0)
        self.assertEqual(rows[0]["parsed_tds_deducted"], 45000.0)

    def test_parse_traces_csv_requires_identifier(self):
        traces = _load_traces_parser()
        with self.assertRaises(ValueError):
            traces.parse_traces_csv("Gross,TDS\n100,10\n")


class TestP6DeclarationRollup(unittest.TestCase):
    def test_rollup_maps_80c_and_hra(self):
        tax_decl = _load_tax_rollup()
        logic = _load_tds_logic()
        rules = logic.load_tax_rules("2025-26", "old")
        items = [
            {"section_code": "80C", "item_code": "PPF", "amount": 50000},
            {"section_code": "HRA", "item_code": "RENT_MONTHLY", "amount": 10000},
            {"section_code": "HRA", "item_code": "IS_METRO", "text_value": "true"},
        ]
        out = tax_decl.rollup_items_to_tds_inputs(items, monthly_epf=1500, rules=rules)
        self.assertEqual(out["section_80c_extra"], 50000)
        self.assertEqual(out["rent_paid_annual"], 120000)
        self.assertTrue(out["is_metro"])


if __name__ == "__main__":
    unittest.main()
