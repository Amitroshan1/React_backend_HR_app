"""Platform Super Admin (tenant 1) vs company Admin plan gates and reserved role."""
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
from website.models.tenant import Tenant  # noqa: E402
from website.plan_features import (  # noqa: E402
    can_access_accounts_panel,
    can_access_it_panel,
    is_org_admin,
    is_platform_super_admin,
    reserved_platform_role_error,
)
from website.tenant_context import register_tenant_guards  # noqa: E402


@pytest.fixture()
def app():
    from website.Admin import admin_bp
    from website.Human_resource import hr
    from website.auth import auth
    from website.crm_api import crm_bp
    from website.it import it_bp

    app = Flask("platform_super_admin_gates")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="platform-super-admin-secret-key-32b!!",
        SHOW_DEPLOYMENT_GUIDE=True,
        TESTING=True,
        ZEPTO_SENDER_EMAIL="noreply@test.com",
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(auth, url_prefix="/api/auth")
    app.register_blueprint(crm_bp, url_prefix="/api/admin/crm")
    app.register_blueprint(it_bp, url_prefix="/api/it")
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="Owner", slug="default", plan="enterprise", status="active"))
        db.session.add(Tenant(id=2, name="Beta", slug="beta", plan="basic", status="active"))
        db.session.add(Tenant(id=3, name="Gamma", slug="gamma", plan="essential", status="active"))
        db.session.add(Admin(
            id=1, tenant_id=1, email="owner@one.com", emp_id="P1", first_name="Owner",
            emp_type="Super Admin", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=2, tenant_id=2, email="admin@beta.com", emp_id="B1", first_name="Beta Admin",
            emp_type="Admin", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=3, tenant_id=3, email="admin@gamma.com", emp_id="G1", first_name="Gamma Admin",
            emp_type="Admin", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _headers(app, identity, email, emp_type, tenant_id):
    with app.app_context():
        token = create_access_token(
            identity=str(identity),
            additional_claims={"email": email, "emp_type": emp_type, "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


def test_helpers_lock_super_admin_to_tenant_one():
    assert is_platform_super_admin({"emp_type": "Super Admin", "tenant_id": 1})
    assert not is_platform_super_admin({"emp_type": "Super Admin", "tenant_id": 2})
    assert not is_platform_super_admin({"emp_type": "Admin", "tenant_id": 1})
    assert is_org_admin({"emp_type": "Admin", "tenant_id": 2})
    assert not is_org_admin({"emp_type": "Super Admin", "tenant_id": 2})
    assert reserved_platform_role_error(2, "SuperAdmin")
    assert reserved_platform_role_error(1, "Super Admin") is None


def test_basic_plan_admin_has_no_accounts_or_it(app):
    claims = {"emp_type": "Admin", "tenant_id": 2}
    with app.app_context():
        assert can_access_accounts_panel(claims) is False
        assert can_access_it_panel(claims) is False


def test_essential_plan_admin_has_accounts_not_it(app):
    claims = {"emp_type": "Admin", "tenant_id": 3}
    with app.app_context():
        assert can_access_accounts_panel(claims) is True
        assert can_access_it_panel(claims) is False


def test_company_cannot_create_super_admin_department(app):
    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        res = client.post(
            "/api/HumanResource/master/department",
            json={"name": "Super Admin"},
            headers=_headers(app, 2, "admin@beta.com", "Admin", 2),
        )
    assert res.status_code == 400
    assert "reserved" in (res.get_json() or {}).get("message", "").lower()


def test_company_cannot_open_customers_or_crm(app):
    client = app.test_client()
    headers = _headers(app, 2, "admin@beta.com", "Admin", 2)
    assert client.get("/api/admin/customers", headers=headers).status_code == 403
    assert client.get("/api/admin/crm/deals", headers=headers).status_code == 403


def test_owner_super_admin_can_open_customers(app):
    client = app.test_client()
    headers = _headers(app, 1, "owner@one.com", "Super Admin", 1)
    assert client.get("/api/admin/customers", headers=headers).status_code == 200


def test_company_super_admin_login_is_remapped_to_admin(app):
    from website.auth import _issue_login_token

    with app.app_context():
        row = db.session.get(Admin, 2)
        row.emp_type = "Super Admin"
        db.session.commit()
        payload = _issue_login_token(row)
        assert payload["success"] is True
        assert payload["is_platform_super_admin"] is False
        assert db.session.get(Admin, 2).emp_type == "Admin"
