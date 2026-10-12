"""Module rollout — Queries, notifications / news feed and biometric stay inside one tenant."""
import importlib
import logging
import pkgutil
from datetime import date, datetime, timedelta

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token, verify_jwt_in_request
from sqlalchemy import create_engine, inspect, text

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    # confirmation_request references a Signup model that is not defined.
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.biometric.models import BiometricAttendanceDay, BiometricDevice, BiometricLog  # noqa: E402
from website.models.Admin_models import Admin  # noqa: E402
from website.models.news_feed import NewsFeed  # noqa: E402
from website.models.notification import Notification  # noqa: E402
from website.models.query import Query  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

HR_TYPE = "Human Resource"
TODAY = date.today()
SCAN_DAY = date(2026, 8, 20)


@pytest.fixture()
def app():
    from website.auth import auth
    from website.biometric.hr_views import biometric_hr_bp
    from website.Human_resource import hr
    from website.query import query

    app = Flask("tenancy_queries_biometric_module")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-queries-biometric-secret-32",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(auth, url_prefix="/api/auth")
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(query, url_prefix="/api/query")
    app.register_blueprint(biometric_hr_bp, url_prefix="/api/hr/biometric")

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
        ])
        common = dict(circle="NHQ", is_active=True, is_exited=False, doj=TODAY - timedelta(days=400))
        # Same HR email and emp_ids in both tenants; employee emails differ so recipients are visible.
        db.session.add_all([
            Admin(id=1, tenant_id=1, email="hr@x.com", emp_id="H1", first_name="One HR", emp_type=HR_TYPE, **common),
            Admin(id=2, tenant_id=1, email="alpha@x.com", emp_id="E1", first_name="Alpha Dev", emp_type="Engineering", **common),
            Admin(id=3, tenant_id=2, email="hr@x.com", emp_id="H1", first_name="Two HR", emp_type=HR_TYPE, **common),
            Admin(id=4, tenant_id=2, email="beta@x.com", emp_id="E1", first_name="Beta Dev", emp_type="Engineering",
                  circle="NHQ", is_active=True, is_exited=False, doj=TODAY.replace(year=TODAY.year - 2)),
        ])
        db.session.flush()
        db.session.add_all([
            Query(id=20, admin_id=2, title="Payslip", department=HR_TYPE, query_text="Missing payslip", status="New"),
            Query(id=40, admin_id=4, title="Payslip", department=HR_TYPE, query_text="Missing payslip", status="New"),
            NewsFeed(id=20, tenant_id=1, title="Holiday", content="Office closed", circle="All", emp_type="All"),
            NewsFeed(id=40, tenant_id=2, title="Townhall", content="Friday", circle="All", emp_type="All"),
            BiometricDevice(id=1, serial_number="DEV-ONE", name="One", is_active=True),
            BiometricDevice(id=2, tenant_id=2, serial_number="DEV-TWO", name="Two", is_active=True),
        ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _token(app, admin_id, tenant_id, emp_type, email):
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": email, "emp_type": emp_type, "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


def _hr(app, tenant_id):
    return _token(app, 1 if tenant_id == 1 else 3, tenant_id, HR_TYPE, "hr@x.com")


def _emp(app, tenant_id):
    return _token(
        app, 2 if tenant_id == 1 else 4, tenant_id, "Engineering", "alpha@x.com" if tenant_id == 1 else "beta@x.com"
    )


# --- Queries ---------------------------------------------------------------


def test_department_inbox_lists_only_own_tenant_queries(app):
    c = app.test_client()
    rows = c.get("/api/query/queries", headers=_hr(app, 1)).get_json()["queries"]
    assert [r["id"] for r in rows] == [20]
    rows = c.get("/api/query/queries", headers=_hr(app, 2)).get_json()["queries"]
    assert [r["id"] for r in rows] == [40]


def test_other_tenant_query_returns_404(app):
    c = app.test_client()
    h = _hr(app, 1)
    assert c.get("/api/query/queries/40", headers=h).status_code == 404
    assert c.post("/api/query/queries/40/reply", json={"reply_text": "Looking"}, headers=h).status_code == 404
    assert c.post("/api/query/queries/40/close", headers=h).status_code == 404
    assert c.post("/api/query/queries/40/mark-read", headers=h).status_code == 404
    assert c.get("/api/query/queries/20", headers=h).status_code == 200
    with app.app_context():
        assert db.session.get(Query, 40).status == "New"


def test_new_query_notifies_only_own_tenant_department(app):
    c = app.test_client()
    resp = c.post(
        "/api/query/queries",
        json={"title": "Laptop slow", "departments": [HR_TYPE], "query_text": "Please help"},
        headers=_emp(app, 2),
    )
    assert resp.status_code == 201, resp.get_json()
    with app.app_context():
        assert [n.recipient_admin_id for n in Notification.query.all()] == [3]


# --- News feed -------------------------------------------------------------


def test_news_feed_history_and_delete_are_tenant_scoped(app):
    c = app.test_client()
    items = c.get("/api/HumanResource/news-feed", headers=_hr(app, 1)).get_json()["items"]
    assert [i["id"] for i in items] == [20]
    assert c.delete("/api/HumanResource/news-feed/40", headers=_hr(app, 1)).status_code == 404

    resp = c.post("/api/HumanResource/news-feed", data={"title": "Offsite", "content": "Goa", "circle": "All", "emp_type": "All"}, headers=_hr(app, 2))
    assert resp.status_code == 201
    with app.app_context():
        assert db.session.get(NewsFeed, 40) is not None
        assert db.session.get(NewsFeed, resp.get_json()["news_feed"]["id"]).tenant_id == 2


def test_employee_dashboard_feed_is_tenant_scoped(app):
    c = app.test_client()
    items = c.get("/api/auth/news-feed", headers=_emp(app, 1)).get_json()["news_feed"]
    ids = {str(i["id"]) for i in items}
    assert "20" in ids and "40" not in ids
    # Same circle, but admin 4's work anniversary belongs to the other company.
    assert "anniversary-4" not in ids
    items = c.get("/api/auth/news-feed", headers=_emp(app, 2)).get_json()["news_feed"]
    assert "anniversary-4" in {str(i["id"]) for i in items}


def test_announcement_email_recipients_are_tenant_scoped(app):
    from website.email import news_feed_employee_emails

    with app.test_request_context(headers=_hr(app, 2)):
        verify_jwt_in_request()
        assert news_feed_employee_emails("All", "All") == ["beta@x.com", "hr@x.com"]


# --- Biometric -------------------------------------------------------------


def test_device_pin_resolves_to_device_tenant_employee(app):
    from website.biometric.mapping import resolve_biometric_employee

    with app.app_context():
        # emp_id E1 exists in both tenants; before scoping this was ambiguous and the punch was dropped.
        assert resolve_biometric_employee("E1", device_id=1).admin_id == 2
        assert resolve_biometric_employee("E1", device_id=2).admin_id == 4
        assert resolve_biometric_employee("E1", device_id=None).admin_id == 2


def _ingest_same_pin_on_both_devices(app):
    from website.biometric.day_rollup import upsert_attendance_day_from_log

    with app.app_context():
        for i, (serial, admin_id) in enumerate((("DEV-ONE", 2), ("DEV-TWO", 4)), start=1):
            log = BiometricLog(
                device_serial_number=serial, device_user_id="E1", admin_id=admin_id,
                punch_time=datetime.combine(SCAN_DAY, datetime.min.time()) + timedelta(hours=9, minutes=i),
                status="processed", idempotency_key=f"key-{i}",
            )
            db.session.add(log)
            db.session.flush()
            upsert_attendance_day_from_log(log)
        db.session.add(BiometricLog(
            device_serial_number="DEV-TWO", device_user_id="777",
            punch_time=datetime.combine(SCAN_DAY, datetime.min.time()) + timedelta(hours=10),
            status="unknown_employee", idempotency_key="key-unmapped",
        ))
        db.session.commit()


def test_read_model_keeps_same_pin_apart_per_tenant(app):
    _ingest_same_pin_on_both_devices(app)
    with app.app_context():
        rows = BiometricAttendanceDay.query.order_by(BiometricAttendanceDay.tenant_id).all()
        assert [(r.tenant_id, r.admin_id, r.device_user_id) for r in rows] == [(1, 2, "E1"), (2, 4, "E1")]


def test_biometric_hr_views_are_tenant_scoped(app):
    _ingest_same_pin_on_both_devices(app)
    c = app.test_client()
    h1, h2 = _hr(app, 1), _hr(app, 2)

    rows = c.get(f"/api/hr/biometric/summary?date={SCAN_DAY}", headers=h2).get_json()["rows"]
    assert [(r["admin_id"], r["employee_name"]) for r in rows] == [(4, "Beta Dev")]
    devices = c.get("/api/hr/biometric/devices", headers=h1).get_json()["devices"]
    assert [d["serial_number"] for d in devices] == ["DEV-ONE"]

    assert c.get(f"/api/hr/biometric/employee/2/day/{SCAN_DAY}", headers=h2).status_code == 404
    scans = c.get(f"/api/hr/biometric/employee/4/day/{SCAN_DAY}", headers=h2).get_json()["scans"]
    assert [s["device_serial_number"] for s in scans] == ["DEV-TWO"]

    unmapped = c.get(f"/api/hr/biometric/unmapped/777/day/{SCAN_DAY}", headers=h1).get_json()["scans"]
    assert unmapped == []
    unmapped = c.get(f"/api/hr/biometric/unmapped/777/day/{SCAN_DAY}", headers=h2).get_json()["scans"]
    assert len(unmapped) == 1


# --- Migrations ------------------------------------------------------------


def test_biometric_and_news_feed_tenant_migration():
    from website.tenant_migrations import ensure_biometric_tenant_ids, ensure_news_feed_tenant_id

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        for ddl in (
            "CREATE TABLE admins (id INTEGER PRIMARY KEY, tenant_id INTEGER)",
            "CREATE TABLE biometric_devices (id INTEGER PRIMARY KEY, serial_number TEXT)",
            "CREATE TABLE biometric_attendance_day (id INTEGER PRIMARY KEY, admin_id INTEGER, "
            "device_user_id TEXT, attendance_date DATE)",
            "CREATE UNIQUE INDEX uq_bio_att_day_pin_date ON biometric_attendance_day (device_user_id, attendance_date)",
            "CREATE TABLE news_feeds (id INTEGER PRIMARY KEY, title TEXT)",
        ):
            conn.execute(text(ddl))
        conn.execute(text("INSERT INTO admins VALUES (2, 1), (4, 2)"))
        conn.execute(text("INSERT INTO biometric_devices VALUES (1, 'DEV-ONE')"))
        conn.execute(text(
            "INSERT INTO biometric_attendance_day VALUES "
            "(1, 2, 'E1', '2026-08-20'), (2, 4, 'E2', '2026-08-20'), (3, NULL, '777', '2026-08-20')"
        ))
        conn.execute(text("INSERT INTO news_feeds VALUES (1, 'Holiday')"))

    log = logging.getLogger("test")
    first = ensure_biometric_tenant_ids(engine, log)
    assert first["biometric_devices"] == {"added": True, "backfilled": 1}
    assert first["unique"] == {"created": True, "dropped": ["uq_bio_att_day_pin_date"], "skipped": None}
    assert ensure_news_feed_tenant_id(engine, log) == {"added": True, "backfilled": 1}

    with engine.connect() as conn:
        days = [tuple(r) for r in conn.execute(text("SELECT id, tenant_id FROM biometric_attendance_day ORDER BY id"))]
        # The same PIN + date can now exist once per tenant.
        conn.execute(text(
            "INSERT INTO biometric_attendance_day (id, tenant_id, admin_id, device_user_id, attendance_date) "
            "VALUES (4, 2, 4, 'E1', '2026-08-20')"
        ))
    assert days == [(1, 1), (2, 2), (3, 1)]
    uniques = [ix["column_names"] for ix in inspect(engine).get_indexes("biometric_attendance_day") if ix["unique"]]
    assert uniques == [["tenant_id", "device_user_id", "attendance_date"]]

    again = ensure_biometric_tenant_ids(engine, log)
    assert again["unique"] == {"created": False, "dropped": [], "skipped": None}
    assert again["biometric_attendance_day"] == {"added": False, "backfilled": 0}


def test_unassigned_device_can_be_claimed_and_only_platform_can_move_it(app):
    from website.biometric.models import BiometricDevice

    with app.app_context():
        db.session.add(BiometricDevice(id=9, serial_number="DEV-FREE", name="Free", is_active=True))
        db.session.commit()
    client = app.test_client()
    claimed = client.post(
        "/api/hr/biometric/devices/claim",
        json={"serial_number": "DEV-FREE"},
        headers=_hr(app, 2),
    )
    assert claimed.status_code == 200
    assert claimed.get_json()["device"]["tenant_id"] == 2
    assert client.post(
        "/api/hr/biometric/devices/claim",
        json={"serial_number": "DEV-TWO"},
        headers=_hr(app, 1),
    ).status_code == 404
    assert client.patch(
        "/api/hr/biometric/devices/2", json={"tenant_id": 1}, headers=_hr(app, 2)
    ).status_code == 403
    assert client.patch(
        "/api/hr/biometric/devices/9", json={"tenant_id": 1}, headers=_hr(app, 1)
    ).status_code == 404
    moved = client.patch(
        "/api/hr/biometric/devices/1", json={"tenant_id": 2}, headers=_hr(app, 1)
    )
    assert moved.status_code == 200
    assert moved.get_json()["device"]["tenant_id"] == 2
