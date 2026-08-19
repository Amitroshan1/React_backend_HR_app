"""NHQ biometric 8 PM finalization, scope isolation, and bridge guards."""

from __future__ import annotations

import importlib.util
import os
import sys
import types
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WEB = _ROOT / "website"
_BIO = _WEB / "biometric"

NHQ_SN = "NES1254800218"
OTHER_SN = "OTHER0001"
PIN = "EMP00125"
DAY = date(2026, 8, 19)


def _ensure_packages():
    if "website" not in sys.modules:
        website = types.ModuleType("website")
        website.__path__ = [str(_WEB)]
        sys.modules["website"] = website
    if "website.biometric" not in sys.modules:
        bio = types.ModuleType("website.biometric")
        bio.__path__ = [str(_BIO)]
        sys.modules["website.biometric"] = bio
    if "website.models" not in sys.modules:
        models_pkg = types.ModuleType("website.models")
        models_pkg.__path__ = [str(_WEB / "models")]
        sys.modules["website.models"] = models_pkg


def _load(full: str, path: Path):
    _ensure_packages()
    spec = importlib.util.spec_from_file_location(full, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[full] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def stack():
    for key in list(sys.modules):
        if key.startswith("website."):
            if key.startswith("website.biometric") or key in (
                "website.punch_aggregate",
                "website.punch_auto_close",
                "website.manager_utils",
                "website.models.attendance",
                "website.models.Admin_models",
                "website.offboarding_service",
                "website.utility",
                "website.attendance_realtime.models",
                "website.attendance_realtime.publisher",
            ):
                del sys.modules[key]
    _ensure_packages()

    _load("website.datetime_utils", _WEB / "datetime_utils.py")

    from flask import Flask, Blueprint
    from flask_sqlalchemy import SQLAlchemy

    app = Flask("biometric_finalize_test")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["TESTING"] = True
    app.config["BIOMETRIC_NHQ_SERIALS"] = NHQ_SN

    db = SQLAlchemy()
    sys.modules["website"].db = db

    mgr = types.ModuleType("website.manager_utils")

    def _norm_circle(value):
        return (value or "").strip().lower()

    def circles_equivalent(a, b):
        return _norm_circle(a) == _norm_circle(b)

    mgr.circles_equivalent = circles_equivalent
    sys.modules["website.manager_utils"] = mgr

    class Admin(db.Model):
        __tablename__ = "admins"
        id = db.Column(db.Integer, primary_key=True)
        email = db.Column(db.String(120), nullable=True)
        emp_id = db.Column(db.String(10), nullable=True)
        first_name = db.Column(db.String(150), nullable=True)
        circle = db.Column(db.String(50), nullable=True)
        is_active = db.Column(db.Boolean, nullable=True, default=True)
        is_exited = db.Column(db.Boolean, nullable=True, default=False)
        punch_records = db.relationship("Punch", back_populates="admin")
        leave_applications = db.relationship(
            "LeaveApplication",
            foreign_keys="LeaveApplication.admin_id",
            back_populates="admin",
        )

    admin_models = types.ModuleType("website.models.Admin_models")
    admin_models.Admin = Admin
    sys.modules["website.models.Admin_models"] = admin_models

    off = types.ModuleType("website.offboarding_service")

    def admin_login_allowed(admin):
        return admin is not None and getattr(admin, "is_active", True) is not False

    off.admin_login_allowed = admin_login_allowed
    sys.modules["website.offboarding_service"] = off

    class Punch(db.Model):
        __tablename__ = "punch"
        id = db.Column(db.Integer, primary_key=True)
        admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False)
        punch_date = db.Column(db.Date, nullable=False)
        punch_in = db.Column(db.DateTime, nullable=True)
        punch_out = db.Column(db.DateTime, nullable=True)
        today_work = db.Column(db.String(20), nullable=True)
        admin = db.relationship("Admin", back_populates="punch_records")
        sessions = db.relationship(
            "PunchSession", back_populates="punch", cascade="all, delete-orphan"
        )

    class PunchSession(db.Model):
        __tablename__ = "punch_sessions"
        id = db.Column(db.Integer, primary_key=True)
        punch_id = db.Column(
            db.Integer, db.ForeignKey("punch.id", ondelete="CASCADE"), nullable=False
        )
        clock_in = db.Column(db.DateTime, nullable=False)
        clock_out = db.Column(db.DateTime, nullable=True)
        repeat_reason = db.Column(db.String(500), nullable=True)
        extended_hours_reason = db.Column(db.String(500), nullable=True)
        auto_punched_out = db.Column(db.Boolean, nullable=False, default=False)
        is_wfh = db.Column(db.Boolean, nullable=False, default=False)
        lat = db.Column(db.Float, nullable=True)
        lon = db.Column(db.Float, nullable=True)
        location_status = db.Column(db.String(30), nullable=True)
        location_status_in = db.Column(db.String(30), nullable=True)
        location_status_out = db.Column(db.String(30), nullable=True)
        source = db.Column(db.String(20), nullable=True)
        closed_by = db.Column(db.String(20), nullable=True)
        punch = db.relationship("Punch", back_populates="sessions")

    class LeaveApplication(db.Model):
        __tablename__ = "leave_applications"
        id = db.Column(db.Integer, primary_key=True)
        admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False)
        leave_type = db.Column(db.String(50), nullable=False)
        reason = db.Column(db.String(255), nullable=False)
        start_date = db.Column(db.Date, nullable=False)
        end_date = db.Column(db.Date, nullable=False)
        status = db.Column(db.String(20), nullable=False, default="Pending")
        created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)
        admin = db.relationship(
            "Admin", foreign_keys=[admin_id], back_populates="leave_applications"
        )

    att = types.ModuleType("website.models.attendance")
    att.Punch = Punch
    att.PunchSession = PunchSession
    att.LeaveApplication = LeaveApplication
    att.CompOffGain = type("CompOffGain", (), {})
    att.Location = type("Location", (), {})
    att.LeaveBalance = type("LeaveBalance", (), {})
    att.WorkFromHomeApplication = type("WorkFromHomeApplication", (), {})
    sys.modules["website.models.attendance"] = att

    util = types.ModuleType("website.utility")
    util.is_on_leave = lambda admin_id, today: False
    sys.modules["website.utility"] = util

    punch_agg = _load("website.punch_aggregate", _WEB / "punch_aggregate.py")
    punch_auto = _load("website.punch_auto_close", _WEB / "punch_auto_close.py")
    bio_models = _load("website.biometric.models", _BIO / "models.py")
    _load("website.biometric.validators", _BIO / "validators.py")
    mapping = _load("website.biometric.mapping", _BIO / "mapping.py")
    scope = _load("website.biometric.scope", _BIO / "scope.py")
    finalization = _load("website.biometric.finalization", _BIO / "finalization.py")
    _load("website.biometric.parser", _BIO / "parser.py")
    _load("website.biometric.device_manager", _BIO / "device_manager.py")
    bridge = _load("website.biometric.attendance_bridge", _BIO / "attendance_bridge.py")
    rt_pkg = types.ModuleType("website.attendance_realtime")
    rt_pkg.__path__ = [str(_WEB / "attendance_realtime")]
    sys.modules["website.attendance_realtime"] = rt_pkg
    hooks_stub = types.ModuleType("website.attendance_realtime.hooks")
    hooks_stub.register_session_hooks = lambda: None
    sys.modules["website.attendance_realtime.hooks"] = hooks_stub
    rt_models = _load(
        "website.attendance_realtime.models",
        _WEB / "attendance_realtime" / "models.py",
    )
    _load("website.attendance_realtime.hub", _WEB / "attendance_realtime" / "hub.py")
    publisher = _load(
        "website.attendance_realtime.publisher",
        _WEB / "attendance_realtime" / "publisher.py",
    )

    bio_pkg = sys.modules["website.biometric"]
    biometric_bp = Blueprint("biometric", __name__)
    bio_pkg.biometric_bp = biometric_bp
    service = _load("website.biometric.service", _BIO / "service.py")
    _load("website.biometric.routes", _BIO / "routes.py")
    app.register_blueprint(biometric_bp, url_prefix="/iclock")

    db.init_app(app)
    with app.app_context():
        db.create_all()
        rt_models.AttendanceRealtimeEvent.__table__.create(
            bind=db.engine, checkfirst=True
        )
        publisher.register_session_hooks()

    return types.SimpleNamespace(
        app=app,
        db=db,
        Admin=Admin,
        Punch=Punch,
        PunchSession=PunchSession,
        LeaveApplication=LeaveApplication,
        BiometricDevice=bio_models.BiometricDevice,
        BiometricLog=bio_models.BiometricLog,
        BiometricDayState=bio_models.BiometricDayState,
        BiometricEmployeeMap=bio_models.BiometricEmployeeMap,
        bridge=bridge,
        scope=scope,
        finalization=finalization,
        punch_agg=punch_agg,
        punch_auto=punch_auto,
        service=service,
        publisher=publisher,
        rt_models=rt_models,
    )


def _att(ts: str, pin: str = PIN) -> str:
    return f"{pin}\t{ts}\t0\t15\t0\t0"


def _post(client, line: str, sn: str = NHQ_SN):
    return client.post(f"/iclock/cdata?SN={sn}&table=ATTLOG", data=line)


def _seed_nhq_admin(stack, *, circle="NHQ", admin_id=42):
    admin = stack.Admin(
        id=admin_id,
        email=f"u{admin_id}@test.local",
        emp_id=PIN,
        first_name="Test",
        circle=circle,
        is_active=True,
    )
    stack.db.session.add(admin)
    dev = stack.BiometricDevice(
        serial_number=NHQ_SN, name="AiFace ERIS", is_active=True
    )
    stack.db.session.add(dev)
    stack.db.session.commit()
    return admin


@pytest.fixture
def client(stack):
    with stack.app.app_context():
        for model in (
            stack.rt_models.AttendanceRealtimeEvent,
            stack.BiometricLog,
            stack.BiometricDayState,
            stack.BiometricEmployeeMap,
            stack.BiometricDevice,
            stack.PunchSession,
            stack.Punch,
            stack.LeaveApplication,
            stack.Admin,
        ):
            stack.db.session.execute(model.__table__.delete())
        stack.db.session.commit()
        _seed_nhq_admin(stack)
        yield stack.app.test_client()


def test_first_scan_creates_biometric_in(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        sess = stack.PunchSession.query.first()
        assert sess.clock_out is None
        assert (sess.source or "") == "biometric"


def test_subsequent_scans_no_immediate_out(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        _post(client, _att("2026-08-19 12:00:00"))
        _post(client, _att("2026-08-19 17:00:00"))
        sess = stack.PunchSession.query.first()
        assert sess.clock_out is None
        day = stack.BiometricDayState.query.first()
        assert day.last_scan_at == datetime(2026, 8, 19, 17, 0, 0)


def test_finalize_selects_latest_scan(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        _post(client, _att("2026-08-19 12:00:00"))
        _post(client, _att("2026-08-19 17:30:00"))
        res = stack.finalization.finalize_biometric_day(42, DAY)
        stack.db.session.commit()
        assert res["finalized"] is True
        sess = stack.PunchSession.query.first()
        assert sess.clock_out == datetime(2026, 8, 19, 17, 30, 0)
        assert (sess.closed_by or "") == "biometric"
        assert stack.BiometricDayState.query.first().status == "finalized"


def test_exact_2000_scan_included(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        _post(client, _att("2026-08-19 20:00:00"))
        stack.finalization.finalize_biometric_day(42, DAY)
        stack.db.session.commit()
        assert stack.PunchSession.query.first().clock_out == datetime(2026, 8, 19, 20, 0, 0)


def test_2001_scan_excluded_from_out(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        _post(client, _att("2026-08-19 17:00:00"))
        _post(client, _att("2026-08-19 20:00:01"))
        res = stack.finalization.finalize_biometric_day(42, DAY)
        stack.db.session.commit()
        assert res["finalized"] is True
        assert stack.PunchSession.query.first().clock_out == datetime(2026, 8, 19, 17, 0, 0)


def test_same_timestamp_highest_log_id_wins(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        _post(client, _att("2026-08-19 17:00:00"))
        logs = stack.BiometricLog.query.order_by(stack.BiometricLog.id.asc()).all()
        extra = stack.BiometricLog(
            device_serial_number=NHQ_SN,
            device_user_id=PIN,
            punch_time=datetime(2026, 8, 19, 17, 0, 0),
            status="processed",
            admin_id=42,
            punch_session_id=logs[0].punch_session_id,
            idempotency_key="dup-ts-test-key",
        )
        stack.db.session.add(extra)
        stack.db.session.commit()
        out = stack.finalization.select_final_out_log(
            admin_id=42,
            punch_date=DAY,
            clock_in=datetime(2026, 8, 19, 9, 0, 0),
        )
        assert out.id == extra.id


def test_offline_scan_uses_punch_time_not_created_at(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        log = stack.BiometricLog(
            device_serial_number=NHQ_SN,
            device_user_id=PIN,
            punch_time=datetime(2026, 8, 19, 18, 30, 0),
            status="processed",
            admin_id=42,
            punch_session_id=stack.PunchSession.query.first().id,
            idempotency_key="offline-buffer-key",
            created_at=datetime(2026, 8, 19, 21, 0, 0),
        )
        stack.db.session.add(log)
        stack.db.session.commit()
        res = stack.finalization.finalize_biometric_day(42, DAY)
        stack.db.session.commit()
        assert res["finalized"] is True
        assert stack.PunchSession.query.first().clock_out == datetime(2026, 8, 19, 18, 30, 0)


def test_single_scan_no_fabricated_out(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        res = stack.finalization.finalize_biometric_day(42, DAY)
        stack.db.session.commit()
        assert res["skipped"] == "no_later_scan"
        assert stack.PunchSession.query.first().clock_out is None


def test_manual_web_out_before_8pm_wins(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        _post(client, _att("2026-08-19 14:00:00"))
        sess = stack.PunchSession.query.first()
        punch = stack.Punch.query.first()
        stack.punch_auto.close_punch_session(
            sess,
            punch,
            is_auto=False,
            clock_out_at=datetime(2026, 8, 19, 18, 0, 0),
            closed_by="web",
        )
        stack.db.session.commit()
        res = stack.finalization.finalize_biometric_day(42, DAY)
        stack.db.session.commit()
        assert res["skipped"] == "no_open_session"
        assert sess.clock_out == datetime(2026, 8, 19, 18, 0, 0)
        assert (sess.closed_by or "") == "web"


def test_scan_after_web_out_does_not_reopen(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        sess = stack.PunchSession.query.first()
        punch = stack.Punch.query.first()
        stack.punch_auto.close_punch_session(
            sess,
            punch,
            is_auto=False,
            clock_out_at=datetime(2026, 8, 19, 18, 0, 0),
            closed_by="web",
        )
        stack.db.session.commit()
        _post(client, _att("2026-08-19 19:00:00"))
        assert stack.PunchSession.query.count() == 1
        log = stack.BiometricLog.query.order_by(stack.BiometricLog.id.desc()).first()
        assert log.status == "ignored_day_closed"
        assert sess.clock_out == datetime(2026, 8, 19, 18, 0, 0)


def test_post_finalization_scan_does_not_reopen(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        _post(client, _att("2026-08-19 17:00:00"))
        stack.finalization.finalize_biometric_day(42, DAY)
        stack.db.session.commit()
        sess = stack.PunchSession.query.first()
        out_before = sess.clock_out
        _post(client, _att("2026-08-19 21:00:00"))
        stack.db.session.commit()
        assert stack.PunchSession.query.count() == 1
        assert sess.clock_out == out_before
        assert stack.BiometricDayState.query.first().status == "finalized"
        assert stack.BiometricLog.query.order_by(stack.BiometricLog.id.desc()).first().status == "ignored_day_closed"


def test_finalize_idempotent(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        _post(client, _att("2026-08-19 17:00:00"))
        r1 = stack.finalization.finalize_biometric_day(42, DAY)
        stack.db.session.commit()
        out = stack.PunchSession.query.first().clock_out
        r2 = stack.finalization.finalize_biometric_day(42, DAY)
        stack.db.session.commit()
        assert r1["finalized"] is True
        assert r2["skipped"] in ("already_finalized", "no_open_session")
        assert stack.PunchSession.query.first().clock_out == out


def test_catchup_uses_prior_day_cutoff(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-17 09:00:00"))
        _post(client, _att("2026-08-17 16:00:00"))
        prev = date(2026, 8, 17)
        summary = stack.finalization.finalize_all_nhq_biometric_days(
            for_date=prev, include_catchup=False
        )
        assert summary["finalized_count"] == 1
        assert stack.PunchSession.query.first().clock_out == datetime(2026, 8, 17, 16, 0, 0)


def test_non_nhq_employee_not_finalized(client, stack):
    with stack.app.app_context():
        stack.Admin.query.first().circle = "HNQ"
        stack.db.session.commit()
        _post(client, _att("2026-08-19 09:00:00"))
        _post(client, _att("2026-08-19 17:00:00"))
        res = stack.finalization.finalize_biometric_day(42, DAY)
        assert res["skipped"] in ("not_nhq_admin", "not_nhq_biometric_session")


def test_non_nhq_device_not_finalized(client, stack):
    with stack.app.app_context():
        stack.db.session.add(
            stack.BiometricDevice(serial_number=OTHER_SN, name="Other", is_active=True)
        )
        stack.db.session.commit()
        _post(client, _att("2026-08-19 09:00:00"), sn=OTHER_SN)
        _post(client, _att("2026-08-19 17:00:00"), sn=OTHER_SN)
        res = stack.finalization.finalize_biometric_day(42, DAY)
        assert res["skipped"] == "not_nhq_biometric_session"


def test_nhq_biometric_skips_10h_auto_close(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        sess = stack.PunchSession.query.first()
        now = datetime(2026, 8, 19, 20, 30, 0)
        assert stack.punch_auto._close_overdue_session(sess, now=now) is False
        assert sess.clock_out is None


def test_web_session_still_10h_auto_close(client, stack):
    with stack.app.app_context():
        punch = stack.Punch(admin_id=42, punch_date=DAY)
        stack.db.session.add(punch)
        stack.db.session.flush()
        sess = stack.PunchSession(
            punch_id=punch.id,
            clock_in=datetime(2026, 8, 19, 8, 0, 0),
            clock_out=None,
            source="web",
        )
        stack.db.session.add(sess)
        stack.db.session.commit()
        now = datetime(2026, 8, 19, 19, 0, 0)
        assert stack.punch_auto._close_overdue_session(sess, now=now) is True
        assert sess.clock_out is not None


def test_session_auto_close_deadline_null_for_nhq_biometric(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        sess = stack.PunchSession.query.first()
        assert stack.punch_auto.session_auto_close_deadline(sess) is None


def test_serialize_includes_source_and_nhq_flag(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        punch = stack.Punch.query.first()
        data = stack.punch_agg.serialize_punch_sessions(punch)
        assert data[0]["source"] == "biometric"
        assert data[0]["is_nhq_biometric"] is True
        assert data[0]["session_auto_close_at"] is None


def test_non_nhq_biometric_session_keeps_10h_deadline(client, stack):
    """HNQ employee on NHQ device: biometric source but not NHQ-scoped for 10h skip."""
    with stack.app.app_context():
        stack.Admin.query.first().circle = "HNQ"
        stack.db.session.commit()
        _post(client, _att("2026-08-19 09:00:00"))
        punch = stack.Punch.query.first()
        sess = stack.PunchSession.query.first()
        data = stack.punch_agg.serialize_punch_sessions(punch)
        assert data[0]["source"] == "biometric"
        assert data[0]["is_nhq_biometric"] is False
        assert data[0]["session_auto_close_at"] is not None
        assert stack.punch_auto.session_auto_close_deadline(sess) is not None


def test_web_session_serialize_not_nhq_biometric(client, stack):
    with stack.app.app_context():
        punch = stack.Punch(admin_id=42, punch_date=DAY)
        stack.db.session.add(punch)
        stack.db.session.flush()
        sess = stack.PunchSession(
            punch_id=punch.id,
            clock_in=datetime(2026, 8, 19, 8, 0, 0),
            clock_out=None,
            source="web",
        )
        stack.db.session.add(sess)
        stack.db.session.commit()
        data = stack.punch_agg.serialize_punch_sessions(punch)
        assert data[0]["source"] == "web"
        assert data[0]["is_nhq_biometric"] is False
        assert data[0]["session_auto_close_at"] is not None


def test_concurrent_finalize_second_call_skips(client, stack):
    """Simulates second worker after first commit: must not double-close."""
    with stack.app.app_context():
        _post(client, _att("2026-08-17 09:00:00"))
        _post(client, _att("2026-08-17 17:00:00"))
        r1 = stack.finalization.finalize_biometric_day(42, date(2026, 8, 17))
        stack.db.session.commit()
        out = stack.PunchSession.query.first().clock_out
        r2 = stack.finalization.finalize_biometric_day(42, date(2026, 8, 17))
        stack.db.session.commit()
        assert r1["finalized"] is True
        assert r2["skipped"] in ("already_finalized", "no_open_session")
        assert stack.PunchSession.query.first().clock_out == out


def test_finalize_publishes_sse_once(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-17 09:00:00"))
        _post(client, _att("2026-08-17 17:00:00"))
        before = stack.rt_models.AttendanceRealtimeEvent.query.count()
        stack.finalization.finalize_biometric_day(42, date(2026, 8, 17))
        stack.db.session.commit()
        after = stack.rt_models.AttendanceRealtimeEvent.query.count()
        assert after - before == 1


def test_unknown_employee_excluded_from_out_selection(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-19 09:00:00"))
        log = stack.BiometricLog(
            device_serial_number=NHQ_SN,
            device_user_id="UNKNOWN",
            punch_time=datetime(2026, 8, 19, 18, 0, 0),
            status="unknown_employee",
            idempotency_key="unk-key",
        )
        stack.db.session.add(log)
        stack.db.session.commit()
        out = stack.finalization.select_final_out_log(
            admin_id=42, punch_date=DAY, clock_in=datetime(2026, 8, 19, 9, 0, 0)
        )
        assert out is None or out.status == "processed"


def test_cross_day_stale_nhq_finalized_not_10h(client, stack):
    with stack.app.app_context():
        _post(client, _att("2026-08-18 09:00:00"))
        _post(client, _att("2026-08-18 17:00:00"))
        _post(client, _att("2026-08-19 09:00:00"))
        stack.db.session.commit()
        sessions = stack.PunchSession.query.order_by(stack.PunchSession.id.asc()).all()
        assert len(sessions) == 2
        old = sessions[0]
        if old.clock_out is None:
            res = stack.finalization.finalize_biometric_day(42, date(2026, 8, 18))
            stack.db.session.commit()
            assert res["finalized"] is True
        assert old.clock_out is not None


def test_scope_requires_both_nhq_admin_and_device(client, stack):
    with stack.app.app_context():
        admin = stack.Admin.query.first()
        assert stack.scope.is_nhq_biometric_scope(admin, NHQ_SN) is True
        admin.circle = "HNQ"
        assert stack.scope.is_nhq_biometric_scope(admin, NHQ_SN) is False
        admin.circle = "NHQ"
        assert stack.scope.is_nhq_biometric_scope(admin, OTHER_SN) is False
