"""Module rollout — departments/circles, holidays and HR policies are per tenant."""
import importlib
import logging
import pkgutil
from datetime import date, timedelta

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import create_engine, inspect, text

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    # confirmation_request references a Signup model that is not defined.
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin  # noqa: E402
from website.models.holiday_calendar import HolidayCalendar  # noqa: E402
from website.models.hr_policy import HRPolicyDocument  # noqa: E402
from website.models.master_data import MasterData  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

HR_TYPE = "Human Resource"
TODAY = date.today()
T1_HOLIDAY = date(2026, 8, 15)
T2_HOLIDAY = date(2026, 8, 20)  # Thursday


@pytest.fixture()
def app():
    from website.auth import auth
    from website.Human_resource import hr
    from website.leave_attendence import leave

    app = Flask("tenancy_master_data_module")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-master-data-secret-32b",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(auth, url_prefix="/api/auth")
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(leave, url_prefix="/api/leave")

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
        ])
        common = dict(circle="NHQ", is_active=True, is_exited=False, doj=TODAY - timedelta(days=400))
        db.session.add_all([
            Admin(id=1, tenant_id=1, email="hr@x.com", emp_id="H1", first_name="One HR", emp_type=HR_TYPE, **common),
            Admin(id=2, tenant_id=1, email="alpha@x.com", emp_id="E1", first_name="Alpha", emp_type="Engineering", **common),
            Admin(id=3, tenant_id=2, email="hr@x.com", emp_id="H1", first_name="Two HR", emp_type=HR_TYPE, **common),
            Admin(id=4, tenant_id=2, email="beta@x.com", emp_id="E1", first_name="Beta", emp_type="Engineering", **common),
            Admin(id=5, tenant_id=2, email="gamma@x.com", emp_id="E2", first_name="Gamma", emp_type="Finance", **common),
        ])
        db.session.flush()
        db.session.add_all([
            MasterData(id=20, tenant_id=1, master_type="department", name="Engineering"),
            MasterData(id=21, tenant_id=1, master_type="department", name="Finance"),
            MasterData(id=22, tenant_id=1, master_type="circle", name="NHQ"),
            MasterData(id=40, tenant_id=2, master_type="department", name="Engineering"),
            MasterData(id=42, tenant_id=2, master_type="circle", name="Pune"),
            HolidayCalendar(id=20, tenant_id=1, year=2026, holiday_name="INDEPENDENCE DAY", holiday_date=T1_HOLIDAY),
            HolidayCalendar(
                id=40, tenant_id=2, year=2026, holiday_name="FOUNDATION DAY", holiday_date=T2_HOLIDAY, is_optional=True
            ),
            HRPolicyDocument(id=20, tenant_id=1, title="Code of conduct"),
            HRPolicyDocument(id=40, tenant_id=2, title="Leave policy"),
        ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _token(app, admin_id, tenant_id, emp_type, email):
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": email, "emp_type": emp_type, "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


def _hr(app, tenant_id):
    return _token(app, 1 if tenant_id == 1 else 3, tenant_id, HR_TYPE, "hr@x.com")


def _emp(app, tenant_id):
    return _token(
        app, 2 if tenant_id == 1 else 4, tenant_id, "Engineering", "alpha@x.com" if tenant_id == 1 else "beta@x.com"
    )


# --- Departments / circles ---------------------------------------------------


def test_master_lists_and_options_are_tenant_scoped(app):
    c = app.test_client()
    items = c.get("/api/HumanResource/master/department", headers=_hr(app, 2)).get_json()["items"]
    assert [i["id"] for i in items] == [40]
    opts = c.get("/api/HumanResource/master/options", headers=_hr(app, 1)).get_json()
    assert (opts["departments"], opts["circles"]) == (["Engineering", "Finance"], ["NHQ"])
    emp_opts = c.get("/api/auth/master-options", headers=_emp(app, 2)).get_json()
    assert emp_opts["circles"] == ["Pune"]


def test_master_create_and_delete_stay_in_tenant(app):
    c = app.test_client()
    # The same name may exist once per tenant.
    assert c.post("/api/HumanResource/master/department", json={"name": "Finance"}, headers=_hr(app, 2)).status_code == 201
    assert c.post("/api/HumanResource/master/department", json={"name": "Engineering"}, headers=_hr(app, 2)).status_code == 409
    # Another tenant's value → 404; usage by another tenant's employees does not block delete.
    assert c.delete("/api/HumanResource/master/department/40", headers=_hr(app, 1)).status_code == 404
    assert c.delete("/api/HumanResource/master/department/21", headers=_hr(app, 1)).status_code == 200
    assert c.delete("/api/HumanResource/master/department/40", headers=_hr(app, 2)).status_code == 409
    with app.app_context():
        created = MasterData.query.filter_by(name="Finance", is_active=True).all()
        assert [(r.tenant_id, r.master_type) for r in created] == [(2, "department")]


# --- Holidays ----------------------------------------------------------------


def test_holiday_calendar_is_tenant_scoped(app):
    c = app.test_client()
    rows = c.get("/api/HumanResource/holidays?year=2026&auto_seed=0", headers=_hr(app, 1)).get_json()["holidays"]
    assert [r["id"] for r in rows] == [20]
    rows = c.get("/api/HumanResource/holidays?year=2026&auto_seed=0", headers=_hr(app, 2)).get_json()["holidays"]
    assert [r["id"] for r in rows] == [40]
    h = _hr(app, 1)
    assert c.put("/api/HumanResource/holidays/40", json={"is_optional": False}, headers=h).status_code == 404
    assert c.delete("/api/HumanResource/holidays/40", headers=h).status_code == 404
    created = c.post(
        "/api/HumanResource/holidays",
        json={"year": 2026, "holiday_name": "FOUNDATION DAY", "holiday_date": "2026-09-01"},
        headers=h,
    )
    assert created.status_code == 201
    with app.app_context():
        assert db.session.get(HolidayCalendar, created.get_json()["holiday"]["id"]).tenant_id == 1
        assert db.session.get(HolidayCalendar, 40).is_active is True


def test_holiday_auto_seed_is_per_tenant(app):
    c = app.test_client()
    seeded = c.get("/api/HumanResource/holidays?year=2027", headers=_hr(app, 2)).get_json()["holidays"]
    assert len(seeded) > 0
    assert c.get("/api/HumanResource/holidays?year=2027&auto_seed=0", headers=_hr(app, 1)).get_json()["holidays"] == []
    with app.app_context():
        assert {r.tenant_id for r in HolidayCalendar.query.filter_by(year=2027)} == {2}


def test_leave_and_attendance_use_employee_tenant_holidays(app):
    from website.attendance_engine import load_attendance_month_context
    from website.leave_attendence import _compute_working_and_sandwich_days

    with app.app_context():
        span = dict(emp_type="Engineering", start_date=T2_HOLIDAY, end_date=T2_HOLIDAY)
        assert _compute_working_and_sandwich_days(**span, tenant_id=2) == (0.0, 0.0)
        assert _compute_working_and_sandwich_days(**span, tenant_id=1)[0] == 1.0
        # No JWT here: each employee still gets their own company's calendar.
        assert set(load_attendance_month_context(4, 2026, 8).holiday_map) == {T2_HOLIDAY}
        assert set(load_attendance_month_context(2, 2026, 8).holiday_map) == {T1_HOLIDAY}

    c = app.test_client()
    t2 = c.get("/api/leave/optional-holidays?year=2026", headers=_emp(app, 2)).get_json()["holidays"]
    assert [h["holiday_name"] for h in t2] == ["FOUNDATION DAY"]
    assert c.get("/api/leave/optional-holidays?year=2026", headers=_emp(app, 1)).get_json()["holidays"] == []


# --- HR policies -------------------------------------------------------------


def test_policies_hr_side_is_tenant_scoped(app):
    c = app.test_client()
    h = _hr(app, 1)
    assert [p["id"] for p in c.get("/api/HumanResource/policies", headers=h).get_json()["policies"]] == [20]
    assert c.patch("/api/HumanResource/policies/40", json={"title": "x"}, headers=h).status_code == 404
    assert c.get("/api/HumanResource/policies/40/stats", headers=h).status_code == 404
    assert c.post("/api/HumanResource/policies/40/upload", headers=h).status_code == 404

    created = c.post("/api/HumanResource/policies", json={"title": "WFH policy"}, headers=_hr(app, 2))
    assert created.status_code == 201
    body = created.get_json()["policy"]
    assert body["applicable_count"] == 3  # tenant 2 employees only
    with app.app_context():
        assert db.session.get(HRPolicyDocument, body["id"]).tenant_id == 2


def test_policies_employee_side_is_tenant_scoped(app):
    c = app.test_client()
    assert [p["id"] for p in c.get("/api/auth/policies/pending", headers=_emp(app, 2)).get_json()["policies"]] == [40]
    assert [p["id"] for p in c.get("/api/auth/policies/pending", headers=_emp(app, 1)).get_json()["policies"]] == [20]
    assert c.post("/api/auth/policies/20/acknowledge", headers=_emp(app, 2)).status_code == 404
    assert c.post("/api/auth/policies/40/acknowledge", headers=_emp(app, 2)).status_code == 200


def test_policy_file_access_is_tenant_scoped(app):
    from website.secure_file_service import authorize_upload_access

    with app.test_request_context():
        beta = db.session.get(Admin, 4)
        assert authorize_upload_access(beta, "policies/policy_20_20260101_code.pdf", {})[0] is False
        assert authorize_upload_access(beta, "policies/policy_40_20260101_leave.pdf", {})[0] is True


# --- Migration ---------------------------------------------------------------


def test_master_data_tenant_migration():
    from website.tenant_migrations import ensure_master_data_tenant_ids

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        for ddl in (
            "CREATE TABLE master_data (id INTEGER PRIMARY KEY, master_type TEXT, name TEXT)",
            "CREATE UNIQUE INDEX uq_master_type_name ON master_data (master_type, name)",
            "CREATE TABLE holiday_calendar (id INTEGER PRIMARY KEY, year INTEGER, holiday_name TEXT)",
            "CREATE UNIQUE INDEX uq_holiday_calendar_year_name ON holiday_calendar (year, holiday_name)",
            "CREATE TABLE hr_policy_documents (id INTEGER PRIMARY KEY, title TEXT)",
        ):
            conn.execute(text(ddl))
        conn.execute(text("INSERT INTO master_data VALUES (1, 'department', 'Engineering')"))
        conn.execute(text("INSERT INTO holiday_calendar VALUES (1, 2026, 'DIWALI')"))
        conn.execute(text("INSERT INTO hr_policy_documents VALUES (1, 'Code')"))

    log = logging.getLogger("test")
    first = ensure_master_data_tenant_ids(engine, log)
    assert first["master_data"] == {
        "added": True,
        "backfilled": 1,
        "unique": {"created": True, "dropped": ["uq_master_type_name"], "skipped": None},
    }
    assert first["holiday_calendar"]["unique"]["dropped"] == ["uq_holiday_calendar_year_name"]
    assert first["hr_policy_documents"] == {"added": True, "backfilled": 1}

    with engine.begin() as conn:
        # Another tenant may now reuse the same department / holiday name.
        conn.execute(text("INSERT INTO master_data (id, tenant_id, master_type, name) VALUES (2, 2, 'department', 'Engineering')"))
        conn.execute(text("INSERT INTO holiday_calendar (id, tenant_id, year, holiday_name) VALUES (2, 2, 2026, 'DIWALI')"))
        tenants = [r[0] for r in conn.execute(text("SELECT tenant_id FROM master_data ORDER BY id"))]
    assert tenants == [1, 2]
    uniques = [ix["column_names"] for ix in inspect(engine).get_indexes("master_data") if ix["unique"]]
    assert uniques == [["tenant_id", "master_type", "name"]]

    again = ensure_master_data_tenant_ids(engine, log)
    assert again["master_data"] == {
        "added": False,
        "backfilled": 0,
        "unique": {"created": False, "dropped": [], "skipped": None},
    }
