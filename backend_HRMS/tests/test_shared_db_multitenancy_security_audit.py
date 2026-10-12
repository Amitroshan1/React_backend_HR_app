"""
Rollout step 10 — cross-company security audit over every HTTP route.

Every table gets one row per company: company 1's row carries a marker string in
every text column (``zqleak…``), company 2's row neutral values. Integer columns
hold the company number, so each row's ids and references (admin_id, leave_id,
unit_id, …) point at the same company's rows. Employee identity values (email,
emp_id, mobile, user name) are the same in both companies, as real customers have.

Then users of company 2 (org admin, HR, Accounts, IT, manager, employee, and
anonymous) call every registered route with company 1's ids in the URL, query
string and JSON body. A route fails the audit when

- a successful (2xx) response contains company 1's marker (data leak), or
- company 1's rows changed (cross-company write, or a new row that counts as
  company 1: its owner column is company 1 or its tenant_id is NULL).

The database is restored after every route. Tables that are global on purpose
are seeded without the marker (``GLOBAL_TABLES``).
"""
from __future__ import annotations

import hashlib
import importlib
import pkgutil
import re
import sqlite3
from datetime import date, datetime, time

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Time,
    or_,
    select,
)
from sqlalchemy.types import TypeDecorator

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    # confirmation_request references a Signup model that is not defined.
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")
importlib.import_module("website.biometric.models")
importlib.import_module("website.attendance_realtime.models")

from website.tenant_context import register_tenant_guards  # noqa: E402

MARK = "zqleak"
TODAY = date(2026, 3, 10)
EMPLOYEE_ID = {1: 1, 2: 2}  # the seeded employee of each company
SHARED_EMAIL = "dup@x.com"
SHARED_EMP_ID = "E1"

# Tables seeded without the marker because they are global on purpose
# (see SHARED_DB_MULTI_TENANCY.md, rollout step 10).
GLOBAL_TABLES = frozenset({
    "tenants",  # platform registry (platform admins only)
    "deployed_customers",  # platform registry bridge
    "audit_logs",  # platform log, no read route
    "offboarding_reminder_logs",  # scheduler dedupe keys
    "geo_config_changes",  # platform geo settings: changes/history limited to the platform company
    "geo_config_overrides",
})

# Company 2 callers: (admin id, emp_type, email, emp_id).
CALLERS = {
    "admin": (21, "Admin", "admin@two.com", "A21"),
    "hr": (22, "Human Resource", "hr@two.com", "A22"),
    "accounts": (23, "Accounts", "accounts@two.com", "A23"),
    "it": (24, "IT", "it@two.com", "A24"),
    "manager": (25, "Manager", "manager@two.com", "A25"),
    "employee": (26, "Engineering", "emp@two.com", "A26"),
}

# Routes whose responses never finish (server-sent events).
SKIP_RULES = frozenset({"/api/attendance/events"})

STRING_ARGS = {
    "emp_id": SHARED_EMP_ID,
    "email_path": SHARED_EMAIL,
    "master_type": "department",
    "date_str": TODAY.isoformat(),
    "pincode": "110001",
    "doc_type": "aadhaar",
    "attempt_id": MARK + "attempt_id",
}

# Second query string for GET routes that default to "today": a range around the seed dates.
DATE_RANGE_ARGS = {
    "from": "2026-02-01", "to": "2026-04-30",
    "date_from": "2026-02-01", "date_to": "2026-04-30",
    "start_date": "2026-02-01", "end_date": "2026-04-30",
    "start": "2026-02-01", "end": "2026-04-30",
    "month": "2026-03", "year": 2026,
}


# --- Seeding -------------------------------------------------------------------


def _base_type(col_type):
    if isinstance(col_type, TypeDecorator):
        impl = getattr(col_type, "impl_instance", None) or col_type.impl
        return impl() if isinstance(impl, type) else impl
    return col_type


def _is_int(col) -> bool:
    return isinstance(_base_type(col.type), Integer) and not isinstance(_base_type(col.type), Boolean)


def _admin_ref_columns(table):
    """Integer columns that name an employee without a declared foreign key."""
    fk_cols = {fk.parent.name for fk in table.foreign_keys}
    return [
        c for c in table.columns
        if _is_int(c) and c.name not in fk_cols and not c.primary_key
        and (c.name == "admin_id" or c.name.endswith("_admin_id"))
    ]


def _owned_tables(metadata) -> set[str]:
    """Tables whose rows belong to one company: tenant_id, or a link to an owned table."""
    owned = {"admins"}
    changed = True
    while changed:
        changed = False
        for t in metadata.sorted_tables:
            if t.name in owned or t.name in GLOBAL_TABLES:
                continue
            refs = {fk.column.table.name for fk in t.foreign_keys}
            if "tenant_id" in t.columns or refs & owned or _admin_ref_columns(t):
                owned.add(t.name)
                changed = True
    return owned


def _value(col, company: int, marked: bool):
    t = _base_type(col.type)
    if isinstance(t, Boolean):
        return False
    if isinstance(t, Integer):
        return company
    if isinstance(t, (Float, Numeric)):
        return float(company)
    if isinstance(t, DateTime):
        return datetime(2026, 3, 1, 9, 0)
    if isinstance(t, Date):
        return TODAY
    if isinstance(t, Time):
        return time(9, 0)
    if isinstance(t, Enum):
        return t.enums[0] if t.enums else None
    if isinstance(t, JSON):
        return None if col.nullable else {}
    if isinstance(t, LargeBinary):
        return b""
    if isinstance(t, String):
        text = f"{MARK}{col.name}" if marked else f"ok{company}{col.name}"
        length = getattr(t, "length", None)
        return text[:length] if length else text
    return None


def _row(table, company: int, marked: bool) -> dict:
    return {c.name: _value(c, company, marked) for c in table.columns}


def _admin_row(table, admin_id, company, marked, **overrides):
    row = _row(table, company, marked)
    row.update(
        id=admin_id, tenant_id=company, email=SHARED_EMAIL, emp_id=SHARED_EMP_ID,
        is_active=True, is_exited=False, exit_login_until=None,
    )
    for col in ("mobile", "user_name"):
        if col in table.columns:
            row[col] = f"shared-{col}"
    row.update(overrides)
    return {k: v for k, v in row.items() if k in table.columns}


def _seed(metadata, owned):
    from website.models.tenant import Tenant

    db.session.add_all([
        Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
        Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
    ])
    db.session.flush()
    for table in metadata.sorted_tables:
        if table.name == "tenants":
            continue
        if table.name == "admins":
            rows = [_admin_row(table, 1, 1, True), _admin_row(table, 2, 2, False)]
            for aid, emp_type, email, emp_id in CALLERS.values():
                rows.append(_admin_row(
                    table, aid, 2, False, emp_type=emp_type, email=email, emp_id=emp_id,
                    **{c: f"{c}-{aid}" for c in ("mobile", "user_name") if c in table.columns},
                ))
        else:
            marked = table.name in owned
            rows = [_row(table, 1, marked), _row(table, 2, False)]
        db.session.execute(table.insert(), rows)
    db.session.commit()


def _company1_predicate(table, owned):
    """SQL condition matching rows that count as company 1."""
    conds = []
    pk = list(table.primary_key.columns)
    if len(pk) == 1 and _is_int(pk[0]):
        conds.append(pk[0] == 1)
    if "tenant_id" in table.columns:
        conds += [table.c.tenant_id == 1, table.c.tenant_id.is_(None)]
    for fk in table.foreign_keys:
        if fk.column.table.name in owned:
            conds.append(fk.parent == 1)
    conds += [c == 1 for c in _admin_ref_columns(table)]
    return or_(*conds) if conds else None


def _company1_fingerprint(metadata, owned) -> dict[str, str]:
    out = {}
    for table in metadata.sorted_tables:
        if table.name not in owned:
            continue
        pred = _company1_predicate(table, owned)
        if pred is None:
            continue
        rows = db.session.execute(select(table).where(pred)).all()
        rows = sorted(repr(tuple(r)) for r in rows)
        out[table.name] = hashlib.sha1("\n".join(rows).encode()).hexdigest()
    return out


# --- App -----------------------------------------------------------------------


def _register_blueprints(app):
    from website.Accounts import Accounts
    from website.Admin import admin_bp
    from website.Human_resource import hr
    from website.attendance_realtime import attendance_realtime_bp
    from website.attendance_realtime import routes as _realtime_routes  # noqa: F401
    from website.auth import auth
    from website.biometric import biometric_bp
    from website.biometric.hr_views import biometric_hr_bp
    from website.daily_checkout.views import daily_checkout_bp
    from website.files import files_bp
    from website.it import it_bp
    from website.leave_attendence import leave
    from website.manager import manager
    from website.notifications import notifications
    from website.performance_api import performance_api
    from website.probation_api import probation_api
    from website.query import query

    for bp, prefix in [
        (auth, "/api/auth"), (admin_bp, "/api/admin"), (leave, "/api/leave"),
        (hr, "/api/HumanResource"), (Accounts, "/api/accounts"), (query, "/api/query"),
        (manager, "/api/manager"), (it_bp, "/api/it"), (daily_checkout_bp, "/api/it/daily-checkout"),
        (notifications, "/api/notifications"), (performance_api, "/api/performance"),
        (probation_api, "/api/probation"), (files_bp, "/api/files"), (biometric_bp, "/iclock"),
        (biometric_hr_bp, "/api/hr/biometric"), (attendance_realtime_bp, "/api/attendance"),
    ]:
        app.register_blueprint(bp, url_prefix=prefix)

    @app.route("/static/uploads/<path:filename>", methods=["GET", "HEAD"])
    def protected_static_uploads(filename):
        from website.secure_file_service import serve_upload_with_request_auth

        return serve_upload_with_request_auth(filename)


def _build_app(upload_dir):
    app = Flask("tenancy_security_audit")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite://",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-security-audit-secret-32b",
        SECRET_KEY="test-tenancy-security-audit",
        CUSTOMER_PLAN="enterprise",
        SHOW_DEPLOYMENT_GUIDE=True,
        UPLOADS_ROOT=str(upload_dir),
        UPLOAD_FOLDER=str(upload_dir),
        BASE_URL="https://hr.example.test",
        ZEPTO_API_KEY="test",
        ZEPTO_SENDER_EMAIL="noreply@example.test",
        TESTING=True,
        # Synthetic rows can crash a route; that is a 500, not an audit finding.
        PROPAGATE_EXCEPTIONS=False,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    _register_blueprints(app)
    return app


def _rules():
    app = Flask("tenancy_security_audit_rules")
    _register_blueprints(app)
    out = []
    for rule in app.url_map.iter_rules():
        if rule.endpoint == "static" or rule.rule in SKIP_RULES:
            continue
        methods = sorted(rule.methods - {"HEAD", "OPTIONS"})
        out.append(pytest.param(rule.rule, methods, id=f"{'|'.join(methods)} {rule.rule}"))
    return out


class _Audit:
    def __init__(self, app, owned, seed_copy):
        self.app = app
        self.owned = owned
        self.seed_copy = seed_copy
        self.headers = {}
        with app.app_context():
            for name, (aid, emp_type, email, _) in CALLERS.items():
                token = create_access_token(
                    identity=str(aid),
                    additional_claims={"email": email, "emp_type": emp_type, "tenant_id": 2},
                )
                self.headers[name] = {"Authorization": f"Bearer {token}"}
            self.headers["anonymous"] = {}
            self.id_keys = sorted({
                c.name for t in db.metadata.sorted_tables for c in t.columns
                if c.name.endswith("_id") and c.name != "tenant_id"
            } | {"id"})

    def _main_connection(self) -> sqlite3.Connection:
        return db.engine.raw_connection().driver_connection

    def restore(self):
        with self.app.app_context():
            db.session.remove()
            self.seed_copy.backup(self._main_connection())

    def fingerprint(self):
        with self.app.app_context():
            fp = _company1_fingerprint(db.metadata, self.owned)
            db.session.remove()
            return fp

    def url(self, rule: str) -> str:
        def sub(match):
            converter, name = match.group(1), match.group(2)
            if converter == "int":
                return "1"
            if converter == "path":
                return "tenants/1/audit/missing.pdf"
            return STRING_ARGS.get(name, "1")

        path = re.sub(r"<(?:(\w+)(?:\([^)]*\))?:)?(\w+)>", sub, rule)
        return path

    def body(self) -> dict:
        data = {k: 1 for k in self.id_keys}
        data.update({
            "ids": [1], "admin_ids": [1], "employee_ids": [1],
            "emp_id": SHARED_EMP_ID, "email": SHARED_EMAIL,
            "status": "Approved", "action": "approve",
            "reason": "audit", "remarks": "audit", "comment": "audit",
        })
        return data

    def query_string(self, dated: bool = False) -> dict:
        qs = {k: 1 for k in ("id", "admin_id", "employee_id", "user_id")}
        qs.update(emp_id=SHARED_EMP_ID, email=SHARED_EMAIL)
        if dated:
            qs.update(DATE_RANGE_ARGS)
        return qs


@pytest.fixture(scope="module")
def audit(tmp_path_factory):
    app = _build_app(tmp_path_factory.mktemp("uploads"))
    with app.app_context():
        db.create_all()
        owned = _owned_tables(db.metadata)
        _seed(db.metadata, owned)
        seed_copy = sqlite3.connect(":memory:")
        db.engine.raw_connection().driver_connection.backup(seed_copy)
        db.session.remove()
    audit = _Audit(app, owned, seed_copy)
    audit.baseline = audit.fingerprint()
    yield audit
    with app.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture(autouse=True)
def _no_outside_world(monkeypatch):
    import requests

    import website.email as email_module

    def _blocked(*_a, **_kw):
        raise requests.ConnectionError("network disabled in security audit")

    monkeypatch.setattr(requests, "request", _blocked)
    monkeypatch.setattr(requests, "get", _blocked)
    monkeypatch.setattr(requests, "post", _blocked)
    monkeypatch.setattr(requests.Session, "request", _blocked)
    monkeypatch.setattr(email_module, "send_email_via_zeptomail", lambda *a, **k: (True, "ok"))


def _leak_snippet(body: bytes) -> str:
    i = body.find(MARK.encode())
    return body[max(0, i - 80): i + 60].decode("utf-8", "replace")


def test_every_table_is_company_owned_or_declared_global():
    """A table the audit cannot tie to a company would be seeded without the marker,
    so a leak from it would go unnoticed. New tables must be linked or listed."""
    unclassified = sorted(
        t.name for t in db.metadata.sorted_tables
        if t.name not in _owned_tables(db.metadata) and t.name not in GLOBAL_TABLES
    )
    assert not unclassified, (
        "tables with no tenant_id / admin link and not in GLOBAL_TABLES: " + ", ".join(unclassified)
    )
    stale = sorted(GLOBAL_TABLES - {t.name for t in db.metadata.sorted_tables})
    assert not stale, "GLOBAL_TABLES names unknown tables: " + ", ".join(stale)


def test_audit_reaches_route_logic(audit, capsys):
    """Positive control: the seed is visible to its own company and routes answer company 2."""
    with audit.app.app_context():
        own = {"Authorization": "Bearer " + create_access_token(
            identity="1",
            additional_claims={"email": SHARED_EMAIL, "emp_type": "Human Resource", "tenant_id": 1},
        )}
    client = audit.app.test_client()
    own_marker, ok, total, errors = 0, 0, 0, 0
    for param in _rules():
        rule, methods = param.values
        if "GET" not in methods:
            continue
        url = audit.url(rule)
        for headers in audit.headers.values():
            status = client.get(url, headers=headers, query_string=audit.query_string()).status_code
            total += 1
            ok += 200 <= status < 300
            errors += status >= 500
        resp = client.get(url, headers=own, query_string=audit.query_string())
        own_marker += resp.status_code < 300 and MARK.encode() in resp.get_data()
        audit.restore()
    with capsys.disabled():
        print(f"\naudit coverage: company-1 HR sees its marker on {own_marker} GET routes; "
              f"company-2 GET calls 2xx={ok} 5xx={errors} of {total}")
    assert own_marker >= 40
    assert ok >= 300


@pytest.mark.parametrize("rule, methods", _rules())
def test_route_never_crosses_companies(audit, rule, methods):
    client = audit.app.test_client()
    url = audit.url(rule)
    problems = []
    try:
        for method in methods:
            for caller, headers in audit.headers.items():
                if method == "GET":
                    responses = [
                        client.get(url, headers=headers, query_string=audit.query_string(dated))
                        for dated in (False, True)
                    ]
                else:
                    responses = [client.open(url, method=method, headers=headers, json=audit.body())]
                for resp in responses:
                    body = resp.get_data()
                    if 200 <= resp.status_code < 300 and MARK.encode() in body:
                        problems.append(
                            f"LEAK {method} as {caller} -> {resp.status_code}: …{_leak_snippet(body)}…"
                        )
        after = audit.fingerprint()
        changed = sorted(t for t, h in after.items() if audit.baseline.get(t) != h)
        if changed:
            problems.append(f"COMPANY 1 ROWS CHANGED in {changed}")
    finally:
        audit.restore()
    assert not problems, f"{rule}:\n" + "\n".join(problems)

# --- Targeted checks for the modules fixed by this audit ------------------------

HR = "/api/HumanResource"


def test_ats_by_id_routes_return_404_for_other_company(audit):
    client = audit.app.test_client()
    hr_headers = audit.headers["hr"]
    calls = [
        ("GET", f"{HR}/ats/candidates/1/hire-progress", None),
        ("GET", f"{HR}/ats/candidates/1/signup-payload", None),
        ("GET", f"{HR}/ats/candidates/1/offer-letter/pdf", None),
        ("PATCH", f"{HR}/ats/candidates/1/stage", {"stage": "screening"}),
        ("PUT", f"{HR}/ats/candidates/1/offer", {"annual_ctc": 100000}),
        ("POST", f"{HR}/ats/candidates/1/offer/send", {}),
        ("PATCH", f"{HR}/ats/requisitions/1", {"status": "closed"}),
        ("POST", f"{HR}/ats/candidates", {"requisition_id": 1, "full_name": "X", "email": "x@two.com"}),
    ]
    try:
        for method, url, body in calls:
            resp = client.open(url, method=method, headers=hr_headers, json=body)
            assert resp.status_code == 404, (method, url, resp.status_code, resp.get_json())
        assert audit.fingerprint() == audit.baseline
    finally:
        audit.restore()


def test_same_setup_keys_are_separate_per_company(audit):
    """Company 2 saving a band / budget with company 1's exact key creates its own row."""
    from website.models.compensation_band import CompensationBand
    from website.models.headcount_budget import HeadcountBudget

    client = audit.app.test_client()
    hr_headers = audit.headers["hr"]
    band = {"circle": MARK + "circle", "emp_type": MARK + "emp_type", "grade": MARK + "grade",
            "min_annual_ctc": 1, "max_annual_ctc": 2}
    budget = {"fiscal_year": MARK + "fiscal_year", "circle": MARK + "circle",
              "emp_type": MARK + "emp_type", "budgeted_count": 3}
    try:
        assert client.post(f"{HR}/compensation/bands", headers=hr_headers, json=band).status_code < 300
        assert client.post(f"{HR}/workforce-plan/budgets", headers=hr_headers, json=budget).status_code < 300
        with audit.app.app_context():
            bands = CompensationBand.query.filter_by(circle=band["circle"], grade=band["grade"]).all()
            budgets = HeadcountBudget.query.filter_by(fiscal_year=budget["fiscal_year"]).all()
            assert sorted(b.tenant_id for b in bands) == [1, 2]
            assert sorted(b.tenant_id for b in budgets) == [1, 2]
            db.session.remove()
        assert audit.fingerprint() == audit.baseline

        listed = client.get(f"{HR}/compensation/bands", headers=hr_headers).get_json()["bands"]
        assert [b["max_annual_ctc"] for b in listed if b["circle"] == band["circle"]] == [2]
    finally:
        audit.restore()


def test_punch_geofence_uses_own_company_offices(audit):
    """Company 1's office sits at (1, 1), company 2's at (2, 2): standing at (1, 1) is
    inside only for company 1's employees."""
    from website.auth import resolve_geofence_for_coordinates
    from website.tenant_context import tenant_scope

    with audit.app.app_context():
        with tenant_scope(1):
            assert resolve_geofence_for_coordinates(1.0, 1.0)["in_range"] is True
        with tenant_scope(2):
            assert resolve_geofence_for_coordinates(1.0, 1.0)["in_range"] is False
            assert resolve_geofence_for_coordinates(2.0, 2.0)["in_range"] is True
        db.session.remove()


def test_assessment_files_belong_to_the_invite_company(audit):
    from website.upload_tenancy import upload_owner_tenant

    with audit.app.app_context():
        assert upload_owner_tenant("assessment_selfies/assessment_1_abc.jpg") == 1
        assert upload_owner_tenant("assessment_selfies/assessment_2_abc.jpg") == 2
        assert upload_owner_tenant("assessment_recordings/assessment_2_abc_session.webm") == 2
        db.session.remove()


def test_geo_settings_are_platform_only(audit):
    client = audit.app.test_client()
    hr_headers = audit.headers["hr"]
    try:
        calls = [
            client.put(f"{HR}/geo-analytics/config", headers=hr_headers,
                       json={"updates": {"GEO_ENGINE_MODE": "V2"}, "reason": "audit test"}),
            client.put(f"{HR}/geo-analytics/engine-mode", headers=hr_headers, json={"mode": "V2"}),
            client.get(f"{HR}/geo-analytics/config/history", headers=hr_headers),
        ]
        assert [r.status_code for r in calls] == [403, 403, 403]
        for path in ("/geo-analytics/config", "/geo-analytics/rollout"):
            res = client.get(f"{HR}{path}", headers=hr_headers)
            assert res.status_code == 200, path
            assert res.get_json()["can_manage"] is False, path
        with audit.app.app_context():
            from website.models.geo_config_change import GeoConfigOverride

            assert GeoConfigOverride.query.filter_by(config_key="GEO_ENGINE_MODE").count() == 0
            db.session.remove()
    finally:
        audit.restore()


def test_recruitment_and_compensation_tenant_migrations():
    import logging

    from sqlalchemy import create_engine, inspect, text

    from website.tenant_migrations import (
        ensure_compensation_tenant_ids,
        ensure_master_data_tenant_ids,
        ensure_recruitment_tenant_ids,
    )

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        for ddl in (
            "CREATE TABLE admins (id INTEGER PRIMARY KEY, tenant_id INTEGER)",
            "CREATE TABLE job_requisitions (id INTEGER PRIMARY KEY, title TEXT)",
            "CREATE TABLE candidates (id INTEGER PRIMARY KEY, requisition_id INTEGER, admin_id INTEGER, assessment_invite_id INTEGER)",
            "CREATE TABLE assessment_invites (id INTEGER PRIMARY KEY, full_name TEXT)",
            "CREATE TABLE location (id INTEGER PRIMARY KEY, name TEXT)",
            "CREATE TABLE headcount_budgets (id INTEGER PRIMARY KEY, fiscal_year TEXT, circle TEXT, emp_type TEXT)",
            "CREATE UNIQUE INDEX uq_headcount_budget_year_circle_dept ON headcount_budgets (fiscal_year, circle, emp_type)",
            "CREATE TABLE increment_cycles (id INTEGER PRIMARY KEY, name TEXT)",
            "CREATE TABLE merit_matrix_entries (id INTEGER PRIMARY KEY, circle TEXT, emp_type TEXT, rating TEXT)",
            "CREATE UNIQUE INDEX uq_merit_matrix_circle_dept_rating ON merit_matrix_entries (circle, emp_type, rating)",
            "CREATE TABLE compensation_bands (id INTEGER PRIMARY KEY, circle TEXT, emp_type TEXT, grade TEXT)",
            "CREATE UNIQUE INDEX uq_comp_band_circle_dept_grade ON compensation_bands (circle, emp_type, grade)",
            "INSERT INTO admins VALUES (7, 3)",
            "INSERT INTO job_requisitions VALUES (1, 'Dev')",
            "INSERT INTO candidates VALUES (1, 1, NULL, NULL), (2, NULL, 7, 5), (3, NULL, NULL, NULL)",
            "INSERT INTO assessment_invites VALUES (5, 'via candidate'), (6, 'walk-in')",
            "INSERT INTO location VALUES (1, 'HQ')",
            "INSERT INTO headcount_budgets VALUES (1, '2026-27', 'Delhi', 'IT')",
            "INSERT INTO increment_cycles VALUES (1, 'FY26')",
            "INSERT INTO merit_matrix_entries VALUES (1, 'Delhi', 'IT', 'Good')",
            "INSERT INTO compensation_bands VALUES (1, 'Delhi', 'IT', 'General')",
        ):
            conn.execute(text(ddl))

    log = logging.getLogger("test")
    rec = ensure_recruitment_tenant_ids(engine, log)
    comp = ensure_compensation_tenant_ids(engine, log)
    master = ensure_master_data_tenant_ids(engine, log)
    assert master["location"] == {"added": True, "backfilled": 1}
    assert rec["headcount_budgets"]["unique"]["dropped"] == ["uq_headcount_budget_year_circle_dept"]
    assert comp["merit_matrix_entries"]["unique"]["dropped"] == ["uq_merit_matrix_circle_dept_rating"]
    assert comp["compensation_bands"]["unique"]["dropped"] == ["uq_comp_band_circle_dept_grade"]
    assert comp["increment_cycles"] == {"added": True, "backfilled": 1}

    with engine.begin() as conn:
        # Candidates: from the requisition, else the hired employee's company, else default.
        assert [r[0] for r in conn.execute(text("SELECT tenant_id FROM candidates ORDER BY id"))] == [1, 3, 1]
        # Assessment invites: from the candidate they were sent to, else default.
        assert [r[0] for r in conn.execute(text("SELECT tenant_id FROM assessment_invites ORDER BY id"))] == [3, 1]
        conn.execute(text("INSERT INTO compensation_bands (id, tenant_id, circle, emp_type, grade) VALUES (2, 2, 'Delhi', 'IT', 'General')"))
        conn.execute(text("INSERT INTO headcount_budgets (id, tenant_id, fiscal_year, circle, emp_type) VALUES (2, 2, '2026-27', 'Delhi', 'IT')"))
    uniques = [ix["column_names"] for ix in inspect(engine).get_indexes("compensation_bands") if ix["unique"]]
    assert uniques == [["tenant_id", "circle", "emp_type", "grade"]]

    again = ensure_compensation_tenant_ids(engine, log)
    assert again["compensation_bands"] == {
        "added": False, "backfilled": 0, "unique": {"created": False, "dropped": [], "skipped": None},
    }
