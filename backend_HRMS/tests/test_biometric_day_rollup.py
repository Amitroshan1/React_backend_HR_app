"""Incremental biometric_attendance_day rollup (isolated sqlite)."""

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


def _load(mod_name: str, path: Path):
    _ensure_packages()
    full = f"website.{mod_name}" if not mod_name.startswith("website.") else mod_name
    spec = importlib.util.spec_from_file_location(full, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[full] = mod
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def rollup_stack():
    for key in list(sys.modules):
        if key.startswith("website.biometric") or key == "website":
            sys.modules.pop(key, None)
    _ensure_packages()

    from flask import Flask
    from flask_sqlalchemy import SQLAlchemy

    app = Flask("bio_day_rollup_test")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["TESTING"] = True

    db = SQLAlchemy()
    website = sys.modules["website"]
    website.db = db
    db.init_app(app)

    models = _load("website.biometric.models", _BIO / "models.py")
    rollup = _load("website.biometric.day_rollup", _BIO / "day_rollup.py")

    with app.app_context():
        db.Table(
            "admins",
            db.metadata,
            db.Column("id", db.Integer, primary_key=True),
            extend_existing=True,
        )
        db.create_all()

    return types.SimpleNamespace(app=app, db=db, models=models, rollup=rollup)


def _add_log(db, models, pin, dt, status="processed", admin_id=1, suffix=""):
    log = models.BiometricLog(
        device_serial_number="NES1254800218",
        device_user_id=pin,
        punch_time=dt,
        status=status,
        idempotency_key=f"{pin}|{dt}|{status}|{suffix}",
        admin_id=admin_id,
        raw_payload="",
    )
    db.session.add(log)
    db.session.flush()
    return log


def test_incremental_upsert_appends_all_timestamps(rollup_stack):
    s = rollup_stack
    with s.app.app_context():
        t1 = datetime(2026, 8, 20, 9, 3, 16)
        t2 = datetime(2026, 8, 20, 14, 36, 28)
        t3 = datetime(2026, 8, 20, 14, 22, 44)
        l1 = _add_log(s.db, s.models, "10236", t1, suffix="a")
        l2 = _add_log(s.db, s.models, "10236", t2, suffix="b")
        l3 = _add_log(s.db, s.models, "10236", t3, suffix="c")
        s.rollup.upsert_attendance_day_from_log(l1)
        s.rollup.upsert_attendance_day_from_log(l2)
        s.rollup.upsert_attendance_day_from_log(l3)
        s.db.session.commit()

        row = s.models.BiometricAttendanceDay.query.filter_by(device_user_id="10236").one()
        assert row.admin_id == 1
        assert row.first_scan == t1
        assert row.last_scan == t2
        assert row.total_scans == [
            "2026-08-20 09:03:16",
            "2026-08-20 14:22:44",
            "2026-08-20 14:36:28",
        ]


def test_invalid_statuses_skipped(rollup_stack):
    s = rollup_stack
    with s.app.app_context():
        t = datetime(2026, 8, 20, 9, 0, 0)
        ok = _add_log(s.db, s.models, "10236", t, status="processed", suffix="ok")
        bad = _add_log(s.db, s.models, "10236", t, status="duplicate", suffix="dup")
        s.rollup.upsert_attendance_day_from_log(ok)
        assert s.rollup.upsert_attendance_day_from_log(bad) is None
        s.db.session.commit()
        row = s.models.BiometricAttendanceDay.query.one()
        assert row.total_scans == ["2026-08-20 09:00:00"]


def test_rebuild_from_logs(rollup_stack):
    s = rollup_stack
    with s.app.app_context():
        _add_log(s.db, s.models, "10236", datetime(2026, 8, 20, 9, 0, 0), suffix="1")
        _add_log(s.db, s.models, "10236", datetime(2026, 8, 20, 18, 0, 0), suffix="2")
        _add_log(s.db, s.models, "10320", datetime(2026, 8, 20, 14, 0, 0), admin_id=None, suffix="u")
        s.db.session.commit()
        n = s.rollup.rebuild_attendance_days_from_logs()
        s.db.session.commit()
        assert n == 2
        mapped = s.models.BiometricAttendanceDay.query.filter_by(device_user_id="10236").one()
        assert len(mapped.total_scans) == 2
        unmapped = s.models.BiometricAttendanceDay.query.filter_by(device_user_id="10320").one()
        assert unmapped.admin_id is None
