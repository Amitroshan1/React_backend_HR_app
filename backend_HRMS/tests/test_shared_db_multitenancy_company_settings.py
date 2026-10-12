"""Per-company settings: leave policy, TDS / payroll (employer, declaration deadline) and CTC policy."""
import importlib
import json
import pkgutil
from datetime import date, timedelta

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    # confirmation_request references a Signup model that is not defined.
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website import ctc_settings, leave_settings, tds_settings  # noqa: E402
from website.models.Admin_models import Admin  # noqa: E402
from website.models.company_setting import CompanySetting  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards, tenant_scope  # noqa: E402

TODAY = date.today()
FY = "2026-2027"
PLATFORM_FILE = {"employer_name": "Platform Ltd", "employer_tan": "PLAT12345T", "employer_pan": "PLATP1234P"}


@pytest.fixture()
def app(tmp_path, monkeypatch):
    from website.Accounts import Accounts
    from website.Human_resource import hr

    # The default company's legacy settings files (other companies must never read them).
    tds_file = tmp_path / "tds_settings.json"
    tds_file.write_text(json.dumps(PLATFORM_FILE), encoding="utf-8")
    leave_file = tmp_path / "leave_settings.json"
    leave_file.write_text(json.dumps({"max_hr_backdate_days": 45}), encoding="utf-8")
    ctc_file = tmp_path / "ctc_settings.json"
    ctc_file.write_text(json.dumps({"hra_max_pct": 45.0}), encoding="utf-8")
    monkeypatch.setattr(tds_settings, "_SETTINGS_PATH", tds_file)
    monkeypatch.setattr(leave_settings, "_SETTINGS_PATH", leave_file)
    monkeypatch.setattr(ctc_settings, "_SETTINGS_PATH", ctc_file)

    app = Flask("tenancy_company_settings")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-company-settings-secret",
        TESTING=True,
        CUSTOMER_PLAN="enterprise",
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(Accounts, url_prefix="/api/accounts")
    app.register_blueprint(hr, url_prefix="/api/HumanResource")

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Two Pvt Ltd", slug="two", plan="enterprise", status="active"),
        ])
        common = dict(circle="NHQ", is_active=True, is_exited=False, doj=TODAY - timedelta(days=400))
        db.session.add_all([
            Admin(id=1, tenant_id=1, email="acc@one.com", emp_id="A1", emp_type="Accounts", **common),
            Admin(id=2, tenant_id=1, email="hr@one.com", emp_id="H1", emp_type="Human Resource", **common),
            Admin(id=3, tenant_id=2, email="acc@two.com", emp_id="A1", emp_type="Accounts", **common),
            Admin(id=4, tenant_id=2, email="hr@two.com", emp_id="H1", emp_type="Human Resource", **common),
        ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _headers(app, admin_id):
    who = {1: ("acc@one.com", "Accounts", 1), 2: ("hr@one.com", "Human Resource", 1),
           3: ("acc@two.com", "Accounts", 2), 4: ("hr@two.com", "Human Resource", 2)}[admin_id]
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": who[0], "emp_type": who[1], "tenant_id": who[2]},
        )
    return {"Authorization": f"Bearer {token}"}


def test_tds_settings_are_per_company(app):
    client = app.test_client()
    one = client.get("/api/accounts/tds-settings", headers=_headers(app, 1)).get_json()["settings"]
    two = client.get("/api/accounts/tds-settings", headers=_headers(app, 3)).get_json()["settings"]
    assert one["employer_tan"] == "PLAT12345T"
    # A new company starts with its own name and no TAN / PAN, never the platform file.
    assert two["employer_name"] == "Two Pvt Ltd"
    assert two["employer_tan"] == "" and two["employer_pan"] == ""

    res = client.put("/api/accounts/tds-settings", headers=_headers(app, 3),
                     json={"employer_tan": "TWOT12345T", "max_declaration_amendments_per_fy": 5})
    assert res.status_code == 200
    assert res.get_json()["settings"]["employer_tan"] == "TWOT12345T"

    one = client.get("/api/accounts/tds-settings", headers=_headers(app, 1)).get_json()["settings"]
    assert one["employer_tan"] == "PLAT12345T"
    assert one["max_declaration_amendments_per_fy"] == 2
    with app.app_context():
        rows = CompanySetting.query.all()
        assert [(r.tenant_id, r.namespace) for r in rows] == [(2, "tds")]
        assert rows[0].updated_by_admin_id == 3


def test_employer_on_documents_is_the_owner_company(app):
    with app.app_context():
        assert tds_settings.employer_details(1)["name"] == "Platform Ltd"
        assert tds_settings.employer_details(2) == {"name": "Two Pvt Ltd", "tan": "—", "pan": "—"}
        with tenant_scope(2):
            assert tds_settings.employer_details()["name"] == "Two Pvt Ltd"


def test_declaration_deadline_is_per_company(app):
    with app.app_context():
        with tenant_scope(2):
            tds_settings.set_declaration_deadline_override(FY, date(2027, 3, 31))
            assert tds_settings.effective_declaration_deadline(FY) == date(2027, 3, 31)
        with tenant_scope(1):
            assert tds_settings.effective_declaration_deadline(FY) == date(2027, 2, 25)
            assert tds_settings.load_tds_settings()["employer_name"] == "Platform Ltd"


def test_ctc_policy_is_per_company(app):
    client = app.test_client()
    res = client.put("/api/accounts/ctc-policy", headers=_headers(app, 3), json={"hra_max_pct": 30})
    assert res.status_code == 200 and res.get_json()["policy"]["hra_max_pct"] == 30.0

    one = client.get("/api/accounts/ctc-policy", headers=_headers(app, 1)).get_json()["policy"]
    two = client.get("/api/accounts/ctc-policy", headers=_headers(app, 3)).get_json()["policy"]
    assert one["hra_max_pct"] == 45.0  # default company keeps its file
    assert two["hra_max_pct"] == 30.0


def test_leave_policy_is_per_company(app):
    client = app.test_client()
    url = "/api/HumanResource/leave-updation/policy"
    res = client.put(url, headers=_headers(app, 4), json={"max_hr_backdate_days": 5, "manager_on_behalf_allowed": True})
    assert res.status_code == 200
    assert res.get_json()["policy"]["max_hr_backdate_days"] == 5

    one = client.get(url, headers=_headers(app, 2)).get_json()["policy"]
    assert one["max_hr_backdate_days"] == 45
    assert one["manager_on_behalf_allowed"] is False

    bad = client.put(url, headers=_headers(app, 4), json={"max_hr_backdate_days": "soon"})
    assert bad.status_code == 400
    # Only HR may change the leave policy.
    assert client.put(url, headers=_headers(app, 3), json={"max_hr_backdate_days": 1}).status_code == 403

    with app.app_context():
        # Jobs running in a company scope (schedulers) read that company's policy.
        with tenant_scope(2):
            assert leave_settings.max_hr_backdate_days() == 5
        with tenant_scope(1):
            assert leave_settings.max_hr_backdate_days() == 45


def test_saving_default_company_moves_it_off_the_file(app):
    client = app.test_client()
    res = client.put("/api/accounts/ctc-policy", headers=_headers(app, 1), json={"hra_max_pct": 40})
    assert res.status_code == 200
    with app.app_context():
        assert ctc_settings.load_ctc_settings(1)["hra_max_pct"] == 40.0
        assert ctc_settings.load_ctc_settings(2)["hra_max_pct"] == 50.0  # module default
    assert json.loads(ctc_settings._SETTINGS_PATH.read_text(encoding="utf-8")) == {"hra_max_pct": 45.0}
