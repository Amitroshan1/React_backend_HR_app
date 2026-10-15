"""
Phase 6: background jobs for mass emails, bulk exports, recalculations.

BACKGROUND_JOBS off → async=1 is ignored (sync behaviour).
BACKGROUND_JOBS on  → async=1 returns a job ID; worker/process_job finishes it.
"""
import importlib
import pkgutil
from datetime import date

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin  # noqa: E402
from website.models.background_job import BackgroundJob  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402


@pytest.fixture()
def app(tmp_path, monkeypatch):
    from website.Accounts import Accounts
    from website.Human_resource import hr
    from website.jobs_api import jobs_bp
    from website import jobs

    monkeypatch.setenv("BACKGROUND_JOBS", "1")
    jobs.configure_app  # noqa: B018 — ensure import

    app = Flask("phase6_jobs")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="phase6-jobs-secret-key-32-bytes!!!!",
        TESTING=True,
        BACKGROUND_JOBS=True,
        BACKGROUND_JOBS_BATCH=20,
        UPLOADS_ROOT=str(tmp_path),
        UPLOAD_FOLDER=str(tmp_path),
        ZEPTO_SENDER_EMAIL="hr@example.com",
        ZEPTO_CC_HR="hr@example.com",
        ZEPTO_SENDER_NAME="HR",
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(Accounts, url_prefix="/api/accounts")
    app.register_blueprint(jobs_bp, url_prefix="/api/jobs")

    # Run queued work inline in tests (no race with daemon threads).
    def _sync_kick(job_id):
        jobs.process_job(int(job_id))

    monkeypatch.setattr(jobs, "kick_job", _sync_kick)

    with app.app_context():
        db.create_all()
        db.session.add(Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"))
        db.session.add(Admin(
            id=2, tenant_id=1, email="hr@one.com", emp_id="H1", first_name="Hema",
            emp_type="Human Resource", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=3, tenant_id=1, email="acc@one.com", emp_id="A1", first_name="Ada",
            emp_type="Accounts", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.add(Admin(
            id=4, tenant_id=1, email="emp@one.com", emp_id="E1", first_name="Eve",
            emp_type="Engineering", circle="NHQ", is_active=True, is_exited=False, doj=date(2024, 1, 1),
        ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _headers(app, admin_id, email, emp_type):
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": email, "emp_type": emp_type, "tenant_id": 1},
        )
    return {"Authorization": f"Bearer {token}"}


def _hr(app):
    return _headers(app, 2, "hr@one.com", "Human Resource")


def _acc(app):
    return _headers(app, 3, "acc@one.com", "Accounts")


def test_want_async_respects_flag(app, monkeypatch):
    from website import jobs

    with app.test_request_context("/x?async=1"):
        app.config["BACKGROUND_JOBS"] = True
        assert jobs.want_async() is True
        app.config["BACKGROUND_JOBS"] = False
        assert jobs.want_async() is False


def test_news_feed_async_queues_email(app, monkeypatch):
    from website import jobs

    sent = {}

    def fake_send(**kwargs):
        sent.update(kwargs)
        return True, "ok", 2

    monkeypatch.setattr("website.email.send_news_feed_announcement_email", fake_send)
    monkeypatch.setattr("website.Human_resource.send_news_feed_announcement_email", fake_send)

    client = app.test_client()
    resp = client.post(
        "/api/HumanResource/news-feed",
        data={
            "title": "Hello",
            "content": "World",
            "circle": "NHQ",
            "emp_type": "all",
            "send_email": "true",
            "async": "1",
        },
        headers=_hr(app),
    )
    assert resp.status_code == 201, resp.get_json()
    body = resp.get_json()
    assert body["async"] is True
    assert body["job_id"]
    assert "queued" in (body["message"] or "").lower()

    with app.app_context():
        job = db.session.get(BackgroundJob, body["job_id"])
        assert job is not None
        assert job.kind == jobs.KIND_NEWS_FEED_EMAIL
        assert job.status == jobs.STATUS_SUCCEEDED
        assert sent.get("title") == "Hello"

    status = client.get(f"/api/jobs/{body['job_id']}", headers=_hr(app))
    assert status.status_code == 200
    assert status.get_json()["job"]["status"] == "succeeded"


def test_news_feed_sync_when_jobs_disabled(app, monkeypatch):
    sent = {"n": 0}

    def fake_send(**kwargs):
        sent["n"] += 1
        return True, "ok", 1

    monkeypatch.setattr("website.Human_resource.send_news_feed_announcement_email", fake_send)
    app.config["BACKGROUND_JOBS"] = False

    client = app.test_client()
    resp = client.post(
        "/api/HumanResource/news-feed",
        data={
            "title": "Sync",
            "content": "Now",
            "circle": "NHQ",
            "emp_type": "all",
            "send_email": "true",
            "async": "1",
        },
        headers=_hr(app),
    )
    assert resp.status_code == 201, resp.get_json()
    body = resp.get_json()
    assert "job_id" not in body
    assert sent["n"] == 1


def test_pf_ecr_async_export_and_download(app, monkeypatch):
    from website import jobs

    def fake_build(**kwargs):
        return {
            "year": kwargs["year"],
            "month_num": kwargs["month_num"],
            "month_name": "January",
            "row_count": 1,
            "lines": [{"uan": "1"}],
            "csv": "uan,name\n1,Ada\n",
        }

    monkeypatch.setattr("website.Accounts.build_pf_ecr_export", fake_build)
    monkeypatch.setattr("website.compliance_export_service.build_pf_ecr_export", fake_build)

    client = app.test_client()
    resp = client.get(
        "/api/accounts/compliance/pf-ecr?year=2026&month=1&async=1",
        headers=_acc(app),
    )
    assert resp.status_code == 202, resp.get_json()
    body = resp.get_json()
    assert body["async"] is True
    job_id = body["job_id"]

    with app.app_context():
        job = db.session.get(BackgroundJob, job_id)
        assert job.status == jobs.STATUS_SUCCEEDED

    status = client.get(f"/api/jobs/{job_id}", headers=_acc(app)).get_json()
    assert status["job"]["result"]["row_count"] == 1
    assert status["job"]["result"]["download_path"]

    dl = client.get(f"/api/jobs/{job_id}/download", headers=_acc(app))
    assert dl.status_code == 200
    assert b"uan,name" in dl.data


def test_tds_recalculate_async(app, monkeypatch):
    from website import jobs

    calls = []

    def fake_recalc(admin_id, financial_year):
        calls.append((admin_id, financial_year))
        return 2

    monkeypatch.setattr(
        "website.payroll_tds_service.recalculate_payroll_tds_for_financial_year",
        fake_recalc,
    )

    client = app.test_client()
    resp = client.post(
        "/api/accounts/tds/recalculate",
        json={"financial_year": "2025-26", "async": True},
        headers=_acc(app),
    )
    assert resp.status_code == 202, resp.get_json()
    job_id = resp.get_json()["job_id"]

    with app.app_context():
        job = db.session.get(BackgroundJob, job_id)
        assert job.status == jobs.STATUS_SUCCEEDED
        # All three seeded admins
        assert len(calls) == 3

    status = client.get(f"/api/jobs/{job_id}", headers=_acc(app)).get_json()
    assert status["job"]["result"]["updated_rows"] == 6
    assert status["job"]["result"]["employees"] == 3


def test_tds_recalculate_sync(app, monkeypatch):
    monkeypatch.setattr(
        "website.payroll_tds_service.recalculate_payroll_tds_for_financial_year",
        lambda admin_id, financial_year: 1,
    )
    client = app.test_client()
    resp = client.post(
        "/api/accounts/tds/recalculate",
        json={"financial_year": "2025-26", "admin_id": 4},
        headers=_acc(app),
    )
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["success"] is True
    assert body["result"]["updated_rows"] == 1
    assert body["result"]["scoped_admin_id"] == 4


def test_process_pending_drains_queue(app, monkeypatch):
    from website import jobs

    monkeypatch.setattr(jobs, "kick_job", lambda job_id: None)
    monkeypatch.setattr(
        "website.payroll_tds_service.recalculate_payroll_tds_for_financial_year",
        lambda *a, **k: 0,
    )

    with app.app_context():
        job = jobs.enqueue(
            jobs.KIND_PAYROLL_TDS_RECALC,
            {"financial_year": "2025-26", "admin_id": 4},
            tenant_id=1,
            requested_by_admin_id=3,
            kick=False,
        )
        assert job.status == jobs.STATUS_PENDING
        n = jobs.process_pending(limit=5)
        assert n == 1
        db.session.refresh(job)
        assert job.status == jobs.STATUS_SUCCEEDED


def test_job_isolation_across_tenants(app):
    from website import jobs

    client = app.test_client()
    with app.app_context():
        other = BackgroundJob(
            tenant_id=99,
            kind=jobs.KIND_NEWS_FEED_EMAIL,
            status=jobs.STATUS_SUCCEEDED,
            payload_json="{}",
            result_json='{"ok": true}',
        )
        db.session.add(other)
        db.session.commit()
        other_id = other.id

    resp = client.get(f"/api/jobs/{other_id}", headers=_hr(app))
    assert resp.status_code == 404
