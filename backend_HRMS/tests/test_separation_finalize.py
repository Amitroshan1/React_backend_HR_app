"""Separation submit: separation-only mail to Manager/HR, no NOC creation."""
import importlib
import pkgutil
from datetime import date, timedelta
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
from website.models.seperation import NocApplicationRequest, NocDepartmentRequest, Resignation  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402


@pytest.fixture()
def app():
    from website.leave_attendence import leave

    app = Flask("separation_finalize")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="separation-finalize-secret-key-32b!",
        TESTING=True,
        ZEPTO_SENDER_EMAIL="noreply@test.com",
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(leave, url_prefix="/api/leave")
    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        db.session.add(Admin(
            id=1, tenant_id=1, email="emp@one.com", emp_id="E1", first_name="Eve",
            emp_type="Engineering", circle="NHQ", is_active=True, is_exited=False,
            doj=date.today() - timedelta(days=400),
        ))
        db.session.add(Admin(
            id=2, tenant_id=1, email="hr@one.com", emp_id="H1", first_name="Hari",
            emp_type="Human Resource", circle="NHQ", is_active=True, is_exited=False,
            doj=date.today() - timedelta(days=800),
        ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _headers(app):
    with app.app_context():
        token = create_access_token(
            identity="1",
            additional_claims={"email": "emp@one.com", "emp_type": "Engineering", "tenant_id": 1},
        )
    return {"Authorization": f"Bearer {token}"}


def test_finalize_is_separation_only_no_noc(app):
    client = app.test_client()
    with patch("website.leave_attendence.send_resignation_email", return_value=(True, "ok")) as sep_mail, \
         patch("website.leave_attendence.send_noc_request_email") as noc_mail:
        res = client.post(
            "/api/leave/seperation/finalize",
            json={
                "resignation_date": (date.today() + timedelta(days=30)).isoformat(),
                "reason": "Moving to another opportunity for growth.",
                "departments": ["HR"],
            },
            headers=_headers(app),
        )
    body = res.get_json() or {}
    assert res.status_code == 201, body
    assert body.get("success") is True
    assert body.get("separation_email_sent") is True
    assert not body.get("noc_email_sent")
    sep_mail.assert_called_once()
    noc_mail.assert_not_called()

    with app.app_context():
        row = Resignation.query.filter_by(admin_id=1).first()
        assert row is not None
        assert (row.status or "").strip().lower() == "pending"
        assert NocDepartmentRequest.query.filter_by(resignation_id=row.id).count() == 0
        assert NocApplicationRequest.query.filter_by(admin_id=1).count() == 0


def test_separation_post_also_separation_only(app):
    client = app.test_client()
    with patch("website.leave_attendence.send_resignation_email", return_value=(True, "ok")) as sep_mail, \
         patch("website.leave_attendence.send_noc_request_email") as noc_mail:
        res = client.post(
            "/api/leave/seperation",
            json={
                "resignation_date": (date.today() + timedelta(days=30)).isoformat(),
                "reason": "Personal reasons for leaving the role.",
            },
            headers=_headers(app),
        )
    body = res.get_json() or {}
    assert res.status_code == 201, body
    assert body.get("success") is True
    sep_mail.assert_called_once()
    noc_mail.assert_not_called()
    with app.app_context():
        assert NocDepartmentRequest.query.count() == 0
