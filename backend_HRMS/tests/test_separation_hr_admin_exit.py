"""HR separation list readiness + submit exit to Admin queue."""
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
from website.models.seperation import NocApplicationRequest, NocDepartmentRequest, Resignation  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402


@pytest.fixture()
def app():
    from website.Human_resource import hr
    from website.Admin import admin_bp

    app = Flask("separation_hr_admin_exit")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="separation-hr-admin-secret-key-32b!",
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
        db.session.add(Admin(
            id=3, tenant_id=1, email="emp@one.com", emp_id="E1", first_name="Eve",
            emp_type="Engineering", circle="NHQ", is_active=True, is_exited=False,
            doj=date.today() - timedelta(days=400),
        ))
        lwd = date.today() + timedelta(days=20)
        res = Resignation(
            id=50,
            admin_id=3,
            resignation_date=lwd,
            reason="Moving city for family reasons and career.",
            status="Approved",
        )
        db.session.add(res)
        db.session.add(NocDepartmentRequest(
            id=100,
            admin_id=3,
            resignation_id=50,
            department_key="HR",
            noc_date=lwd,
            status="Uploaded",
            file_path="noc_department/hr_sample.pdf",
        ))
        db.session.add(NocDepartmentRequest(
            id=101,
            admin_id=3,
            resignation_id=50,
            department_key="IT",
            noc_date=lwd,
            status="Uploaded",
            file_path="noc_department/it_sample.pdf",
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


def test_list_marks_ready_when_manager_approved_and_nocs_uploaded(app):
    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        res = client.get(
            "/api/HumanResource/separations?status=ready_for_admin",
            headers=_hr_headers(app),
        )
    body = res.get_json() or {}
    assert res.status_code == 200, body
    assert body.get("success") is True
    rows = body.get("separations") or []
    assert len(rows) == 1
    assert rows[0]["resignation_id"] == 50
    assert rows[0]["bucket"] == "ready_for_admin"
    assert body["summary"]["ready_for_admin"] >= 1
    assert body["summary"]["needs_attention"] >= 1


def test_detail_blocks_submit_when_noc_pending(app):
    with app.app_context():
        noc = NocDepartmentRequest.query.get(101)
        noc.status = "Pending"
        noc.file_path = None
        db.session.commit()

    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        res = client.get("/api/HumanResource/separations/50", headers=_hr_headers(app))
    body = res.get_json() or {}
    assert res.status_code == 200, body
    sep = body["separation"]
    # Legacy dept rows (no NocApplicationRequest) still count as applied.
    assert sep["noc_applied"] is True
    assert sep["bucket"] == "noc_pending"
    assert sep["can_submit_to_admin"] is False
    assert "NOC" in (sep.get("submit_blocked_reason") or "")


def test_detail_not_applied_for_noc_when_no_exit_application(app):
    with app.app_context():
        NocDepartmentRequest.query.filter_by(resignation_id=50).delete()
        db.session.commit()

    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        res = client.get("/api/HumanResource/separations/50", headers=_hr_headers(app))
    body = res.get_json() or {}
    assert res.status_code == 200, body
    sep = body["separation"]
    assert sep["noc_applied"] is False
    assert sep["noc_message"] == "Not applied for NOC"
    assert sep["noc_application"] is None
    assert sep["bucket"] == "ready_for_admin"
    assert sep["can_submit_to_admin"] is True


def test_detail_banking_application_does_not_count_as_exit_noc(app):
    with app.app_context():
        NocDepartmentRequest.query.filter_by(resignation_id=50).delete()
        db.session.add(NocApplicationRequest(
            admin_id=3,
            separation_id=50,
            request_type="banking_bonafide",
            details="Need bonafide letter for bank account opening.",
            status="Pending",
        ))
        db.session.commit()

    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        res = client.get("/api/HumanResource/separations/50", headers=_hr_headers(app))
    sep = (res.get_json() or {})["separation"]
    assert sep["noc_applied"] is False
    assert sep["noc_message"] == "Not applied for NOC"


def test_detail_exit_application_counts_as_applied(app):
    with app.app_context():
        NocDepartmentRequest.query.get(101).status = "Pending"
        NocDepartmentRequest.query.get(101).file_path = None
        db.session.add(NocApplicationRequest(
            admin_id=3,
            separation_id=50,
            request_type="exit_no_dues",
            details="Please clear no dues for exit processing.",
            status="Pending",
        ))
        db.session.commit()

    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        res = client.get("/api/HumanResource/separations/50", headers=_hr_headers(app))
    sep = (res.get_json() or {})["separation"]
    assert sep["noc_applied"] is True
    assert sep["noc_application"]["request_type"] == "exit_no_dues"
    assert sep["bucket"] == "noc_pending"


def test_submit_exit_requires_remarks_and_stages_admin_request(app):
    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True), \
         patch("website.approval_settings.approval_required", return_value=True), \
         patch(
             "website.offboarding_service.validate_employee_exit",
             return_value=(True, "ok", {"checklist": []}),
         ):
        short = client.post(
            "/api/HumanResource/separations/50/submit-exit",
            json={"remarks": "too short"},
            headers=_hr_headers(app),
        )
        assert short.status_code == 400

        ok = client.post(
            "/api/HumanResource/separations/50/submit-exit",
            json={"remarks": "All clearances complete. Ready for Admin exit approval."},
            headers=_hr_headers(app),
        )
    body = ok.get_json() or {}
    assert ok.status_code == 200, body
    assert body.get("pending_approval") is True

    with app.app_context():
        req = EmployeeProfileChangeRequest.query.filter_by(
            request_type="exit", status="pending", employee_admin_id=3
        ).first()
        assert req is not None
        import json
        payload = json.loads(req.signup_payload or "{}")
        assert payload.get("source") == "hr_separation_clearance"
        assert payload.get("resignation_id") == 50
        assert "clearances" in (payload.get("hr_remarks") or "").lower() or len(payload.get("hr_remarks") or "") >= 10
        resignation = Resignation.query.get(50)
        assert resignation.hr_remarks
        assert len(resignation.hr_remarks) >= 10


def test_admin_approve_exit_from_separation_marks_employee_exited(app):
    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True), \
         patch("website.approval_settings.approval_required", return_value=True), \
         patch(
             "website.offboarding_service.validate_employee_exit",
             return_value=(True, "ok", {}),
         ):
        stage = client.post(
            "/api/HumanResource/separations/50/submit-exit",
            json={"remarks": "NOCs complete and manager approved the resignation."},
            headers=_hr_headers(app),
        )
    assert stage.status_code == 200, stage.get_json()

    with app.app_context():
        req = EmployeeProfileChangeRequest.query.filter_by(request_type="exit", status="pending").first()
        req_id = req.id

    with patch("website.employee_profile_change_service._send_decision_email", return_value=(True, "")), \
         patch(
             "website.offboarding_service.execute_employee_exit",
             return_value=(True, "ok", {
                 "exit_type": "Resigned",
                 "last_working_day": date.today().isoformat(),
                 "exit_reason": "ok",
                 "hr_email": "hr@one.com",
                 "deferred_login": False,
             }),
         ) as exit_fn, \
         patch("website.offboarding_service.send_exit_employee_notifications", return_value=None):
        decide = client.post(
            f"/api/admin/employee-change-requests/{req_id}/decide",
            json={"decision": "approve", "note": "Approved exit"},
            headers=_admin_headers(app),
        )
    body = decide.get_json() or {}
    assert decide.status_code == 200, body
    exit_fn.assert_called_once()
