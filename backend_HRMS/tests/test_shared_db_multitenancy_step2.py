"""Rollout step 2: tenant assignment on employee creation + first tenant admin."""
import importlib
import pkgutil
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    # confirmation_request references a Signup model that is not defined.
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin, AuditLog  # noqa: E402
from website.models.attendance import LeaveBalance  # noqa: E402
from website.models.deployed_customer import DeployedCustomer  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import tenant_admin_query  # noqa: E402

_TABLES = [Tenant, Admin, LeaveBalance, AuditLog, DeployedCustomer]


@pytest.fixture()
def app():
    from website.Admin import admin_bp

    app = Flask("tenancy_step2")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-step2-secret-key-32b",
        SHOW_DEPLOYMENT_GUIDE=True,
        TESTING=True,
    )
    db.init_app(app)
    JWTManager(app)
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    with app.app_context():
        db.Model.metadata.create_all(bind=db.engine, tables=[m.__table__ for m in _TABLES])
        db.session.add_all([
            Tenant(id=1, name="Platform", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Beta", slug="beta", plan="basic", status="active"),
        ])
        db.session.add_all([
            Admin(id=1, email="owner@platform.com", emp_id="P1", emp_type="Super Admin", tenant_id=1),
            Admin(id=2, email="legacy@platform.com", emp_id="P2"),
            Admin(id=3, email="boss@beta.com", emp_id="B1", emp_type="Super Admin", tenant_id=2),
            Admin(id=4, email="stub@beta.com", tenant_id=2),
        ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _auth(app, admin_id, tenant_id, emp_type="Super Admin", email="owner@platform.com"):
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": email, "emp_type": emp_type, "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


def test_tenant_id_defaults_to_default_tenant_outside_request(app):
    with app.app_context():
        assert db.session.get(Admin, 2).tenant_id == 1


def test_tenant_admin_query_scopes_rows(app):
    with app.app_context():
        assert sorted(a.id for a in tenant_admin_query(1).all()) == [1, 2]
        assert sorted(a.id for a in tenant_admin_query(2).all()) == [3, 4]


def _import(rows, tenant_id):
    from website.employee_import_service import commit_employee_import

    with patch("website.employee_import_service._validate_row", return_value=[]), patch(
        "website.employee_import_service.send_welcome_email"
    ), patch("website.Human_resource._log_initial_circle_assignment"), patch(
        "website.Human_resource._sync_probation_after_doj_change"
    ), patch("website.Human_resource._upsert_employee_designation_for_admin"), patch(
        "website.employment_status.resolve_employment_payload", return_value={}
    ), patch("website.employment_status.apply_employment_fields"):
        return commit_employee_import(rows, hr_email="hr@beta.com", tenant_id=tenant_id)


def _row(email, emp_id, n=1):
    return {
        "row_number": n,
        "email": email,
        "first_name": "New Person",
        "user_name": f"user_{emp_id}",
        "mobile": f"90000000{n:02d}",
        "emp_id": emp_id,
        "emp_type": "Engineering",
        "circle": "NHQ",
        "designation": "Engineer",
        "doj": "2026-01-05",
    }


def test_import_creates_employee_in_importers_tenant(app):
    with app.app_context():
        result = _import([_row("new@beta.com", "B2")], tenant_id=2)
        assert result["created"] == 1
        assert Admin.query.filter_by(email="new@beta.com").one().tenant_id == 2


def test_import_does_not_take_over_other_tenants_stub(app):
    with app.app_context():
        result = _import([_row("stub@beta.com", "P9")], tenant_id=1)
        assert result["created"] == 1
        stub = db.session.get(Admin, 4)
        assert stub.tenant_id == 2
        assert not (stub.emp_id or "").strip()
        own = tenant_admin_query(1).filter_by(email="stub@beta.com").one()
        assert own.id != 4 and own.emp_id == "P9"


def test_import_allows_identifiers_used_by_another_tenant(app):
    with app.app_context():
        result = _import([_row("boss@beta.com", "B1")], tenant_id=1)
        assert result["created"] == 1
        assert Admin.query.filter_by(email="boss@beta.com").count() == 2
        assert Admin.query.filter_by(emp_id="B1").count() == 2


def test_import_rejects_identifiers_already_used_in_same_tenant(app):
    with app.app_context():
        result = _import([_row("fresh@platform.com", "P1")], tenant_id=1)
        assert result["created"] == 0
        assert result["failed"] == 1
        assert Admin.query.filter_by(emp_id="P1").count() == 1


def test_preview_checks_duplicates_within_tenant_only(app):
    from website.employee_import_service import preview_employee_import

    with app.app_context(), patch(
        "website.employee_import_service._validate_row", return_value=[]
    ):
        assert preview_employee_import([_row("boss@beta.com", "B1")], tenant_id=1)["error_count"] == 0
        assert preview_employee_import([_row("boss@beta.com", "B1")], tenant_id=2)["error_count"] == 1


def test_database_enforces_uniques_per_tenant(app):
    from sqlalchemy.exc import IntegrityError

    with app.app_context():
        db.session.add(Admin(email="owner@platform.com", emp_id="P1", tenant_id=2))
        db.session.commit()
        db.session.add(Admin(email="owner@platform.com", emp_id="P7", tenant_id=1))
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()
        db.session.add(Admin(email="other@platform.com", emp_id="P1", tenant_id=1))
        with pytest.raises(IntegrityError):
            db.session.commit()
        db.session.rollback()


def test_register_company_seeds_first_admin(app):
    client = app.test_client()
    res = client.post(
        "/api/admin/customers",
        json={
            "company_name": "Gamma Ltd",
            "plan": "essential",
            "admin_email": " Admin@Gamma.com ",
            "admin_name": "Gamma Admin",
            "admin_mobile": "9876500000",
        },
        headers=_auth(app, 1, 1),
    )
    assert res.status_code == 201, res.get_json()
    body = res.get_json()
    tenant_id = body["tenant"]["id"]
    assert body["tenant_admin"]["email"] == "admin@gamma.com"
    with app.app_context():
        seeded = Admin.query.filter_by(email="admin@gamma.com").one()
        assert seeded.tenant_id == tenant_id
        assert seeded.emp_type == "Admin"
        assert seeded.emp_id == "ADM0001"
        assert seeded.is_onboarded()
        assert LeaveBalance.query.filter_by(admin_id=seeded.id).count() == 1
        assert AuditLog.query.filter_by(action="CREATE_TENANT_ADMIN").count() == 1


def test_register_company_allows_admin_email_used_by_another_company(app):
    client = app.test_client()
    for name in ("Delta", "Zeta"):
        res = client.post(
            "/api/admin/customers",
            json={"company_name": name, "plan": "basic", "admin_email": "BOSS@beta.com"},
            headers=_auth(app, 1, 1),
        )
        assert res.status_code == 201, res.get_json()
    with app.app_context():
        rows = Admin.query.filter_by(email="boss@beta.com").all()
        assert len({r.tenant_id for r in rows}) == 3
        assert Admin.query.filter_by(emp_id="ADM0001").count() == 2


def test_register_company_without_admin_still_works(app):
    client = app.test_client()
    res = client.post(
        "/api/admin/customers",
        json={"company_name": "Epsilon", "plan": "basic"},
        headers=_auth(app, 1, 1),
    )
    assert res.status_code == 201
    assert "tenant_admin" not in res.get_json()


def test_other_tenant_super_admin_cannot_use_registry(app):
    client = app.test_client()
    headers = _auth(app, 3, 2, email="boss@beta.com")
    assert client.get("/api/admin/customers", headers=headers).status_code == 403
    res = client.post(
        "/api/admin/customers",
        json={"company_name": "Sneaky", "plan": "basic"},
        headers=headers,
    )
    assert res.status_code == 403
