"""Smart reprocess for mapping-failure biometric logs."""

from __future__ import annotations

import importlib.util
import sys
import types
from datetime import datetime
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
    if "website.models" not in sys.modules:
        models = types.ModuleType("website.models")
        models.__path__ = [str(_WEB / "models")]
        sys.modules["website.models"] = models
    if "website.commands" not in sys.modules:
        commands = types.ModuleType("website.commands")
        commands.__path__ = [str(_WEB / "commands")]
        sys.modules["website.commands"] = commands


def _load(full: str, path: Path):
    _ensure_packages()
    # Force reload for edited modules under test.
    if full in (
        "website.biometric.reprocess",
        "website.biometric.attendance_bridge",
        "website.biometric.models",
        "website.biometric.hr_views",
    ):
        sys.modules.pop(full, None)
    spec = importlib.util.spec_from_file_location(full, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[full] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def stack():
    _ensure_packages()
    from flask import Flask

    app = Flask("biometric_reprocess_test")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["BIOMETRIC_NHQ_SERIALS"] = ["ERIS001"]

    for key in list(sys.modules):
        if key.startswith("website.") and key not in ("website", "website.biometric", "website.models"):
            if key.startswith("website.biometric") or key in (
                "website.punch_aggregate",
                "website.punch_auto_close",
                "website.utility",
                "website.datetime_utils",
                "website.manager_utils",
            ):
                del sys.modules[key]

    website = sys.modules["website"]
    db_mod = types.ModuleType("website")
    from flask_sqlalchemy import SQLAlchemy

    db = SQLAlchemy()
    website.db = db
    sys.modules["website"].db = db

    dt_utils = types.ModuleType("website.datetime_utils")
    from zoneinfo import ZoneInfo

    dt_utils.IST = ZoneInfo("Asia/Kolkata")
    dt_utils.isoformat_api = lambda x: x.isoformat() if x else None
    dt_utils.isoformat_punch_clock = lambda x: x.isoformat() if x else None
    dt_utils.utc_now = lambda: datetime.utcnow()
    sys.modules["website.datetime_utils"] = dt_utils

    mu = types.ModuleType("website.manager_utils")
    mu.circles_equivalent = lambda a, b: (a or "").strip().upper() == (b or "").strip().upper()
    sys.modules["website.manager_utils"] = mu

    class Admin(db.Model):
        __tablename__ = "admins"
        id = db.Column(db.Integer, primary_key=True)
        email = db.Column(db.String(120))
        emp_id = db.Column(db.String(10))
        first_name = db.Column(db.String(80))
        circle = db.Column(db.String(20))
        emp_type = db.Column(db.String(40))
        is_active = db.Column(db.Boolean, default=True)
        is_exited = db.Column(db.Boolean, default=False)

    admin_models = types.ModuleType("website.models.Admin_models")
    admin_models.Admin = Admin
    sys.modules["website.models.Admin_models"] = admin_models

    class Punch(db.Model):
        __tablename__ = "punch"
        id = db.Column(db.Integer, primary_key=True)
        admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False)
        punch_date = db.Column(db.Date, nullable=False)
        punch_in = db.Column(db.DateTime, nullable=True)
        punch_out = db.Column(db.DateTime, nullable=True)
        today_work = db.Column(db.String(20), nullable=True)
        sessions = db.relationship("PunchSession", back_populates="punch", cascade="all, delete-orphan")

    class PunchSession(db.Model):
        __tablename__ = "punch_sessions"
        id = db.Column(db.Integer, primary_key=True)
        punch_id = db.Column(db.Integer, db.ForeignKey("punch.id", ondelete="CASCADE"), nullable=False)
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

    att = types.ModuleType("website.models.attendance")
    att.Punch = Punch
    att.PunchSession = PunchSession
    att.LeaveApplication = type("LeaveApplication", (), {})
    att.CompOffGain = type("CompOffGain", (), {})
    att.Location = type("Location", (), {})
    att.LeaveBalance = type("LeaveBalance", (), {})
    att.WorkFromHomeApplication = type("WorkFromHomeApplication", (), {})
    sys.modules["website.models.attendance"] = att

    util = types.ModuleType("website.utility")
    util.is_on_leave = lambda admin_id, today: False
    sys.modules["website.utility"] = util

    off = types.ModuleType("website.offboarding_service")
    off.admin_login_allowed = lambda admin: admin is not None and getattr(admin, "is_active", True)
    sys.modules["website.offboarding_service"] = off

    punch_agg = _load("website.punch_aggregate", _WEB / "punch_aggregate.py")
    _load("website.punch_auto_close", _WEB / "punch_auto_close.py")
    bio_models = _load("website.biometric.models", _BIO / "models.py")
    _load("website.biometric.validators", _BIO / "validators.py")
    _load("website.biometric.mapping", _BIO / "mapping.py")
    _load("website.biometric.day_rollup", _BIO / "day_rollup.py")
    _load("website.biometric.scope", _BIO / "scope.py")
    bridge = _load("website.biometric.attendance_bridge", _BIO / "attendance_bridge.py")
    reprocess = _load("website.biometric.reprocess", _BIO / "reprocess.py")
    hr_views = _load("website.biometric.hr_views", _BIO / "hr_views.py")

    pub = types.ModuleType("website.attendance_realtime.publisher")
    pub.queue_attendance_updated = lambda **kwargs: None
    if "website.attendance_realtime" not in sys.modules:
        rt = types.ModuleType("website.attendance_realtime")
        rt.__path__ = [str(_WEB / "attendance_realtime")]
        sys.modules["website.attendance_realtime"] = rt
    sys.modules["website.attendance_realtime.publisher"] = pub

    db.init_app(app)
    with app.app_context():
        db.create_all()

    return types.SimpleNamespace(
        app=app,
        db=db,
        Admin=Admin,
        Punch=Punch,
        PunchSession=PunchSession,
        BiometricDevice=bio_models.BiometricDevice,
        BiometricLog=bio_models.BiometricLog,
        BiometricEmployeeMap=bio_models.BiometricEmployeeMap,
        BiometricDayState=bio_models.BiometricDayState,
        BiometricAttendanceDay=bio_models.BiometricAttendanceDay,
        bridge=bridge,
        reprocess=reprocess,
        hr_views=hr_views,
        punch_agg=punch_agg,
    )


@pytest.fixture
def client(stack):
    with stack.app.app_context():
        for model in (
            stack.BiometricLog,
            stack.BiometricDayState,
            stack.BiometricAttendanceDay,
            stack.BiometricEmployeeMap,
            stack.BiometricDevice,
            stack.PunchSession,
            stack.Punch,
            stack.Admin,
        ):
            stack.db.session.execute(model.__table__.delete())
        stack.db.session.commit()
        stack.db.session.add(
            stack.Admin(
                id=42,
                email="u@test.local",
                emp_id="EMP00125",
                first_name="Amit",
                circle="NHQ",
                is_active=True,
            )
        )
        stack.db.session.add(
            stack.BiometricDevice(serial_number="ERIS001", name="AiFace", is_active=True)
        )
        stack.db.session.commit()
        yield stack.app.test_client()


def test_reprocess_resolves_after_emp_id_fixed(client, stack):
    with stack.app.app_context():
        log = stack.BiometricLog(
            device_serial_number="ERIS001",
            device_user_id="EMP00999",
            punch_time=datetime(2026, 8, 19, 9, 0, 0),
            status="unknown_employee",
            error_message="no_admin_emp_id_match",
            idempotency_key="reprocess-1",
            reprocess_attempts=0,
        )
        stack.db.session.add(log)
        stack.db.session.commit()

        # Still unknown → still_unmapped
        res = stack.reprocess.reprocess_one_mapping_log(log, max_attempts=7)
        stack.db.session.commit()
        assert res["outcome"] == "still_unmapped"
        assert log.reprocess_attempts == 1
        assert log.status == "unknown_employee"

        # Fix mapping: change device pin to match emp_id
        log.device_user_id = "EMP00125"
        stack.db.session.commit()
        res2 = stack.reprocess.reprocess_one_mapping_log(log, max_attempts=7)
        stack.db.session.commit()
        assert res2["outcome"] == "resolved"
        assert log.status == "processed"
        assert log.punch_session_id is not None
        assert stack.PunchSession.query.count() == 1


def test_reprocess_exhausts_ghost_pin(client, stack):
    with stack.app.app_context():
        log = stack.BiometricLog(
            device_serial_number="ERIS001",
            device_user_id="GHOST999",
            punch_time=datetime(2026, 8, 19, 10, 0, 0),
            status="unknown_employee",
            idempotency_key="reprocess-ghost",
            reprocess_attempts=6,
        )
        stack.db.session.add(log)
        stack.db.session.commit()
        res = stack.reprocess.reprocess_one_mapping_log(log, max_attempts=7)
        stack.db.session.commit()
        assert res["outcome"] == "exhausted"
        assert log.status == "unmapped_permanent"
        assert stack.PunchSession.query.count() == 0


def test_hr_attendance_label_unmapped_vs_applied(client, stack):
    with stack.app.app_context():
        day = datetime(2026, 8, 19).date()
        unmapped = stack.BiometricAttendanceDay(
            admin_id=None,
            device_user_id="GHOST1",
            attendance_date=day,
            first_scan=datetime(2026, 8, 19, 9, 0, 0),
            last_scan=datetime(2026, 8, 19, 9, 0, 0),
            total_scans=["2026-08-19 09:00:00"],
        )
        stack.db.session.add(unmapped)
        mapped_day = stack.BiometricAttendanceDay(
            admin_id=42,
            device_user_id="EMP00125",
            attendance_date=day,
            first_scan=datetime(2026, 8, 19, 9, 0, 0),
            last_scan=datetime(2026, 8, 19, 18, 0, 0),
            total_scans=["2026-08-19 09:00:00", "2026-08-19 18:00:00"],
        )
        stack.db.session.add(mapped_day)
        stack.db.session.commit()

        u = stack.hr_views._serialize_day_row(unmapped, None)
        assert u["attendance_status"] == "unmapped"
        assert "Unmapped" in u["attendance_label"]

        admin = stack.Admin.query.get(42)
        # No linked log yet → not applied
        m0 = stack.hr_views._serialize_day_row(mapped_day, admin)
        assert m0["attendance_status"] == "not_applied_to_punch"

        stack.db.session.add(
            stack.BiometricLog(
                device_serial_number="ERIS001",
                device_user_id="EMP00125",
                punch_time=datetime(2026, 8, 19, 9, 0, 0),
                status="processed",
                admin_id=42,
                punch_session_id=99,
                idempotency_key="label-applied-1",
            )
        )
        stack.db.session.commit()
        m1 = stack.hr_views._serialize_day_row(mapped_day, admin)
        assert m1["attendance_status"] == "applied_to_punch"


def test_scheduler_registers_mapping_reprocess_job():
    text = (_WEB / "__init__.py").read_text(encoding="utf-8")
    assert "biometric_mapping_reprocess" in text
    assert "run_biometric_mapping_reprocess_job" in text
    sched = (_WEB / "scheduler.py").read_text(encoding="utf-8")
    assert "run_biometric_mapping_reprocess_job" in sched
