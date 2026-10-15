"""HR leave/WFH changes wait for Admin approval; an Admin's own change applies at once."""
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
from website.models.Admin_models import Admin, AuditLog  # noqa: E402
from website.models.attendance import LeaveApplication, LeaveBalance, WorkFromHomeApplication  # noqa: E402
from website.models.employee_profile_change import EmployeeProfileChangeRequest  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

BASE = "/api/HumanResource"
TODAY = date.today()
SOON = TODAY + timedelta(days=10)


@pytest.fixture()
def sent(monkeypatch):
    calls = {"leave": [], "wfh": [], "decision": []}
    monkeypatch.setattr(
        "website.Human_resource.send_hr_leave_updation_email",
        lambda **kw: calls["leave"].append(kw),
    )
    monkeypatch.setattr(
        "website.Human_resource.send_hr_wfh_updation_email",
        lambda **kw: calls["wfh"].append(kw),
    )
    monkeypatch.setattr(
        "website.employee_profile_change_service._send_decision_email",
        lambda row, decision, name: (calls["decision"].append((row.id, decision)) or (True, "")),
    )
    return calls


@pytest.fixture()
def app():
    from website.Human_resource import hr

    app = Flask("leave_admin_approval")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="leave-admin-approval-secret-32bytes",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        common = dict(tenant_id=1, circle="NHQ", is_active=True, is_exited=False, doj=TODAY - timedelta(days=400))
        db.session.add_all([
            Admin(id=1, email="hr@one.com", emp_id="H1", first_name="Hema", emp_type="Human Resource", **common),
            Admin(id=2, email="emp@one.com", emp_id="E1", first_name="Asha", emp_type="Engineering", **common),
            Admin(id=5, email="boss@one.com", emp_id="A1", first_name="Owner", emp_type="Admin", **common),
        ])
        db.session.flush()
        db.session.add(LeaveBalance(
            admin_id=2, privilege_leave_balance=8, casual_leave_balance=6, compensatory_leave_balance=0,
        ))
        db.session.add(LeaveApplication(
            id=20, admin_id=2, leave_type="Casual Leave", reason="Family function at home",
            start_date=SOON, end_date=SOON, status="Pending",
        ))
        db.session.add(WorkFromHomeApplication(
            id=30, admin_id=2, start_date=SOON, end_date=SOON, reason="Internet work at home", status="Pending",
        ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _headers(app, admin_id):
    claims = {
        1: {"email": "hr@one.com", "emp_type": "Human Resource", "tenant_id": 1},
        5: {"email": "boss@one.com", "emp_type": "Admin", "tenant_id": 1},
    }[admin_id]
    with app.app_context():
        token = create_access_token(identity=str(admin_id), additional_claims=claims)
    return {"Authorization": f"Bearer {token}"}


def _decide(app, monkeypatch, request_id, decision, note=""):
    from website.employee_profile_change_service import decide_profile_change, get_change_request

    monkeypatch.setattr(
        "website.employee_profile_change_service.current_admin",
        lambda: db.session.get(Admin, 5),
    )
    with app.app_context():
        row = get_change_request(1, request_id)
        return decide_profile_change(row, decision, note)


def test_hr_leave_edit_waits_then_admin_approval_applies(app, monkeypatch, sent):
    client = app.test_client()
    res = client.patch(f"{BASE}/leave-updation/requests/20", json={"status": "Rejected"}, headers=_headers(app, 1))
    body = res.get_json()
    assert res.status_code == 200, body
    assert body["pending_approval"] is True
    with app.app_context():
        assert db.session.get(LeaveApplication, 20).status == "Pending"
        row = EmployeeProfileChangeRequest.query.one()
        assert row.request_type == "leave_update" and row.employee_admin_id == 2
    assert sent["leave"] == []

    listing = client.get(f"{BASE}/leave-updation/requests?request_type=all", headers=_headers(app, 1)).get_json()
    flags = {(r["request_type"], r["id"]): r["admin_pending"] for r in listing["requests"]}
    assert flags == {("leave", 20): True, ("wfh", 30): False}

    again = client.patch(f"{BASE}/leave-updation/requests/20", json={"status": "Approved"}, headers=_headers(app, 1))
    assert again.status_code == 409

    payload, message, status = _decide(app, monkeypatch, row.id, "approve")
    assert status == 200, message
    status_field = next(f for f in payload["fields"] if f["field"] == "status")
    assert (status_field["from"], status_field["to"]) == ("Pending", "Rejected")
    with app.app_context():
        assert db.session.get(LeaveApplication, 20).status == "Rejected"
        assert db.session.get(EmployeeProfileChangeRequest, row.id).status == "approved"
        audit = AuditLog.query.filter(AuditLog.action.like("LEAVE_UPDATION|leave_id=20|%")).one()
        assert "approved_by:Owner|" in audit.action
        assert audit.performed_by == "hr@one.com"
    assert len(sent["leave"]) == 1
    assert sent["decision"] == [(row.id, "approved")]


def test_admin_rejection_changes_nothing(app, monkeypatch, sent):
    client = app.test_client()
    client.patch(f"{BASE}/leave-updation/wfh-requests/30", json={"status": "Approved"}, headers=_headers(app, 1))
    with app.app_context():
        request_id = EmployeeProfileChangeRequest.query.one().id

    payload, message, status = _decide(app, monkeypatch, request_id, "reject", "Not needed")
    assert status == 200, message
    assert payload["status"] == "rejected"
    with app.app_context():
        assert db.session.get(WorkFromHomeApplication, 30).status == "Pending"
    assert sent["wfh"] == []
    assert sent["decision"] == [(request_id, "rejected")]

    retry = client.patch(f"{BASE}/leave-updation/wfh-requests/30", json={"status": "Approved"}, headers=_headers(app, 1))
    assert retry.status_code == 200 and retry.get_json()["pending_approval"] is True


def test_org_admin_change_applies_immediately(app, sent):
    client = app.test_client()
    res = client.patch(f"{BASE}/leave-updation/wfh-requests/30", json={"status": "Approved"}, headers=_headers(app, 5))
    body = res.get_json()
    assert res.status_code == 200, body
    assert "pending_approval" not in body
    with app.app_context():
        assert db.session.get(WorkFromHomeApplication, 30).status == "Approved"
        assert EmployeeProfileChangeRequest.query.count() == 0
    assert len(sent["wfh"]) == 1


def test_leave_on_behalf_waits_and_is_created_on_approval(app, monkeypatch, sent):
    client = app.test_client()
    start = SOON + timedelta(days=7)
    body = {
        "admin_id": 2, "leave_type": "Casual Leave", "reason": "Medical appointment in town",
        "start_date": start.isoformat(), "end_date": start.isoformat(),
    }
    res = client.post(f"{BASE}/leave-updation/requests", json=body, headers=_headers(app, 1))
    data = res.get_json()
    assert res.status_code == 200, data
    assert data["pending_approval"] is True
    with app.app_context():
        assert LeaveApplication.query.count() == 1

    listing = client.get(f"{BASE}/leave-updation/requests", headers=_headers(app, 1)).get_json()
    assert [p["start_date"] for p in listing["pending_on_behalf"]] == [start.isoformat()]

    dup = client.post(f"{BASE}/leave-updation/requests", json=body, headers=_headers(app, 1))
    assert dup.status_code == 409

    payload, message, status = _decide(app, monkeypatch, data["request_id"], "approve")
    assert status == 200, message
    with app.app_context():
        created = LeaveApplication.query.filter(LeaveApplication.id != 20).one()
        assert created.start_date == start and created.applied_on_behalf is True
        assert created.applied_by_admin_id == 1
    assert len(sent["leave"]) == 1


def test_invalid_change_is_refused_before_sending(app, sent):
    client = app.test_client()
    bad = client.patch(
        f"{BASE}/leave-updation/requests/20",
        json={"start_date": SOON.isoformat(), "end_date": (SOON - timedelta(days=2)).isoformat()},
        headers=_headers(app, 1),
    )
    assert bad.status_code == 400
    same = client.patch(f"{BASE}/leave-updation/requests/20", json={"status": "Pending"}, headers=_headers(app, 1))
    assert same.status_code == 400
    with app.app_context():
        assert EmployeeProfileChangeRequest.query.count() == 0


def test_stale_request_cannot_be_approved(app, monkeypatch, sent):
    client = app.test_client()
    client.patch(f"{BASE}/leave-updation/requests/20", json={"status": "Rejected"}, headers=_headers(app, 1))
    with app.app_context():
        request_id = EmployeeProfileChangeRequest.query.one().id
        db.session.get(LeaveApplication, 20).status = "Approved"
        db.session.commit()

    payload, message, status = _decide(app, monkeypatch, request_id, "approve")
    assert payload is None and status == 409
    assert "changed after HR sent it" in message
    with app.app_context():
        assert db.session.get(LeaveApplication, 20).status == "Approved"
        assert db.session.get(EmployeeProfileChangeRequest, request_id).status == "pending"
    assert sent["decision"] == []


def test_leave_requests_do_not_block_profile_changes(app, sent):
    from website.employee_profile_change_service import pending_for_employee

    client = app.test_client()
    client.patch(f"{BASE}/leave-updation/requests/20", json={"status": "Rejected"}, headers=_headers(app, 1))
    with app.app_context():
        assert pending_for_employee(db.session.get(Admin, 2)) is None
