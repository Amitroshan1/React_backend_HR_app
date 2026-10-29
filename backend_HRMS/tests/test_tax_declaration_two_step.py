"""Accounts verifies tax declarations; Finance approves. No skip, no self-review."""
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

from website.Accounts import Accounts  # noqa: E402
from website.models.Admin_models import Admin  # noqa: E402
from website.models.employee_tax_declaration import EmployeeTaxDeclaration  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402


@pytest.fixture()
def app():
    app = Flask("tax_two_step")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="tax-two-step-secret-key-32bytes!",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(Accounts, url_prefix="/api/accounts")
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        db.session.add(Admin(
            id=20, tenant_id=1, email="emp@one.com", emp_id="E1", first_name="Emp",
            emp_type="IT", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=21, tenant_id=1, email="acc@one.com", emp_id="A1", first_name="Acc",
            emp_type="Accounts", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=22, tenant_id=1, email="fin@one.com", emp_id="F1", first_name="Fin",
            emp_type="Finance", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
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
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _seed(app):
    with app.app_context():
        row = EmployeeTaxDeclaration(
            admin_id=20,
            financial_year="2025-26",
            status="submitted",
            tax_regime="new",
        )
        db.session.add(row)
        db.session.commit()
        return row.id


def _review(client, app, decl_id, headers, action, comment=""):
    with patch("website.plan_features.can_access_accounts_panel", return_value=True), \
         patch("website.plan_features.can_access_finance_panel", return_value=True), \
         patch("website.payroll_tds_service.recalculate_payroll_tds_for_financial_year"):
        return client.post(
            f"/api/accounts/tax-declarations/{decl_id}/review",
            json={"action": action, "comment": comment},
            headers=headers,
        )


def test_finance_cannot_skip_accounts(app):
    client = app.test_client()
    decl_id = _seed(app)
    fin = _headers(app, 22, "fin@one.com", "Finance")
    acc = _headers(app, 21, "acc@one.com", "Accounts")

    skipped = _review(client, app, decl_id, fin, "approve")
    assert skipped.status_code == 400, skipped.get_json()

    verified = _review(client, app, decl_id, acc, "verify")
    assert verified.status_code == 200, verified.get_json()
    assert verified.get_json()["declaration"]["status"] == "verified"

    approved = _review(client, app, decl_id, fin, "approve")
    assert approved.status_code == 200
    assert approved.get_json()["declaration"]["status"] == "approved"


def test_finance_remarks_return_to_accounts(app):
    client = app.test_client()
    decl_id = _seed(app)
    acc = _headers(app, 21, "acc@one.com", "Accounts")
    fin = _headers(app, 22, "fin@one.com", "Finance")
    _review(client, app, decl_id, acc, "verify")

    no_remark = _review(client, app, decl_id, fin, "return_accounts")
    assert no_remark.status_code == 400

    returned = _review(client, app, decl_id, fin, "return_accounts", "Cut 80C to the proof amount.")
    assert returned.status_code == 200
    body = returned.get_json()["declaration"]
    assert body["status"] == "returned_to_accounts"
    assert "80C" in (body.get("rejection_reason") or "")

    resent = _review(client, app, decl_id, acc, "resubmit_finance", "Considered 80C reduced.")
    assert resent.status_code == 200
    assert resent.get_json()["declaration"]["status"] == "verified"


def test_accounts_cannot_final_approve_and_cannot_self_review(app):
    client = app.test_client()
    decl_id = _seed(app)
    acc = _headers(app, 21, "acc@one.com", "Accounts")
    with app.app_context():
        own = EmployeeTaxDeclaration(admin_id=21, financial_year="2024-25", status="submitted")
        db.session.add(own)
        db.session.commit()
        own_id = own.id

    mapped = _review(client, app, decl_id, acc, "approve")
    assert mapped.status_code == 200
    assert mapped.get_json()["declaration"]["status"] == "verified"

    self_review = _review(client, app, own_id, acc, "verify")
    assert self_review.status_code == 403
