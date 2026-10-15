"""
HR Leave/WFH updation list paging (GET /api/HumanResource/leave-updation/requests?page=...).

Pages must add up to the old merged list (newest first, leave before WFH on a full tie), status
counts must match what the screen counted, and without ``page`` the list is unchanged.
"""
import importlib
import pkgutil
from datetime import date, datetime, timedelta
from urllib.parse import urlencode

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")
from it_perf_support import count_queries  # noqa: E402
from website.models.Admin_models import Admin  # noqa: E402
from website.models.attendance import LeaveApplication, WorkFromHomeApplication  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

START = date(2026, 3, 2)
BASE = datetime(2026, 3, 1, 9)
API = "/api/HumanResource/leave-updation/requests"
STATUSES = ("Pending", "Approved", "Rejected", "", " approved ", "Cancelled")


def _make_app(paging_on, n=9):
    from website.Human_resource import hr

    app = Flask("hr_leave_updation_paging")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="hr-leave-updation-paging-secret-32!",
        TESTING=True,
        API_PAGINATION_V1=paging_on,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    with app.app_context():
        db.create_all()
        _seed(n)
    return app


def _seed(n):
    db.session.add_all([
        Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
        Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
    ])
    common = dict(is_active=True, is_exited=False, doj=date(2024, 1, 1))
    db.session.add_all([
        Admin(id=2, tenant_id=1, email="hr@one.com", emp_id="H1", first_name="Hema", emp_type="Human Resource", circle="NHQ", **common),
        Admin(id=900, tenant_id=2, email="x@two.com", emp_id="T2", first_name="Other", emp_type="Admin", circle="NHQ", **common),
    ])
    for i in range(n):
        aid = 10 + i
        db.session.add(Admin(
            id=aid, tenant_id=1, email=f"emp{aid}@one.com", emp_id=f"E{aid}", first_name=f"Emp {aid}",
            emp_type=("Engineering" if i % 2 else "Accounts"), circle=("NHQ" if i % 3 else "Mumbai"), **common,
        ))
    db.session.flush()
    leave_id = wfh_id = 0
    for i in range(n):
        aid = 10 + i
        for k in range(4):
            leave_id += 1
            # Every third leave shares its created_at with the WFH row of the same id (full tie).
            created = BASE + timedelta(hours=leave_id // 3)
            db.session.add(LeaveApplication(
                id=leave_id, admin_id=aid, leave_type=("Casual Leave" if k % 2 else "Sick Leave"),
                reason="Family function at home", start_date=START + timedelta(days=i), end_date=START + timedelta(days=i),
                status=STATUSES[(i + k) % len(STATUSES)], deducted_days=1, created_at=created,
            ))
        for k in range(3):
            wfh_id += 1
            db.session.add(WorkFromHomeApplication(
                id=wfh_id, admin_id=aid, start_date=START, end_date=START, reason="Internet work at home",
                status=STATUSES[(i + 2 * k) % len(STATUSES)], created_at=BASE + timedelta(hours=wfh_id // 3),
            ))
    db.session.add(LeaveApplication(
        id=5000, admin_id=900, leave_type="Casual Leave", reason="Other tenant leave", start_date=START, end_date=START,
        status="Pending", created_at=BASE + timedelta(days=30),
    ))
    db.session.commit()


def _headers(app):
    with app.app_context():
        token = create_access_token(
            identity="2", additional_claims={"email": "hr@one.com", "emp_type": "Human Resource", "tenant_id": 1},
        )
    return {"Authorization": f"Bearer {token}"}


def _fixture(paging_on):
    app = _make_app(paging_on)
    yield app, app.test_client(), _headers(app)
    with app.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture(scope="module")
def on():
    yield from _fixture(True)


@pytest.fixture(scope="module")
def off():
    yield from _fixture(False)


def _get(ctx, **params):
    _, client, headers = ctx
    resp = client.get(f"{API}?{urlencode(params)}", headers=headers)
    assert resp.status_code == 200, (params, resp.get_json())
    return resp.get_json()


def shown_status(row):
    return (row["status"] or "").strip().lower() or "pending"


def screen_counts(rows):
    return {
        "all": len(rows),
        "pending": sum(shown_status(r) == "pending" for r in rows),
        "approved": sum(shown_status(r) == "approved" for r in rows),
        "rejected": sum(shown_status(r) == "rejected" for r in rows),
    }


FILTERS = [
    {"request_type": "all"},
    {"request_type": "leave"},
    {"request_type": "wfh"},
    {"request_type": "all", "circle": "Mumbai"},
    {"request_type": "all", "emp_type": "Engineering"},
    {"request_type": "all", "admin_id": 12},
    {"request_type": "bogus"},
]


@pytest.mark.parametrize("filters", FILTERS, ids=[urlencode(f) for f in FILTERS])
@pytest.mark.parametrize("status", ["all", "pending", "approved", "rejected", "cancelled"])
def test_pages_add_up_to_old_list(on, off, filters, status):
    old = _get(off, **filters)["requests"]
    expected = [r for r in old if status == "all" or shown_status(r) == status]
    collected, page = [], 1
    while True:
        body = _get(on, page=page, per_page=7, status=status, **filters)
        assert body["counts"] == screen_counts(old)
        assert body["pagination"]["total"] == len(expected)
        collected += body["requests"]
        if not body["pagination"]["has_next"]:
            break
        page += 1
    assert collected == expected


def test_ties_keep_leave_before_wfh(on):
    rows = _get(on, page=1, per_page=100)["requests"]
    pairs = [(a["row_key"], b["row_key"]) for a, b in zip(rows, rows[1:])
             if a["created_at"] == b["created_at"] and a["id"] == b["id"]]
    assert pairs and all(a.startswith("leave-") and b.startswith("wfh-") for a, b in pairs)


def test_other_tenant_hidden(on):
    rows = _get(on, page=1, per_page=100)["requests"]
    assert 5000 not in {r["id"] for r in rows if r["request_type"] == "leave"}
    assert _get(on, page=1, per_page=5, ref="leave-5000")["ref_row"] is None


def test_without_page_unchanged(on, off):
    for filters in FILTERS[:3] + [{"status": "pending"}]:
        assert _get(on, **filters) == _get(off, **filters)


def test_switch_off_ignores_page(off):
    full = _get(off, request_type="all")
    assert "pagination" not in full and "counts" not in full
    assert _get(off, request_type="all", page=2, per_page=3, ref="leave-1") == full


def test_ref_row_found_beyond_first_page(on):
    rows = _get(on, page=1, per_page=100)["requests"]
    last = rows[-1]
    body = _get(on, page=1, per_page=5, ref=last["row_key"])
    assert last not in body["requests"]
    assert body["ref_row"] == last


def test_ref_row_respects_filters(on):
    rows = _get(on, page=1, per_page=100, status="approved")["requests"]
    approved = rows[0]["row_key"]
    assert _get(on, page=1, per_page=5, status="approved", ref=approved)["ref_row"]["row_key"] == approved
    assert _get(on, page=1, per_page=5, status="rejected", ref=approved)["ref_row"] is None
    assert _get(on, page=1, per_page=5, request_type="wfh", ref="leave-1")["ref_row"] is None
    for junk in ("leave-", "leave-x", "nope-1", "leave-99999"):
        assert _get(on, page=1, per_page=5, ref=junk)["ref_row"] is None
    assert "ref_row" not in _get(on, page=1, per_page=5)


def test_rows_carry_admin_flags(on):
    body = _get(on, page=1, per_page=5)
    assert all("admin_pending" in r and "admin_request_id" in r for r in body["requests"])
    assert body["pending_on_behalf"] == []


def test_page_past_end_is_empty(on):
    body = _get(on, page=99, per_page=10)
    assert body["requests"] == [] and body["pagination"]["page"] == 99


@pytest.mark.parametrize("params", [{"page": 1, "per_page": 5}, {"page": 2, "per_page": 5, "status": "approved", "ref": "wfh-3"}])
def test_query_count_does_not_grow(params):
    counts = []
    for n in (4, 20):
        app = _make_app(True, n)
        client, headers = app.test_client(), _headers(app)
        with app.app_context():
            engine = db.engine
        path = f"{API}?{urlencode(params)}"
        client.get(path, headers=headers)
        with count_queries(engine) as statements:
            assert client.get(path, headers=headers).status_code == 200
        counts.append(len(statements))
        with app.app_context():
            db.session.remove()
            db.drop_all()
    assert counts[0] == counts[1], counts
