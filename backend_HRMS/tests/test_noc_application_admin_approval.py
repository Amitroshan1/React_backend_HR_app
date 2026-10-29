"""Non-exit NOC: HR upload -> Admin approval -> employee download; reject in history."""
import importlib
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
from website.models.employee_profile_change import EmployeeProfileChangeRequest  # noqa: E402
from website.models.seperation import NocApplicationRequest  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402


@pytest.fixture()
def app():
    from website.Human_resource import hr
    from website.Admin import admin_bp
    from website.leave_attendence import leave

    app = Flask("noc_application_admin_approval")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="noc-app-admin-secret-key-32bytes!!",
        TESTING=True,
        ZEPTO_SENDER_EMAIL="noreply@test.com",
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(leave, url_prefix="/api/leave")
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
            id=3, tenant_id=1, email="emp@one.com", emp_id="E1", first_name="Eve",
            emp_type="Engineering", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(NocApplicationRequest(
            id=70, admin_id=3, separation_id=None, request_type="banking_bonafide",
            details="Need bonafide letter for bank account opening.",
            status="Pending", hr_document_path="noc_applications/bonafide.pdf",
        ))
        db.session.add(NocApplicationRequest(
            id=71, admin_id=3, separation_id=None, request_type="travel_bonafide",
            details="Need bonafide letter for travel visa processing.",
            status="Pending", hr_document_path="noc_applications/travel.pdf",
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


def _hr(app):
    return _headers(app, 2, "hr@one.com", "HR")


def _admin(app):
    return _headers(app, 1, "admin@one.com", "Admin")


def _emp(app):
    return _headers(app, 3, "emp@one.com", "Engineering")


def _stage(client, app, app_id=70):
    with patch("website.plan_features.can_access_hr_operations", return_value=True), \
         patch("website.approval_settings.approval_required", return_value=True):
        res = client.post(
            f"/api/HumanResource/noc-applications/{app_id}/submit-admin",
            json={"remarks": "Bonafide letter prepared and verified."},
            headers=_hr(app),
        )
    assert res.status_code == 200, res.get_json()
    return res


def test_hr_submit_stages_admin_and_employee_cannot_download_yet(app):
    client = app.test_client()
    _stage(client, app)
    with app.app_context():
        application = NocApplicationRequest.query.get(70)
        assert application.status == "Pending Admin"
        req = EmployeeProfileChangeRequest.query.filter_by(
            request_type="noc_application", status="pending"
        ).first()
        assert req is not None

    blocked = client.get("/api/leave/noc-applications/70/document", headers=_emp(app))
    assert blocked.status_code == 403

    listing = client.get("/api/leave/noc-applications", headers=_emp(app))
    assert listing.status_code == 200, listing.get_json()
    row = next(r for r in listing.get_json()["requests"] if r["id"] == 70)
    assert row["hr_document"] is None
    assert row["status"] == "Pending Admin"


def test_admin_approve_releases_document_to_employee(app):
    client = app.test_client()
    _stage(client, app)
    with app.app_context():
        req_id = EmployeeProfileChangeRequest.query.filter_by(
            request_type="noc_application", status="pending"
        ).first().id

    with patch("website.employee_profile_change_service._send_decision_email", return_value=(True, "")):
        decide = client.post(
            f"/api/admin/employee-change-requests/{req_id}/decide",
            json={"decision": "approve", "note": "Verified"},
            headers=_admin(app),
        )
    assert decide.status_code == 200, decide.get_json()

    with app.app_context():
        assert NocApplicationRequest.query.get(70).status == "Approved"

    listing = client.get("/api/leave/noc-applications", headers=_emp(app))
    row = next(r for r in listing.get_json()["requests"] if r["id"] == 70)
    assert row["hr_document"] is not None
    assert row["hr_document"]["filename"] == "bonafide.pdf"


def test_admin_reject_goes_to_hr_history(app):
    client = app.test_client()
    _stage(client, app, app_id=71)
    with app.app_context():
        req_id = EmployeeProfileChangeRequest.query.filter_by(
            request_type="noc_application", status="pending"
        ).first().id

    with patch("website.employee_profile_change_service._send_decision_email", return_value=(True, "")):
        decide = client.post(
            f"/api/admin/employee-change-requests/{req_id}/decide",
            json={"decision": "reject", "note": "Regenerate with correct designation"},
            headers=_admin(app),
        )
    assert decide.status_code == 200, decide.get_json()

    with app.app_context():
        assert NocApplicationRequest.query.get(71).status == "Rejected"

    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        history = client.get(
            "/api/HumanResource/noc-applications/history?status=rejected",
            headers=_hr(app),
        )
    body = history.get_json() or {}
    assert history.status_code == 200, body
    assert len(body["history"]) == 1
    assert body["history"][0]["noc_application_id"] == 71
    assert body["history"][0]["hr_document_filename"] == "travel.pdf"
    assert body["summary"]["rejected"] == 1
