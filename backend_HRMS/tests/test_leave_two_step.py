"""L1 then L2 leave approval, month-end lock, and late extra payment."""
import importlib
import pkgutil
from datetime import date, datetime

import pytest
from flask import Flask

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")
from website.models.Admin_models import Admin
from website.models.attendance import LeaveApplication, LeaveBalance, WorkFromHomeApplication
from website.models.manager_model import ManagerContact
from website.models.tenant import Tenant
from website.tenant_context import register_tenant_guards
from flask_jwt_extended import JWTManager


@pytest.fixture()
def app():
    app = Flask("leave_two_step")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="leave-two-step-test-secret-32bytes",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        common = dict(circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1), tenant_id=1)
        db.session.add_all([
            Admin(id=1, email="l1@one.com", emp_id="L1", first_name="Lead", emp_type="Engineering", **common),
            Admin(id=2, email="l2@one.com", emp_id="L2", first_name="Head", emp_type="Engineering", **common),
            Admin(id=3, email="emp@one.com", emp_id="E1", first_name="Employee", emp_type="Engineering", **common),
        ])
        db.session.add(LeaveBalance(admin_id=3, privilege_leave_balance=8, casual_leave_balance=6, compensatory_leave_balance=0))
        db.session.add(ManagerContact(
            tenant_id=1, circle_name="NHQ", user_type="Engineering", l1_admin_id=1, l2_admin_id=2,
        ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _leave(start, end, status="Pending", deducted=1):
    row = LeaveApplication(
        admin_id=3,
        leave_type="Casual Leave",
        reason="Family function at home",
        start_date=start,
        end_date=end,
        status=status,
        deducted_days=deducted,
        requested_deducted_days=deducted,
    )
    db.session.add(row)
    db.session.commit()
    return row


def test_l1_then_l2_and_l2_reject_closes_the_request(app):
    from website.leave_two_step import ApprovalError, decide_request

    with app.app_context():
        row = _leave(date(2026, 10, 20), date(2026, 10, 20))
        l1 = db.session.get(Admin, 1)
        l2 = db.session.get(Admin, 2)
        with pytest.raises(ApprovalError):
            decide_request(row, l2, "approve")
        assert decide_request(row, l1, "approve") == "l1_approved"
        assert row.status == "L1 Approved"
        balance = LeaveBalance.query.filter_by(admin_id=3).one()
        assert float(balance.casual_leave_balance or 0) == 6
        assert decide_request(row, l2, "reject") == "rejected"
        assert row.status == "Rejected"


def test_l1_approval_is_final_when_there_is_no_l2(app):
    from website.leave_two_step import decide_request

    with app.app_context():
        contact = ManagerContact.query.one()
        contact.l2_admin_id = None
        row = _leave(date(2026, 10, 21), date(2026, 10, 21))
        assert decide_request(row, db.session.get(Admin, 1), "approve") == "approved"
        assert row.final_approved_at is not None


def test_closed_month_is_greyed_and_admin_release_restores_the_step(app):
    from website.leave_two_step import decide_request, grey_out_closed_months, release_greyed_items, ApprovalError

    with app.app_context():
        row = _leave(date(2026, 9, 3), date(2026, 9, 3))
        assert grey_out_closed_months(date(2026, 9, 30), 1) == 0
        assert grey_out_closed_months(date(2026, 10, 1), 1) == 1
        db.session.refresh(row)
        assert row.status == "Greyed Out"
        assert row.greyed_from_status == "Pending"
        with pytest.raises(ApprovalError):
            decide_request(row, db.session.get(Admin, 1), "approve")
        release_greyed_items({"items": [{"kind": "leave", "id": row.id}]})
        assert row.status == "Pending"

        waiting = _leave(date(2026, 9, 10), date(2026, 9, 10), status="L1 Approved")
        grey_out_closed_months(date(2026, 10, 1), 1)
        db.session.refresh(waiting)
        release_greyed_items({"items": [{"kind": "leave", "id": waiting.id}]})
        assert waiting.status == "L1 Approved"


def test_late_approval_stays_unpaid_in_september_and_pays_in_october(app):
    from website.leave_two_step import counts_as_paid_on_sheet, extra_payment_lines

    with app.app_context():
        row = _leave(date(2026, 9, 3), date(2026, 9, 5), status="Approved", deducted=3)
        row.final_approved_at = datetime(2026, 10, 6, 9, 0, 0)
        db.session.commit()
        assert counts_as_paid_on_sheet(row, 2026, 9) is False
        assert counts_as_paid_on_sheet(row, 2026, 10) is True
        assert extra_payment_lines(3, 2026, 10) == ["3 days · 2026-09-03 to 2026-09-05"]
        assert extra_payment_lines(3, 2026, 9) == []


def test_wfh_follows_the_same_two_steps(app):
    from website.leave_two_step import decide_request

    with app.app_context():
        row = WorkFromHomeApplication(
            admin_id=3, start_date=date(2026, 10, 22), end_date=date(2026, 10, 22),
            reason="Working from home today", status="Pending",
        )
        db.session.add(row)
        db.session.commit()
        assert decide_request(row, db.session.get(Admin, 1), "approve") == "l1_approved"
        assert decide_request(row, db.session.get(Admin, 2), "approve") == "approved"


def test_reminder_uses_the_28th_when_february_has_no_29th():
    from website.leave_two_step import reminder_day

    assert reminder_day(date(2026, 2, 1)) == 28
    assert reminder_day(date(2024, 2, 1)) == 29
    assert reminder_day(date(2026, 9, 1)) == 29
