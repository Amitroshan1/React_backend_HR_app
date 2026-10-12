"""Rollout step 3: post-OTP company picker (/verify-otp + /select-tenant)."""
import importlib
import pkgutil
from datetime import timedelta
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
from website.tenant_context import is_session_token  # noqa: E402

OTP_CODE = "123456"


@pytest.fixture()
def app():
    app = Flask("tenancy_step3")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-step3-secret-key-32b",
        TESTING=True,
    )
    db.init_app(app)
    jwt = JWTManager(app)

    @jwt.token_verification_loader
    def _verify(_h, data):
        return is_session_token(data)

    app.register_blueprint(auth_mod.auth, url_prefix="/api/auth")

    @app.route("/protected")
    @jwt_required()
    def protected():
        return jsonify(ok=True)

    with app.app_context():
        db.Model.metadata.create_all(
            bind=db.engine, tables=[Tenant.__table__, Admin.__table__, OTP.__table__]
        )
        db.session.add_all([
            Tenant(id=1, name="Zeta Platform", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Acme", slug="acme", plan="basic", status="active"),
        ])
        db.session.add_all([
            Admin(id=1, email="sam@x.com", emp_id="Z1", emp_type="Engineer", tenant_id=1, is_active=True),
            Admin(id=2, email="sam.acme@x.com", emp_id="A1", emp_type="HR", tenant_id=2, is_active=True),
        ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _add_otp(email="sam@x.com", admin_id=None):
    db.session.add(OTP(
        identifier=email,
        channel="email",
        otp_hash=auth_mod._hash_otp(OTP_CODE),
        admin_id=admin_id,
        created_at=utc_now(),
        expires_at=OTP.expiry_from_now(5),
        is_used=False,
        attempts=0,
        email=email,
        otp_code="******",
    ))
    db.session.commit()


def _both_accounts():
    return [Admin.query.get(1), Admin.query.get(2)]


def _verify(client):
    return client.post("/api/auth/verify-otp", json={"identifier": "sam@x.com", "otp": OTP_CODE})


def test_find_admins_for_login_returns_all_matches(app):
    with app.app_context():
        rows = auth_mod._find_admins_for_login("email", "SAM@x.com")
        assert [a.id for a in rows] == [1]
        assert auth_mod._find_admins_for_login("email", "nobody@x.com") == []


def test_single_account_logs_in_directly(app):
    client = app.test_client()
    with app.app_context():
        _add_otp(admin_id=1)
    res = _verify(client)
    body = res.get_json()
    assert res.status_code == 200, body
    assert body.get("token")
    assert "requires_tenant_selection" not in body
    with app.app_context():
        assert decode_token(body["token"])["tenant_id"] == 1


def test_multiple_accounts_require_company_choice(app):
    client = app.test_client()
    with app.app_context():
        _add_otp()
    with app.app_context(), patch.object(auth_mod, "_find_admins_for_login", side_effect=lambda *_: _both_accounts()):
        res = _verify(client)
    body = res.get_json()
    assert res.status_code == 200, body
    assert body["requires_tenant_selection"] is True
    assert "token" not in body
    assert [t["name"] for t in body["tenants"]] == ["Acme", "Zeta Platform"]
    assert all("admin_id" not in t for t in body["tenants"])
    with app.app_context():
        assert OTP.query.one().is_used is True


def _selection_token(app, client):
    with app.app_context():
        _add_otp()
    with app.app_context(), patch.object(auth_mod, "_find_admins_for_login", side_effect=lambda *_: _both_accounts()):
        return _verify(client).get_json()["selection_token"]


def test_select_tenant_issues_token_for_chosen_company(app):
    client = app.test_client()
    sel = _selection_token(app, client)
    res = client.post("/api/auth/select-tenant", json={"selection_token": sel, "tenant_id": 2})
    body = res.get_json()
    assert res.status_code == 200, body
    with app.app_context():
        claims = decode_token(body["token"])
    assert claims["sub"] == "2"
    assert claims["tenant_id"] == 2
    assert "token_type" not in claims


def test_select_tenant_rejects_company_not_in_list(app):
    client = app.test_client()
    sel = _selection_token(app, client)
    res = client.post("/api/auth/select-tenant", json={"selection_token": sel, "tenant_id": 3})
    assert res.status_code == 403


def test_select_tenant_rejects_login_token_and_garbage(app):
    client = app.test_client()
    with app.app_context():
        login = create_access_token(identity="1", additional_claims={"tenant_id": 1})
    for token in (login, "not-a-token", ""):
        res = client.post("/api/auth/select-tenant", json={"selection_token": token, "tenant_id": 1})
        assert res.status_code == 401


def test_select_tenant_rejects_expired_selection(app):
    client = app.test_client()
    with app.app_context():
        expired = create_access_token(
            identity="tenant_select:sam@x.com",
            additional_claims={"token_type": "tenant_select", "admin_ids": [1, 2]},
            expires_delta=timedelta(seconds=-1),
        )
    res = client.post("/api/auth/select-tenant", json={"selection_token": expired, "tenant_id": 1})
    assert res.status_code == 401


def test_select_tenant_blocks_inactive_account(app):
    client = app.test_client()
    sel = _selection_token(app, client)
    with app.app_context():
        Admin.query.get(2).is_active = False
        db.session.commit()
    res = client.post("/api/auth/select-tenant", json={"selection_token": sel, "tenant_id": 2})
    assert res.status_code == 403


def test_selection_and_sensitive_tokens_cannot_open_protected_routes(app):
    client = app.test_client()
    sel = _selection_token(app, client)
    with app.app_context():
        sensitive = create_access_token(
            identity="1", additional_claims={"token_type": "sensitive", "admin_id": 1}
        )
        login = create_access_token(identity="1", additional_claims={"tenant_id": 1})
    for token in (sel, sensitive):
        res = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code in (400, 401, 422)
    assert client.get("/protected", headers={"Authorization": f"Bearer {login}"}).status_code == 200
