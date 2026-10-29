"""Probation HR decision must go to Admin; employee mail only after confirm/extend approve."""
import importlib
import pkgutil
from datetime import date, timedelta
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
from website.models.employee_profile_change import EmployeeProfileChangeRequest  # noqa: E402
from website.models.probation import ProbationReview  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.probation_utils import (  # noqa: E402
    STATUS_MANAGER_SUBMITTED,
    STATUS_PENDING_ADMIN,
    STATUS_HR_CONFIRMED,
)
from website.tenant_context import register_tenant_guards  # noqa: E402


@pytest.fixture()
def app():
    from website.Human_resource import hr
    from website.Admin import admin_bp

    app = Flask("probation_admin_approval")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="probation-admin-secret-key-32bytes!!",
        TESTING=True,
        ZEPTO_SENDER_EMAIL="noreply@test.com",
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        db.session.add(Admin(
            id=1, tenant_id=1, email="admin@one.com", emp_id="A1", first_name="Ada",
            emp_type="Admin", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=2, tenant_id=1, email="hr@one.com", emp_id="H1", first_name="Hari",
            emp_type="HR", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        end = date.today() + timedelta(days=5)
        db.session.add(Admin(
            id=3, tenant_id=1, email="emp@one.com", emp_id="E1", first_name="Eve",
            emp_type="Employee", circle="NHQ", is_active=True, is_exited=False,
            doj=date.today() - timedelta(days=170),
            employment_status="probation",
            probation_end_date=end,
        ))
        db.session.add(ProbationReview(
            id=10,
            admin_id=3,
            probation_end_date=end,
            status=STATUS_MANAGER_SUBMITTED,
            reviewed_at=date.today(),
            rating="4",
            manager_recommendation="confirm",
            feedback="Good work",
        ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _hr_headers(app):
    with app.app_context():
        token = create_access_token(
            identity="2",
            additional_claims={"email": "hr@one.com", "emp_type": "HR", "tenant_id": 1},
        )
    return {"Authorization": f"Bearer {token}"}


def _admin_headers(app):
    with app.app_context():
        token = create_access_token(
            identity="1",
            additional_claims={"email": "admin@one.com", "emp_type": "Admin", "tenant_id": 1},
        )
    return {"Authorization": f"Bearer {token}"}


def test_hr_stages_on_role_for_admin(app):
    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        res = client.post(
            "/api/HumanResource/probation-decision",
            json={"probation_review_id": 10, "decision": "confirmed", "notes": "Ready for confirmation"},
            headers=_hr_headers(app),
        )
    body = res.get_json() or {}
    assert res.status_code == 200, body
    assert body.get("pending_approval") is True

    with app.app_context():
        review = ProbationReview.query.get(10)
        assert review.status == STATUS_PENDING_ADMIN
        assert review.hr_decision is None
        pending = EmployeeProfileChangeRequest.query.filter_by(
            request_type="probation", status="pending"
        ).first()
        assert pending is not None
        assert pending.employee_admin_id == 3


def test_admin_approve_confirm_applies_on_role_and_mails_employee(app):
    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        stage = client.post(
            "/api/HumanResource/probation-decision",
            json={"probation_review_id": 10, "decision": "confirmed", "notes": "Confirm after strong review"},
            headers=_hr_headers(app),
        )
    assert stage.status_code == 200, stage.get_json()

    with app.app_context():
        req = EmployeeProfileChangeRequest.query.filter_by(request_type="probation", status="pending").first()
        req_id = req.id

    with patch("website.employee_profile_change_service._send_decision_email", return_value=(True, "")), \
         patch("website.probation_api.send_probation_decision_notifications") as notify, \
         patch("website.employment_status.transition_to_on_role") as on_role:
        decide = client.post(
            f"/api/admin/employee-change-requests/{req_id}/decide",
            json={"decision": "approve", "note": "Approved"},
            headers=_admin_headers(app),
        )
    body = decide.get_json() or {}
    assert decide.status_code == 200, body
    on_role.assert_called_once()
    notify.assert_called_once()
    result = notify.call_args[0][0]
    assert result["decision"] == "confirmed"
    assert result["send_employee_mail"] is True

    with app.app_context():
        review = ProbationReview.query.get(10)
        assert review.status == STATUS_HR_CONFIRMED
        assert review.hr_decision == "confirmed"


def test_admin_reject_returns_review_to_hr(app):
    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        stage = client.post(
            "/api/HumanResource/probation-decision",
            json={"probation_review_id": 10, "decision": "extended", "extended_until": (date.today() + timedelta(days=90)).isoformat()},
            headers=_hr_headers(app),
        )
    assert stage.status_code == 200, stage.get_json()

    with app.app_context():
        req_id = EmployeeProfileChangeRequest.query.filter_by(request_type="probation", status="pending").first().id

    with patch("website.employee_profile_change_service._send_decision_email", return_value=(True, "")):
        decide = client.post(
            f"/api/admin/employee-change-requests/{req_id}/decide",
            json={"decision": "reject", "note": "Please revise date"},
            headers=_admin_headers(app),
        )
    assert decide.status_code == 200, decide.get_json()

    with app.app_context():
        review = ProbationReview.query.get(10)
        assert review.status == STATUS_MANAGER_SUBMITTED
        assert review.hr_decision is None
        req = EmployeeProfileChangeRequest.query.get(req_id)
        assert req.status == "rejected"
