"""Phase 3C: biometric attendance bridge → PunchSession / Punch aggregate.

Isolated Flask + SQLAlchemy harness (does not load website/__init__.py).
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
    if "website.models" not in sys.modules:
        models_pkg = types.ModuleType("website.models")
        models_pkg.__path__ = [str(_WEB / "models")]
        sys.modules["website.models"] = models_pkg


def _load(full: str, path: Path):
    _ensure_packages()
    # Always reload punch_auto_close / bridge when path matches to pick up edits
    if full in sys.modules and getattr(sys.modules[full], "__file__", None) == str(path):
        return sys.modules[full]
    spec = importlib.util.spec_from_file_location(full, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[full] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def stack():
    _ensure_packages()
    # Clear modules that may have been loaded by other biometric test modules
    for key in list(sys.modules):
        if key.startswith("website.biometric") or key in (
            "website.punch_aggregate",
            "website.punch_auto_close",
            "website.models.attendance",
            "website.models.Admin_models",
            "website.offboarding_service",
            "website.utility",
        ):
            del sys.modules[key]
    _ensure_packages()

    dt_mod = _load("website.datetime_utils", _WEB / "datetime_utils.py")
    sys.modules["website.datetime_utils"] = dt_mod

    from flask import Flask, Blueprint
    from flask_sqlalchemy import SQLAlchemy

    app = Flask("biometric_phase3c_test")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["TESTING"] = True
    app.config["BIOMETRIC_DEBUG_LOG"] = True

    db = SQLAlchemy()
    website = sys.modules["website"]
    website.db = db

    class Admin(db.Model):
        __tablename__ = "admins"
        id = db.Column(db.Integer, primary_key=True)
        email = db.Column(db.String(120), nullable=True)
        emp_id = db.Column(db.String(10), nullable=True)  # unique in prod; not enforced here for ambiguous tests
        first_name = db.Column(db.String(150), nullable=True)
        is_active = db.Column(db.Boolean, nullable=True, default=True)
        is_exited = db.Column(db.Boolean, nullable=True, default=False)
        exit_login_until = db.Column(db.Date, nullable=True)
        punch_records = db.relationship("Punch", back_populates="admin")
        leave_applications = db.relationship(
            "LeaveApplication",
            foreign_keys="LeaveApplication.admin_id",
            back_populates="admin",
        )
        leaves_applied_on_behalf = db.relationship(
            "LeaveApplication",
            foreign_keys="LeaveApplication.applied_by_admin_id",
            back_populates="applied_by",
        )
        comp_off_gains = db.relationship("CompOffGain", back_populates="admin")

    admin_models = types.ModuleType("website.models.Admin_models")
    admin_models.Admin = Admin
    sys.modules["website.models.Admin_models"] = admin_models

    off = types.ModuleType("website.offboarding_service")

    def admin_login_allowed(admin):
        if admin is None:
            return False
        if getattr(admin, "is_active", True) is False:
            return False
        if not getattr(admin, "is_exited", False):
            return True
        return False

    off.admin_login_allowed = admin_login_allowed
    sys.modules["website.offboarding_service"] = off

    # Minimal attendance models (avoid full Admin_models graph)
    class Punch(db.Model):
        __tablename__ = "punch"
        id = db.Column(db.Integer, primary_key=True)
        admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False)
        punch_date = db.Column(db.Date, nullable=False)
        punch_in = db.Column(db.DateTime, nullable=True)
        punch_out = db.Column(db.DateTime, nullable=True)
        today_work = db.Column(db.String(20), nullable=True)
        lat = db.Column(db.Float, nullable=True)
        lon = db.Column(db.Float, nullable=True)
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
        deducted_days = db.Column(db.Float, default=0.0)
        applied_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
        applied_on_behalf = db.Column(db.Boolean, nullable=False, default=False)
        admin = db.relationship(
            "Admin", foreign_keys=[admin_id], back_populates="leave_applications"
        )
        applied_by = db.relationship(
            "Admin",
            foreign_keys=[applied_by_admin_id],
            back_populates="leaves_applied_on_behalf",
        )

    class CompOffGain(db.Model):
        __tablename__ = "comp_off_gains"
        id = db.Column(db.Integer, primary_key=True)
        admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False)
        gain_date = db.Column(db.Date, nullable=False)
        expiry_date = db.Column(db.Date, nullable=False)
        used = db.Column(db.Float, default=0.0)
        admin = db.relationship("Admin", back_populates="comp_off_gains")

    att = types.ModuleType("website.models.attendance")
    att.Punch = Punch
    att.PunchSession = PunchSession
    att.LeaveApplication = LeaveApplication
    att.CompOffGain = CompOffGain
    att.Location = type("Location", (), {})
    att.LeaveBalance = type("LeaveBalance", (), {})
    att.WorkFromHomeApplication = type("WorkFromHomeApplication", (), {})
    sys.modules["website.models.attendance"] = att

    util = types.ModuleType("website.utility")

    def is_on_leave(admin_id, today):
        rows = LeaveApplication.query.filter(
            LeaveApplication.admin_id == admin_id,
            LeaveApplication.status == "Approved",
            LeaveApplication.start_date <= today,
            LeaveApplication.end_date >= today,
        ).all()
        for lv in rows:
            leave_type = (getattr(lv, "leave_type", None) or "").strip().lower()
            if leave_type != "half day leave":
                return True
        return False

    util.is_on_leave = is_on_leave
    sys.modules["website.utility"] = util

    punch_agg = _load("website.punch_aggregate", _WEB / "punch_aggregate.py")
    # Stub isoformat for serialize paths if needed
    punch_auto = _load("website.punch_auto_close", _WEB / "punch_auto_close.py")

    bio_models = _load("website.biometric.models", _BIO / "models.py")
    mapping = _load("website.biometric.mapping", _BIO / "mapping.py")
    _load("website.biometric.parser", _BIO / "parser.py")
    _load("website.biometric.validators", _BIO / "validators.py")
    _load("website.biometric.device_manager", _BIO / "device_manager.py")
    bridge = _load("website.biometric.attendance_bridge", _BIO / "attendance_bridge.py")
    import importlib

    importlib.reload(bridge)
    rt_models = _load(
        "website.attendance_realtime.models",
        _WEB / "attendance_realtime" / "models.py",
    )

    bio_pkg = sys.modules["website.biometric"]
    biometric_bp = Blueprint("biometric", __name__)
    bio_pkg.biometric_bp = biometric_bp
    _load("website.biometric.routes", _BIO / "routes.py")
    app.register_blueprint(biometric_bp, url_prefix="/iclock")

    db.init_app(app)
    with app.app_context():
        db.create_all()
        rt_models.AttendanceRealtimeEvent.__table__.create(
            bind=db.engine, checkfirst=True
        )

    service = _load("website.biometric.service", _BIO / "service.py")

    return types.SimpleNamespace(
        app=app,
        db=db,
        Admin=Admin,
        Punch=Punch,
        PunchSession=PunchSession,
        LeaveApplication=LeaveApplication,
        BiometricDevice=bio_models.BiometricDevice,
        BiometricLog=bio_models.BiometricLog,
        BiometricEmployeeMap=bio_models.BiometricEmployeeMap,
        BiometricDayState=bio_models.BiometricDayState,
        bridge=bridge,
        mapping=mapping,
        service=service,
        punch_agg=punch_agg,
        punch_auto=punch_auto,
        util=util,
    )


@pytest.fixture
def client(stack):
    with stack.app.app_context():
        stack.db.session.remove()
        # Wipe only attendance-related tables (avoid unrelated metadata from other imports)
        for model in (
            stack.BiometricLog,
            stack.BiometricDayState,
            stack.BiometricEmployeeMap,
            stack.BiometricDevice,
            stack.PunchSession,
            stack.Punch,
            stack.LeaveApplication,
            stack.Admin,
        ):
            try:
                stack.db.session.execute(model.__table__.delete())
            except Exception:
                stack.db.session.rollback()
        stack.db.session.commit()

        admin = stack.Admin(
            id=42,
            email="bio@test.local",
            emp_id="EMP00125",
            first_name="Amit",
            is_active=True,
            is_exited=False,
        )
        stack.db.session.add(admin)
        device = stack.BiometricDevice(
            serial_number="ERIS001", name="AiFace", is_active=True
        )
        stack.db.session.add(device)
        stack.db.session.flush()
        stack.db.session.add(
            stack.BiometricEmployeeMap(
                device_user_id="EMP00125",
                admin_id=42,
                emp_id="EMP00125",
                device_id=None,
                is_active=True,
            )
        )
        stack.db.session.commit()
        yield stack.app.test_client()


def _post_attlog(client, line: str, sn: str = "ERIS001", *, aspx: bool = False):
    path = "/iclock/cdata.aspx" if aspx else "/iclock/cdata"
    return client.post(f"{path}?SN={sn}&table=ATTLOG", data=line)


PIN = "EMP00125"


def _att(pin: str = PIN, ts: str = "2026-08-17 09:00:00") -> str:
    return f"{pin}\t{ts}\t0\t15\t0\t0"


def test_first_scan_creates_session(client, stack):
    with stack.app.app_context():
        resp = _post_attlog(client, _att())
        assert resp.status_code == 200
        assert stack.PunchSession.query.count() == 1
        sess = stack.PunchSession.query.first()
        assert sess.clock_in == datetime(2026, 8, 17, 9, 0, 0)
        assert sess.clock_out is None
        assert (sess.source or "").lower() == "biometric"
        punch = stack.Punch.query.first()
        assert punch.admin_id == 42
        assert punch.punch_in == sess.clock_in
        assert punch.punch_out is None
        log = stack.BiometricLog.query.first()
        assert log.status == "processed"
        assert log.admin_id == 42
        assert log.punch_session_id == sess.id
        day = stack.BiometricDayState.query.first()
        assert day.first_scan_at == sess.clock_in
        assert day.last_scan_at == sess.clock_in


def test_subsequent_scans_update_last_scan_only(client, stack):
    with stack.app.app_context():
        _post_attlog(client, _att())
        _post_attlog(client, _att(ts="2026-08-17 12:00:00"))
        _post_attlog(client, _att(ts="2026-08-17 18:00:00"))
        assert stack.PunchSession.query.count() == 1
        day = stack.BiometricDayState.query.first()
        assert day.first_scan_at == datetime(2026, 8, 17, 9, 0, 0)
        assert day.last_scan_at == datetime(2026, 8, 17, 18, 0, 0)
        assert stack.BiometricLog.query.filter_by(status="processed").count() == 3
        assert stack.Punch.query.first().punch_out is None


def test_unknown_mapping_no_attendance(client, stack):
    with stack.app.app_context():
        _post_attlog(client, "9999\t2026-08-17 09:00:00\t0\t15\t0\t0")
        assert stack.PunchSession.query.count() == 0
        assert stack.Punch.query.count() == 0
        log = stack.BiometricLog.query.first()
        assert log.status == "unknown_employee"


def test_open_web_session_ignored(client, stack):
    with stack.app.app_context():
        punch = stack.Punch(admin_id=42, punch_date=datetime(2026, 8, 17).date())
        stack.db.session.add(punch)
        stack.db.session.flush()
        web = stack.PunchSession(
            punch_id=punch.id,
            clock_in=datetime(2026, 8, 17, 8, 0, 0),
            clock_out=None,
            is_wfh=False,
        )
        web.source = "web"
        stack.db.session.add(web)
        stack.db.session.commit()

        _post_attlog(client, _att(ts="2026-08-17 12:00:00"))
        assert stack.PunchSession.query.count() == 1
        log = stack.BiometricLog.query.order_by(stack.BiometricLog.id.desc()).first()
        assert log.status == "ignored_open_web_session"
        assert log.punch_session_id == web.id


def test_biometric_in_then_web_close(client, stack):
    with stack.app.app_context():
        _post_attlog(client, _att())
        sess = stack.PunchSession.query.first()
        punch = stack.Punch.query.first()
        stack.punch_auto.close_punch_session(
            sess,
            punch,
            is_auto=False,
            now=datetime(2026, 8, 17, 18, 0, 0),
            clock_out_at=datetime(2026, 8, 17, 18, 0, 0),
            closed_by="web",
        )
        stack.db.session.commit()
        assert stack.PunchSession.query.count() == 1
        assert sess.clock_out == datetime(2026, 8, 17, 18, 0, 0)
        assert (sess.closed_by or "") == "web"
        assert (sess.source or "") == "biometric"
        assert punch.punch_out == sess.clock_out


def test_full_day_leave_blocks(client, stack):
    with stack.app.app_context():
        stack.db.session.add(
            stack.LeaveApplication(
                admin_id=42,
                leave_type="Casual Leave",
                reason="vacation",
                start_date=datetime(2026, 8, 17).date(),
                end_date=datetime(2026, 8, 17).date(),
                status="Approved",
            )
        )
        stack.db.session.commit()
        _post_attlog(client, _att())
        assert stack.PunchSession.query.count() == 0
        log = stack.BiometricLog.query.first()
        assert log.status == "ignored"
        assert log.error_message == "on_leave"


def test_duplicate_event_one_session(client, stack):
    with stack.app.app_context():
        body = _att()
        _post_attlog(client, body)
        _post_attlog(client, body)
        assert stack.BiometricLog.query.count() == 1
        assert stack.PunchSession.query.count() == 1


def test_offline_delayed_timestamp_uses_event_time(client, stack):
    with stack.app.app_context():
        old = datetime.now() - timedelta(days=3)
        line = _att(ts=old.strftime("%Y-%m-%d %H:%M:%S"))
        _post_attlog(client, line)
        sess = stack.PunchSession.query.first()
        assert sess is not None
        assert sess.clock_in.replace(microsecond=0) == old.replace(microsecond=0)
        assert stack.Punch.query.first().punch_date == old.date()


def test_auto_close_uses_last_scan_when_present(client, stack):
    with stack.app.app_context():
        _post_attlog(client, _att())
        _post_attlog(client, _att(ts="2026-08-17 18:00:00"))
        sess = stack.PunchSession.query.first()
        now = datetime(2026, 8, 17, 19, 5, 0)
        closed = stack.punch_auto._close_overdue_session(sess, now=now)
        assert closed is True
        stack.db.session.commit()
        assert sess.clock_out == datetime(2026, 8, 17, 18, 0, 0)
        assert (sess.closed_by or "") == "system"
        day = stack.BiometricDayState.query.first()
        assert day.status == "auto_closed"


def test_auto_close_single_scan_uses_10h_cap(client, stack):
    with stack.app.app_context():
        _post_attlog(client, _att())
        sess = stack.PunchSession.query.first()
        now = datetime(2026, 8, 17, 19, 5, 0)
        closed = stack.punch_auto._close_overdue_session(sess, now=now)
        assert closed is True
        stack.db.session.commit()
        assert sess.clock_out == datetime(2026, 8, 17, 19, 0, 0)


def test_null_source_treated_as_web(client, stack):
    with stack.app.app_context():
        punch = stack.Punch(admin_id=42, punch_date=datetime(2026, 8, 17).date())
        stack.db.session.add(punch)
        stack.db.session.flush()
        legacy = stack.PunchSession(
            punch_id=punch.id,
            clock_in=datetime(2026, 8, 17, 8, 30, 0),
            clock_out=None,
            is_wfh=False,
        )
        stack.db.session.add(legacy)
        stack.db.session.commit()
        _post_attlog(client, _att(ts="2026-08-17 10:00:00"))
        assert stack.PunchSession.query.count() == 1
        assert stack.BiometricLog.query.first().status == "ignored_open_web_session"


def test_bridge_does_not_call_auth_punch_routes():
    text = (_BIO / "attendance_bridge.py").read_text(encoding="utf-8")
    assert "from ..auth import" not in text
    assert "punch_in(" not in text
    assert "punch_out(" not in text
    assert "validate_employee_location" not in text


def test_emp_id_resolves_to_admin_id_for_session(client, stack):
    """eSSL User ID == Admin.emp_id → Admin.id → PunchSession."""
    with stack.app.app_context():
        resp = _post_attlog(client, _att())
        assert resp.status_code == 200
        punch = stack.Punch.query.first()
        assert punch is not None
        assert punch.admin_id == 42
        assert punch.admin_id != "EMP00125"
        desc = stack.mapping.describe_mapping(PIN)
        assert desc["resolved_admin_id"] == 42
        assert desc["resolved_emp_id"] == PIN
        assert desc["mapping_status"] == "valid"


def test_unknown_emp_id_no_attendance(client, stack):
    with stack.app.app_context():
        _post_attlog(client, _att("EMP99999"))
        assert stack.PunchSession.query.count() == 0
        log = stack.BiometricLog.query.first()
        assert log.status == "unknown_employee"
        assert "no_admin_emp_id_match" in (log.error_message or "")


def test_arbitrary_numeric_pin_does_not_map_to_admin(client, stack):
    """User ID 1234 must not resolve to Admin 42 unless Admin.emp_id is 1234."""
    with stack.app.app_context():
        _post_attlog(client, _att("1234"))
        assert stack.PunchSession.query.count() == 0
        log = stack.BiometricLog.query.first()
        assert log.status == "unknown_employee"


def test_direct_emp_id_match_without_map_row(client, stack):
    """Mapping table is optional; Admin.emp_id exact match is enough."""
    with stack.app.app_context():
        stack.db.session.execute(stack.BiometricEmployeeMap.__table__.delete())
        stack.db.session.commit()
        _post_attlog(client, _att())
        punch = stack.Punch.query.first()
        assert punch is not None
        assert punch.admin_id == 42


def test_ambiguous_emp_id_no_attendance(client, stack):
    with stack.app.app_context():
        seeded = stack.Admin.query.get(42)
        seeded.emp_id = "EMP00042"
        stack.db.session.add(
            stack.Admin(id=87, email="a@t.com", emp_id="EMPDUP01", first_name="A")
        )
        stack.db.session.add(
            stack.Admin(id=88, email="b@t.com", emp_id="EMPDUP01", first_name="B")
        )
        stack.db.session.commit()
        _post_attlog(client, _att("EMPDUP01"))
        assert stack.PunchSession.query.count() == 0
        log = stack.BiometricLog.query.filter_by(device_user_id="EMPDUP01").first()
        assert log.status == "ambiguous_employee_mapping"


def test_mismatched_map_emp_id_invalid_mapping(client, stack):
    with stack.app.app_context():
        stack.db.session.execute(stack.BiometricEmployeeMap.__table__.delete())
        stack.db.session.add(
            stack.BiometricEmployeeMap(
                device_user_id=PIN,
                admin_id=42,
                emp_id="EMP00999",
                is_active=True,
            )
        )
        stack.db.session.commit()
        _post_attlog(client, _att())
        assert stack.PunchSession.query.count() == 0
        log = stack.BiometricLog.query.first()
        assert log.status == "invalid_mapping"


def test_mismatched_map_admin_id_invalid_mapping(client, stack):
    with stack.app.app_context():
        stack.db.session.add(
            stack.Admin(id=99, email="other@t.com", emp_id="EMP00999", first_name="Other")
        )
        stack.db.session.execute(stack.BiometricEmployeeMap.__table__.delete())
        stack.db.session.add(
            stack.BiometricEmployeeMap(
                device_user_id=PIN,
                admin_id=99,
                emp_id=PIN,
                is_active=True,
            )
        )
        stack.db.session.commit()
        _post_attlog(client, _att())
        assert stack.PunchSession.query.count() == 0
        log = stack.BiometricLog.query.first()
        assert log.status == "invalid_mapping"


def test_leading_zeros_device_user_id_exact(client, stack):
    with stack.app.app_context():
        seeded = stack.Admin.query.get(42)
        seeded.emp_id = "000125"
        stack.db.session.execute(stack.BiometricEmployeeMap.__table__.delete())
        stack.db.session.add(
            stack.BiometricEmployeeMap(
                device_user_id="000125",
                admin_id=42,
                emp_id="000125",
                is_active=True,
            )
        )
        stack.db.session.commit()
        _post_attlog(client, _att("000125"))
        assert stack.PunchSession.query.count() == 1
        assert stack.Punch.query.first().admin_id == 42
        _post_attlog(client, _att("125"))
        unknown = stack.BiometricLog.query.filter_by(device_user_id="125").first()
        assert unknown.status == "unknown_employee"


def test_two_devices_same_emp_id_same_employee(client, stack):
    """Same User ID on two devices must resolve to the same Admin.emp_id."""
    with stack.app.app_context():
        factory = stack.BiometricDevice(
            serial_number="FACTORY01", name="Factory", is_active=True
        )
        stack.db.session.add(factory)
        stack.db.session.flush()
        reception = stack.BiometricDevice.query.filter_by(serial_number="ERIS001").first()
        stack.db.session.execute(stack.BiometricEmployeeMap.__table__.delete())
        stack.db.session.add(
            stack.BiometricEmployeeMap(
                device_user_id=PIN,
                admin_id=42,
                emp_id=PIN,
                device_id=reception.id,
                is_active=True,
            )
        )
        stack.db.session.add(
            stack.BiometricEmployeeMap(
                device_user_id=PIN,
                admin_id=42,
                emp_id=PIN,
                device_id=factory.id,
                is_active=True,
            )
        )
        stack.db.session.commit()

        _post_attlog(client, _att(), sn="ERIS001")
        assert stack.Punch.query.filter_by(admin_id=42).count() == 1
        _post_attlog(client, _att(ts="2026-08-17 10:00:00"), sn="FACTORY01")
        assert stack.Punch.query.count() == 1
        assert stack.PunchSession.query.count() == 1


def test_example_admin_87_emp00125(client, stack):
    """Canonical: eSSL User ID EMP00125 → Admin.id 87."""
    with stack.app.app_context():
        stack.db.session.execute(stack.PunchSession.__table__.delete())
        stack.db.session.execute(stack.Punch.__table__.delete())
        stack.db.session.execute(stack.Admin.__table__.delete())
        stack.db.session.execute(stack.BiometricEmployeeMap.__table__.delete())
        stack.db.session.add(
            stack.Admin(
                id=87,
                email="amit@t.com",
                emp_id="EMP00125",
                first_name="Amit Kumar",
                is_active=True,
            )
        )
        stack.db.session.add(
            stack.BiometricEmployeeMap(
                device_user_id="EMP00125",
                admin_id=87,
                emp_id="EMP00125",
                is_active=True,
            )
        )
        stack.db.session.commit()
        _post_attlog(client, _att())
        punch = stack.Punch.query.first()
        assert punch.admin_id == 87
        sess = stack.PunchSession.query.first()
        assert sess is not None
        assert sess.punch_id == punch.id


def test_inactive_employee_no_attendance(client, stack):
    with stack.app.app_context():
        seeded = stack.Admin.query.get(42)
        seeded.is_active = False
        stack.db.session.commit()
        _post_attlog(client, _att())
        assert stack.PunchSession.query.count() == 0
        log = stack.BiometricLog.query.first()
        assert log.status == "employee_inactive"


def test_aspx_attlog_creates_session(client, stack):
    """cdata.aspx ATTLOG uses same bridge as cdata (Admin.emp_id match)."""
    with stack.app.app_context():
        resp = _post_attlog(client, _att(), aspx=True)
        assert resp.status_code == 200
        assert stack.PunchSession.query.count() == 1
        assert stack.Punch.query.first().admin_id == 42
        log = stack.BiometricLog.query.first()
        assert log.status == "processed"
        assert log.device_user_id == PIN


# --- Phase 3E: cross-day biometric session regression ---


def _setup_admin_10236(stack):
    stack.db.session.execute(stack.BiometricEmployeeMap.__table__.delete())
    stack.db.session.execute(stack.Admin.__table__.delete())
    admin = stack.Admin(
        id=1,
        email="10236@test.local",
        emp_id="10236",
        first_name="CrossDay",
        is_active=True,
        is_exited=False,
    )
    stack.db.session.add(admin)
    stack.db.session.commit()
    return admin


def _att_10236(ts: str) -> str:
    return f"10236\t{ts}\t255\t15\t0\t0\t0\t0\t0\t0"


def _stale_biometric_session(stack, *, punch_date, clock_in, clock_out=None):
    punch = stack.Punch(admin_id=1, punch_date=punch_date)
    stack.db.session.add(punch)
    stack.db.session.flush()
    sess = stack.PunchSession(
        punch_id=punch.id,
        clock_in=clock_in,
        clock_out=clock_out,
        is_wfh=False,
        source="biometric",
    )
    stack.db.session.add(sess)
    stack.db.session.commit()
    return punch, sess


def test_biometric_new_day_creates_new_session_when_prior_stale_open(client, stack):
    """Stale Aug 17 open session must not receive Aug 19 scan."""
    with stack.app.app_context():
        _setup_admin_10236(stack)
        _, old_sess = _stale_biometric_session(
            stack,
            punch_date=datetime(2026, 8, 17).date(),
            clock_in=datetime(2026, 8, 17, 15, 58, 38),
            clock_out=None,
        )
        old_id = old_sess.id

        resp = _post_attlog(client, _att_10236("2026-08-19 10:08:03"))
        assert resp.status_code == 200

        log = stack.BiometricLog.query.order_by(stack.BiometricLog.id.desc()).first()
        assert log.status == "processed"
        assert log.admin_id == 1
        assert log.punch_session_id != old_id

        new_sess = stack.PunchSession.query.get(log.punch_session_id)
        assert new_sess is not None
        assert (new_sess.source or "").lower() == "biometric"
        assert new_sess.clock_in == datetime(2026, 8, 19, 10, 8, 3)
        assert new_sess.punch.punch_date == datetime(2026, 8, 19).date()

        old_sess = stack.PunchSession.query.get(old_id)
        assert stack.BiometricLog.query.filter_by(punch_session_id=old_id).count() == 0

        day = stack.BiometricDayState.query.filter_by(
            admin_id=1, punch_date=datetime(2026, 8, 19).date()
        ).first()
        assert day is not None
        assert day.punch_session_id == new_sess.id


def test_biometric_same_day_subsequent_scan_does_not_create_second_session(client, stack):
    with stack.app.app_context():
        _setup_admin_10236(stack)
        _post_attlog(client, _att_10236("2026-08-19 10:08:03"))
        _post_attlog(client, _att_10236("2026-08-19 10:20:00"))

        assert stack.PunchSession.query.count() == 1
        sess = stack.PunchSession.query.first()
        assert sess.punch.punch_date == datetime(2026, 8, 19).date()
        day = stack.BiometricDayState.query.filter_by(
            admin_id=1, punch_date=datetime(2026, 8, 19).date()
        ).first()
        assert day.last_scan_at == datetime(2026, 8, 19, 10, 20, 0)


def test_biometric_new_day_after_prior_auto_closed_session(client, stack):
    with stack.app.app_context():
        _setup_admin_10236(stack)
        _, old_sess = _stale_biometric_session(
            stack,
            punch_date=datetime(2026, 8, 17).date(),
            clock_in=datetime(2026, 8, 17, 15, 58, 38),
            clock_out=datetime(2026, 8, 18, 1, 58, 38),
        )
        old_id = old_sess.id
        old_out = old_sess.clock_out

        _post_attlog(client, _att_10236("2026-08-19 10:08:03"))

        old_sess = stack.PunchSession.query.get(old_id)
        assert old_sess.clock_out == old_out
        assert stack.PunchSession.query.count() == 2
        new_sess = (
            stack.PunchSession.query.join(stack.Punch)
            .filter(stack.Punch.punch_date == datetime(2026, 8, 19).date())
            .first()
        )
        assert new_sess is not None
        assert new_sess.id != old_id


def test_biometric_day_state_uses_scan_date(client, stack):
    with stack.app.app_context():
        _setup_admin_10236(stack)
        _stale_biometric_session(
            stack,
            punch_date=datetime(2026, 8, 17).date(),
            clock_in=datetime(2026, 8, 17, 15, 58, 38),
            clock_out=None,
        )
        _post_attlog(client, _att_10236("2026-08-19 10:08:03"))

        day = stack.BiometricDayState.query.filter_by(admin_id=1).first()
        assert day.punch_date == datetime(2026, 8, 19).date()


def test_biometric_does_not_mutate_prior_day_state(client, stack):
    with stack.app.app_context():
        _setup_admin_10236(stack)
        punch, old_sess = _stale_biometric_session(
            stack,
            punch_date=datetime(2026, 8, 17).date(),
            clock_in=datetime(2026, 8, 17, 15, 58, 38),
            clock_out=None,
        )
        prior_last = datetime(2026, 8, 17, 18, 0, 0)
        stack.db.session.add(
            stack.BiometricDayState(
                admin_id=1,
                punch_date=datetime(2026, 8, 17).date(),
                punch_session_id=old_sess.id,
                first_scan_at=datetime(2026, 8, 17, 15, 58, 38),
                last_scan_at=prior_last,
                status="open",
            )
        )
        stack.db.session.commit()

        _post_attlog(client, _att_10236("2026-08-19 10:08:03"))

        old_day = stack.BiometricDayState.query.filter_by(
            admin_id=1, punch_date=datetime(2026, 8, 17).date()
        ).first()
        assert old_day.last_scan_at == prior_last
        new_day = stack.BiometricDayState.query.filter_by(
            admin_id=1, punch_date=datetime(2026, 8, 19).date()
        ).first()
        assert new_day is not None
        assert new_day.last_scan_at == datetime(2026, 8, 19, 10, 8, 3)


def test_offline_buffer_out_of_order_dates(client, stack):
    with stack.app.app_context():
        _setup_admin_10236(stack)
        _, stale_sess = _stale_biometric_session(
            stack,
            punch_date=datetime(2026, 8, 17).date(),
            clock_in=datetime(2026, 8, 17, 15, 58, 38),
            clock_out=None,
        )
        stale_id = stale_sess.id

        _post_attlog(client, _att_10236("2026-08-19 10:08:03"))
        _post_attlog(client, _att_10236("2026-08-18 09:30:00"))

        logs = stack.BiometricLog.query.filter_by(status="processed").all()
        assert len(logs) == 2

        aug19_log = next(l for l in logs if l.punch_time.date() == datetime(2026, 8, 19).date())
        aug18_log = next(l for l in logs if l.punch_time.date() == datetime(2026, 8, 18).date())

        assert aug19_log.punch_session_id != stale_id
        assert aug18_log.punch_session_id != stale_id
        assert aug19_log.punch_session_id != aug18_log.punch_session_id

        aug19_sess = stack.PunchSession.query.get(aug19_log.punch_session_id)
        aug18_sess = stack.PunchSession.query.get(aug18_log.punch_session_id)
        assert aug19_sess.punch.punch_date == datetime(2026, 8, 19).date()
        assert aug18_sess.punch.punch_date == datetime(2026, 8, 18).date()


def test_web_open_session_biometric_behavior(client, stack):
    """Open web session blocks biometric; web session stays open."""
    with stack.app.app_context():
        punch = stack.Punch(admin_id=42, punch_date=datetime(2026, 8, 19).date())
        stack.db.session.add(punch)
        stack.db.session.flush()
        web = stack.PunchSession(
            punch_id=punch.id,
            clock_in=datetime(2026, 8, 19, 8, 0, 0),
            clock_out=None,
            is_wfh=False,
            source="web",
        )
        stack.db.session.add(web)
        stack.db.session.commit()
        web_id = web.id

        _post_attlog(client, _att(ts="2026-08-19 10:08:03"))

        assert stack.PunchSession.query.count() == 1
        web = stack.PunchSession.query.get(web_id)
        assert web.clock_out is None
        log = stack.BiometricLog.query.first()
        assert log.status == "ignored_open_web_session"
        assert log.punch_session_id == web_id
