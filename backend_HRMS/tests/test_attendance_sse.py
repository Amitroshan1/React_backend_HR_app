"""Phase 3D: attendance SSE — auth, publish-after-commit, authorization filters.

Does not load website/__init__.py. Never creates Punch / PunchSession.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import types
from datetime import date, datetime
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WEB = _ROOT / "website"
_RT = _WEB / "attendance_realtime"


def _ensure_packages():
    if "website" not in sys.modules:
        website = types.ModuleType("website")
        website.__path__ = [str(_WEB)]
        sys.modules["website"] = website
    if "website.attendance_realtime" not in sys.modules:
        pkg = types.ModuleType("website.attendance_realtime")
        pkg.__path__ = [str(_RT)]
        sys.modules["website.attendance_realtime"] = pkg
    if "website.models" not in sys.modules:
        models_pkg = types.ModuleType("website.models")
        models_pkg.__path__ = [str(_WEB / "models")]
        sys.modules["website.models"] = models_pkg


def _load(full: str, path: Path):
    _ensure_packages()
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
    for key in list(sys.modules):
        if key.startswith("website.attendance_realtime") or key in (
            "website.datetime_utils",
            "website.manager",
        ):
            del sys.modules[key]
    _ensure_packages()

    _load("website.datetime_utils", _WEB / "datetime_utils.py")

    from flask import Flask, Blueprint
    from flask_sqlalchemy import SQLAlchemy

    app = Flask("attendance_sse_test")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-sse-secret"

    db = SQLAlchemy()
    sys.modules["website"].db = db

    class Admin(db.Model):
        __tablename__ = "admins"
        id = db.Column(db.Integer, primary_key=True)
        email = db.Column(db.String(120), nullable=True)
        emp_type = db.Column(db.String(64), nullable=True)
        first_name = db.Column(db.String(64), nullable=True)

    admin_models = types.ModuleType("website.models.Admin_models")
    admin_models.Admin = Admin
    sys.modules["website.models.Admin_models"] = admin_models

    # Stub manager team helper used by authz
    manager_mod = types.ModuleType("website.manager")

    def _team_member_admin_ids(manager_admin):
        # Manager 1 manages employee 2 only
        if getattr(manager_admin, "id", None) == 1:
            return [2]
        return []

    manager_mod._team_member_admin_ids = _team_member_admin_ids
    sys.modules["website.manager"] = manager_mod

    models = _load("website.attendance_realtime.models", _RT / "models.py")
    hub_mod = _load("website.attendance_realtime.hub", _RT / "hub.py")
    authz = _load("website.attendance_realtime.authz", _RT / "authz.py")
    publisher = _load("website.attendance_realtime.publisher", _RT / "publisher.py")

    pkg = sys.modules["website.attendance_realtime"]
    bp = Blueprint("attendance_realtime", __name__)
    pkg.attendance_realtime_bp = bp
    routes = _load("website.attendance_realtime.routes", _RT / "routes.py")

    from flask_jwt_extended import JWTManager, create_access_token

    jwt = JWTManager(app)
    app.register_blueprint(bp, url_prefix="/api/attendance")

    db.init_app(app)
    with app.app_context():
        db.create_all()
        db.session.add(Admin(id=1, email="mgr@t.com", emp_type="Manager", first_name="M"))
        db.session.add(Admin(id=2, email="emp@t.com", emp_type="Engineer", first_name="E"))
        db.session.add(Admin(id=3, email="hr@t.com", emp_type="Human Resource", first_name="H"))
        db.session.add(Admin(id=4, email="other@t.com", emp_type="Engineer", first_name="O"))
        db.session.commit()

    return types.SimpleNamespace(
        app=app,
        db=db,
        Admin=Admin,
        models=models,
        hub=hub_mod.hub,
        authz=authz,
        publisher=publisher,
        routes=routes,
        create_access_token=create_access_token,
        jwt=jwt,
    )


@pytest.fixture
def client(stack):
    with stack.app.app_context():
        # wipe outbox between tests
        stack.db.session.execute(stack.models.AttendanceRealtimeEvent.__table__.delete())
        stack.db.session.commit()
        yield stack.app.test_client()


def _token(stack, admin_id: int) -> str:
    with stack.app.app_context():
        return stack.create_access_token(identity=str(admin_id))


def test_1_authenticated_sse_connects(client, stack):
    tok = _token(stack, 2)
    # stream_with_context: read a chunk then close
    resp = client.get(
        f"/api/attendance/events?access_token={tok}",
        buffered=False,
    )
    assert resp.status_code == 200
    assert "text/event-stream" in resp.content_type
    # Close without reading forever
    resp.close()


def test_2_unauthenticated_rejected(client):
    resp = client.get("/api/attendance/events")
    assert resp.status_code == 401


def test_3_publish_creates_outbox_and_local_event(client, stack):
    with stack.app.app_context():
        received = []
        sub = stack.hub.subscribe(2, {2})

        stack.publisher.publish_attendance_updated_now(
            employee_admin_id=2,
            attendance_date=date(2026, 8, 17),
            punch_session_id=99,
            source="biometric",
            event_time=datetime(2026, 8, 17, 9, 1, 22),
        )
        ev = sub.q.get(timeout=2)
        received.append(ev)
        stack.hub.unsubscribe(sub)

        assert received[0]["event"] == "attendance.updated"
        assert received[0]["employee_id"] == 2
        assert received[0]["source"] == "biometric"
        assert stack.models.AttendanceRealtimeEvent.query.count() == 1


def test_4_employee_cannot_see_other(stack):
    with stack.app.app_context():
        a2 = stack.Admin.query.get(2)
        a4 = stack.Admin.query.get(4)
        assert stack.authz.viewer_may_see_employee(a2, 2) is True
        assert stack.authz.viewer_may_see_employee(a2, 4) is False
        assert stack.authz.viewer_may_see_employee(a4, 2) is False


def test_5_manager_sees_team_only(stack):
    with stack.app.app_context():
        mgr = stack.Admin.query.get(1)
        assert stack.authz.viewer_may_see_employee(mgr, 2) is True
        assert stack.authz.viewer_may_see_employee(mgr, 4) is False
        assert stack.authz.viewer_may_see_employee(mgr, 1) is True


def test_6_hr_sees_all(stack):
    with stack.app.app_context():
        hr = stack.Admin.query.get(3)
        assert stack.authz.resolve_allowed_employee_ids(hr) is None
        assert stack.authz.viewer_may_see_employee(hr, 4) is True


def test_7_queue_after_commit_only(stack):
    """Rolled-back transaction must not publish."""
    with stack.app.app_context():
        before = stack.models.AttendanceRealtimeEvent.query.count()
        stack.publisher.queue_attendance_updated(
            employee_admin_id=2,
            attendance_date=date(2026, 8, 17),
            source="web",
        )
        stack.db.session.rollback()
        assert stack.models.AttendanceRealtimeEvent.query.count() == before

        stack.publisher.queue_attendance_updated(
            employee_admin_id=2,
            attendance_date=date(2026, 8, 17),
            source="web",
        )
        stack.db.session.commit()
        assert stack.models.AttendanceRealtimeEvent.query.count() == before + 1


def test_8_sse_module_never_writes_punch():
    for fname in ("publisher.py", "routes.py", "hub.py", "authz.py", "models.py"):
        text = (_RT / fname).read_text(encoding="utf-8")
        assert "PunchSession(" not in text
        assert "punch_in(" not in text
        assert "punch_out(" not in text
        assert "recompute_punch_aggregate(" not in text


def test_9_outbox_fetch_since(stack):
    with stack.app.app_context():
        stack.publisher.publish_attendance_updated_now(
            employee_admin_id=2, attendance_date=date(2026, 8, 17), source="web"
        )
        stack.publisher.publish_attendance_updated_now(
            employee_admin_id=2, attendance_date=date(2026, 8, 17), source="web"
        )
        latest = stack.publisher.latest_outbox_id()
        rows = stack.publisher.fetch_outbox_since(latest - 1, limit=10)
        assert len(rows) >= 1
        assert rows[-1]["id"] == latest


def test_10_health(client):
    resp = client.get("/api/attendance/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["phase"] == "3D"
