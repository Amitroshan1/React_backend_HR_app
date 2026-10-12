"""Rollout step 5: suspended/cancelled tenants blocked; employee ids in URLs stay in tenant."""
import importlib
import pkgutil
from unittest.mock import patch

import pytest
from flask import Flask, jsonify
from flask_jwt_extended import JWTManager, create_access_token, decode_token, jwt_required

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    # confirmation_request references a Signup model that is not defined.
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website import auth as auth_mod  # noqa: E402
from website.datetime_utils import utc_now  # noqa: E402
from website.models.Admin_models import Admin  # noqa: E402
from website.models.otp import OTP  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.offboarding_service import admin_login_allowed, employee_login_allowed  # noqa: E402
from website.tenant_context import (  # noqa: E402
    TENANT_BLOCKED_CODE,
    get_admin_in_tenant,
    register_tenant_guards,
    tenant_is_accessible,
)

OTP_CODE = "123456"


@pytest.fixture()
def app():
    app = Flask("tenancy_step5")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-step5-secret-key-32b",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(auth_mod.auth, url_prefix="/api/auth")

    @app.route("/protected")
    @jwt_required()
    def protected():
        return jsonify(ok=True)

    @app.route("/employees/<int:admin_id>")
    @jwt_required()
    def employee(admin_id):
        return jsonify(id=admin_id)

    @app.route("/leave-balance/<int:employee_id>")
    @jwt_required()
    def leave_balance(employee_id):
        return jsonify(id=employee_id)

    with app.app_context():
        db.Model.metadata.create_all(
            bind=db.engine, tables=[Tenant.__table__, Admin.__table__, OTP.__table__]
        )
        db.session.add_all([
            Tenant(id=1, name="Platform", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Acme", slug="acme", plan="basic", status="active"),
            Tenant(id=3, name="Gone", slug="gone", plan="basic", status="suspended"),
        ])
        db.session.add_all([
            Admin(id=1, email="sam@x.com", emp_id="P1", emp_type="HR", tenant_id=1, is_active=True),
            Admin(id=2, email="hr@acme.com", emp_id="A1", emp_type="HR", tenant_id=2, is_active=True),
            Admin(id=3, email="sam@x.com", emp_id="G1", emp_type="HR", tenant_id=3, is_active=True),
            Admin(id=4, email="dev@acme.com", emp_id="A2", emp_type="Engineer", tenant_id=2, is_active=True),
            Admin(id=5, email="old@acme.com", emp_id="A3", emp_type="Engineer", tenant_id=2, is_active=False),
            Admin(id=6, email="only@gone.com", emp_id="G2", emp_type="HR", tenant_id=3, is_active=True),
        ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _token(app, admin_id, tenant_id):
    with app.app_context():
        return create_access_token(identity=str(admin_id), additional_claims={"tenant_id": tenant_id})


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _set_status(app, tenant_id, status):
    with app.app_context():
        db.session.get(Tenant, tenant_id).status = status
        db.session.commit()


def _add_otp(email):
    db.session.add(OTP(
        identifier=email,
        channel="email",
        otp_hash=auth_mod._hash_otp(OTP_CODE),
        created_at=utc_now(),
        expires_at=OTP.expiry_from_now(5),
        is_used=False,
        attempts=0,
        email=email,
        otp_code="******",
    ))
    db.session.commit()


# ---- tenant status ------------------------------------------------------------

def test_tenant_is_accessible(app):
    with app.app_context():
        assert tenant_is_accessible(2) is True
        assert tenant_is_accessible(3) is False
        assert tenant_is_accessible(99) is False
        assert tenant_is_accessible(None) is True
        assert tenant_is_accessible("bad") is False
    _set_status(app, 2, "cancelled")
    with app.app_context():
        assert tenant_is_accessible(2) is False


def test_platform_tenant_is_never_blocked(app):
    _set_status(app, 1, "suspended")
    with app.app_context():
        assert tenant_is_accessible(1) is True


def test_suspension_blocks_login_but_not_employee_eligibility(app):
    with app.app_context():
        admin = db.session.get(Admin, 6)
        assert employee_login_allowed(admin) is True
        assert admin_login_allowed(admin) is False


# ---- login --------------------------------------------------------------------

def test_request_otp_reports_suspended_company(app):
    res = app.test_client().post("/api/auth/request-otp", json={"identifier": "only@gone.com"})
    assert res.status_code == 403
    assert res.get_json()["code"] == TENANT_BLOCKED_CODE


def test_request_otp_inactive_account_keeps_inactive_message(app):
    res = app.test_client().post("/api/auth/request-otp", json={"identifier": "old@acme.com"})
    assert res.status_code == 403
    body = res.get_json()
    assert "code" not in body
    assert "inactive" in body["message"]


def test_verify_otp_reports_suspended_company(app):
    with app.app_context():
        _add_otp("only@gone.com")
    res = app.test_client().post(
        "/api/auth/verify-otp", json={"identifier": "only@gone.com", "otp": OTP_CODE}
    )
    assert res.status_code == 403
    assert res.get_json()["code"] == TENANT_BLOCKED_CODE


def test_picker_hides_suspended_company(app):
    # sam@x.com exists in platform (active) and Gone (suspended): logs straight into platform.
    with app.app_context():
        _add_otp("sam@x.com")
    res = app.test_client().post("/api/auth/verify-otp", json={"identifier": "sam@x.com", "otp": OTP_CODE})
    body = res.get_json()
    assert res.status_code == 200, body
    assert "requires_tenant_selection" not in body
    with app.app_context():
        assert decode_token(body["token"])["tenant_id"] == 1


def test_select_tenant_rejects_suspended_company(app):
    with app.app_context():
        sel = create_access_token(
            identity="tenant_select:sam@x.com",
            additional_claims={"token_type": "tenant_select", "admin_ids": [1, 3]},
        )
    res = app.test_client().post("/api/auth/select-tenant", json={"selection_token": sel, "tenant_id": 3})
    assert res.status_code == 403
    assert res.get_json()["code"] == TENANT_BLOCKED_CODE


# ---- existing sessions -------------------------------------------------------

def test_suspending_company_ends_existing_sessions(app):
    client = app.test_client()
    token = _token(app, 2, 2)
    assert client.get("/protected", headers=_bearer(token)).status_code == 200

    _set_status(app, 2, "suspended")
    res = client.get("/protected", headers=_bearer(token))
    assert res.status_code == 401
    assert res.get_json()["code"] == TENANT_BLOCKED_CODE

    _set_status(app, 2, "active")
    assert client.get("/protected", headers=_bearer(token)).status_code == 200


def test_session_refresh_blocked_for_suspended_company(app):
    _set_status(app, 2, "suspended")
    res = app.test_client().post("/api/auth/session/refresh", headers=_bearer(_token(app, 2, 2)))
    assert res.status_code == 401


# ---- employee ids in URLs ----------------------------------------------------

def test_url_employee_in_same_tenant_is_allowed(app):
    client = app.test_client()
    headers = _bearer(_token(app, 2, 2))
    assert client.get("/employees/4", headers=headers).get_json() == {"id": 4}
    assert client.get("/leave-balance/4", headers=headers).get_json() == {"id": 4}


def test_url_employee_in_other_tenant_is_not_found(app):
    client = app.test_client()
    headers = _bearer(_token(app, 2, 2))
    assert client.get("/employees/1", headers=headers).status_code == 404
    assert client.get("/leave-balance/1", headers=headers).status_code == 404
    platform = _bearer(_token(app, 1, 1))
    assert client.get("/employees/4", headers=platform).status_code == 404


def test_url_guard_leaves_missing_ids_and_anonymous_requests_to_route(app):
    client = app.test_client()
    assert client.get("/employees/999", headers=_bearer(_token(app, 2, 2))).get_json() == {"id": 999}
    assert client.get("/employees/1").status_code == 401


def test_get_admin_in_tenant(app):
    with app.app_context():
        assert get_admin_in_tenant(4, 2).id == 4
        assert get_admin_in_tenant(1, 2) is None
        assert get_admin_in_tenant("x", 2) is None
        with patch("website.tenant_context.get_current_tenant_id", return_value=2):
            assert get_admin_in_tenant(4).id == 4
            assert get_admin_in_tenant(1) is None
