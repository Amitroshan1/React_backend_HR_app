"""Shared IT + Inventory purchase queue: manager first, then finance."""
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

from website.inventory_purchase import purchase_bp  # noqa: E402
from website.it import it_bp  # noqa: E402
from website.models.Admin_models import Admin  # noqa: E402
from website.models.inventory_purchase_request import InventoryPurchaseRequest  # noqa: E402
from website.models.manager_model import ManagerContact  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402


@pytest.fixture()
def app():
    app = Flask("purchase_queue")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="purchase-secret-key-32-bytes-long!",
        TESTING=True,
        ZEPTO_SENDER_EMAIL="noreply@test.com",
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(it_bp, url_prefix="/api/it")
    app.register_blueprint(purchase_bp, url_prefix="/api/inventory-purchase")
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        db.session.add(Admin(
            id=10, tenant_id=1, email="it@one.com", emp_id="IT1", first_name="Isha",
            emp_type="IT", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=11, tenant_id=1, email="mgr@one.com", emp_id="M1", first_name="Mira",
            emp_type="IT", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=12, tenant_id=1, email="fin@one.com", emp_id="F1", first_name="Finn",
            emp_type="Finance", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=13, tenant_id=1, email="other@one.com", emp_id="X1", first_name="Omar",
            emp_type="HR", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(ManagerContact(
            tenant_id=1, circle_name="NHQ", user_type="IT", user_email="it@one.com",
            l1_admin_id=11,
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


def _it(app):
    return _headers(app, 10, "it@one.com", "IT")


def _mgr(app):
    return _headers(app, 11, "mgr@one.com", "IT")


def _fin(app):
    return _headers(app, 12, "fin@one.com", "Finance")


def _other(app):
    return _headers(app, 13, "other@one.com", "HR")


def _mailboxes():
    return patch(
        "website.inventory_purchase.company_mailbox",
        side_effect=lambda key: "finance@one.com" if "FINANCE" in key else "itbox@one.com",
    )


def _create(client, app, source="it"):
    with patch("website.plan_features.can_access_it_panel", return_value=True), \
         patch("website.email.send_email_via_zeptomail", return_value=(True, "ok")) as mailer, \
         _mailboxes():
        res = client.post(
            "/api/it/inventory/purchase",
            data={
                "title": "New laptops",
                "justification": "Team machines are failing.",
                "category": "Laptop",
                "item_name": "ThinkPad",
                "quantity": "2",
                "source": source,
            },
            headers=_it(app),
        )
    assert res.status_code == 201, res.get_json()
    return res.get_json()["request"], mailer


def test_create_requires_manager_and_notifies(app):
    client = app.test_client()
    with app.app_context():
        ManagerContact.query.delete()
        db.session.commit()
    with patch("website.plan_features.can_access_it_panel", return_value=True):
        blocked = client.post(
            "/api/it/inventory/purchase",
            data={"title": "Monitors", "justification": "Need screens for new joiners."},
            headers=_it(app),
        )
    assert blocked.status_code == 400
    with app.app_context():
        db.session.add(ManagerContact(
            tenant_id=1, circle_name="NHQ", user_type="IT", user_email="it@one.com",
            l1_admin_id=11,
        ))
        db.session.commit()

    row, mailer = _create(client, app, source="it")
    assert row["status"] == "pending_manager"
    assert row["source"] == "it"
    assert mailer.call_count >= 2
    subjects = [call.kwargs.get("subject") or call.args[1] for call in mailer.call_args_list]
    assert any("waiting on manager" in str(subject) for subject in subjects)
    recipients = [call.kwargs.get("recipient_email") for call in mailer.call_args_list]
    assert "mgr@one.com" in recipients
    assert "finance@one.com" in recipients


def test_manager_must_approve_before_finance(app):
    client = app.test_client()
    row, _ = _create(client, app)
    rid = row["id"]

    with patch("website.plan_features.can_access_finance_panel", return_value=True):
        early = client.post(
            f"/api/inventory-purchase/{rid}/finance-action",
            json={"action": "approve"},
            headers=_fin(app),
        )
    assert early.status_code == 400

    with patch("website.plan_features.can_access_it_panel", return_value=False):
        stranger = client.post(
            f"/api/it/inventory/purchase/{rid}/manager-action",
            json={"action": "approve"},
            headers=_other(app),
        )
    assert stranger.status_code == 403

    own = client.post(
        f"/api/inventory-purchase/{rid}/manager-action",
        json={"action": "approve"},
        headers=_it(app),
    )
    assert own.status_code == 403

    with patch("website.email.send_email_via_zeptomail", return_value=(True, "ok")) as mailer, _mailboxes():
        approved = client.post(
            f"/api/inventory-purchase/{rid}/manager-action",
            json={"action": "approve"},
            headers=_mgr(app),
        )
    assert approved.status_code == 200, approved.get_json()
    assert approved.get_json()["request"]["status"] == "pending_finance"
    assert mailer.call_count >= 1
    subjects = [call.kwargs.get("subject") or "" for call in mailer.call_args_list]
    assert any("approved by manager" in subject for subject in subjects)

    with patch("website.plan_features.can_access_finance_panel", return_value=True), \
         patch("website.email.send_email_via_zeptomail", return_value=(True, "ok")):
        funded = client.post(
            f"/api/inventory-purchase/{rid}/finance-action",
            json={"action": "approve"},
            headers=_fin(app),
        )
    assert funded.status_code == 200
    assert funded.get_json()["request"]["status"] == "finance_approved"

    with patch("website.plan_features.can_access_it_panel", return_value=True):
        received = client.post(
            f"/api/it/inventory/purchase/{rid}/receive",
            json={"notes": "Arrived"},
            headers=_it(app),
        )
    assert received.status_code == 200
    assert received.get_json()["request"]["status"] == "received"


def test_finance_can_see_manager_pending(app):
    client = app.test_client()
    row, _ = _create(client, app, source="inventory")
    with patch("website.plan_features.can_access_finance_panel", return_value=True):
        listed = client.get("/api/inventory-purchase?inbox=finance&status=pending_manager", headers=_fin(app))
    assert listed.status_code == 200
    ids = [item["id"] for item in listed.get_json()["requests"]]
    assert row["id"] in ids
    with app.app_context():
        saved = db.session.get(InventoryPurchaseRequest, row["id"])
        assert saved.source == "inventory"
        assert saved.status == "pending_manager"
