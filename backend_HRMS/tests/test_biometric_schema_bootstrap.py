"""Biometric schema bootstrap — isolated sqlite, mirrors _ensure_biometric_schema_tables."""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

import pytest
from sqlalchemy import inspect

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


def _ensure_biometric_schema_tables(db, models):
    """Same logic as website/__init__.py _ensure_biometric_schema_tables."""
    insp = inspect(db.engine)
    existing = set(insp.get_table_names())
    tables_in_order = (
        ("biometric_devices", models.BiometricDevice),
        ("biometric_logs", models.BiometricLog),
        ("biometric_day_state", models.BiometricDayState),
        ("biometric_employee_map", models.BiometricEmployeeMap),
    )
    for table_name, model in tables_in_order:
        if table_name in existing:
            continue
        model.__table__.create(bind=db.engine, checkfirst=True)
        existing.add(table_name)


@pytest.fixture(scope="module")
def bio_schema_stack():
    for key in list(sys.modules):
        if key.startswith("website.biometric") or key == "website":
            sys.modules.pop(key, None)
    _ensure_packages()

    from flask import Flask
    from flask_sqlalchemy import SQLAlchemy

    app = Flask("bio_schema_test")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db = SQLAlchemy()
    website = sys.modules["website"]
    website.db = db
    db.init_app(app)

    models = _load("biometric.models", _BIO / "models.py")

    with app.app_context():
        if "admins" not in db.metadata.tables:
            db.Table(
                "admins",
                db.metadata,
                db.Column("id", db.Integer, primary_key=True),
                extend_existing=True,
            )
        _ensure_biometric_schema_tables(db, models)
        _ensure_biometric_schema_tables(db, models)  # idempotent second pass

    yield app, db, models


def test_biometric_schema_tables_created(bio_schema_stack):
    app, db, models = bio_schema_stack
    expected = {
        "biometric_devices",
        "biometric_logs",
        "biometric_day_state",
        "biometric_employee_map",
    }
    with app.app_context():
        names = set(inspect(db.engine).get_table_names())
        assert expected <= names


def test_biometric_devices_columns(bio_schema_stack):
    app, db, models = bio_schema_stack
    with app.app_context():
        cols = {c["name"] for c in inspect(db.engine).get_columns("biometric_devices")}
        assert {
            "id",
            "serial_number",
            "name",
            "allowed_ips",
            "is_active",
            "timezone",
            "last_seen_at",
            "created_at",
            "updated_at",
        } <= cols
        indexes = inspect(db.engine).get_indexes("biometric_devices")
        indexed_cols = {tuple(ix.get("column_names") or []) for ix in indexes}
        uniques = inspect(db.engine).get_unique_constraints("biometric_devices")
        unique_cols = {tuple(u.get("column_names") or []) for u in uniques}
        assert ("serial_number",) in indexed_cols or ("serial_number",) in unique_cols


def test_biometric_employee_map_fks_and_uniques(bio_schema_stack):
    app, db, models = bio_schema_stack
    with app.app_context():
        cols = {c["name"] for c in inspect(db.engine).get_columns("biometric_employee_map")}
        assert "emp_id" in cols
        fks = inspect(db.engine).get_foreign_keys("biometric_employee_map")
        fk_cols = {tuple(fk["constrained_columns"]) for fk in fks}
        assert ("admin_id",) in fk_cols
        assert ("device_id",) in fk_cols
        uniques = inspect(db.engine).get_unique_constraints("biometric_employee_map")
        assert any(u.get("name") == "uq_bio_map_user_device" for u in uniques)


def test_biometric_day_state_unique(bio_schema_stack):
    app, db, models = bio_schema_stack
    with app.app_context():
        uniques = inspect(db.engine).get_unique_constraints("biometric_day_state")
        assert any(u.get("name") == "uq_bio_day_admin_date" for u in uniques)


def test_biometric_logs_idempotency_key_unique(bio_schema_stack):
    app, db, models = bio_schema_stack
    with app.app_context():
        uniques = inspect(db.engine).get_unique_constraints("biometric_logs")
        unique_cols = {tuple(u.get("column_names") or []) for u in uniques}
        indexes = inspect(db.engine).get_indexes("biometric_logs")
        indexed_unique = {
            tuple(ix.get("column_names") or [])
            for ix in indexes
            if ix.get("unique")
        }
        assert ("idempotency_key",) in unique_cols or ("idempotency_key",) in indexed_unique
