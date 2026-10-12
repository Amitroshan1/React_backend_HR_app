"""Rollout step — uploaded files are only served inside the owning tenant."""
import importlib
import io
import os
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
from website.models.emp_detail_models import Asset  # noqa: E402
from website.models.expense import ExpenseClaimHeader, ExpenseLineItem  # noqa: E402
from website.models.news_feed import NewsFeed, PaySlip  # noqa: E402
from website.models.query import Query  # noqa: E402
from website.models.seperation import Noc_Upload  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

ACCOUNTS = "Accounts"
HR_TYPE = "Human Resource"
TODAY = date.today()

# Files seeded on disk under UPLOADS_ROOT.
DISK_FILES = ("payslips/p2.pdf", "payslips/p4.pdf", "misc/legacy.txt", "tenants/2/news/abc/t2.txt")


@pytest.fixture()
def app(tmp_path):
    from website.Accounts import Accounts
    from website.files import files_bp
    from website.Human_resource import hr

    app = Flask("tenancy_uploads")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-uploads-secret-32-bytes",
        UPLOADS_ROOT=str(tmp_path / "private"),
        UPLOAD_FOLDER=str(tmp_path / "static_uploads"),
        TESTING=True,
    )
    for rel in DISK_FILES:
        path = tmp_path / "private" / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"file:" + rel.encode())

    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(Accounts, url_prefix="/api/accounts")
    app.register_blueprint(files_bp, url_prefix="/api/files")
    app.register_blueprint(hr, url_prefix="/api/HumanResource")

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
        ])
        common = dict(circle="NHQ", is_active=True, is_exited=False, doj=TODAY - timedelta(days=400))
        db.session.add_all([
            Admin(id=1, tenant_id=1, email="acc@x.com", emp_id="A1", first_name="One Acc", emp_type=ACCOUNTS, **common),
            Admin(id=2, tenant_id=1, email="alpha@x.com", emp_id="E1", first_name="Alpha", emp_type="Engineering", **common),
            Admin(id=3, tenant_id=2, email="acc@x.com", emp_id="A1", first_name="Two Acc", emp_type=ACCOUNTS, **common),
            Admin(id=4, tenant_id=2, email="beta@x.com", emp_id="E1", first_name="Beta", emp_type="Engineering", **common),
            Admin(id=5, tenant_id=2, email="hr@x.com", emp_id="H1", first_name="Two HR", emp_type=HR_TYPE, **common),
        ])
        db.session.flush()
        claim = ExpenseClaimHeader(
            id=40, admin_id=4, employee_name="Beta", designation="Dev", email="beta@x.com", emp_id="E1",
            project_name="P", country_state="MH", travel_from_date=TODAY, travel_to_date=TODAY,
        )
        db.session.add_all([
            PaySlip(admin_id=2, month="Aug", year="2026", file_path="payslips/p2.pdf"),
            PaySlip(admin_id=4, month="Aug", year="2026", file_path="payslips/p4.pdf"),
            Noc_Upload(admin_id=2, file_path="noc/n2.pdf", emp_type_uploader=HR_TYPE),
            NewsFeed(tenant_id=2, title="T2", content="x", circle="All", emp_type="All", file_path="t2-banner.png"),
            Query(id=40, admin_id=4, title="Q", department=HR_TYPE, query_text="x", photo='["q40_abc.pdf"]'),
            Asset(id=20, name="Laptop", admin_id=2, image_files="assets/E1/pic.png"),
            claim,
        ])
        db.session.flush()
        db.session.add(ExpenseLineItem(
            claim_id=40, sr_no=1, date=TODAY, purpose="Taxi", amount=10, currency="INR",
            Attach_file="expenses/E1_40_1_taxi.pdf",
        ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _headers(app, admin_id, tenant_id, emp_type, email):
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": email, "emp_type": emp_type, "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


def _acc(app, tenant_id):
    return _headers(app, 1 if tenant_id == 1 else 3, tenant_id, ACCOUNTS, "acc@x.com")


def _allowed(app, admin_id, rel):
    from website.secure_file_service import authorize_upload_access

    with app.test_request_context():
        return authorize_upload_access(db.session.get(Admin, admin_id), rel, {})[0]


@pytest.mark.parametrize(
    "rel, tenant1_admin, tenant2_admin",
    [
        # (path, tenant-1 caller allowed?, tenant-2 caller allowed?) — privileged callers 1 and 3.
        ("payslips/p2.pdf", True, False),
        ("payslips/p4.pdf", False, True),
        ("noc/n2.pdf", True, False),
        ("signatures/2/v1.png", True, False),
        ("expenses/E1_40_1_taxi.pdf", False, True),
        ("queries/q40_abc.pdf", False, True),
        ("assets/E1/pic.png", True, False),
        ("t2-banner.png", False, True),
        ("tenants/2/news/abc/t2.txt", False, True),
        ("tenants/1/news/abc/t1.txt", True, False),
        ("misc/legacy.txt", True, False),
    ],
)
def test_privileged_roles_only_reach_own_tenant_files(app, rel, tenant1_admin, tenant2_admin):
    assert _allowed(app, 1, rel) is tenant1_admin
    assert _allowed(app, 3, rel) is tenant2_admin


def test_employee_media_is_tenant_scoped(app):
    # Org-directory profile photos and company news files: same tenant only.
    assert _allowed(app, 4, "profile_4_E1_abc.jpg") is True
    assert _allowed(app, 4, "profile_2_E1_abc.jpg") is False
    assert _allowed(app, 4, "tenants/2/news/abc/t2.txt") is True
    assert _allowed(app, 2, "tenants/2/news/abc/t2.txt") is False


def test_file_api_denies_other_tenant_files(app):
    c = app.test_client()
    assert c.get("/api/files/content/payslips/p2.pdf", headers=_acc(app, 2)).status_code == 403
    assert c.get("/api/files/content/payslips/p4.pdf", headers=_acc(app, 2)).status_code == 200
    assert c.post("/api/files/sign", json={"path": "payslips/p2.pdf"}, headers=_acc(app, 2)).status_code == 403
    assert c.get("/api/files/resolve?path=/static/uploads/misc/legacy.txt", headers=_acc(app, 2)).status_code == 403
    assert c.get("/api/files/content/tenants/2/news/abc/t2.txt", headers=_acc(app, 2)).status_code == 200


def test_accounts_file_route_denies_other_tenant_files(app):
    c = app.test_client()
    # Unknown prefixes were open to any privileged role; now only to the owning tenant.
    assert c.get("/api/accounts/file/misc/legacy.txt", headers=_acc(app, 2)).status_code == 404
    assert c.get("/api/accounts/file/misc/legacy.txt", headers=_acc(app, 1)).status_code == 200
    assert c.get("/api/accounts/file/payslips/p2.pdf", headers=_acc(app, 2)).status_code == 404


def test_news_attachment_is_stored_in_tenant_folder(app, tmp_path):
    c = app.test_client()
    hr2 = _headers(app, 5, 2, HR_TYPE, "hr@x.com")
    resp = c.post(
        "/api/HumanResource/news-feed",
        data={"title": "Offsite", "content": "Goa", "circle": "All", "emp_type": "All",
              "file": (io.BytesIO(b"agenda"), "agenda.pdf")},
        headers=hr2,
        content_type="multipart/form-data",
    )
    assert resp.status_code in (200, 201)
    with app.app_context():
        post = NewsFeed.query.filter_by(title="Offsite").one()
        assert post.file_path.startswith("tenants/2/news/") and post.file_path.endswith("/agenda.pdf")
        assert os.path.isfile(tmp_path / "static_uploads" / post.file_path)


def test_legacy_asset_update_is_tenant_scoped(app):
    c = app.test_client()
    hr2 = _headers(app, 5, 2, HR_TYPE, "hr@x.com")
    assert c.put("/api/HumanResource/assets/20", data={"name": "Stolen"}, headers=hr2).status_code == 404
    with app.app_context():
        assert db.session.get(Asset, 20).name == "Laptop"


def test_tenant_upload_rel_helpers(app):
    from website.upload_tenancy import split_tenant_rel, tenant_upload_rel, upload_owner_tenant

    with app.app_context():
        assert tenant_upload_rel("news/a.pdf", 2) == "tenants/2/news/a.pdf"
        assert split_tenant_rel("tenants/2/news/a.pdf") == (2, "news/a.pdf")
        assert split_tenant_rel("news/a.pdf") == (None, "news/a.pdf")
        assert upload_owner_tenant("payslips/p4.pdf") == 2
        assert upload_owner_tenant("payslips/orphan.pdf") == 1


def _employee_otp_ok(monkeypatch):
    """Employees opening their own salary files need the sensitive OTP; treat it as done."""
    monkeypatch.setattr("website.sensitive_data_auth.validate_sensitive_token", lambda token, admin_id: True)


def _beta(app):
    return _headers(app, 4, 2, "Engineering", "beta@x.com")


@pytest.mark.parametrize("kind", ["payslip", "form16"])
def test_salary_uploads_go_to_company_folder_and_stay_readable(app, tmp_path, monkeypatch, kind):
    monkeypatch.setattr("website.Accounts.send_payslip_uploaded_email", lambda *a, **k: (True, "ok"))
    monkeypatch.setattr("website.Accounts.send_form16_uploaded_email", lambda *a, **k: (True, "ok"))
    _employee_otp_ok(monkeypatch)
    c = app.test_client()
    if kind == "payslip":
        url, data, model = "/api/accounts/payslip/upload", {"month": "Sep", "year": "2026"}, PaySlip
        data["payslip_file"] = (io.BytesIO(b"%PDF-1.4 slip"), "slip.pdf")
    else:
        from website.models.news_feed import Form16 as model

        url, data = "/api/accounts/form16/upload", {"financial_year": "2025-26"}
        data["form16_file"] = (io.BytesIO(b"%PDF-1.4 f16"), "f16.pdf")
    data["admin_id"] = "4"
    resp = c.post(url, data=data, headers=_acc(app, 2), content_type="multipart/form-data")
    assert resp.status_code == 201, resp.get_json()
    with app.app_context():
        rel = model.query.filter_by(admin_id=4).order_by(model.id.desc()).first().file_path
    folder = "payslips" if kind == "payslip" else "form16"
    assert rel.startswith(f"tenants/2/{folder}/4_")
    assert os.path.isfile(tmp_path / "private" / rel)

    # Company 2 Accounts and the employee (own file) can open it; company 1 cannot.
    assert c.get(f"/api/accounts/file/{rel}", headers=_acc(app, 2)).status_code == 200
    assert c.get(f"/api/accounts/file/{rel}", headers=_beta(app)).status_code == 200
    assert c.get(f"/api/files/content/{rel}", headers=_beta(app)).status_code == 200
    assert c.get(f"/api/accounts/file/{rel}", headers=_acc(app, 1)).status_code == 404
    assert c.get(f"/api/files/content/{rel}", headers=_acc(app, 1)).status_code == 403
    assert _allowed(app, 4, rel) is True
    assert _allowed(app, 2, rel) is False


def test_prefixed_salary_file_of_a_colleague_stays_private(app, tmp_path, monkeypatch):
    _employee_otp_ok(monkeypatch)
    with app.app_context():
        db.session.add(Admin(id=6, tenant_id=2, email="gamma@x.com", emp_id="E2", first_name="Gamma",
                             emp_type="Engineering", circle="NHQ", is_active=True, is_exited=False,
                             doj=TODAY - timedelta(days=400)))
        db.session.add(PaySlip(admin_id=4, month="Sep", year="2026", file_path="tenants/2/payslips/p4b.pdf"))
        db.session.commit()
    path = tmp_path / "private" / "tenants" / "2" / "payslips" / "p4b.pdf"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"%PDF-1.4")
    gamma = _headers(app, 6, 2, "Engineering", "gamma@x.com")
    c = app.test_client()
    assert c.get("/api/accounts/file/tenants/2/payslips/p4b.pdf", headers=gamma).status_code == 403
    assert c.get("/api/files/content/tenants/2/payslips/p4b.pdf", headers=gamma).status_code == 403
    assert c.get("/api/accounts/file/tenants/2/payslips/p4b.pdf", headers=_beta(app)).status_code == 200


def test_query_attachments_are_saved_per_company_and_legacy_still_opens(app, tmp_path, monkeypatch):
    import website.query as query_mod

    monkeypatch.setattr(query_mod, "UPLOADS_BASE", str(tmp_path / "q_uploads"))
    monkeypatch.setattr(query_mod, "UPLOAD_DIR", str(tmp_path / "q_uploads" / "queries"))
    monkeypatch.setattr(query_mod, "notify_query_event", lambda *a, **k: None)
    app.register_blueprint(query_mod.query, url_prefix="/api/query")
    legacy = tmp_path / "q_uploads" / "queries" / "q40_abc.pdf"
    legacy.parent.mkdir(parents=True, exist_ok=True)
    legacy.write_bytes(b"legacy")

    c = app.test_client()
    resp = c.post(
        "/api/query/queries",
        data={"title": "Laptop", "department": HR_TYPE, "query_text": "Broken",
              "files": (io.BytesIO(b"photo"), "screen.png")},
        headers=_beta(app),
        content_type="multipart/form-data",
    )
    assert resp.status_code in (200, 201), resp.get_json()
    with app.app_context():
        row = Query.query.filter_by(title="Laptop").one()
        stored = __import__("json").loads(row.photo)[0]
        qid = row.id
    assert "/" not in stored
    assert os.path.isfile(tmp_path / "q_uploads" / "tenants" / "2" / "queries" / stored)
    assert not os.path.exists(tmp_path / "q_uploads" / "queries" / stored)
    assert c.get(f"/api/query/queries/{qid}/files/{stored}", headers=_beta(app)).status_code == 200
    assert c.get("/api/query/queries/40/files/q40_abc.pdf", headers=_beta(app)).status_code == 200


def test_signature_and_profile_document_writers_use_company_folder(app, tmp_path):
    from werkzeug.datastructures import FileStorage

    from website.auth import auth
    from website.daily_checkout.service import upload_signature

    app.root_path = str(tmp_path / "app_root")
    app.register_blueprint(auth, url_prefix="/api/auth")
    with app.app_context():
        sig = upload_signature(db.session.get(Admin, 4), FileStorage(io.BytesIO(b"\x89PNG sig"), "sig.png"))
        assert sig.file_path == "tenants/2/signatures/4/v1.png"
        assert os.path.isfile(tmp_path / "private" / sig.file_path)
    assert _allowed(app, 4, "tenants/2/signatures/4/v1.png") is True
    assert _allowed(app, 1, "tenants/2/signatures/4/v1.png") is False

    c = app.test_client()
    hr2 = _headers(app, 5, 2, HR_TYPE, "hr@x.com")
    ok = c.post("/api/auth/upload-profile-file", data={"admin_id": "4", "field": "panFront",
                "file": (io.BytesIO(b"%PDF-1.4"), "pan.pdf")}, headers=hr2, content_type="multipart/form-data")
    assert ok.status_code == 201
    rel = ok.get_json()["path"]
    assert rel.startswith("tenants/2/profile/4_panFront_")
    assert os.path.isfile(tmp_path / "app_root" / "static" / "uploads" / rel)
    # Another company's employee id: refused (was saved under that id).
    other = c.post("/api/auth/upload-profile-file", data={"admin_id": "2", "field": "panFront",
                   "file": (io.BytesIO(b"%PDF-1.4"), "pan.pdf")}, headers=hr2, content_type="multipart/form-data")
    assert other.status_code == 404


def test_upload_path_helpers_accept_tenant_keys(app):
    from website.expense_utils import claim_attach_static_filename, claim_attach_storage_name
    from website.tax_declaration_service import _declaration_upload_dir

    assert claim_attach_storage_name("tenants/2/expenses/a.pdf") == "tenants/2/expenses/a.pdf"
    assert claim_attach_storage_name("expenses/a.pdf") == "expenses/a.pdf"
    assert claim_attach_storage_name("a.pdf") == "expenses/a.pdf"
    assert claim_attach_static_filename("tenants/2/expenses/a.pdf") == "uploads/tenants/2/expenses/a.pdf"
    assert claim_attach_static_filename("a.pdf") == "uploads/expenses/a.pdf"
    with app.app_context():
        rel, abs_dir = _declaration_upload_dir(7, 2)
        assert rel == "tenants/2/tax_declarations/7"
        assert os.path.isdir(abs_dir)


def test_upload_path_columns_widen_is_safe_on_sqlite():
    import logging

    from sqlalchemy import create_engine, text

    from website.tenant_migrations import ensure_upload_path_columns

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE expense_line_item (id INTEGER PRIMARY KEY, Attach_file VARCHAR(100))"))
    out = ensure_upload_path_columns(engine, logging.getLogger("t"))
    assert out == {
        "expense_line_item.Attach_file": False,
        "employees.photo_filename": False,
        "family_details.photo_filename": False,
    }
