"""Module rollout — Admin: the org admin dashboard only sees the caller's tenant."""
import importlib
import pkgutil
from datetime import date, timedelta

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    # confirmation_request references a Signup model that is not defined.
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin  # noqa: E402
from website.models.attendance import LeaveApplication  # noqa: E402
from website.models.expense import ExpenseClaimHeader, ExpenseLineItem  # noqa: E402
from website.models.it_models import ITSupportTicket  # noqa: E402
from website.models.query import Query  # noqa: E402
from website.models.seperation import Resignation  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

TODAY = date.today()
BASE = "/api/admin"


@pytest.fixture()
def app():
    from website.Admin import admin_bp

    app = Flask("tenancy_admin_module")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-admin-module-secret-32",
        SHOW_DEPLOYMENT_GUIDE=True,
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(admin_bp, url_prefix=BASE)

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
        ])
        common = dict(circle="NHQ", is_active=True, is_exited=False, doj=TODAY - timedelta(days=400))
        db.session.add_all([
            Admin(id=1, tenant_id=1, email="admin@one.com", emp_id="ADM0001", first_name="One Admin", emp_type="Admin", **common),
            Admin(id=2, tenant_id=1, email="dup@x.com", emp_id="E1", first_name="Alpha Dev", emp_type="Engineering", **common),
            Admin(id=3, tenant_id=2, email="admin@two.com", emp_id="ADM0001", first_name="Two Admin", emp_type="Super Admin", **common),
            Admin(id=4, tenant_id=2, email="dup@x.com", emp_id="E1", first_name="Beta Dev", emp_type="Engineering", **common),
        ])
        db.session.flush()
        for aid in (2, 4):
            db.session.add(LeaveApplication(
                id=aid * 10, admin_id=aid, leave_type="Casual Leave", reason="Family function",
                start_date=TODAY, end_date=TODAY, status="Pending",
            ))
            db.session.add(Query(
                id=aid * 10, admin_id=aid, title="Laptop", department="IT", query_text="Slow", status="New",
            ))
            claim = ExpenseClaimHeader(
                id=aid * 10, admin_id=aid, employee_name=f"Emp {aid}", designation="Dev", email="dup@x.com",
                emp_id="E1", project_name="P", country_state="KA", travel_from_date=TODAY, travel_to_date=TODAY,
            )
            db.session.add(claim)
            db.session.flush()
            db.session.add(ExpenseLineItem(
                claim_id=claim.id, sr_no=1, date=TODAY, purpose="Cab", amount=10.0, currency="INR", status="Pending",
            ))
            db.session.add(Resignation(
                id=aid * 10, admin_id=aid, resignation_date=TODAY + timedelta(days=30), reason="Moving", status="Pending",
            ))
            db.session.add(ITSupportTicket(
                ticket_code=f"T{aid}", requester_admin_id=aid, title="VPN", description="Down", status="pending",
            ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _admin(app, tenant_id):
    admin_id, emp_type = (1, "Admin") if tenant_id == 1 else (3, "Super Admin")
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": f"admin@{'one' if tenant_id == 1 else 'two'}.com",
                               "emp_type": emp_type, "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


def test_dashboard_counts_only_own_tenant(app):
    body = app.test_client().get(f"{BASE}/dashboard", headers=_admin(app, 2)).get_json()
    assert body["company_total_employees"] == 2
    for key in ("total_leaves", "total_queries", "total_claims", "total_resignations",
                "pending_leaves", "pending_queries", "pending_claims", "open_tickets"):
        assert body[key] == 1, key


@pytest.mark.parametrize("path", ["leaves", "queries", "claims", "resignations"])
def test_org_lists_only_own_tenant(app, path):
    rows = app.test_client().get(f"{BASE}/{path}", headers=_admin(app, 1)).get_json()["requests"]
    assert [r["id"] for r in rows] == [20]


def test_employees_list_only_own_tenant(app):
    rows = app.test_client().get(f"{BASE}/employees", headers=_admin(app, 2)).get_json()["employees"]
    assert sorted(r["id"] for r in rows) == [3, 4]


def test_query_detail_of_other_tenant_is_not_found(app):
    c = app.test_client()
    assert c.get(f"{BASE}/queries/40", headers=_admin(app, 1)).status_code == 404
    assert c.get(f"{BASE}/queries/20", headers=_admin(app, 1)).status_code == 200


def test_employee_detail_of_other_tenant_is_not_found(app):
    c = app.test_client()
    assert c.get(f"{BASE}/employees/4", headers=_admin(app, 1)).status_code == 404
    assert c.get(f"{BASE}/employees/4/punches", headers=_admin(app, 1)).status_code == 404
    assert c.get(f"{BASE}/employees/2", headers=_admin(app, 1)).status_code == 200


def test_customer_registry_is_platform_tenant_only(app):
    c = app.test_client()
    assert c.get(f"{BASE}/customers", headers=_admin(app, 2)).status_code == 403
    assert c.get(f"{BASE}/customers", headers=_admin(app, 1)).status_code == 200
