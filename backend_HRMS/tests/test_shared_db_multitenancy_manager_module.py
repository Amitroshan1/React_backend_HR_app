"""Module rollout — Manager: approval chains, manager panel and manager setup stay inside one tenant."""
import importlib
import logging
import pkgutil
from datetime import date, timedelta

import pytest
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import create_engine, text

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    # confirmation_request references a Signup model that is not defined.
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin  # noqa: E402
from website.models.attendance import LeaveApplication  # noqa: E402
from website.models.manager_model import ManagerContact  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

TODAY = date.today()


@pytest.fixture()
def app():
    from website.manager import manager
    from website.query import query

    app = Flask("tenancy_manager_module")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-manager-module-secret-32",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(query, url_prefix="/api/query")
    app.register_blueprint(manager, url_prefix="/api/manager")

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
        ])
        common = dict(circle="NHQ", is_active=True, is_exited=False, doj=TODAY - timedelta(days=400))
        # Both tenants use the same manager email, employee email and circle/emp_type.
        db.session.add_all([
            Admin(id=1, tenant_id=1, email="mgr@x.com", emp_id="M1", first_name="One Mgr", emp_type="Manager", **common),
            Admin(id=2, tenant_id=1, email="dup@x.com", emp_id="E1", first_name="Alpha Dev", emp_type="Engineering", **common),
            Admin(id=3, tenant_id=2, email="mgr@x.com", emp_id="M1", first_name="Two Mgr", emp_type="Manager", **common),
            Admin(id=4, tenant_id=2, email="dup@x.com", emp_id="E1", first_name="Beta Dev", emp_type="Engineering", **common),
        ])
        db.session.flush()
        db.session.add_all([
            ManagerContact(id=1, tenant_id=1, circle_name="NHQ", user_type="Engineering", l1_admin_id=1),
            ManagerContact(id=2, tenant_id=2, circle_name="NHQ", user_type="Engineering", l1_admin_id=3),
        ])
        for aid in (2, 4):
            db.session.add(LeaveApplication(
                id=aid * 10, admin_id=aid, leave_type="Casual Leave", reason="Family function",
                start_date=TODAY, end_date=TODAY, status="Pending",
            ))
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _mgr(app, tenant_id):
    admin_id = 1 if tenant_id == 1 else 3
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": "mgr@x.com", "emp_type": "Manager", "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


def test_employee_resolves_to_own_tenant_contact(app):
    from website.manager_utils import find_manager_contact, resolve_manager_contact_for_employee

    with app.app_context():
        assert resolve_manager_contact_for_employee(db.session.get(Admin, 2)).id == 1
        assert resolve_manager_contact_for_employee(db.session.get(Admin, 4)).id == 2
        assert find_manager_contact(db.session.get(Admin, 4)).id == 2


def test_manager_never_matches_other_tenant_contact(app):
    from website.manager_utils import get_manager_emails, is_manager_in_contact

    with app.app_context():
        mgr_one = db.session.get(Admin, 1)
        assert is_manager_in_contact(db.session.get(ManagerContact, 1), mgr_one)
        # Same email as tenant 2's L1, but a different company.
        assert not is_manager_in_contact(db.session.get(ManagerContact, 2), mgr_one)
        # A contact that links a foreign admin id does not resolve that admin.
        db.session.get(ManagerContact, 2).l2_admin_id = 1
        assert get_manager_emails(db.session.get(ManagerContact, 2)) == ["mgr@x.com"]
        assert not is_manager_in_contact(db.session.get(ManagerContact, 2), mgr_one)
        db.session.rollback()


def test_scheduler_contact_lookup_is_tenant_scoped(app):
    from website.commands.leave_pending_reminder import _get_contact_for_admin as leave_contact
    from website.commands.probation import _get_contact_for_admin as probation_contact

    with app.app_context():
        emp_two = db.session.get(Admin, 4)
        assert leave_contact(emp_two).id == 2
        assert probation_contact(emp_two).id == 2


def test_manager_lists_only_own_tenant_requests(app):
    c = app.test_client()
    rows = c.get("/api/manager/leave-requests", headers=_mgr(app, 1)).get_json()["requests"]
    assert [r["id"] for r in rows] == [20]
    members = c.get("/api/manager/team-members", headers=_mgr(app, 2)).get_json()["members"]
    assert [m["id"] for m in members] == [4]
    counts = c.get("/api/manager/pending-counts", headers=_mgr(app, 1)).get_json()["counts"]
    assert counts["leave"] == 1


def test_manager_cannot_act_on_other_tenant_leave(app):
    c = app.test_client()
    resp = c.post("/api/manager/leave-requests/40/action", json={"action": "approve"}, headers=_mgr(app, 1))
    assert resp.status_code == 404
    with app.app_context():
        assert db.session.get(LeaveApplication, 40).status == "Pending"


def test_manager_setup_picker_and_contact_are_tenant_scoped(app):
    c = app.test_client()
    picked = c.get("/api/query/api/managers/employees?q=dup", headers=_mgr(app, 1)).get_json()["employees"]
    assert [e["id"] for e in picked] == [2]
    found = c.get("/api/query/api/managers/search?identifier=E1", headers=_mgr(app, 2)).get_json()["employees"]
    assert [e["id"] for e in found] == [4]
    data = c.get(
        "/api/query/api/managers/contact?circle=NHQ&emp_type=Engineering", headers=_mgr(app, 2)
    ).get_json()["data"]
    assert data["l1_admin_id"] == 3


def test_manager_setup_upsert_stays_in_tenant(app):
    c = app.test_client()
    base = {"circle_name": "NHQ", "user_type": "Engineering"}
    resp = c.post("/api/query/api/managers/contact", json={**base, "l1_admin_id": 3}, headers=_mgr(app, 1))
    assert resp.status_code == 404

    resp = c.post("/api/query/api/managers/contact", json={**base, "l1_admin_id": 2}, headers=_mgr(app, 1))
    assert resp.status_code == 200
    resp = c.post(
        "/api/query/api/managers/contact",
        json={"circle_name": "South", "user_type": "Sales", "l1_admin_id": 4},
        headers=_mgr(app, 2),
    )
    assert resp.status_code == 200
    with app.app_context():
        assert db.session.get(ManagerContact, 1).l1_admin_id == 2
        assert db.session.get(ManagerContact, 2).l1_admin_id == 3
        assert ManagerContact.query.filter_by(circle_name="South").one().tenant_id == 2


def test_manager_contact_tenant_migration_backfills_from_managers():
    from website.tenant_migrations import ensure_manager_contact_tenant_id

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE admins (id INTEGER PRIMARY KEY, tenant_id INTEGER)"))
        conn.execute(text(
            "CREATE TABLE manager_contacts (id INTEGER PRIMARY KEY, circle_name TEXT, user_type TEXT, "
            "user_email TEXT, l1_admin_id INTEGER, l2_admin_id INTEGER, l3_admin_id INTEGER)"
        ))
        conn.execute(text("INSERT INTO admins (id, tenant_id) VALUES (1, 1), (3, 2)"))
        conn.execute(text(
            "INSERT INTO manager_contacts (id, circle_name, user_type, l1_admin_id, l2_admin_id) VALUES "
            "(1, 'NHQ', 'Eng', 1, NULL), (2, 'NHQ', 'Eng', NULL, 3), (3, 'NHQ', 'Eng', NULL, NULL)"
        ))

    log = logging.getLogger("test")
    assert ensure_manager_contact_tenant_id(engine, log) == {"added": True, "backfilled": 3}
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, tenant_id FROM manager_contacts ORDER BY id")).all()
    assert [tuple(r) for r in rows] == [(1, 1), (2, 2), (3, 1)]
    assert ensure_manager_contact_tenant_id(engine, log) == {"added": False, "backfilled": 0}


def test_employee_cannot_open_manager_setup(app):
    with app.app_context():
        token = create_access_token(
            identity="2",
            additional_claims={"email": "alpha@x.com", "emp_type": "Engineering", "tenant_id": 1},
        )
    headers = {"Authorization": f"Bearer {token}"}
    client = app.test_client()
    assert client.get("/api/query/api/managers/employees?q=dup", headers=headers).status_code == 403
    assert client.post(
        "/api/query/api/managers/contact",
        json={"circle_name": "NHQ", "user_type": "Engineering", "l1_admin_id": 2},
        headers=headers,
    ).status_code == 403
