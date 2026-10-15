"""
Employee directory screen (GET /api/admin/employees?view=directory).

The server must return what frontend/src/pages/Admin/Employee.jsx used to compute in the
browser: same filters, search, natural sort and type counts. Without ``view`` the list is unchanged.
"""
import importlib
import pkgutil
from datetime import date
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
from website.models.tenant import Tenant  # noqa: E402
from website.query_utils import base_collation_key  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402


def _make_app(paging_on, extra=25):
    from website.Admin import admin_bp

    app = Flask("admin_employee_directory")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="admin-employee-directory-secret-32b!",
        TESTING=True,
        API_PAGINATION_V1=paging_on,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    with app.app_context():
        db.create_all()
        _seed(extra)
    return app


def _admin(aid, emp_id, name, emp_type, circle, tenant=1, **kw):
    fields = dict(is_active=True, is_exited=False, doj=date(2024, 1, 1), mobile=None)
    fields.update(kw)
    return Admin(
        id=aid, tenant_id=tenant, email=f"user{aid}@one.com", emp_id=emp_id, first_name=name,
        emp_type=emp_type, circle=circle, **fields,
    )


def _seed(extra):
    db.session.add_all([
        Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
        Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
    ])
    db.session.add_all([
        _admin(1, "A1", "Owner", "Admin", "NHQ", mobile="9000000001"),
        _admin(2, "E10", "zara", "", "Delhi", doj=date(2023, 5, 1)),
        _admin(3, "E2", "Ánil", "Engineering", "NHQ", employment_status="on_probation", doj=date(2025, 2, 1)),
        _admin(4, "e3", "anil", "engineering", " NHQ ", employment_status="confirmed", mobile="98765"),
        _admin(5, "E1", "Bob", "Accounts", "Mumbai", employment_status="confirmed", doj=None),
        _admin(6, "E20", "Carl", "Accounts", None, is_active=None, employment_status="custom_state"),
        _admin(7, "E7", "Dan", "Accounts", "NHQ", is_active=False),
        _admin(8, "E8", "Eve", "Accounts", "NHQ", is_exited=True),
        _admin(9, "", "", "Field", "Pune", employment_status="review_pending"),
        _admin(900, "T2", "Other", "Admin", "NHQ", tenant=2),
    ])
    for i in range(extra):
        aid = 100 + i
        db.session.add(_admin(
            aid, f"E{aid}", f"Emp {i}", ("Engineering", "Accounts", "Field")[i % 3], ("NHQ", "Mumbai")[i % 2],
            employment_status=("", "confirmed", "extended", "failed", "awaiting_hr")[i % 5],
            doj=date(2020 + i % 5, 1 + i % 12, 1),
        ))
    db.session.commit()


def _headers(app):
    with app.app_context():
        token = create_access_token(
            identity="1", additional_claims={"email": "user1@one.com", "emp_type": "Admin", "tenant_id": 1},
        )
    return {"Authorization": f"Bearer {token}"}


def _ctx(paging_on):
    app = _make_app(paging_on)
    return app, app.test_client(), _headers(app)


@pytest.fixture(scope="module")
def on():
    ctx = _ctx(True)
    yield ctx
    with ctx[0].app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture(scope="module")
def off():
    ctx = _ctx(False)
    yield ctx
    with ctx[0].app_context():
        db.session.remove()
        db.drop_all()


def _get(ctx, path, expect=200):
    _, client, headers = ctx
    resp = client.get(path, headers=headers)
    assert resp.status_code == expect, (path, resp.get_json())
    return resp.get_json()


def _directory(ctx, **params):
    return _get(ctx, "/api/admin/employees?" + urlencode({"view": "directory", **params}))


# ---- the old browser logic (Employee.jsx) ---------------------------------------------------

LABELS = {
    "active": "Active", "inactive": "Inactive", "on_probation": "On probation",
    "review_pending": "Review in progress", "awaiting_hr": "Awaiting HR decision",
    "confirmed": "Confirmed", "extended": "Probation extended", "failed": "Probation not cleared",
}


def status_key(row):
    if row["is_active"] is False:
        return "inactive"
    return (row["employment_status"] or "").strip() or "active"


def status_label(key):
    if key in LABELS:
        return LABELS[key]
    text = key.replace("_", " ").strip()
    return text[:1].upper() + text[1:] if text else "Active"


def browser_visible(full, type="All", circle="All", status="All", q="", sort="name", dir="asc"):
    needle = q.strip().lower()
    rows = [
        r for r in full
        if (type == "All" or (r["emp_type"] or "Unassigned") == type)
        and (circle == "All" or (r["circle"] or "") == circle)
        and (status == "All" or status_key(r) == status)
        and (not needle or any(needle in str(r[k] or "").lower()
                               for k in ("name", "emp_id", "email", "mobile", "emp_type", "circle")))
    ]

    def value(r):
        return status_label(status_key(r)) if sort == "status" else (r[sort] or "")

    return sorted(rows, key=lambda r: base_collation_key(str(value(r)), numeric=True), reverse=dir == "desc")


def browser_facets(full):
    counts = {}
    for r in full:
        key = r["emp_type"] or "Unassigned"
        counts[key] = counts.get(key, 0) + 1
    return {
        "total": len(full),
        "typeCounts": counts,
        "types": sorted({r["emp_type"] for r in full if r["emp_type"]}),
        "circles": sorted({r["circle"] for r in full if r["circle"]}),
        "statuses": sorted({status_key(r) for r in full}),
    }


CASES = [
    {},
    {"sort": "name", "dir": "desc"},
    {"sort": "emp_id"},
    {"sort": "emp_id", "dir": "desc"},
    {"sort": "emp_type"},
    {"sort": "circle", "dir": "desc"},
    {"sort": "doj"},
    {"sort": "doj", "dir": "desc"},
    {"sort": "status"},
    {"sort": "status", "dir": "desc"},
    {"type": "Unassigned"},
    {"type": "Engineering"},
    {"type": "engineering"},
    {"type": "Accounts", "sort": "emp_id"},
    {"circle": "NHQ"},
    {"circle": "nhq"},
    {"circle": "Mumbai", "type": "Field"},
    {"status": "confirmed", "sort": "name"},
    {"status": "active"},
    {"status": "custom_state"},
    {"q": "anil"},
    {"q": "  E1 "},
    {"q": "98765"},
    {"q": "USER1"},
    {"q": "nhq", "type": "Accounts", "dir": "desc"},
    {"q": "zzz"},
]


def _server_params(case):
    params = dict(case)
    if "circle" in params:
        params["in_circle"] = params.pop("circle")
    return params


@pytest.fixture(scope="module")
def full(off):
    return _get(off, "/api/admin/employees")["employees"]


@pytest.mark.parametrize("case", CASES, ids=[urlencode(c) or "default" for c in CASES])
def test_full_directory_matches_browser(on, full, case):
    body = _directory(on, **_server_params(case))
    expected = browser_visible(full, **case)
    assert "pagination" not in body
    assert body["employees"] == expected
    assert body["count"] == len(expected)
    assert body["facets"] == browser_facets(full)


@pytest.mark.parametrize("case", CASES[:6] + CASES[10:14] + CASES[20:22], ids=lambda c: urlencode(c) or "default")
def test_pages_add_up_to_browser_order(on, full, case):
    expected = browser_visible(full, **case)
    collected, page = [], 1
    while True:
        body = _directory(on, page=page, per_page=7, **_server_params(case))
        assert body["pagination"]["total"] == len(expected)
        assert body["facets"]["total"] == len(full)
        collected += body["employees"]
        if not body["pagination"]["has_next"]:
            break
        page += 1
    assert collected == expected


def test_natural_case_insensitive_sort():
    rows = [{"emp_id": v} for v in ("E10", "e3", "E2", "E1", "E20")]
    ordered = sorted(rows, key=lambda r: base_collation_key(r["emp_id"], numeric=True))
    assert [r["emp_id"] for r in ordered] == ["E1", "E2", "e3", "E10", "E20"]


def test_emp_id_order_on_server(on):
    ids = [e["emp_id"] for e in _directory(on, sort="emp_id")["employees"] if e["id"] < 100]
    assert ids == ["", "A1", "E1", "E2", "e3", "E10", "E20"]


def test_name_ties_keep_database_order(on):
    names = [e["name"] for e in _directory(on, q="nil")["employees"]]
    assert sorted(names) == ["anil", "Ánil"]
    assert _directory(on, q="nil", dir="desc")["employees"] == _directory(on, q="nil")["employees"]


def test_hidden_and_other_tenant_employees_excluded(on):
    ids = {e["id"] for e in _directory(on)["employees"]}
    assert not ids & {7, 8, 900}
    assert {1, 2, 3, 4, 5, 6, 9} <= ids


def test_plain_list_unchanged(on, off):
    plain = _get(on, "/api/admin/employees")
    assert plain == _get(off, "/api/admin/employees")
    assert set(plain) == {"success", "count", "employees"}
    assert _get(on, "/api/admin/employees?page=1&per_page=3&q=zzz&type=Field&sort=doj") == plain


def test_switch_off_returns_full_directory(on, off):
    for case in ({}, {"type": "Accounts", "sort": "emp_id", "dir": "desc"}, {"q": "emp 1"}):
        body = _directory(off, page=1, per_page=3, **case)
        assert "pagination" not in body
        assert body == _directory(on, **case)


def test_photos_only_on_returned_page(on):
    body = _directory(on, page=1, per_page=4)
    assert len(body["employees"]) == 4
    assert all("photo" in e and "photo_url" in e for e in body["employees"])


def test_bad_sort_is_400(on):
    assert _directory_status(on, sort="mobile") == 400


def _directory_status(ctx, **params):
    _, client, headers = ctx
    return client.get("/api/admin/employees?" + urlencode({"view": "directory", **params}), headers=headers).status_code


@pytest.mark.parametrize("params", [{"page": 1, "per_page": 5}, {"type": "Accounts", "q": "e", "sort": "status"}])
def test_query_count_does_not_grow(params):
    counts = []
    for extra in (5, 40):
        app = _make_app(True, extra)
        client, headers = app.test_client(), _headers(app)
        with app.app_context():
            engine = db.engine
        path = "/api/admin/employees?" + urlencode({"view": "directory", **params})
        client.get(path, headers=headers)
        with count_queries(engine) as statements:
            assert client.get(path, headers=headers).status_code == 200
        counts.append(len(statements))
        with app.app_context():
            db.session.remove()
            db.drop_all()
    assert counts[0] == counts[1], counts
