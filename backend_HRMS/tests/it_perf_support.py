"""Shared app, seed data and helpers for IT list contract / query-count tests and the benchmark script."""
import importlib
import pkgutil
import re
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import event

import website.models as models_pkg
from website import db

for _mod in pkgutil.iter_modules(models_pkg.__path__):
    # confirmation_request references a Signup model that is not defined.
    if _mod.name != "confirmation_request":
        importlib.import_module(f"website.models.{_mod.name}")

from website.models.Admin_models import Admin  # noqa: E402
from website.models.daily_checkout import DailyCheckoutRequest, DailyUnitHold  # noqa: E402
from website.models.emp_detail_models import Employee  # noqa: E402
from website.models.it_models import (  # noqa: E402
    ITAssetReturnRequest,
    ITAssetTransition,
    ITAssetUnit,
    ITDeletedAssetLog,
    ITInventoryItem,
    ITInventoryQuantityAssignment,
    ITOfficeStockDeployment,
    ITRemovedAsset,
    ITSoftwareLicense,
    ITSupportTicket,
)
from website.models.tenant import Tenant  # noqa: E402
from website.tenant_context import register_tenant_guards  # noqa: E402

BASE = datetime(2025, 1, 1, 9, 0, 0)
PHOTO = "data:image/png;base64,iVBORw0KGgo="
IT_ADMIN_ID = 1
OTHER_TENANT_ADMIN_ID = 900

LIST_ENDPOINTS = (
    "/api/it/inventory/items",
    "/api/it/inventory/items?category=hardware",
    "/api/it/inventory/items?inventory_category=fixed assets",
    "/api/it/units",
    "/api/it/units?status=available",
    "/api/it/units?status=ASSIGNED",
    "/api/it/units?inventory_id=10",
    "/api/it/software/licenses",
    "/api/it/software/licenses?status=assigned",
    "/api/it/tickets",
    "/api/it/tickets?status=pending",
    "/api/it/return-requests",
    "/api/it/return-requests?status=pending",
    "/api/it/return-requests?emp_id=E2",
    "/api/it/employees/E2/return-requests",
    "/api/it/employees/E2/assets",
    "/api/it/employees/assigned-assets",
    "/api/it/employees/lookup?q=emp",
    "/api/it/removed-assets",
    "/api/it/deleted-logs",
    "/api/it/office-stock/deployments",
    "/api/it/inventory-stock/deployments?inventory_category=Transport Assets",
    "/api/it/summary",
    "/api/it/daily-checkout/available-units",
    "/api/it/daily-checkout/available-units?hw_type=Mobile",
    "/api/it/daily-checkout/available-units?q=lap",
)


def make_app(*, itam_flags_on=False, extra_config=None):
    from website.daily_checkout.views import daily_checkout_bp
    from website.it import it_bp

    app = Flask("it_perf")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        JWT_SECRET_KEY="test-it-perf-secret-key-32-chars!!",
        TESTING=True,
        itam_lifecycle_v1=itam_flags_on,
        itam_timeline_v1=itam_flags_on,
    )
    app.config.update(extra_config or {})
    db.init_app(app)
    register_tenant_guards(app, JWTManager(app))
    app.register_blueprint(it_bp, url_prefix="/api/it")
    app.register_blueprint(daily_checkout_bp, url_prefix="/api/it/daily-checkout")
    return app


def it_headers(app, admin_id=IT_ADMIN_ID, tenant_id=1):
    with app.app_context():
        token = create_access_token(
            identity=str(admin_id),
            additional_claims={"email": "it@x.com", "emp_type": "IT", "tenant_id": tenant_id},
        )
    return {"Authorization": f"Bearer {token}"}


def _ts(i, minutes=0):
    return BASE + timedelta(hours=i, minutes=minutes)


def _employee_row(admin_id, emp_id, photo):
    return Employee(
        admin_id=admin_id, name=f"Emp {admin_id}", email=f"emp{admin_id}@x.com", father_name="F",
        mother_name="M", marital_status="Single", dob=date(1990, 1, 1), emp_id=emp_id,
        mobile="9999999999", gender="Male", nationality="Indian", blood_group="O+",
        designation="Engineer", photo_filename=photo,
    )


def seed(n=3):
    """
    Tenant 1: one IT user plus ``n`` employees, each holding a unit, a license and an accessory,
    with ``n`` rows in every IT log table. Tenant 2 gets one row of each to prove scoping.
    Call inside an app context after ``db.create_all()``.
    """
    # Each table gets its own id block (100s for n <= 40, larger blocks at benchmark scale).
    block = 100 if n <= 40 else 10 ** len(str(2 * n + 10))

    def _id(x):
        return (x // 100) * block + (x % 100) * (block // 100)

    other_admin = _id(OTHER_TENANT_ADMIN_ID)
    common = dict(circle="NHQ", is_active=True, is_exited=False, doj=date(2023, 1, 1))
    db.session.add_all([
        Tenant(id=1, name="One", slug="default", plan="enterprise", status="active"),
        Tenant(id=2, name="Two", slug="two", plan="enterprise", status="active"),
    ])
    db.session.add(Admin(
        id=IT_ADMIN_ID, tenant_id=1, email="it@x.com", emp_id="IT1", first_name="One IT", emp_type="IT", **common,
    ))
    emp_ids = []
    for i in range(n):
        aid = 2 + i
        emp_ids.append(aid)
        # Every third employee has no first name so the email fallback is exercised.
        db.session.add(Admin(
            id=aid, tenant_id=1, email=f"emp{aid}@x.com", emp_id=f"E{aid}",
            first_name=("" if i % 3 == 2 else f"Emp {aid}"), emp_type="Engineering", **common,
        ))
    db.session.add(Admin(
        id=other_admin, tenant_id=2, email="it@x.com", emp_id="IT1", first_name="Two IT",
        emp_type="IT", **common,
    ))
    db.session.flush()
    for i, aid in enumerate(emp_ids):
        if i % 2 == 0:
            db.session.add(_employee_row(aid, f"E{aid}", f"employee_photos/e{aid}.jpg"))

    def item(iid, tid, name, category, inv_cat, **kw):
        return ITInventoryItem(
            id=iid, tenant_id=tid, inventory_code=f"INV-{iid}", name=name, category=category,
            inventory_category=inv_cat, created_by_admin_id=IT_ADMIN_ID if tid == 1 else other_admin,
            created_at=_ts(0, iid), updated_at=_ts(0, iid), photos_json=[PHOTO], receipts_json=[], **kw,
        )

    db.session.add_all([
        item(10, 1, "Laptop", "Hardware", "IT Assets", hw_type="Laptop"),
        item(11, 1, "Office 365", "Software", "IT Assets"),
        item(12, 1, "Mouse", "Accessories", "IT Assets", total_quantity=50, available_quantity=40),
        item(13, 1, "Chairs", "Stock", "Fixed Assets", total_quantity=20, available_quantity=10),
        item(14, 1, "Van", "Vehicle", "Transport Assets"),
        item(20, 2, "Laptop", "Hardware", "IT Assets", hw_type="Laptop"),
    ])
    db.session.flush()

    unit_id = _id(100)
    for i, aid in enumerate(emp_ids):
        db.session.add(ITAssetUnit(
            id=unit_id, inventory_item_id=10, unit_code=f"LAP-{unit_id}", asset_name="Laptop", category="Hardware",
            hw_type="Laptop", brand="Dell", make="Dell", model="5420", serial_number=f"SN{unit_id}",
            status="assigned", assigned_to_admin_id=aid, assigned_at=_ts(i), photos_json=[PHOTO],
            assignment_photos_json=[PHOTO], created_at=_ts(i), updated_at=_ts(i),
        ))
        unit_id += 1
    for i in range(n):
        hw = "Mobile" if i % 2 else "Laptop"
        db.session.add(ITAssetUnit(
            id=unit_id, inventory_item_id=10, unit_code=f"{hw.upper()}-{unit_id}", asset_name=f"{hw} spare {i}",
            category="Hardware", hw_type=hw, status="Available" if i == 0 else "available", is_daily_pool=True,
            photos_json=[PHOTO], created_at=_ts(i, 30), updated_at=_ts(i, 30),
        ))
        unit_id += 1
    db.session.add(ITAssetUnit(
        id=unit_id, inventory_item_id=10, unit_code=f"LAP-{unit_id}", asset_name="Laptop broken",
        category="Hardware", hw_type="Laptop", status="repair", created_at=_ts(0), updated_at=_ts(0),
    ))
    van_unit_id = unit_id + 1
    db.session.add(ITAssetUnit(
        id=van_unit_id, inventory_item_id=14, unit_code="VAN-1", asset_name="Van", category="Vehicle",
        hw_type=None, serial_number="DL01AB1234", status="assigned", created_at=_ts(0), updated_at=_ts(0),
    ))
    held_unit_id = van_unit_id + 1
    db.session.add(ITAssetUnit(
        id=held_unit_id, inventory_item_id=10, unit_code="LAP-HELD", asset_name="Laptop held", category="Hardware",
        hw_type="Laptop", status="available", is_daily_pool=True, created_at=_ts(0), updated_at=_ts(0),
    ))
    db.session.add(ITAssetUnit(
        id=held_unit_id + 1, inventory_item_id=20, unit_code="LAP-T2", asset_name="Laptop", category="Hardware",
        hw_type="Laptop", status="available", created_at=_ts(0), updated_at=_ts(0),
    ))
    db.session.flush()

    lic_id = _id(300)
    for i, aid in enumerate(emp_ids):
        db.session.add(ITSoftwareLicense(
            id=lic_id, inventory_item_id=11, license_code=f"LIC-{lic_id}", name="Office 365", status="assigned",
            assigned_to_admin_id=aid, assigned_at=_ts(i), subscription_start=date(2025, 1, 1),
            subscription_end=date(2026, 1, 1), created_at=_ts(i), updated_at=_ts(i),
        ))
        lic_id += 1
    db.session.add(ITSoftwareLicense(
        id=lic_id, inventory_item_id=11, license_code=f"LIC-{lic_id}", name="Office 365", status="available",
        created_at=_ts(0), updated_at=_ts(0),
    ))

    for i, aid in enumerate(emp_ids):
        db.session.add(ITInventoryQuantityAssignment(
            id=_id(400) + i, inventory_item_id=12, assigned_to_admin_id=aid, quantity=(0 if i == 1 else 2),
            created_at=_ts(i), updated_at=_ts(i),
        ))

    for i, aid in enumerate(emp_ids):
        db.session.add(ITSupportTicket(
            id=_id(500) + i, ticket_code=f"TKT-{_id(500) + i}", requester_admin_id=aid,
            assignee_admin_id=(IT_ADMIN_ID if i % 2 == 0 else None), title=f"Issue {i}", description="Screen",
            priority="medium", status=("pending" if i % 2 == 0 else "completed"),
            created_at=_ts(i), updated_at=_ts(i),
        ))
        db.session.add(ITAssetReturnRequest(
            id=_id(600) + i, tenant_id=1, request_code=f"RET-{_id(600) + i}", requester_admin_id=aid,
            requester_emp_id=f"E{aid}", asset_unit_id=_id(100) + i, asset_name="Laptop", category="Hardware",
            reason="Leaving", photos_json=[PHOTO], status=("pending" if i % 2 == 0 else "approved"),
            approved_by_admin_id=(IT_ADMIN_ID if i % 2 else None), approved_at=(_ts(i, 5) if i % 2 else None),
            created_at=_ts(i), updated_at=_ts(i),
        ))
        db.session.add(ITRemovedAsset(
            id=_id(700) + i, tenant_id=1, removed_code=f"RIT-{_id(700) + i}", owner_admin_id=aid,
            removed_by_admin_id=IT_ADMIN_ID, name="Old laptop", category="Hardware", reason="Dead",
            photos_json=[PHOTO], removed_at=_ts(i),
        ))
        db.session.add(ITDeletedAssetLog(
            id=_id(800) + i, tenant_id=1, delete_code=f"DEL-{_id(800) + i}", deleted_by_admin_id=IT_ADMIN_ID,
            deleted_by_name=("" if i % 2 == 0 else "Named IT"), asset_name="Old mouse", category="Accessories",
            serial_number=f"MS{i}", reason="Lost", deleted_at=_ts(i),
        ))
        db.session.add(ITOfficeStockDeployment(
            id=_id(900) + i, inventory_item_id=13, inventory_category="Fixed Assets", quantity=1,
            deployment_location=f"Floor {i}", custodian_name=f"Emp {aid}", custodian_emp_id=f"E{aid}",
            created_by_admin_id=IT_ADMIN_ID, created_at=_ts(i),
        ))
    db.session.add(ITOfficeStockDeployment(
        id=_id(999), inventory_item_id=14, inventory_category="Transport Assets", asset_unit_id=van_unit_id,
        quantity=1, deployment_location="Depot", created_by_admin_id=IT_ADMIN_ID, created_at=_ts(0),
    ))

    db.session.add_all([
        ITSupportTicket(
            id=_id(550), ticket_code="TKT-T2", requester_admin_id=other_admin, title="T2", description="x",
            created_at=_ts(0), updated_at=_ts(0),
        ),
        ITDeletedAssetLog(id=_id(850), tenant_id=2, delete_code="DEL-T2", asset_name="T2", deleted_at=_ts(0)),
        ITRemovedAsset(id=_id(750), tenant_id=2, removed_code="RIT-T2", name="T2", removed_at=_ts(0)),
    ])
    for i, uid in enumerate((_id(100), _id(100) + 1)):
        db.session.add(ITAssetTransition(
            id=_id(1000) + i, tenant_id=1, transition_code=f"TRN-{i}", action_code="NOTE", remark=f"Note {i}",
            asset_unit_id=uid, inventory_item_id=10, occurred_at=_ts(i),
        ))
    db.session.flush()
    hold_req = DailyCheckoutRequest(
        id=_id(1100), request_code="DU-1", requester_admin_id=emp_ids[0], requested_hw_type="Laptop",
        expected_return_at=_ts(1), created_at=_ts(0), updated_at=_ts(0),
    )
    db.session.add(hold_req)
    db.session.flush()
    db.session.add(DailyUnitHold(asset_unit_id=held_unit_id, request_id=hold_req.id, held_at=_ts(0)))
    db.session.commit()
    return emp_ids


@contextmanager
def count_queries(engine):
    statements = []

    def _hook(_conn, _cursor, statement, *_args):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _hook)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _hook)


_SIGNED = re.compile(r"exp=\d+&sig=[0-9a-f]+")


def normalize(value):
    """Mask parts that change on every call: URL signatures and timestamps written as 'now'."""
    today = {datetime.now(timezone.utc).date().isoformat(), date.today().isoformat()}
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize(v) for v in value]
    if isinstance(value, str):
        if value[:10] in today and len(value) > 10 and value[10] == "T":
            return "<now>"
        return _SIGNED.sub("exp=<exp>&sig=<sig>", value)
    return value
