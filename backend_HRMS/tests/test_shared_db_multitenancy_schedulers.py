"""Rollout step 9 — scheduled jobs run per company, with each company's own mailboxes."""
import importlib
import logging
import pkgutil
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

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

import website.email as email_module  # noqa: E402
from website import scheduler  # noqa: E402
from website.company_mailbox import company_mailbox  # noqa: E402
from website.models.Admin_models import Admin, AuditLog  # noqa: E402
from website.models.attendance import LeaveApplication  # noqa: E402
from website.models.deployed_customer import DeployedCustomer  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.plan_features import get_plan  # noqa: E402
from website.tenant_context import (  # noqa: E402
    get_current_tenant_id,
    register_tenant_guards,
    tenant_admin_query,
    tenant_scope,
)
from website.tenant_jobs import job_tenant_ids, run_for_each_tenant  # noqa: E402

TODAY = datetime.now(ZoneInfo("Asia/Kolkata")).date()
PLATFORM_HR = "hr@platform.com"
TENANTS = (1, 2, 3, 4)  # 4 is suspended


def _leave_employee(tid):
    return tid


def _exiting_employee(tid):
    return 10 + tid


def _past_lwd_employee(tid):
    return 20 + tid


@pytest.fixture()
def app():
    from website.Admin import admin_bp

    app = Flask("tenancy_schedulers")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-schedulers-secret-32by",
        SHOW_DEPLOYMENT_GUIDE=True,
        CUSTOMER_PLAN="essential",
        ZEPTO_API_KEY="test-key",
        ZEPTO_SENDER_EMAIL="noreply@platform.com",
        BASE_URL="https://hr.platform.com",
        ZEPTO_CC_HR=PLATFORM_HR,
        EMAIL_HR=PLATFORM_HR,
        EMAIL_IT="it@platform.com",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(admin_bp, url_prefix="/api/admin")

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Two", slug="two", plan="basic", status="active", mailbox_hr="hr@two.com"),
            Tenant(id=3, name="Three", slug="three", plan="enterprise", status="active"),
            Tenant(id=4, name="Four", slug="four", plan="enterprise", status="suspended", mailbox_hr="hr@four.com"),
        ])
        common = dict(circle="NHQ", emp_type="Engineering", doj=TODAY - timedelta(days=400))
        db.session.add(
            Admin(id=100, tenant_id=1, email="admin@one.com", emp_id="ADM0001", first_name="Platform",
                  circle="NHQ", emp_type="Admin", doj=TODAY - timedelta(days=400), is_active=True, is_exited=False)
        )
        for tid in TENANTS:
            db.session.add_all([
                Admin(id=_leave_employee(tid), tenant_id=tid, email=f"emp{tid}@x.com", emp_id="E1",
                      first_name=f"Emp {tid}", is_active=True, is_exited=False, **common),
                Admin(id=_exiting_employee(tid), tenant_id=tid, email=f"leaver{tid}@x.com", emp_id="E2",
                      first_name=f"Leaver {tid}", is_active=True, is_exited=True,
                      exit_login_until=TODAY + timedelta(days=7), **common),
                Admin(id=_past_lwd_employee(tid), tenant_id=tid, email=f"gone{tid}@x.com", emp_id="E3",
                      first_name=f"Gone {tid}", is_active=True, is_exited=True,
                      exit_login_until=TODAY - timedelta(days=1), **common),
            ])
        db.session.flush()
        applied = datetime.combine(TODAY - timedelta(days=10), datetime.min.time())
        for tid in TENANTS:
            db.session.add(LeaveApplication(
                id=tid * 10, admin_id=_leave_employee(tid), leave_type="Casual Leave", reason="Family",
                start_date=TODAY + timedelta(days=3), end_date=TODAY + timedelta(days=3),
                status="Pending", created_at=applied,
            ))
        db.session.add(DeployedCustomer(id=2, company_name="Two", slug="two", plan="basic", status="active"))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def sent(monkeypatch):
    """Emails 'sent' through ZeptoMail, with the tenant scope active at send time."""
    out = []

    def _fake_send(sender_email, subject, body, recipient_email, cc_emails=None, **_kw):
        out.append({
            "tenant": get_current_tenant_id(),
            "subject": subject,
            "to": recipient_email,
            "cc": [c for c in (cc_emails or []) if c],
        })
        return True, "ok"

    monkeypatch.setattr(email_module, "send_email_via_zeptomail", _fake_send)
    return out


def _by_subject(sent, needle):
    return [m for m in sent if needle in m["subject"]]


def _platform_token(app):
    with app.app_context():
        token = create_access_token(
            identity="100",
            additional_claims={"email": "admin@one.com", "emp_type": "Super Admin", "tenant_id": 1},
        )
    return {"Authorization": f"Bearer {token}"}


# --- Company scope -------------------------------------------------------------


def test_tenant_scope_drives_tenant_helpers_and_plan(app):
    with app.app_context():
        assert (get_current_tenant_id(), get_plan()) == (1, "essential")
        with tenant_scope(2):
            assert (get_current_tenant_id(), get_plan()) == (2, "basic")
            assert sorted(a.id for a in tenant_admin_query()) == [2, 12, 22]
            with tenant_scope(3):
                assert get_plan() == "enterprise"
            assert get_current_tenant_id() == 2
        assert get_current_tenant_id() == 1


def test_job_tenants_skip_suspended_and_cancelled(app):
    with app.app_context():
        db.session.add(Tenant(id=5, name="Five", slug="five", plan="basic", status="cancelled"))
        db.session.add(Tenant(id=6, name="Six", slug="six", plan="basic", status="provisioning"))
        db.session.commit()
        assert job_tenant_ids() == [1, 2, 3, 6]


def test_one_company_failure_does_not_block_the_others(app):
    def job(tid):
        db.session.add(AuditLog(action=f"JOB_T{tid}", performed_by="scheduler", target_email="x@x.com"))
        if tid == 1:
            raise RuntimeError("boom")
        return {"ok": tid}

    with app.app_context():
        results = run_for_each_tenant(job, logger=logging.getLogger("test"), label="test")
        assert results[1] == {"error": "boom"}
        assert results[2] == {"ok": 2} and results[3] == {"ok": 3}
        actions = sorted(r.action for r in AuditLog.query.all())
        assert actions == ["JOB_T2", "JOB_T3"]


# --- Company mailboxes ---------------------------------------------------------


def test_company_mailbox_falls_back_to_env_only_for_the_default_company(app):
    with app.app_context():
        assert company_mailbox("ZEPTO_CC_HR", 1) == PLATFORM_HR
        assert company_mailbox("EMAIL_HR", 2) == "hr@two.com"
        assert company_mailbox("ZEPTO_CC_HR", 3) is None
        assert company_mailbox("EMAIL_IT", 2) is None
        with tenant_scope(2):
            assert company_mailbox("ZEPTO_CC_HR") == "hr@two.com"
        db.session.get(Tenant, 1).mailbox_it = "desk@one.com"
        assert company_mailbox("EMAIL_IT", 1) == "desk@one.com"


def test_company_admin_edits_only_own_mailboxes(app):
    with app.app_context():
        db.session.add(Admin(
            id=200, tenant_id=2, email="boss@two.com", emp_id="ADM2", first_name="Boss",
            circle="NHQ", emp_type="Admin", doj=TODAY, is_active=True, is_exited=False,
        ))
        db.session.commit()
        boss = create_access_token(
            identity="200",
            additional_claims={"email": "boss@two.com", "emp_type": "Admin", "tenant_id": 2},
        )
        staff = create_access_token(
            identity="2",
            additional_claims={"email": "emp2@x.com", "emp_type": "Engineering", "tenant_id": 2},
        )
    client = app.test_client()
    headers = {"Authorization": f"Bearer {boss}"}
    loaded = client.get("/api/admin/mailboxes", headers=headers)
    assert loaded.status_code == 200
    body = loaded.get_json()
    assert body["company"] == "Two"
    assert body["uses_env_fallback"] is False
    assert body["mailboxes"]["mailbox_hr"] == "hr@two.com"

    bad = client.put("/api/admin/mailboxes", json={"mailbox_it": "not-an-email"}, headers=headers)
    assert bad.status_code == 400
    saved = client.put(
        "/api/admin/mailboxes",
        json={"mailbox_it": " Desk@Two.com ", "mailbox_hr": ""},
        headers=headers,
    )
    assert saved.status_code == 200
    mailboxes = saved.get_json()["mailboxes"]
    assert mailboxes["mailbox_it"] == "desk@two.com" and mailboxes["mailbox_hr"] == ""
    with app.app_context():
        assert db.session.get(Tenant, 1).mailbox_it is None
        assert db.session.get(Tenant, 2).mailbox_accounts is None
        assert company_mailbox("EMAIL_IT", 2) == "desk@two.com"
        assert company_mailbox("EMAIL_HR", 2) is None
    assert client.get("/api/admin/mailboxes", headers={"Authorization": f"Bearer {staff}"}).status_code == 403


def test_platform_admin_sets_company_mailboxes(app):
    c = app.test_client()
    headers = _platform_token(app)
    bad = c.patch("/api/admin/customers/2", json={"mailbox_it": "not-an-email"}, headers=headers)
    assert bad.status_code == 400
    ok = c.patch(
        "/api/admin/customers/2",
        json={"mailbox_it": " IT@Two.com ", "mailbox_accounts": "acc@two.com", "mailbox_hr": ""},
        headers=headers,
    )
    assert ok.status_code == 200
    mailboxes = ok.get_json()["tenant"]["mailboxes"]
    assert mailboxes == {
        "mailbox_hr": "",
        "mailbox_admin": "",
        "mailbox_accounts": "acc@two.com",
        "mailbox_finance": "",
        "mailbox_it": "it@two.com",
        "mailbox_inventory": "",
    }
    detail = c.get("/api/admin/customers/2", headers=headers).get_json()
    assert detail["tenant"]["mailboxes"]["mailbox_it"] == "it@two.com"


def test_mailbox_columns_migration_is_idempotent():
    from website.tenant_migrations import ensure_tenant_mailbox_columns

    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE tenants (id INTEGER PRIMARY KEY, name VARCHAR(200))"))
    log = logging.getLogger("test")
    assert ensure_tenant_mailbox_columns(engine, log) == [
        "mailbox_hr", "mailbox_admin", "mailbox_accounts", "mailbox_finance", "mailbox_it", "mailbox_inventory",
    ]
    assert ensure_tenant_mailbox_columns(engine, log) == []
    cols = {c["name"] for c in inspect(engine).get_columns("tenants")}
    assert {"mailbox_hr", "mailbox_it"} <= cols


# --- Daily jobs ----------------------------------------------------------------


def test_daily_jobs_run_per_company_with_own_mailboxes(app, sent, monkeypatch):
    monkeypatch.setattr(scheduler, "_app", app)
    scheduler.run_daily_hr_jobs()

    with app.app_context():
        # LWD deactivation: active companies only.
        active = {a.id: a.is_active for a in Admin.query.all()}
        assert [active[_past_lwd_employee(t)] for t in TENANTS] == [False, False, False, True]

    # Leave pending 6+ days, no manager configured: TO the company HR mailbox, else the employee.
    leave = {m["tenant"]: m for m in _by_subject(sent, "Leave pending")}
    assert sorted(leave) == [1, 2, 3]
    assert leave[1]["to"] == PLATFORM_HR
    assert leave[2]["to"] == "hr@two.com"
    assert leave[3]["to"] == "emp3@x.com"
    assert PLATFORM_HR not in leave[3]["cc"]

    # LWD approaching: HR copy goes to the employee's own company only.
    lwd = {m["tenant"]: m for m in _by_subject(sent, "last working day")}
    assert sorted(lwd) == [1, 2, 3]
    assert lwd[1]["to"] == "leaver1@x.com" and PLATFORM_HR in lwd[1]["cc"]
    assert lwd[2]["to"] == "leaver2@x.com" and lwd[2]["cc"] == ["hr@two.com"]
    assert lwd[3]["to"] == "leaver3@x.com" and lwd[3]["cc"] == []

    # Nobody in the suspended company is emailed, and no company mail reaches the platform HR inbox.
    assert all("4@x.com" not in m["to"] for m in sent)
    assert all(PLATFORM_HR not in [m["to"], *m["cc"]] for m in sent if m["tenant"] != 1)


def test_job_functions_scan_only_the_given_company(app, sent):
    from website.commands.leave_pending_reminder import run_leave_pending_reminder
    from website.offboarding_service import run_lwd_deactivation_job

    with app.app_context():
        assert run_lwd_deactivation_job(TODAY, tenant_id=2) == 1
        assert not db.session.get(Admin, _past_lwd_employee(2)).is_active
        assert db.session.get(Admin, _past_lwd_employee(1)).is_active
        db.session.rollback()

        with tenant_scope(3):
            summary = run_leave_pending_reminder(TODAY, dry_run=True, tenant_id=3)
        assert summary["reminders_sent"] == 1
        assert [m["to"] for m in sent] == ["emp3@x.com"]

        # tenant_id=None keeps the old all-companies scan for callers that want it.
        assert run_lwd_deactivation_job(TODAY) == 4


def test_cli_reminder_runs_each_company_in_its_scope(app, sent):
    from website.commands.leave_pending_reminder import register_leave_pending_reminder_command

    register_leave_pending_reminder_command(app)
    result = app.test_cli_runner().invoke(args=["leave-pending-reminder", "--run-date", TODAY.isoformat()])
    assert result.exit_code == 0, result.output
    assert "reminders_sent=3" in result.output
    assert {m["tenant"]: m["to"] for m in sent} == {1: PLATFORM_HR, 2: "hr@two.com", 3: "emp3@x.com"}
