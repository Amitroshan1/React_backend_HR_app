import io
import pkgutil
import importlib
from unittest.mock import patch

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin
from website.models.deployed_customer import DeployedCustomer
from website.models.notification import Notification
from website.models.tenant import Tenant
from website.models.tenant_kyb import TenantKybInvite, TenantKybProfile
from website.tenant_context import register_tenant_guards
from website.commands.kyb_identity import make_gstin
from website.tenant_kyb_service import _hash_token


@pytest.fixture()
def app(tmp_path):
    from website.Admin import admin_bp
    from website.tenant_kyb import tenant_kyb_bp

    flask_app = Flask("tenant_kyb")
    flask_app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenant-kyb-secret-key-32bytes",
        SHOW_DEPLOYMENT_GUIDE=True,
        TESTING=True,
        BASE_URL="https://hr.example.test",
        UPLOADS_ROOT=str(tmp_path),
    )
    db.init_app(flask_app)
    jwt = JWTManager(flask_app)
    register_tenant_guards(flask_app, jwt)
    flask_app.register_blueprint(admin_bp, url_prefix="/api/admin")
    flask_app.register_blueprint(tenant_kyb_bp, url_prefix="/api/public/company-kyb")
    with flask_app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="Platform", slug="default", plan="enterprise", status="active"))
        db.session.add(Admin(id=1, email="owner@platform.com", emp_id="P1", emp_type="Super Admin", tenant_id=1))
        db.session.commit()
        yield flask_app
        db.session.remove()
        db.drop_all()


def _auth(app, admin_id=1, tenant_id=1, emp_type="Super Admin", email="owner@platform.com"):
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": email, "emp_type": emp_type, "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


def _pdf():
    return io.BytesIO(b"%PDF-1.4 test file content")


def test_register_without_kyb_stays_active(app):
    client = app.test_client()
    res = client.post(
        "/api/admin/customers",
        json={"company_name": "Plain Co", "plan": "basic", "admin_email": "a@plain.com"},
        headers=_auth(app),
    )
    assert res.status_code == 201, res.get_json()
    body = res.get_json()
    assert body["tenant"]["status"] == "active"
    assert body["tenant"]["kyc_status"] == "not_required"


def test_register_send_kyb_invite(app):
    client = app.test_client()
    with patch("website.email.send_company_kyb_invite_email", return_value=(True, "ok")):
        res = client.post(
            "/api/admin/customers",
            json={
                "company_name": "Kyb Co",
                "plan": "essential",
                "admin_email": "admin@kyb.com",
                "send_kyb_invite": True,
                "kyb_email": "ops@kyb.com",
            },
            headers=_auth(app),
        )
    assert res.status_code == 201, res.get_json()
    body = res.get_json()
    assert body["tenant"]["status"] == "provisioning"
    assert body["tenant"]["kyc_status"] == "invite_sent"
    assert body["kyb"]["email"] == "ops@kyb.com"
    assert "company-kyb?t=" in body["kyb"]["invite_url"]
    raw = body["kyb"]["invite_url"].split("t=", 1)[1]
    with app.app_context():
        row = TenantKybInvite.query.filter_by(tenant_id=body["tenant"]["id"]).one()
        assert row.token_hash == _hash_token(raw)
        assert raw not in (row.token_hash or "")


def test_public_bad_token(app):
    client = app.test_client()
    res = client.get("/api/public/company-kyb?t=nope")
    assert res.status_code == 404
    assert "invalid" in res.get_json()["message"].lower()


def test_public_draft_upload_submit_and_duplicate_gstin(app):
    client = app.test_client()
    with patch("website.email.send_company_kyb_invite_email", return_value=(True, "ok")):
        created = client.post(
            "/api/admin/customers",
            json={
                "company_name": "First Ltd",
                "plan": "basic",
                "admin_email": "a@first.com",
                "send_kyb_invite": True,
                "kyb_email": "ops@first.com",
            },
            headers=_auth(app),
        ).get_json()
    token = created["kyb"]["invite_url"].split("t=", 1)[1]
    profile = {
        "token": token,
        "company_name": "First Ltd",
        "contact_email": "ops@first.com",
        "country": "India",
        "legal_name": "First Private Limited",
        "entity_type": "pvt_ltd",
        "cin": "U12345MH2014PTC123456",
        "gstin": make_gstin(27, "AABCU9603R"),
        "pan": "AABCU9603R",
        "signatory_name": "Asha",
        "signatory_email": "asha@first.com",
    }
    put = client.put("/api/public/company-kyb/profile", json=profile)
    assert put.status_code == 200, put.get_json()
    for doc_type in ("coi", "company_pan", "authorization", "gst_cert"):
        up = client.post(
            "/api/public/company-kyb/documents",
            data={"token": token, "doc_type": doc_type, "file": (_pdf(), f"{doc_type}.pdf")},
            content_type="multipart/form-data",
        )
        assert up.status_code == 200, up.get_json()
    with patch("website.email.send_company_kyb_submitted_ops_email", return_value=(True, "ok")):
        sub = client.post("/api/public/company-kyb/submit", json={"token": token})
    assert sub.status_code == 200, sub.get_json()
    assert sub.get_json()["already_submitted"] is True
    twice = client.post("/api/public/company-kyb/submit", json={"token": token})
    assert twice.status_code == 409

    with patch("website.email.send_company_kyb_invite_email", return_value=(True, "ok")):
        second = client.post(
            "/api/admin/customers",
            json={
                "company_name": "Copycat Ltd",
                "plan": "basic",
                "admin_email": "a@copy.com",
                "send_kyb_invite": True,
                "kyb_email": "ops@copy.com",
            },
            headers=_auth(app),
        ).get_json()
    token2 = second["kyb"]["invite_url"].split("t=", 1)[1]
    dup = client.put(
        "/api/public/company-kyb/profile",
        json={**profile, "token": token2, "legal_name": "Copycat"},
    )
    assert dup.status_code == 409


def test_provisioning_customer_jwt_blocked(app):
    client = app.test_client()
    with patch("website.email.send_company_kyb_invite_email", return_value=(True, "ok")):
        created = client.post(
            "/api/admin/customers",
            json={
                "company_name": "Wait Ltd",
                "plan": "basic",
                "admin_email": "boss@wait.com",
                "send_kyb_invite": True,
                "kyb_email": "ops@wait.com",
            },
            headers=_auth(app),
        ).get_json()
    tenant_id = created["tenant"]["id"]
    admin_id = created["tenant_admin"]["id"]
    headers = _auth(app, admin_id=admin_id, tenant_id=tenant_id, emp_type="Admin", email="boss@wait.com")
    blocked = client.get("/api/admin/customers", headers=headers)
    assert blocked.status_code in (401, 403)


def test_statutory_gate_respects_kyc_status(app):
    from website.kyb_gates import tenant_kyb_allows_statutory

    with app.app_context():
        assert tenant_kyb_allows_statutory(1) is True
        pending = Tenant(
            name="Pending Co", slug="pending_co", plan="basic", status="provisioning", kyc_status="submitted"
        )
        skipped = Tenant(
            name="Skip Co", slug="skip_co", plan="basic", status="active", kyc_status="skipped"
        )
        db.session.add_all([pending, skipped])
        db.session.commit()
        assert tenant_kyb_allows_statutory(pending.id) is False
        assert tenant_kyb_allows_statutory(skipped.id) is True
        pending.kyc_status = "verified"
        db.session.commit()
        assert tenant_kyb_allows_statutory(pending.id) is True


def test_exe_upload_rejected(app):
    client = app.test_client()
    with patch("website.email.send_company_kyb_invite_email", return_value=(True, "ok")):
        created = client.post(
            "/api/admin/customers",
            json={
                "company_name": "Safe Ltd",
                "plan": "basic",
                "admin_email": "a@safe.com",
                "send_kyb_invite": True,
                "kyb_email": "ops@safe.com",
            },
            headers=_auth(app),
        ).get_json()
    token = created["kyb"]["invite_url"].split("t=", 1)[1]
    up = client.post(
        "/api/public/company-kyb/documents",
        data={"token": token, "doc_type": "coi", "file": (io.BytesIO(b"MZ executable"), "x.exe")},
        content_type="multipart/form-data",
    )
    assert up.status_code == 400


def _submit_full_pack(client, *, name, gstin=None):
    gstin = gstin or make_gstin(27, "AABCU9603R")
    with patch("website.email.send_company_kyb_invite_email", return_value=(True, "ok")):
        created = client.post(
            "/api/admin/customers",
            json={
                "company_name": name,
                "plan": "basic",
                "admin_email": f"admin@{name.replace(' ', '').lower()}.com",
                "send_kyb_invite": True,
                "kyb_email": f"ops@{name.replace(' ', '').lower()}.com",
            },
            headers=_auth(client.application),
        ).get_json()
    token = created["kyb"]["invite_url"].split("t=", 1)[1]
    pan = gstin[2:12]
    client.put("/api/public/company-kyb/profile", json={
        "token": token,
        "company_name": name,
        "contact_email": f"ops@{name.replace(' ', '').lower()}.com",
        "country": "India",
        "legal_name": name,
        "entity_type": "pvt_ltd",
        "cin": "U12345MH2014PTC123456",
        "gstin": gstin,
        "pan": pan,
        "signatory_name": "Patel",
        "signatory_email": "patel@co.com",
    })
    for doc_type in ("coi", "company_pan", "authorization", "gst_cert"):
        client.post(
            "/api/public/company-kyb/documents",
            data={"token": token, "doc_type": doc_type, "file": (_pdf(), f"{doc_type}.pdf")},
            content_type="multipart/form-data",
        )
    with patch("website.email.send_company_kyb_submitted_ops_email", return_value=(True, "ok")):
        sub = client.post("/api/public/company-kyb/submit", json={"token": token})
    assert sub.status_code == 200, sub.get_json()
    return created, token


def test_kyb_notify_approve_and_block_manual_activate(app):
    client = app.test_client()
    created, token = _submit_full_pack(client, name="Review Ltd")
    cid = created["customer"]["id"]
    with app.app_context():
        notes = Notification.query.filter_by(notif_type="tenant_kyb", recipient_admin_id=1).all()
        assert notes
    listed = client.get("/api/admin/customers", headers=_auth(app)).get_json()
    row = next(c for c in listed["customers"] if c["id"] == cid)
    assert row["kyc_status"] == "submitted"
    blocked = client.patch(
        f"/api/admin/customers/{cid}",
        json={"status": "active"},
        headers=_auth(app),
    )
    assert blocked.status_code == 409
    ok = client.post(f"/api/admin/customers/{cid}/kyb/approve", json={}, headers=_auth(app))
    assert ok.status_code == 200, ok.get_json()
    assert ok.get_json()["tenant"]["status"] == "active"
    assert ok.get_json()["tenant"]["kyc_status"] == "verified"
    admin_id = created["tenant_admin"]["id"]
    tenant_id = created["tenant"]["id"]
    live = client.get(
        "/api/admin/customers",
        headers=_auth(app, admin_id=admin_id, tenant_id=tenant_id, emp_type="Admin", email="admin@reviewltd.com"),
    )
    assert live.status_code == 403
    again = client.post(f"/api/admin/customers/{cid}/kyb/approve", json={}, headers=_auth(app))
    assert again.status_code == 200


def test_kyb_request_changes_rotates_token(app):
    client = app.test_client()
    created, old_token = _submit_full_pack(client, name="Fixme Ltd", gstin=make_gstin(19, "AABCT1234A"))
    cid = created["customer"]["id"]
    with patch("website.email.send_company_kyb_changes_email", return_value=(True, "ok")):
        res = client.post(
            f"/api/admin/customers/{cid}/kyb/request-changes",
            json={"note": "GST certificate is blurry, please re-upload."},
            headers=_auth(app),
        )
    assert res.status_code == 200, res.get_json()
    assert res.get_json()["tenant"]["kyc_status"] == "needs_fix"
    stale = client.get(f"/api/public/company-kyb?t={old_token}")
    assert stale.status_code == 404
    new_url = res.get_json()["invite_url"]
    fresh = client.get(f"/api/public/company-kyb?t={new_url.split('t=', 1)[1]}")
    assert fresh.status_code == 200
    assert "blurry" in (fresh.get_json().get("review_note") or "")
