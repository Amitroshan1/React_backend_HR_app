"""
Admin leave list paging (API_PAGINATION_V1) and per-row query fixes on the Admin / HR lists.

Without ``page`` (or with the switch off) every list must answer exactly as before.
"""
import importlib
import pkgutil
from datetime import date, datetime, timedelta

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
from website.models.emp_detail_models import Employee  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

START = date(2026, 3, 2)


def _make_app(paging_on, n):
    from website.Admin import admin_bp
    from website.Human_resource import hr

    app = Flask("admin_hr_lists")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="admin-hr-lists-secret-key-32-bytes!",
        TESTING=True,
        API_PAGINATION_V1=paging_on,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
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
        Admin(id=1, tenant_id=1, email="boss@one.com", emp_id="A1", first_name="Owner", emp_type="Admin", circle="NHQ", **common),
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
    for i in range(n):
        aid = 10 + i
        db.session.add(Employee(
            admin_id=aid, name=f"Emp {aid}", email=f"emp{aid}@one.com", father_name="F", mother_name="M",
            marital_status="Single", dob=date(1990, 1, 1), emp_id=f"E{aid}", mobile="9999999999", gender="Male",
            nationality="Indian", blood_group="O+", designation="Engineer", photo_filename=f"employee_photos/{aid}.jpg",
        ))
        for k, status in enumerate(("Pending", "Approved", "Rejected")):
            db.session.add(LeaveApplication(
                admin_id=aid, leave_type=("Casual Leave" if k else "Sick Leave"), reason="Family function at home",
                start_date=START + timedelta(days=i), end_date=START + timedelta(days=i), status=status,
                deducted_days=1, created_at=datetime(2026, 3, 1, 9) + timedelta(hours=i, minutes=k),
            ))
        db.session.add(WorkFromHomeApplication(
            admin_id=aid, start_date=START, end_date=START, reason="Internet work at home", status="Pending",
            created_at=datetime(2026, 3, 1, 9) + timedelta(hours=i),
        ))
    db.session.add(LeaveApplication(
        admin_id=900, leave_type="Casual Leave", reason="Other tenant leave", start_date=START, end_date=START,
        status="Pending", created_at=datetime(2026, 3, 1, 9),
    ))
    db.session.commit()


def _headers(app, admin_id=1):
    claims = {
        1: {"email": "boss@one.com", "emp_type": "Admin", "tenant_id": 1},
        2: {"email": "hr@one.com", "emp_type": "Human Resource", "tenant_id": 1},
    }[admin_id]
    with app.app_context():
        token = create_access_token(identity=str(admin_id), additional_claims=claims)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def on():
    app = _make_app(True, 7)
    yield app, app.test_client(), _headers(app)
    with app.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture(scope="module")
def off():
    app = _make_app(False, 7)
    yield app, app.test_client(), _headers(app)
    with app.app_context():
        db.session.remove()
        db.drop_all()


def _get(ctx, path):
    _, client, headers = ctx
    resp = client.get(path, headers=headers)
    assert resp.status_code == 200, (path, resp.get_json())
    return resp.get_json()


@pytest.mark.parametrize("status", ["All", "Pending", "Approved"])
def test_leaves_switch_off_ignores_page_and_search(off, status):
    path = f"/api/admin/leaves?status={status}"
    full = _get(off, path)
    assert "pagination" not in full
    assert _get(off, f"{path}&page=1&per_page=2&q=zzz") == full


@pytest.mark.parametrize("status", ["All", "Pending"])
def test_leaves_without_page_match_switch_off(on, off, status):
    assert _get(on, f"/api/admin/leaves?status={status}") == _get(off, f"/api/admin/leaves?status={status}")


@pytest.mark.parametrize("status", ["All", "Rejected"])
def test_leave_pages_add_up(on, status):
    full = _get(on, f"/api/admin/leaves?status={status}")["requests"]
    assert len(full) > 4
    collected, page = [], 1
    while True:
        body = _get(on, f"/api/admin/leaves?status={status}&page={page}&per_page=4")
        assert body["pagination"]["total"] == len(full)
        collected += body["requests"]
        if not body["pagination"]["has_next"]:
            break
        page += 1
    assert collected == full


@pytest.mark.parametrize("needle", ["emp 12", "E13", "mumbai", "sick", "EMP15@ONE"])
def test_leave_search_matches_old_browser_filter(on, needle):
    full = _get(on, "/api/admin/leaves?status=All")["requests"]
    fields = ("employee_name", "employee_email", "emp_id", "circle", "leave_type")
    expected = [r for r in full if any(needle.lower() in str(r[f] or "").lower() for f in fields)]
    body = _get(on, f"/api/admin/leaves?status=All&q={needle}&page=1&per_page=100")
    assert body["requests"] == expected and expected


def test_leaves_stay_in_tenant(on):
    rows = _get(on, "/api/admin/leaves?status=All")["requests"]
    assert "T2" not in {r["emp_id"] for r in rows}


def _query_count(path, admin_id=1):
    counts = []
    for n in (3, 12):
        app = _make_app(True, n)
        client, headers = app.test_client(), _headers(app, admin_id)
        with app.app_context():
            engine = db.engine
        client.get(path, headers=headers)
        with count_queries(engine) as statements:
            assert client.get(path, headers=headers).status_code == 200
        counts.append(len(statements))
        with app.app_context():
            db.session.remove()
            db.drop_all()
    return counts


@pytest.mark.parametrize(
    "path,admin_id",
    [
        ("/api/admin/leaves?status=All", 1),
        ("/api/admin/leaves?status=All&page=1&per_page=5", 1),
        ("/api/admin/employees", 1),
        ("/api/HumanResource/leave-updation/requests?request_type=all&status=all", 2),
    ],
)
def test_query_count_does_not_grow_with_rows(path, admin_id):
    small, large = _query_count(path, admin_id)
    assert small == large, (path, small, large)


def test_employee_photos_still_resolved(on):
    employees = _get(on, "/api/admin/employees")["employees"]
    with_photo = [e for e in employees if e["emp_id"].startswith("E")]
    assert with_photo and all(e["photo_url"] for e in with_photo)
    assert not next(e for e in employees if e["emp_id"] == "A1")["photo_url"]
