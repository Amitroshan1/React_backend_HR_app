"""Feature checks follow the logged-in tenant's plan, not the server-wide CUSTOMER_PLAN."""
import pytest
from flask import Flask, jsonify
from flask_jwt_extended import JWTManager, create_access_token

from website import db
from website.models.Admin_models import Admin
from website.models.tenant import Tenant
from website.tenant_context import register_tenant_guards


@pytest.fixture()
def app():
    from website.Accounts import Accounts
    from website.plan_features import get_plan, has_feature, plan_payload

    app = Flask("tenancy_plan")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-plan-secret-32-bytes!",
        CUSTOMER_PLAN="basic",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(Accounts, url_prefix="/api/accounts")

    @app.route("/plan")
    def plan_probe():
        return jsonify(get_plan=get_plan(), payroll=has_feature("account_payroll"), **plan_payload())

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="essential", status="active"),
            Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
            Admin(id=1, tenant_id=1, email="acc@one.com", emp_id="A1", emp_type="Accounts", is_active=True),
            Admin(id=2, tenant_id=2, email="acc@two.com", emp_id="A1", emp_type="Accounts", is_active=True),
        ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _auth(app, admin_id, tenant_id, **extra):
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"emp_type": "Accounts", "tenant_id": tenant_id, **extra},
        )
    return {"Authorization": f"Bearer {token}"}


def test_plan_follows_jwt_tenant(app):
    c = app.test_client()
    one = c.get("/plan", headers=_auth(app, 1, 1)).get_json()
    two = c.get("/plan", headers=_auth(app, 2, 2)).get_json()
    assert (one["get_plan"], one["plan"], one["payroll"]) == ("essential", "essential", False)
    assert (two["get_plan"], two["plan"], two["payroll"]) == ("enterprise", "enterprise", True)
    assert "account_payroll" in two["features"] and "account_payroll" not in one["features"]


def test_plan_without_login_uses_customer_plan(app):
    assert app.test_client().get("/plan").get_json()["get_plan"] == "basic"
    with app.app_context():
        from website.plan_features import get_plan

        assert get_plan() == "basic"


def test_typed_token_does_not_pick_tenant_plan(app):
    res = app.test_client().get("/plan", headers=_auth(app, 2, 2, token_type="sensitive"))
    assert res.get_json()["get_plan"] == "basic"


def test_payroll_route_gated_by_each_tenants_plan(app):
    c = app.test_client()
    body = {"month": "January", "year": "2026"}
    denied = c.post("/api/accounts/payroll/history", json=body, headers=_auth(app, 1, 1))
    assert denied.status_code == 403
    assert denied.get_json()["plan"] == "essential"
    allowed = c.post("/api/accounts/payroll/history", json=body, headers=_auth(app, 2, 2))
    assert allowed.status_code == 200
