"""Admin approves signup -> welcome mail, HR approval mail, IT asset request (list + complete)."""
import importlib
import json
import pkgutil
from datetime import date
from unittest.mock import patch

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin  # noqa: E402
from website.models.asset_assignment_request import AssetAssignmentRequest  # noqa: E402
from website.models.employee_profile_change import EmployeeProfileChangeRequest  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

SIGNUP_PAYLOAD = {
    "email": "rahul.sharma@one.com",
    "first_name": "Rahul Sharma",
    "user_name": "rahul.sharma",
    "mobile": "9812345678",
    "emp_id": "E100",
    "doj": "2026-11-02",
    "emp_type": "Engineering",
    "circle": "NHQ",
    "designation": "Engineer",
    "employment_status": "probation",
    "probation_duration_months": 6,
}


@pytest.fixture()
def app():
    from website.Admin import admin_bp
    from website.Human_resource import hr
    from website.it import it_bp

    app = Flask("signup_approval_asset")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="signup-approval-secret-key-32bytes!!",
        TESTING=True,
        ZEPTO_SENDER_EMAIL="noreply@test.com",
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(it_bp, url_prefix="/api/it")
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        db.session.add(Admin(
            id=1, tenant_id=1, email="admin@one.com", emp_id="A1", first_name="Ada",
            emp_type="Admin", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=2, tenant_id=1, email="hr@one.com", emp_id="H1", first_name="Hari",
            emp_type="Human Resource", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=4, tenant_id=1, email="it@one.com", emp_id="I1", first_name="Ishan",
            emp_type="IT", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(EmployeeProfileChangeRequest(
            id=90, tenant_id=1, employee_admin_id=None, request_type="signup", status="pending",
            changes=json.dumps({}), signup_payload=json.dumps(SIGNUP_PAYLOAD),
            requested_by_admin_id=2, requested_by_name="Hari", requested_by_email="hr@one.com",
        ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _headers(app, identity, email, emp_type):
    with app.app_context():
        token = create_access_token(
            identity=str(identity),
            additional_claims={"email": email, "emp_type": emp_type, "tenant_id": 1},
        )
    return {"Authorization": f"Bearer {token}"}


def test_admin_approve_signup_mails_and_raises_it_asset_request(app):
    client = app.test_client()
    with patch("website.employee_profile_change_service._send_decision_email", return_value=(True, "")), \
         patch("website.email.send_welcome_email", return_value=True) as welcome, \
         patch("website.email.send_signup_approval_to_hr", return_value=True) as hr_mail, \
         patch("website.email.send_asset_assignment_request_to_it", return_value=True) as it_mail:
        res = client.post(
            "/api/admin/employee-change-requests/90/decide",
            json={"decision": "approve", "note": "Approved"},
            headers=_headers(app, 1, "admin@one.com", "Admin"),
        )
    assert res.status_code == 200, res.get_json()

    # Welcome mail to the employee at the signup email; separate approval mail to HR.
    welcome.assert_called_once()
    assert welcome.call_args[0][0].email == "rahul.sharma@one.com"
    hr_mail.assert_called_once()
    assert hr_mail.call_args[1]["requested_by_email"] == "hr@one.com"
    it_mail.assert_called_once()

    with app.app_context():
        row = AssetAssignmentRequest.query.one()
        assert row.status == "Pending"
        assert row.signup_request_id == 90
        assert row.employee_email == "rahul.sharma@one.com"
        assert row.emp_id == "E100"
        req_id = row.id

    # The request shows in the IT department queue.
    with patch("website.plan_features.can_access_it_panel", return_value=True):
        queue = client.get(
            "/api/it/asset-assignment-requests?status=pending",
            headers=_headers(app, 4, "it@one.com", "IT"),
        )
        assert queue.status_code == 200, queue.get_json()
        assert [r["id"] for r in queue.get_json()["requests"]] == [req_id]

        with patch("website.email.send_asset_assignment_completed_to_hr", return_value=True) as done_mail:
            done = client.post(
                f"/api/it/asset-assignment-requests/{req_id}/complete",
                json={"assigned_assets": "Dell Latitude (SN 123), charger", "it_remarks": "Handed over"},
                headers=_headers(app, 4, "it@one.com", "IT"),
            )
        assert done.status_code == 200, done.get_json()
        done_mail.assert_called_once()

        again = client.post(
            f"/api/it/asset-assignment-requests/{req_id}/complete",
            json={"assigned_assets": "Other laptop"},
            headers=_headers(app, 4, "it@one.com", "IT"),
        )
        assert again.status_code == 409

    with app.app_context():
        assert AssetAssignmentRequest.query.one().status == "Completed"


def test_reject_signup_creates_no_asset_request(app):
    client = app.test_client()
    with patch("website.employee_profile_change_service._send_decision_email", return_value=(True, "")), \
         patch("website.email.send_welcome_email", return_value=True) as welcome, \
         patch("website.email.send_signup_approval_to_hr", return_value=True) as hr_mail, \
         patch("website.email.send_asset_assignment_request_to_it", return_value=True) as it_mail:
        res = client.post(
            "/api/admin/employee-change-requests/90/decide",
            json={"decision": "reject", "note": "Incomplete"},
            headers=_headers(app, 1, "admin@one.com", "Admin"),
        )
    assert res.status_code == 200, res.get_json()
    welcome.assert_not_called()
    hr_mail.assert_not_called()
    it_mail.assert_not_called()
    with app.app_context():
        assert AssetAssignmentRequest.query.count() == 0
