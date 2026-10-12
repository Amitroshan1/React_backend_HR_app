"""Module rollout — IT / ITAM: inventory, assignments, logs, parcels and Day-use stay inside one tenant."""
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

from website.datetime_utils import utc_now  # noqa: E402
from website.models.Admin_models import Admin  # noqa: E402
from website.models.daily_checkout import DailyCheckoutRequest  # noqa: E402
from website.models.it_models import (  # noqa: E402
    ITAssetTransition,
    ITAssetUnit,
    ITDeletedAssetLog,
    ITInventoryItem,
    ITParcelImport,
    ITSupportTicket,
)
from website.models.notification import Notification  # noqa: E402
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

TODAY = date.today()


@pytest.fixture()
def app():
    from website.daily_checkout.views import daily_checkout_bp
    from website.it import it_bp

    app = Flask("tenancy_it_module")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-tenancy-it-module-secret-32-chars",
        TESTING=True,
    )
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(it_bp, url_prefix="/api/it")
    app.register_blueprint(daily_checkout_bp, url_prefix="/api/it/daily-checkout")

    with app.app_context():
        db.create_all()
        db.session.add_all([
            Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
            Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
        ])
        common = dict(circle="NHQ", is_active=True, is_exited=False, doj=TODAY - timedelta(days=400))
        # Both tenants use the same IT email, employee email and emp_id.
        db.session.add_all([
            Admin(id=1, tenant_id=1, email="it@x.com", emp_id="IT1", first_name="One IT", emp_type="IT", **common),
            Admin(id=2, tenant_id=1, email="dup@x.com", emp_id="E1", first_name="Alpha Dev", emp_type="Engineering", **common),
            Admin(id=3, tenant_id=2, email="it@x.com", emp_id="IT1", first_name="Two IT", emp_type="IT", **common),
            Admin(id=4, tenant_id=2, email="dup@x.com", emp_id="E1", first_name="Beta Dev", emp_type="Engineering", **common),
        ])
        db.session.flush()
        for tid, aid in ((1, 2), (2, 4)):
            rid = aid * 10
            db.session.add(ITInventoryItem(
                id=rid, tenant_id=tid, inventory_code=f"INV-{tid}", name="Laptop", category="Hardware",
                created_by_admin_id=aid - 1,
            ))
            db.session.flush()
            db.session.add_all([
                ITAssetUnit(
                    id=rid, inventory_item_id=rid, unit_code=f"LAP-{tid}", asset_name="Laptop",
                    hw_type="Laptop", status="available", is_daily_pool=True,
                ),
                ITSupportTicket(
                    id=rid, ticket_code=f"TKT-{tid}", requester_admin_id=aid, title="Broken", description="Screen",
                ),
                ITDeletedAssetLog(id=rid, tenant_id=tid, delete_code=f"DEL-{tid}", asset_name="Old laptop"),
                ITParcelImport(id=rid, tenant_id=tid, import_code=f"IMP-{tid}", source="Vendor", asset_name="Mouse"),
                ITAssetTransition(
                    id=rid, tenant_id=tid, transition_code=f"TRN-{tid}", action_code="NOTE",
                    remark=f"Note for tenant {tid}", inventory_item_id=rid, occurred_at=utc_now(),
                ),
                DailyCheckoutRequest(
                    id=rid, request_code=f"DU-{tid}", requester_admin_id=aid, requested_hw_type="Laptop",
                    expected_return_at=utc_now() + timedelta(hours=4),
                ),
            ])
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def _it(app, tenant_id):
    admin_id = 1 if tenant_id == 1 else 3
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": "it@x.com", "emp_type": "IT", "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


def test_inventory_lists_and_summary_are_tenant_scoped(app):
    c = app.test_client()
    items = c.get("/api/it/inventory/items", headers=_it(app, 1)).get_json()["items"]
    assert [i["id"] for i in items] == [20]
    units = c.get("/api/it/units", headers=_it(app, 2)).get_json()["units"]
    assert [u["id"] for u in units] == [40]
    tickets = c.get("/api/it/tickets", headers=_it(app, 1)).get_json()["tickets"]
    assert [t["id"] for t in tickets] == [20]
    summary = c.get("/api/it/summary", headers=_it(app, 2)).get_json()["summary"]
    assert summary["total_assets"] == 1 and summary["open_tickets"] == 1


def test_other_tenant_records_return_404(app):
    c = app.test_client()
    h = _it(app, 1)
    assert c.patch("/api/it/inventory/items/40", json={"name": "X"}, headers=h).status_code == 404
    assert c.get("/api/it/units/40/reviews", headers=h).status_code == 404
    assert c.patch("/api/it/tickets/40/resolve", json={}, headers=h).status_code == 404
    assert c.delete("/api/it/deleted-logs/DEL-2", headers=h).status_code == 404
    with app.app_context():
        assert db.session.get(ITInventoryItem, 40).name == "Laptop"
        assert db.session.get(ITDeletedAssetLog, 40) is not None


def test_unit_cannot_be_assigned_across_tenants(app):
    c = app.test_client()
    h = _it(app, 1)
    resp = c.post("/api/it/assignments/units", json={"unit_id": 20, "assigned_to_admin_id": 4}, headers=h)
    assert resp.status_code == 404
    resp = c.post("/api/it/assignments/units", json={"unit_id": 40, "assigned_to_admin_id": 2}, headers=h)
    assert resp.status_code == 404
    # emp_id E1 exists in both tenants; tenant 1 resolves to its own employee.
    resp = c.post("/api/it/assignments/units", json={"unit_id": 20, "assigned_to_emp_id": "E1"}, headers=h)
    assert resp.status_code == 200, resp.get_json()
    with app.app_context():
        assert db.session.get(ITAssetUnit, 20).assigned_to_admin_id == 2
        assert db.session.get(ITAssetUnit, 40).assigned_to_admin_id is None


def test_employee_lookup_and_assets_are_tenant_scoped(app):
    c = app.test_client()
    rows = c.get("/api/it/employees/lookup?q=dup", headers=_it(app, 2)).get_json()["employees"]
    assert [r["adminId"] for r in rows] == [4]
    emp = c.get("/api/it/employees/E1/assets", headers=_it(app, 1)).get_json()["employee"]
    assert emp["adminId"] == 2


def test_logs_parcels_and_activity_are_tenant_scoped(app):
    c = app.test_client()
    h = _it(app, 2)
    logs = c.get("/api/it/deleted-logs", headers=h).get_json()["logs"]
    assert [log["id"] for log in logs] == [40]
    imports = c.get("/api/it/parcels/imports", headers=h).get_json()["imports"]
    assert [i["id"] for i in imports] == [40]
    activity = c.get("/api/it/activity-log", headers=h).get_json()["transitions"]
    assert [t["id"] for t in activity] == [40]

    assert c.delete("/api/it/deleted-logs", headers=h).status_code == 200
    with app.app_context():
        assert db.session.get(ITDeletedAssetLog, 40) is None
        assert db.session.get(ITDeletedAssetLog, 20) is not None


def test_new_rows_take_the_right_tenant(app):
    from website.itam.transition_service import record_transition

    c = app.test_client()
    resp = c.post("/api/it/deleted-logs", json={"asset_name": "Old mouse"}, headers=_it(app, 2))
    assert resp.status_code == 201
    with app.app_context():
        assert db.session.get(ITDeletedAssetLog, resp.get_json()["log"]["id"]).tenant_id == 2
        # No request here: the transition follows its inventory item, not the default tenant.
        row = record_transition(action_code="NOTE", remark="Checked by scheduler", inventory_item_id=40)
        db.session.commit()
        assert row.tenant_id == 2


def test_day_use_inbox_pool_and_actions_are_tenant_scoped(app):
    c = app.test_client()
    h = _it(app, 1)
    rows = c.get("/api/it/daily-checkout/inbox", headers=h).get_json()["requests"]
    assert [r["id"] for r in rows] == [20]
    pool = c.get("/api/it/daily-checkout/pool-units", headers=h).get_json()["units"]
    assert [u["id"] for u in pool] == [20]
    available = c.get("/api/it/daily-checkout/available-units", headers=h).get_json()["units"]
    assert [u["id"] for u in available] == [20]
    assert c.get("/api/it/daily-checkout/requests/40", headers=h).status_code == 404
    assert c.post("/api/it/daily-checkout/requests/40/approve", headers=h).status_code == 404
    resp = c.patch("/api/it/daily-checkout/units/40/daily-pool", json={"enabled": False}, headers=h)
    assert resp.status_code == 404
    with app.app_context():
        assert db.session.get(DailyCheckoutRequest, 40).status == "requested"
        assert db.session.get(ITAssetUnit, 40).is_daily_pool is True


def test_day_use_it_notifications_stay_in_request_tenant(app):
    from website.daily_checkout.service import notify_it_staff

    with app.app_context():
        notify_it_staff("Day-use overdue", "DU-2 is overdue", 40)
        db.session.commit()
        assert [n.recipient_admin_id for n in Notification.query.all()] == [3]


def test_it_tenant_migration_backfills_from_owners():
    from website.tenant_migrations import ensure_it_tenant_ids

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        for ddl in (
            "CREATE TABLE admins (id INTEGER PRIMARY KEY, tenant_id INTEGER)",
            "CREATE TABLE it_inventory_items (id INTEGER PRIMARY KEY, created_by_admin_id INTEGER)",
            "CREATE TABLE it_parcel_exports (id INTEGER PRIMARY KEY, exported_by_admin_id INTEGER)",
            "CREATE TABLE it_parcel_imports (id INTEGER PRIMARY KEY, received_by_admin_id INTEGER)",
            "CREATE TABLE it_removed_assets (id INTEGER PRIMARY KEY, inventory_item_id INTEGER, "
            "owner_admin_id INTEGER, removed_by_admin_id INTEGER)",
            "CREATE TABLE it_deleted_asset_logs (id INTEGER PRIMARY KEY, inventory_item_id INTEGER, "
            "deleted_by_admin_id INTEGER)",
            "CREATE TABLE it_asset_transitions (id INTEGER PRIMARY KEY, inventory_item_id INTEGER, "
            "actor_admin_id INTEGER)",
        ):
            conn.execute(text(ddl))
        conn.execute(text("INSERT INTO admins (id, tenant_id) VALUES (1, 1), (3, 2)"))
        conn.execute(text("INSERT INTO it_inventory_items VALUES (10, 1), (30, 3), (50, NULL)"))
        conn.execute(text("INSERT INTO it_parcel_imports VALUES (1, 3), (2, NULL)"))
        # Removed row: item wins over the admin columns.
        conn.execute(text("INSERT INTO it_removed_assets VALUES (1, 30, 1, 1), (2, NULL, NULL, 3)"))
        conn.execute(text("INSERT INTO it_deleted_asset_logs VALUES (1, NULL, 3)"))
        conn.execute(text("INSERT INTO it_asset_transitions VALUES (1, 30, NULL), (2, NULL, NULL)"))

    log = logging.getLogger("test")
    first = ensure_it_tenant_ids(engine, log)
    assert first["it_inventory_items"]["added"] is True
    assert first["it_inventory_items"]["backfilled"] == 3

    def tenants(table):
        with engine.connect() as conn:
            return [tuple(r) for r in conn.execute(text(f"SELECT id, tenant_id FROM {table} ORDER BY id"))]

    assert tenants("it_inventory_items") == [(10, 1), (30, 2), (50, 1)]
    assert tenants("it_parcel_imports") == [(1, 2), (2, 1)]
    assert tenants("it_removed_assets") == [(1, 2), (2, 2)]
    assert tenants("it_deleted_asset_logs") == [(1, 2)]
    assert tenants("it_asset_transitions") == [(1, 2), (2, 1)]

    again = ensure_it_tenant_ids(engine, log)
    for summary in again.values():
        if "added" in summary:
            assert summary["added"] is False and summary["backfilled"] == 0


PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def test_itam_photos_are_saved_under_the_company_folder(app, tmp_path):
    from website.models.family_models import FamilyDetails
    from website.secure_file_service import authorize_upload_access
    from website.upload_tenancy import upload_owner_tenant

    app.static_folder = str(tmp_path / "static")
    (tmp_path / "static").mkdir()
    client = app.test_client()
    resp = client.post(
        "/api/it/inventory/items",
        json={"name": "Camera", "category": "Hardware", "photos": [PNG]},
        headers=_it(app, 2),
    )
    assert resp.status_code == 201, resp.get_json()
    shown = resp.get_json()["item"]["photos"]
    assert len(shown) == 1 and shown[0].startswith("/api/files/signed/tenants/2/itam/")

    with app.app_context():
        item = ITInventoryItem.query.filter_by(name="Camera").one()
        key = item.photos_json[0]
        assert item.tenant_id == 2
        assert key.startswith("tenants/2/itam/inventory/")
        assert (tmp_path / "static" / "uploads").joinpath(*key.split("/")).is_file()
        assert authorize_upload_access(db.session.get(Admin, 3), key, {})[0] is True
        assert authorize_upload_access(db.session.get(Admin, 1), key, {})[0] is False
        item_id = item.id

    foreign = client.patch(
        f"/api/it/inventory/items/{item_id}",
        json={"photos": ["tenants/1/itam/inventory/secret.png", PNG]},
        headers=_it(app, 2),
    )
    assert foreign.status_code == 200, foreign.get_json()
    with app.app_context():
        stored = db.session.get(ITInventoryItem, item_id).photos_json
        assert len(stored) == 1 and stored[0].startswith("tenants/2/itam/inventory/")
        assert "secret.png" not in stored[0]

        db.session.add(FamilyDetails(
            admin_id=4, photo_filename="family/kid.jpg", name="Kid",
            dob=TODAY, age=10, relation="Son", occupation="Student", address="Home",
        ))
        db.session.commit()
        assert upload_owner_tenant("family/kid.jpg") == 2
        assert authorize_upload_access(db.session.get(Admin, 1), "family/kid.jpg", {})[0] is False


def test_it_codes_are_numbered_inside_each_company(app):
    client = app.test_client()
    one = client.post(
        "/api/it/inventory/items",
        json={"name": "Mouse", "category": "Hardware"},
        headers=_it(app, 1),
    )
    two = client.post(
        "/api/it/inventory/items",
        json={"name": "Mouse", "category": "Hardware"},
        headers=_it(app, 2),
    )
    assert one.status_code == 201 and two.status_code == 201
    # Company 1's latest code is INV-1, so the next is INV-0002. Company 2 continues from INV-2.
    assert one.get_json()["item"]["inventory_code"] == "INV-0002"
    assert two.get_json()["item"]["inventory_code"] == "INV-0003"

    serial = {"units": [{"unit_code": "SN-100", "asset_name": "Laptop", "hw_type": "Laptop"}]}
    assert client.post(
        "/api/it/units/bulk", json={"inventory_item_id": 20, **serial}, headers=_it(app, 1)
    ).status_code == 201
    assert client.post(
        "/api/it/units/bulk", json={"inventory_item_id": 40, **serial}, headers=_it(app, 2)
    ).status_code == 201
    clash = client.post(
        "/api/it/units/bulk", json={"inventory_item_id": 20, **serial}, headers=_it(app, 1)
    )
    assert clash.status_code == 409


def test_existing_itam_image_data_can_be_written_to_the_company_folder(app, tmp_path):
    from website.itam.media import extract_itam_data_urls

    app.static_folder = str(tmp_path / "static")
    (tmp_path / "static").mkdir()
    with app.app_context():
        item = db.session.get(ITInventoryItem, 40)
        item.photos_json = [PNG, "data:text/html;base64,PGh0bWw+", "tenants/2/itam/inventory/kept.png"]
        db.session.commit()
        dry = extract_itam_data_urls()
        assert dry == {"applied": False, "rows": 1, "files": 1, "bytes": 70, "skipped": 1}
        assert db.session.get(ITInventoryItem, 40).photos_json[0].startswith("data:image/")
        assert not (tmp_path / "static" / "uploads" / "tenants").exists()

        done = extract_itam_data_urls(apply=True)
        assert done["applied"] is True and done["files"] == 1 and done["skipped"] == 1
        stored = db.session.get(ITInventoryItem, 40).photos_json
        assert stored[0].startswith("tenants/2/itam/inventory/")
        assert stored[0].endswith(".png")
        assert stored[1].startswith("data:text/html")
        assert stored[2] == "tenants/2/itam/inventory/kept.png"
        assert (tmp_path / "static" / "uploads").joinpath(*stored[0].split("/")).is_file()
        assert not (tmp_path / "static" / "uploads" / "tenants" / "1").exists()

        again = extract_itam_data_urls(apply=True)
        assert again["files"] == 0 and again["rows"] == 0
        assert db.session.get(ITInventoryItem, 40).photos_json[0] == stored[0]

