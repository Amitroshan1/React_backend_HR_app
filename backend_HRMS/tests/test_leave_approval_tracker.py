"""HR view of leave and WFH that L1 approved: L2 pending or fully approved."""
import importlib
import pkgutil
from datetime import date

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")
from website.models.Admin_models import Admin
from website.models.attendance import LeaveApplication, WorkFromHomeApplication
from website.models.manager_model import ManagerContact
from website.models.tenant import Tenant
from website.tenant_context import register_tenant_guards


@pytest.fixture()
def app():
    app = Flask("leave_approval_tracker")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="leave-approval-tracker-secret-32bytes",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        common = dict(is_active=True, is_exited=False, doj=date(2024, 1, 1), tenant_id=1)
        db.session.add_all([
            Admin(id=1, email="l1@one.com", emp_id="L1", first_name="Lead", emp_type="Engineering", circle="NHQ", **common),
            Admin(id=2, email="l2@one.com", emp_id="L2", first_name="Head", emp_type="Engineering", circle="NHQ", **common),
            Admin(id=3, email="emp@one.com", emp_id="E1", first_name="Asha", emp_type="Engineering", circle="NHQ", **common),
            Admin(id=4, email="acc@one.com", emp_id="A1", first_name="Ravi", emp_type="Accounts", circle="Mumbai", **common),
        ])
        db.session.add_all([
            ManagerContact(tenant_id=1, circle_name="NHQ", user_type="Engineering", l1_admin_id=1, l2_admin_id=2),
            ManagerContact(tenant_id=1, circle_name="Mumbai", user_type="Accounts", l1_admin_id=1, l2_admin_id=1),
        ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _leave(admin_id, start, end, status, on_behalf=False):
    row = LeaveApplication(
        admin_id=admin_id, leave_type="Casual Leave", reason="Family function at home",
        start_date=start, end_date=end, status=status, deducted_days=1, applied_on_behalf=on_behalf,
    )
    db.session.add(row)
    return row


def _wfh(admin_id, start, end, status):
    row = WorkFromHomeApplication(
        admin_id=admin_id, start_date=start, end_date=end, reason="Internet work at home", status=status,
    )
    db.session.add(row)
    return row


def test_only_l1_approved_and_final_rows_are_listed_with_levels(app):
    from website.leave_approval_tracker import tracker_rows

    with app.app_context():
        _leave(3, date(2026, 10, 5), date(2026, 10, 6), "L1 Approved")
        _leave(3, date(2026, 10, 9), date(2026, 10, 9), "Approved")
        _leave(3, date(2026, 10, 12), date(2026, 10, 12), "Pending")
        _leave(3, date(2026, 10, 14), date(2026, 10, 14), "Rejected")
        _wfh(3, date(2026, 10, 20), date(2026, 10, 20), "L1 Approved")
        db.session.commit()

        data = tracker_rows()
        rows = {(r["request_type"], r["start_date"]): r for r in data["rows"]}
        assert len(rows) == 3
        waiting = rows[("leave", "2026-10-05")]
        assert waiting["stage"] == "l2_pending"
        assert waiting["l1"] == {"name": "Lead", "status": "Approved"}
        assert waiting["l2"] == {"name": "Head", "status": "Pending"}
        assert waiting["days"] == 2
        done = rows[("leave", "2026-10-09")]
        assert done["stage"] == "approved"
        assert done["l2"]["status"] == "Approved"
        assert rows[("wfh", "2026-10-20")]["stage"] == "l2_pending"
        assert data["summary"] == {"total": 3, "l2_pending": 2, "approved": 1, "leave": 2, "wfh": 1}


def test_l2_not_required_and_hr_applied_are_labelled(app):
    from website.leave_approval_tracker import tracker_rows

    with app.app_context():
        _leave(4, date(2026, 10, 2), date(2026, 10, 2), "Approved")
        _leave(3, date(2026, 10, 3), date(2026, 10, 3), "Approved", on_behalf=True)
        db.session.commit()

        rows = {r["emp_id"]: r for r in tracker_rows()["rows"]}
        assert rows["A1"]["l2"] == {"name": None, "status": "Not required"}
        assert rows["E1"]["l1"]["status"] == "Applied by HR"
        assert rows["E1"]["l2"]["status"] == "Applied by HR"


def test_filters_by_month_emp_type_circle_and_stage(app):
    from website.leave_approval_tracker import month_bounds, tracker_rows

    with app.app_context():
        _leave(3, date(2026, 9, 29), date(2026, 10, 1), "Approved")
        _leave(3, date(2026, 11, 3), date(2026, 11, 3), "L1 Approved")
        _leave(4, date(2026, 10, 15), date(2026, 10, 15), "Approved")
        db.session.commit()

        october = tracker_rows(month="2026-10")["rows"]
        assert {r["start_date"] for r in october} == {"2026-09-29", "2026-10-15"}
        assert [r["emp_id"] for r in tracker_rows(emp_type="Accounts")["rows"]] == ["A1"]
        assert [r["emp_id"] for r in tracker_rows(circle="Mumbai")["rows"]] == ["A1"]
        assert [r["start_date"] for r in tracker_rows(stage="l2_pending")["rows"]] == ["2026-11-03"]
        assert tracker_rows(request_type="wfh")["rows"] == []
        with pytest.raises(ValueError):
            month_bounds("October")
        with pytest.raises(ValueError):
            tracker_rows(stage="l3")
