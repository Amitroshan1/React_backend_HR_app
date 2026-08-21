"""HR Biometric Attendance reporting endpoints (read-only over biometric_logs).

Uses an isolated Flask + SQLAlchemy (sqlite memory) app with a minimal Admin
model and the real biometric models + hr_views blueprint.
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
    if "website.models" not in sys.modules:
        models = types.ModuleType("website.models")
        models.__path__ = [str(_WEB / "models")]
        sys.modules["website.models"] = models
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
def hr_stack():
    for key in list(sys.modules):
        if key.startswith("website.biometric") or key.startswith("website.models"):
            sys.modules.pop(key, None)
    _ensure_packages()

    from flask import Flask
    from flask_jwt_extended import JWTManager
    from flask_sqlalchemy import SQLAlchemy

    app = Flask("biometric_hr_test")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["TESTING"] = True
    app.config["JWT_SECRET_KEY"] = "test-secret"
    app.config["JWT_TOKEN_LOCATION"] = ["headers"]

    db = SQLAlchemy()
    website = sys.modules["website"]
    website.db = db

    # Minimal Admin model (fields used by hr_views).
    from sqlalchemy import Boolean, Column, Date, Integer, String

    class Admin(db.Model):
        __tablename__ = "admins"
        id = Column(Integer, primary_key=True)
        emp_id = Column(String(10), unique=True, nullable=True)
        first_name = Column(String(150), nullable=True)
        emp_type = Column(String(50), nullable=True)
        circle = Column(String(50), nullable=True)
        is_active = Column(Boolean, default=True)
        is_exited = Column(Boolean, default=False)

    admin_mod = types.ModuleType("website.models.Admin_models")
    admin_mod.Admin = Admin
    sys.modules["website.models.Admin_models"] = admin_mod

    # Real biometric models.
    bio_models = _load("website.biometric.models", _BIO / "models.py")

    # Stub website.utility.send_excel_file for the export test.
    captured = {}

    def _fake_send_excel_file(file_obj, download_name, mimetype=None):
        captured["download_name"] = download_name
        captured["bytes"] = file_obj.read() if hasattr(file_obj, "read") else None
        return "EXPORTED"

    util_mod = types.ModuleType("website.utility")
    util_mod.send_excel_file = _fake_send_excel_file
    sys.modules["website.utility"] = util_mod

    # Load hr_views (imports Admin + biometric models + utility lazily).
    hr_views = _load("website.biometric.hr_views", _BIO / "hr_views.py")

    jwt = JWTManager(app)
    db.init_app(app)
    app.register_blueprint(hr_views.biometric_hr_bp, url_prefix="/api/hr/biometric")

    with app.app_context():
        db.create_all()
        # Seed employees
        a1 = Admin(emp_id="10236", first_name="Amit Kumar", emp_type="Engineering", circle="NHQ")
        a2 = Admin(emp_id="10237", first_name="Riya Shah", emp_type="Engineering", circle="NHQ")
        a3 = Admin(emp_id="10238", first_name="Sara", emp_type="HR", circle="NHQ")
        db.session.add_all([a1, a2, a3])
        db.session.flush()

        # Device
        dev = bio_models.BiometricDevice(
            serial_number="NES1254800218",
            name="NHQ Door",
            is_active=True,
            last_seen_at=datetime(2026, 8, 20, 15, 0, 0),
        )
        db.session.add(dev)

        def add_log(admin_id, pin, dt, status="processed", verify="state=0;verify=1", key_suffix=""):
            raw = f"{pin}\t0\t1" if dt is None else f"{pin}\t{dt.strftime('%Y-%m-%d %H:%M:%S')}\t0\t1"
            key = f"{pin}|{dt.isoformat() if dt else 'none'}|{status}|{key_suffix}"
            db.session.add(
                bio_models.BiometricLog(
                    device_serial_number="NES1254800218",
                    device_user_id=pin,
                    punch_time=dt,
                    verification_mode=verify,
                    raw_payload=raw,
                    status=status,
                    idempotency_key=key,
                    admin_id=admin_id,
                )
            )

        # Employee 10236: 10 scans on 2026-08-20 (two with identical timestamp).
        times = [
            "09:03:16", "09:17:42", "10:31:05", "12:04:21", "13:10:44",
            "14:22:43", "14:22:44", "14:30:12", "14:35:01", "14:36:28",
        ]
        for t in times:
            hh, mm, ss = (int(x) for x in t.split(":"))
            add_log(a1.id, "10236", datetime(2026, 8, 20, hh, mm, ss))
        # Add an exact-duplicate timestamp record (still a distinct row).
        add_log(a1.id, "10236", datetime(2026, 8, 20, 14, 22, 44), status="processed", key_suffix="dup")

        # Employee 10236: 2 scans on 2026-08-21.
        add_log(a1.id, "10236", datetime(2026, 8, 21, 9, 0, 0))
        add_log(a1.id, "10236", datetime(2026, 8, 21, 18, 0, 0))

        # Employee 10237: 1 scan on 2026-08-20.
        add_log(a2.id, "10237", datetime(2026, 8, 20, 9, 30, 0))

        # Unmapped PIN 10320: 1 scan on 2026-08-20 (admin_id NULL).
        add_log(None, "10320", datetime(2026, 8, 20, 14, 36, 28), status="unknown_employee")

        # Invalid/protocol records that must NOT count as scans:
        # - failed (bad timestamp)
        add_log(a1.id, "10236", None, status="failed")
        # - duplicate (already ingested)
        add_log(a1.id, "10236", datetime(2026, 8, 20, 9, 3, 16), status="duplicate")
        # - unknown_device
        add_log(a1.id, "10236", datetime(2026, 8, 20, 9, 3, 16), status="unknown_device")

        db.session.commit()
        ids = {"a1": a1.id, "a2": a2.id, "a3": a3.id}

    return types.SimpleNamespace(
        app=app,
        db=db,
        jwt=jwt,
        bio_models=bio_models,
        captured=captured,
        admin_ids=ids,
    )


def _hr_token(hr_stack):
    from flask_jwt_extended import create_access_token

    with hr_stack.app.app_context():
        return create_access_token(identity="1", additional_claims={"emp_type": "HR"})


def _emp_token(hr_stack):
    from flask_jwt_extended import create_access_token

    with hr_stack.app.app_context():
        return create_access_token(identity="2", additional_claims={"emp_type": "Engineering"})


def _get(hr_stack, path, token):
    return hr_stack.app.test_client().get(
        path, headers={"Authorization": f"Bearer {token}"}
    )


def test_unauthorized_employee_forbidden(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/summary", _emp_token(hr_stack))
    assert res.status_code == 403


def test_hr_authorized_summary(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/summary", _hr_token(hr_stack))
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True


def test_ten_scan_scenario(hr_stack):
    """Employee 10236 on 2026-08-20: 10 valid scans + 1 exact-duplicate timestamp = 11."""
    res = _get(
        hr_stack,
        f"/api/hr/biometric/summary?date=2026-08-20&admin_id={hr_stack.admin_ids['a1']}",
        _hr_token(hr_stack),
    )
    data = res.get_json()
    rows = [r for r in data["rows"] if r["mapped"] and r["emp_id"] == "10236"]
    assert len(rows) == 1
    row = rows[0]
    assert row["scan_count"] == 11, row
    assert row["first_scan"] == "2026-08-20 09:03:16"
    assert row["last_scan"] == "2026-08-20 14:36:28"
    assert isinstance(row["total_scans"], list)
    assert len(row["total_scans"]) == 11
    assert row["employee_name"] == "Amit Kumar"
    assert row["emp_type"] == "Engineering"
    assert row["circle"] == "NHQ"
    assert row["mapped"] is True


def test_detail_returns_all_scans(hr_stack):
    res = _get(
        hr_stack,
        f"/api/hr/biometric/employee/{hr_stack.admin_ids['a1']}/day/2026-08-20",
        _hr_token(hr_stack),
    )
    data = res.get_json()
    assert data["success"] is True
    scans = data["scans"]
    assert len(scans) == 11, len(scans)
    # All 10 distinct timestamps present, plus the duplicate-timestamp row.
    times = [s["punch_time"] for s in scans]
    assert "2026-08-20 09:03:16" in times
    assert "2026-08-20 14:36:28" in times
    assert times.count("2026-08-20 14:22:44") == 2
    # Ordered ascending.
    assert times == sorted(times)


def test_unmapped_pin_visible(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/summary?date=2026-08-20", _hr_token(hr_stack))
    data = res.get_json()
    unmapped = [r for r in data["rows"] if not r["mapped"]]
    assert any(r["device_user_id"] == "10320" and r["scan_count"] == 1 for r in unmapped)
    row = next(r for r in unmapped if r["device_user_id"] == "10320")
    assert row["admin_id"] is None
    assert row["employee_name"] is None
    assert row["first_scan"] == "2026-08-20 14:36:28"
    assert row["last_scan"] == "2026-08-20 14:36:28"


def test_unmapped_detail(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/unmapped/10320/day/2026-08-20", _hr_token(hr_stack))
    data = res.get_json()
    assert data["success"] is True
    assert len(data["scans"]) == 1
    assert data["scans"][0]["device_user_id"] == "10320"
    assert data["scans"][0]["mapped"] is False


def test_invalid_records_not_counted(hr_stack):
    """failed / duplicate / unknown_device must not inflate scan_count."""
    res = _get(
        hr_stack,
        f"/api/hr/biometric/summary?date=2026-08-20&admin_id={hr_stack.admin_ids['a1']}",
        _hr_token(hr_stack),
    )
    data = res.get_json()
    row = next(r for r in data["rows"] if r["mapped"] and r["emp_id"] == "10236")
    # 10 distinct + 1 duplicate-timestamp = 11. The failed/duplicate/unknown_device rows are excluded.
    assert row["scan_count"] == 11, row["scan_count"]


def test_month_filter(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/summary?month=2026-08", _hr_token(hr_stack))
    data = res.get_json()
    dates = {r["date"] for r in data["rows"]}
    assert "2026-08-20" in dates
    assert "2026-08-21" in dates


def test_date_range_filter(hr_stack):
    res = _get(
        hr_stack,
        "/api/hr/biometric/summary?start=2026-08-21&end=2026-08-21",
        _hr_token(hr_stack),
    )
    data = res.get_json()
    dates = {r["date"] for r in data["rows"]}
    assert dates == {"2026-08-21"}


def test_employee_id_filter(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/summary?emp_id=10237", _hr_token(hr_stack))
    data = res.get_json()
    assert all(r["emp_id"] == "10237" for r in data["rows"] if r["mapped"])


def test_emp_type_filter(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/summary?emp_type=Engineering", _hr_token(hr_stack))
    data = res.get_json()
    mapped = [r for r in data["rows"] if r["mapped"]]
    assert mapped and all(r["emp_type"] == "Engineering" for r in mapped)


def test_circle_filter(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/summary?circle=NHQ", _hr_token(hr_stack))
    data = res.get_json()
    mapped = [r for r in data["rows"] if r["mapped"]]
    assert mapped and all(r["circle"] == "NHQ" for r in mapped)


def test_device_filter(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/summary?device_sn=NES1254800218", _hr_token(hr_stack))
    assert res.status_code == 200
    data = res.get_json()
    assert data["total"] > 0


def test_devices_endpoint(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/devices", _hr_token(hr_stack))
    data = res.get_json()
    assert data["success"] is True
    assert any(d["serial_number"] == "NES1254800218" for d in data["devices"])


def test_pagination(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/summary?per_page=2&page=1", _hr_token(hr_stack))
    data = res.get_json()
    assert len(data["rows"]) <= 2
    assert data["per_page"] == 2
    assert data["page"] == 1
    assert data["total"] == data["total_pages"] * 2 or data["total"] <= 2
    assert data["total"] >= 1


def test_empty_result(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/summary?date=2020-01-01", _hr_token(hr_stack))
    data = res.get_json()
    assert data["rows"] == []
    assert data["total"] == 0


def test_export(hr_stack):
    res = _get(hr_stack, "/api/hr/biometric/export?date=2026-08-20", _hr_token(hr_stack))
    assert res.status_code == 200
    assert hr_stack.captured["download_name"] == "Biometric_Attendance.xlsx"
    assert hr_stack.captured["bytes"] is not None
