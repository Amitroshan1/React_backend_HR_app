"""Generate official email: HR request -> IT generates -> HR sees generated email + can_signup."""
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
from website.models.official_email_request import OfficialEmailRequest  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

VALID = {
    "candidate_name": "Rahul Sharma",
    "designation": "Software Engineer",
    "department": "Engineering",
    "circle": "NHQ",
    "preferred_prefix": "rahul.sharma",
    "details": "Please create the official mailbox and share the address.",
}


@pytest.fixture()
def app():
    from website.Human_resource import hr
    from website.it import it_bp

    app = Flask("official_email_requests")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="official-email-secret-key-32bytes!!",
        TESTING=True,
        ZEPTO_SENDER_EMAIL="noreply@test.com",
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(it_bp, url_prefix="/api/it")
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        db.session.add(Admin(
            id=2, tenant_id=1, email="hr@one.com", emp_id="H1", first_name="Hari",
            emp_type="Human Resource", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=4, tenant_id=1, email="it@one.com", emp_id="I1", first_name="Ishan",
            emp_type="IT", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=1, tenant_id=1, email="owner@one.com", emp_id="SA1", first_name="Owner",
            emp_type="Super Admin", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
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


def _hr(app):
    return _headers(app, 2, "hr@one.com", "HR")


def _it(app):
    return _headers(app, 4, "it@one.com", "IT")


def _super(app):
    return _headers(app, 1, "owner@one.com", "Super Admin")


def _create(client, app):
    with patch("website.plan_features.can_access_hr_operations", return_value=True), \
         patch("website.email.send_official_email_request_to_it", return_value=True) as mailer:
        res = client.post(
            "/api/HumanResource/official-email-requests",
            json=VALID,
            headers=_hr(app),
        )
    assert res.status_code == 201, res.get_json()
    mailer.assert_called_once()
    return res.get_json()


def test_hr_create_requires_details_and_sends_mail_to_it(app):
    client = app.test_client()
    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        short = client.post(
            "/api/HumanResource/official-email-requests",
            json={"candidate_name": "Rahul Sharma", "details": "short"},
            headers=_hr(app),
        )
    assert short.status_code == 400

    body = _create(client, app)
    assert body["success"] is True
    assert body["email_sent"] is True
    assert body["request"]["status"] == "Pending"
    assert body["request"]["can_signup"] is False

    with app.app_context():
        row = OfficialEmailRequest.query.one()
        assert row.candidate_name == "Rahul Sharma"
        assert row.requested_by_admin_id == 2


def test_it_generates_email_and_hr_can_signup(app):
    client = app.test_client()
    created = _create(client, app)
    req_id = created["request"]["id"]

    with patch("website.plan_features.can_access_it_panel", return_value=True):
        queue = client.get("/api/it/official-email-requests?status=pending", headers=_it(app))
        assert queue.status_code == 200, queue.get_json()
        assert [r["id"] for r in queue.get_json()["requests"]] == [req_id]

        bad = client.post(
            f"/api/it/official-email-requests/{req_id}/respond",
            json={"generated_email": "not-an-email"},
            headers=_it(app),
        )
        assert bad.status_code == 400

        with patch("website.email.send_official_email_generated_to_hr", return_value=True) as mailer:
            done = client.post(
                f"/api/it/official-email-requests/{req_id}/respond",
                json={"generated_email": "Rahul.Sharma@One.com", "it_remarks": "Mailbox created."},
                headers=_it(app),
            )
        assert done.status_code == 200, done.get_json()
        mailer.assert_called_once()
        assert done.get_json()["request"]["generated_email"] == "rahul.sharma@one.com"

        again = client.post(
            f"/api/it/official-email-requests/{req_id}/respond",
            json={"generated_email": "other@one.com"},
            headers=_it(app),
        )
        assert again.status_code == 409

    with patch("website.plan_features.can_access_hr_operations", return_value=True):
        hr_list = client.get(
            "/api/HumanResource/official-email-requests?status=generated", headers=_hr(app))
    assert hr_list.status_code == 200
    rows = hr_list.get_json()["requests"]
    assert len(rows) == 1
    assert rows[0]["generated_email"] == "rahul.sharma@one.com"
    assert rows[0]["can_signup"] is True
    assert hr_list.get_json()["summary"]["generated"] == 1


def test_hr_cannot_open_it_official_email_queue(app):
    client = app.test_client()
    _create(client, app)
    blocked = client.get("/api/it/official-email-requests?status=pending", headers=_hr(app))
    assert blocked.status_code == 403


def test_super_admin_can_open_it_official_email_queue(app):
    client = app.test_client()
    created = _create(client, app)
    req_id = created["request"]["id"]
    queue = client.get("/api/it/official-email-requests?status=pending", headers=_super(app))
    assert queue.status_code == 200, queue.get_json()
    assert [row["id"] for row in queue.get_json()["requests"]] == [req_id]
