"""Smoke: employee holiday page + leave/punch use the resolved circle calendar."""
import importlib
import pkgutil
from datetime import date, timedelta

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin  # noqa: E402
from website.models.holiday_calendar import HolidayCalendar  # noqa: E402
from website.models.master_data import MasterData  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

# Friday 14 Aug 2026 — weekday so leave-block is the holiday, not Saturday.
MANDATORY = date(2026, 8, 14)
CLIENT_DAY = date(2026, 9, 1)


@pytest.fixture()
def app():
    from website.Human_resource import hr
    from website.leave_attendence import leave

    app = Flask("holiday_user_resolved_smoke")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-holiday-user-smoke-secret-32b",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(leave, url_prefix="/api/leave")

    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        common = dict(is_active=True, is_exited=False, doj=date.today() - timedelta(days=400), emp_type="Engineering")
        db.session.add_all(
            [
                Admin(id=1, tenant_id=1, email="hr@x.com", emp_id="H1", first_name="HR", circle="NHQ", emp_type="Human Resource", **{k: v for k, v in common.items() if k != "emp_type"}),
                Admin(id=2, tenant_id=1, email="pune@x.com", emp_id="E1", first_name="Pune Emp", circle="Pune", **common),
                Admin(id=3, tenant_id=1, email="nhq@x.com", emp_id="E2", first_name="NHQ Emp", circle="NHQ", **common),
                MasterData(tenant_id=1, master_type="circle", name="NHQ", is_active=True),
                MasterData(tenant_id=1, master_type="circle", name="Pune", is_active=True),
                HolidayCalendar(
                    tenant_id=1,
                    year=2026,
                    holiday_name="MANDATORY DAY",
                    holiday_date=MANDATORY,
                    circle="",
                    is_optional=False,
                    is_active=True,
                ),
                HolidayCalendar(
                    tenant_id=1,
                    year=2026,
                    holiday_name="MANDATORY DAY",
                    holiday_date=MANDATORY,
                    circle="Pune",
                    is_optional=False,
                    is_active=True,
                    not_observe=True,
                ),
                HolidayCalendar(
                    tenant_id=1,
                    year=2026,
                    holiday_name="CLIENT DAY",
                    holiday_date=CLIENT_DAY,
                    circle="Pune",
                    is_optional=False,
                    is_active=True,
                    not_observe=False,
                ),
            ]
        )
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _headers(app, admin_id, email, emp_type="Engineering"):
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": email, "emp_type": emp_type, "tenant_id": 1},
        )
    return {"Authorization": f"Bearer {token}"}


def test_non_nhq_employee_sees_resolved_calendar_not_skipped_day(app):
    c = app.test_client()
    body = c.get("/api/HumanResource/holidays/user?year=2026&auto_seed=0", headers=_headers(app, 2, "pune@x.com"))
    assert body.status_code == 200, body.get_data(as_text=True)
    data = body.get_json()
    assert data["success"] is True
    assert data["circle"] == "Pune"
    names = [h["holiday_name"] for h in data["holidays"]]
    assert "MANDATORY DAY" not in names
    assert "CLIENT DAY" in names


def test_nhq_employee_still_sees_company_holiday(app):
    c = app.test_client()
    data = c.get(
        "/api/HumanResource/holidays/user?year=2026&auto_seed=0",
        headers=_headers(app, 3, "nhq@x.com"),
    ).get_json()
    names = [h["holiday_name"] for h in data["holidays"]]
    assert "MANDATORY DAY" in names
    assert "CLIENT DAY" not in names


def test_leave_allows_pl_on_skipped_holiday_for_that_circle(app):
    from website.leave_attendence import calendar_block_for_leave_type

    with app.app_context():
        blocked_company = calendar_block_for_leave_type(
            emp_type="Engineering",
            start_date=MANDATORY,
            end_date=MANDATORY,
            leave_type="Privilege Leave",
            tenant_id=1,
            circle="",
        )
        allowed_pune = calendar_block_for_leave_type(
            emp_type="Engineering",
            start_date=MANDATORY,
            end_date=MANDATORY,
            leave_type="Privilege Leave",
            tenant_id=1,
            circle="Pune",
        )
        blocked_extra = calendar_block_for_leave_type(
            emp_type="Engineering",
            start_date=CLIENT_DAY,
            end_date=CLIENT_DAY,
            leave_type="Privilege Leave",
            tenant_id=1,
            circle="Pune",
        )
    assert blocked_company and "MANDATORY DAY" in blocked_company
    assert allowed_pune is None
    assert blocked_extra and "CLIENT DAY" in blocked_extra


def test_attendance_holiday_map_follows_employee_circle(app):
    from website.attendance_engine import load_attendance_month_context

    with app.app_context():
        pune = load_attendance_month_context(2, 2026, 8)
        nhq = load_attendance_month_context(3, 2026, 8)
        pune_sep = load_attendance_month_context(2, 2026, 9)
    assert MANDATORY not in pune.holiday_map
    assert MANDATORY in nhq.holiday_map
    assert CLIENT_DAY in pune_sep.holiday_map
