"""Admin approval switches: defaults on; Admin can toggle them off."""
import importlib
import pkgutil
from datetime import date

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin  # noqa: E402
from website.models.company_setting import CompanySetting  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402


@pytest.fixture()
def app():
    from website.Admin import admin_bp

    app = Flask("approval_settings")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="approval-settings-secret-key-32b!!",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        db.session.add(Admin(
            id=1, tenant_id=1, email="admin@one.com", emp_id="A1", first_name="Ada",
            emp_type="Admin", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _admin_headers(app):
    with app.app_context():
        token = create_access_token(
            identity="1",
            additional_claims={"email": "admin@one.com", "emp_type": "Admin", "tenant_id": 1},
        )
    return {"Authorization": f"Bearer {token}"}


def test_defaults_require_approval(app):
    from website.approval_settings import approval_required

    with app.app_context():
        assert approval_required("signup") is True
        assert approval_required("exit") is True
        assert approval_required("general") is True
        assert approval_required("leave_unlock") is True


def test_admin_can_load_and_toggle(app):
    from website.approval_settings import load_approval_settings

    client = app.test_client()
    headers = _admin_headers(app)

    get = client.get("/api/admin/approval-settings", headers=headers)
    assert get.status_code == 200, get.get_json()
    body = get.get_json()
    assert body["settings"]["signup"] is True
    assert any(s["key"] == "signup" for s in body["switches"])

    put = client.put(
        "/api/admin/approval-settings",
        json={"settings": {"signup": False, "notify_admin_on_bypass": True}},
        headers=headers,
    )
    assert put.status_code == 200, put.get_json()
    assert put.get_json()["settings"]["signup"] is False
    assert put.get_json()["settings"]["notify_admin_on_bypass"] is True

    with app.app_context():
        saved = load_approval_settings(1)
        assert saved["signup"] is False
        assert CompanySetting.query.filter_by(tenant_id=1, namespace="approval").first() is not None
