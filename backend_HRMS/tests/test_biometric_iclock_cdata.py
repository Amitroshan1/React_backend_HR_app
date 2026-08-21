"""Phase 3B: /iclock/cdata log ingestion — no PunchSession / Punch writes.

Runs without importing website/__init__.py (full app). Uses an isolated Flask
+ SQLAlchemy app with only biometric tables.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from datetime import datetime, timedelta
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WEB = _ROOT / "website"
_BIO = _WEB / "biometric"


def _ensure_packages():
    if "website" not in sys.modules:
        website = types.ModuleType("website")
        website.__path__ = [str(_WEB)]
        sys.modules["website"] = website
    if "website.biometric" not in sys.modules:
        bio = types.ModuleType("website.biometric")
        bio.__path__ = [str(_BIO)]
        sys.modules["website.biometric"] = bio


def _load(mod_name: str, path: Path):
    _ensure_packages()
    full = f"website.{mod_name}" if not mod_name.startswith("website.") else mod_name
    if full in sys.modules and getattr(sys.modules[full], "__file__", None) == str(path):
        return sys.modules[full]
    spec = importlib.util.spec_from_file_location(full, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[full] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def bio_stack():
    """Isolated Flask app + biometric modules (sqlite memory)."""
    # Avoid cross-contamination with other biometric test modules
    for key in list(sys.modules):
        drop = False
        if key.startswith("website.biometric") or key in (
            "website.punch_aggregate",
            "website.punch_auto_close",
            "website.utility",
            "website.datetime_utils",
            "website.offboarding_service",
        ):
            drop = True
        if key.startswith("website.models."):
            drop = True
        if drop:
            sys.modules.pop(key, None)
    _ensure_packages()

    # datetime_utils (real file)
    dt_mod = _load("website.datetime_utils", _WEB / "datetime_utils.py")
    sys.modules["website.datetime_utils"] = dt_mod

    from flask import Flask
    from flask_sqlalchemy import SQLAlchemy

    app = Flask("biometric_phase3b_test")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["TESTING"] = True
    app.config["BIOMETRIC_DEBUG_LOG"] = True

    db = SQLAlchemy()
    website = sys.modules["website"]
    website.db = db

    # models need website.db
    models = _load("website.biometric.models", _BIO / "models.py")
    parser = _load("website.biometric.parser", _BIO / "parser.py")
    validators = _load("website.biometric.validators", _BIO / "validators.py")
    device_manager = _load("website.biometric.device_manager", _BIO / "device_manager.py")
    service = _load("website.biometric.service", _BIO / "service.py")

    # Blueprint package + routes
    bio_pkg = sys.modules["website.biometric"]
    from flask import Blueprint

    biometric_bp = Blueprint("biometric", __name__)
    bio_pkg.biometric_bp = biometric_bp

    # Load routes against our blueprint
    routes = _load("website.biometric.routes", _BIO / "routes.py")
    # Re-bind: routes imported biometric_bp from package at load time
    app.register_blueprint(biometric_bp, url_prefix="/iclock")

    db.init_app(app)
    with app.app_context():
        # Stub parent FK target so map/day_state metadata does not break DDL
        if "admins" not in db.metadata.tables:
            db.Table(
                "admins",
                db.Column("id", db.Integer, primary_key=True),
                extend_existing=True,
            )
        # Phase 3B ingest + unknown_employee path (no Punch tables)
        models.BiometricDevice.__table__.create(bind=db.engine, checkfirst=True)
        models.BiometricLog.__table__.create(bind=db.engine, checkfirst=True)
        models.BiometricEmployeeMap.__table__.create(bind=db.engine, checkfirst=True)
        models.BiometricDayState.__table__.create(bind=db.engine, checkfirst=True)

    return types.SimpleNamespace(
        app=app,
        db=db,
        models=models,
        parser=parser,
        validators=validators,
        device_manager=device_manager,
        service=service,
        routes=routes,
        BiometricDevice=models.BiometricDevice,
        BiometricLog=models.BiometricLog,
    )


@pytest.fixture
def client(bio_stack):
    with bio_stack.app.app_context():
        bio_stack.db.session.remove()
        bio_stack.db.session.execute(bio_stack.BiometricLog.__table__.delete())
        bio_stack.db.session.execute(bio_stack.BiometricDevice.__table__.delete())
        bio_stack.db.session.commit()

        # Registered device for happy-path tests
        device = bio_stack.BiometricDevice(
            serial_number="ERIS001",
            name="Test AiFace",
            is_active=True,
        )
        bio_stack.db.session.add(device)
        bio_stack.db.session.commit()

        yield bio_stack.app.test_client()


def _count_logs(bio_stack):
    return bio_stack.BiometricLog.query.count()


def _assert_no_punch_tables(bio_stack):
    """Ingest-only fixture must not create Punch / PunchSession tables."""
    names = set(bio_stack.db.metadata.tables.keys())
    assert "biometric_logs" in names
    assert "biometric_devices" in names
    assert "punch_sessions" not in names
    assert "punch" not in names


# --- Source regression: ingest layers must not call auth punch routes ---

FORBIDDEN_IN_INGEST = (
    "punch_in(",
    "punch_out(",
)


def test_regression_cdata_source_has_no_attendance_calls():
    for fname in ("service.py", "routes.py", "parser.py", "device_manager.py", "validators.py"):
        text = (_BIO / fname).read_text(encoding="utf-8")
        for bad in FORBIDDEN_IN_INGEST:
            assert bad not in text, f"{fname} must not call {bad}"
        assert "close_punch_session(" not in text
    bridge = (_BIO / "attendance_bridge.py").read_text(encoding="utf-8")
    assert "def process_biometric_log" in bridge
    assert "punch_in(" not in bridge
    assert "punch_out(" not in bridge
    assert "close_punch_session(" not in bridge
    assert "recompute_punch_aggregate(" in bridge
    assert "open_punch_session_for_admin(" in bridge
    assert "is_on_leave(" in bridge
    assert "geo_fence" not in bridge
    assert "validate_employee_location" not in bridge


def test_1_valid_single_event(client, bio_stack):
    with bio_stack.app.app_context():
        _assert_no_punch_tables(bio_stack)
        body = "1024\t2026-08-17 09:01:22\t0\t15\t0\t0"
        resp = client.post(
            "/iclock/cdata?SN=ERIS001&table=ATTLOG",
            data=body,
            content_type="text/plain",
        )
        assert resp.status_code == 200
        assert resp.data.decode("utf-8").strip().startswith("OK")
        assert _count_logs(bio_stack) == 1
        row = bio_stack.BiometricLog.query.first()
        assert row.device_user_id == "1024"
        # No employee map in this fixture → bridge marks unknown_employee (no Punch)
        assert row.status == "unknown_employee"
        assert row.admin_id is None
        assert row.punch_session_id is None
        assert "0" in (row.verification_mode or "")
        assert row.raw_payload == body


def test_2_valid_multiple_events(client, bio_stack):
    with bio_stack.app.app_context():
        body = (
            "1024\t2026-08-17 09:01:22\t0\t15\t0\t0\n"
            "1025\t2026-08-17 09:02:11\t0\t15\t0\t0\n"
            "1026\t2026-08-17 09:03:08\t0\t15\t0\t0\n"
        )
        resp = client.post("/iclock/cdata?SN=ERIS001&table=ATTLOG", data=body)
        assert resp.status_code == 200
        assert _count_logs(bio_stack) == 3
        assert all(r.punch_session_id is None for r in bio_stack.BiometricLog.query.all())
        assert all(r.admin_id is None for r in bio_stack.BiometricLog.query.all())
        assert all(r.status == "unknown_employee" for r in bio_stack.BiometricLog.query.all())


def test_3_duplicate_event(client, bio_stack):
    with bio_stack.app.app_context():
        body = "1024\t2026-08-17 09:01:22\t0\t15\t0\t0"
        r1 = client.post("/iclock/cdata?SN=ERIS001&table=ATTLOG", data=body)
        r2 = client.post("/iclock/cdata?SN=ERIS001&table=ATTLOG", data=body)
        assert r1.status_code == 200 and r2.status_code == 200
        assert _count_logs(bio_stack) == 1
        assert bio_stack.BiometricLog.query.first().status == "unknown_employee"


def test_4_unknown_device(client, bio_stack):
    with bio_stack.app.app_context():
        body = "1024\t2026-08-17 09:01:22\t0\t15\t0\t0"
        resp = client.post("/iclock/cdata?SN=UNKNOWN999&table=ATTLOG", data=body)
        assert resp.status_code == 200
        assert resp.data.decode("utf-8").strip() == "OK"
        assert _count_logs(bio_stack) == 0


def test_5_malformed_payload(client, bio_stack):
    with bio_stack.app.app_context():
        resp = client.post("/iclock/cdata?SN=ERIS001&table=ATTLOG", data="not-a-valid-line")
        assert resp.status_code == 200
        # No crash; may store 0 received rows (failed or skipped)
        received = bio_stack.BiometricLog.query.filter_by(status="received").count()
        assert received == 0


def test_6_unknown_employee_still_stored(client, bio_stack):
    """Unknown device PIN is still captured; no Admin mapping → no PunchSession."""
    with bio_stack.app.app_context():
        body = "99999\t2026-08-17 10:00:00\t0\t15\t0\t0"
        resp = client.post("/iclock/cdata?SN=ERIS001&table=ATTLOG", data=body)
        assert resp.status_code == 200
        assert _count_logs(bio_stack) == 1
        row = bio_stack.BiometricLog.query.first()
        assert row.device_user_id == "99999"
        assert row.admin_id is None
        assert row.punch_session_id is None
        assert row.status == "unknown_employee"


def test_7_offline_delayed_timestamp(client, bio_stack):
    with bio_stack.app.app_context():
        old = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")
        body = f"1024\t{old}\t0\t15\t0\t0"
        resp = client.post("/iclock/cdata?SN=ERIS001&table=ATTLOG", data=body)
        assert resp.status_code == 200
        assert _count_logs(bio_stack) == 1
        assert bio_stack.BiometricLog.query.first().status == "unknown_employee"


def test_options_handshake(client, bio_stack):
    with bio_stack.app.app_context():
        resp = client.get("/iclock/cdata?SN=ERIS001&options=all")
        assert resp.status_code == 200
        text = resp.data.decode("utf-8")
        assert "GET OPTION FROM:" in text
        assert "ATTLOGStamp" in text
        device = bio_stack.BiometricDevice.query.filter_by(serial_number="ERIS001").first()
        assert device.last_seen_at is not None
        assert _count_logs(bio_stack) == 0


def test_health_phase_3c(client):
    resp = client.get("/iclock/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["phase"] == "3C"


def test_parser_tab_and_space():
    _ensure_packages()
    dt_mod = _load("website.datetime_utils", _WEB / "datetime_utils.py")
    sys.modules["website.datetime_utils"] = dt_mod
    parser = _load("website.biometric.parser", _BIO / "parser.py")
    ev = parser.parse_attlog_line("1024\t2026-08-17 09:01:22\t0\t15\t0\t0")
    assert ev.device_user_id == "1024"
    assert ev.state == "0"
    assert ev.verification_mode == "15"
    assert ev.punch_time is not None
    assert ev.parse_error is None

    ev2 = parser.parse_attlog_line("1024 2026-08-17 09:01:22 0 15 0 0")
    assert ev2.device_user_id == "1024"
    assert ev2.punch_time is not None


def test_idempotency_distinguishes_different_scans(bio_stack):
    with bio_stack.app.app_context():
        svc = bio_stack.service
        parser = bio_stack.parser
        e1 = parser.parse_attlog_line("1024\t2026-08-17 09:01:22\t0\t15\t0\t0")
        e2 = parser.parse_attlog_line("1024\t2026-08-17 09:01:23\t0\t15\t0\t0")
        k1 = svc.make_idempotency_key("ERIS001", e1)
        k2 = svc.make_idempotency_key("ERIS001", e2)
        assert k1 != k2


def test_service_source_never_imports_attendance_bridge():
    text = (_BIO / "service.py").read_text(encoding="utf-8")
    # Lazy import inside handle_attlog_ingest is expected for Phase 3C
    assert "from .attendance_bridge import process_received_logs_for_device" in text
    assert "from ..punch" not in text
    assert "import punch_aggregate" not in text
    assert "import punch_auto_close" not in text


def test_routes_cdata_aspx_alias():
    text = (_BIO / "routes.py").read_text(encoding="utf-8")
    assert 'route("/cdata.aspx"' in text
    assert 'route("/cdata"' in text
    assert "_iclock_cdata_response()" in text
    assert text.count("_iclock_cdata_response()") >= 2


def test_aspx_operlog_no_attendance(client, bio_stack):
    """Real device sends OPERLOG to cdata.aspx — ack only, no biometric_logs/punch."""
    with bio_stack.app.app_context():
        _assert_no_punch_tables(bio_stack)
        resp = client.post(
            "/iclock/cdata.aspx?SN=ERIS001&table=OPERLOG&OpStamp=9999",
            data="",
            content_type="text/plain",
        )
        assert resp.status_code == 200
        assert resp.data.decode("utf-8").strip() == "OK"
        assert _count_logs(bio_stack) == 0
        device = bio_stack.BiometricDevice.query.filter_by(serial_number="ERIS001").first()
        assert device.last_seen_at is not None


def test_aspx_attlog_same_as_cdata(client, bio_stack):
    with bio_stack.app.app_context():
        body = "1024\t2026-08-17 09:01:22\t0\t15\t0\t0"
        resp = client.post(
            "/iclock/cdata.aspx?SN=ERIS001&table=ATTLOG",
            data=body,
            content_type="text/plain",
        )
        assert resp.status_code == 200
        assert resp.data.decode("utf-8").strip().startswith("OK")
        assert _count_logs(bio_stack) == 1
        assert bio_stack.BiometricLog.query.first().status == "unknown_employee"


def test_aspx_get_heartbeat(client, bio_stack):
    with bio_stack.app.app_context():
        resp = client.get("/iclock/cdata.aspx?SN=ERIS001")
        assert resp.status_code == 200
        assert resp.data.decode("utf-8").strip() == "OK"
        device = bio_stack.BiometricDevice.query.filter_by(serial_number="ERIS001").first()
        assert device.last_seen_at is not None


def test_aspx_duplicate_attlog(client, bio_stack):
    with bio_stack.app.app_context():
        body = "1024\t2026-08-17 09:01:22\t0\t15\t0\t0"
        r1 = client.post("/iclock/cdata.aspx?SN=ERIS001&table=ATTLOG", data=body)
        r2 = client.post("/iclock/cdata.aspx?SN=ERIS001&table=ATTLOG", data=body)
        assert r1.status_code == 200 and r2.status_code == 200
        assert _count_logs(bio_stack) == 1


def test_aspx_unknown_employee_attlog(client, bio_stack):
    with bio_stack.app.app_context():
        body = "EMP99999\t2026-08-17 10:00:00\t0\t15\t0\t0"
        resp = client.post("/iclock/cdata.aspx?SN=ERIS001&table=ATTLOG", data=body)
        assert resp.status_code == 200
        assert _count_logs(bio_stack) == 1
        row = bio_stack.BiometricLog.query.first()
        assert row.status == "unknown_employee"
        assert row.punch_session_id is None


def test_heartbeat_updates_last_seen_not_data_push(client, bio_stack):
    with bio_stack.app.app_context():
        resp = client.get("/iclock/cdata.aspx?SN=ERIS001")
        assert resp.status_code == 200
        device = bio_stack.BiometricDevice.query.filter_by(serial_number="ERIS001").first()
        assert device.last_seen_at is not None
        assert device.last_data_push_at is None


def test_empty_attlog_heartbeat_does_not_set_data_push(client, bio_stack):
    with bio_stack.app.app_context():
        resp = client.post(
            "/iclock/cdata?SN=ERIS001&table=ATTLOG",
            data="",
            content_type="text/plain",
        )
        assert resp.status_code == 200
        device = bio_stack.BiometricDevice.query.filter_by(serial_number="ERIS001").first()
        assert device.last_seen_at is not None
        assert device.last_data_push_at is None


def test_attlog_sets_last_data_push_at(client, bio_stack):
    with bio_stack.app.app_context():
        body = "1024\t2026-08-17 09:01:22\t0\t15\t0\t0"
        resp = client.post("/iclock/cdata?SN=ERIS001&table=ATTLOG", data=body)
        assert resp.status_code == 200
        assert _count_logs(bio_stack) == 1
        device = bio_stack.BiometricDevice.query.filter_by(serial_number="ERIS001").first()
        assert device.last_seen_at is not None
        assert device.last_data_push_at is not None
        assert device.last_data_push_at == device.last_seen_at

