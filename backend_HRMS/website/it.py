from datetime import datetime

from flask import Blueprint, current_app, jsonify, request, send_file
from .datetime_utils import utc_now, isoformat_api
from flask_jwt_extended import get_jwt_identity, jwt_required, get_jwt

from . import db
from .models.Admin_models import Admin
from .models.it_models import (
    ITAssetAssignment,
    ITAssetReturnRequest,
    ITAssetUnit,
    ITDeletedAssetLog,
    ITInventoryItem,
    ITInventoryQuantityAssignment,
    ITOfficeStockDeployment,
    ITParcelExport,
    ITParcelExportItem,
    ITParcelImport,
    ITRemovedAsset,
    ITSoftwareLicense,
    ITSupportTicket,
)
from .email import (
    send_it_assignment_notification,
    send_it_return_request_email,
    send_it_return_request_status_email,
)
from .noc_department_service import download_noc_document, list_noc_requests, upload_noc_document
from .employee_photo import photo_url_for_admin


it_bp = Blueprint("it", __name__)


@it_bp.before_request
def _it_plan_guard():
    from .plan_features import can_access_it_panel, plan_forbidden_response

    if request.method == "OPTIONS":
        return None
    if not can_access_it_panel():
        return plan_forbidden_response("it_panel")
    return None


def _ok(payload=None, message="OK", code=200):
    body = {"success": True, "message": message}
    if payload:
        body.update(payload)
    return jsonify(body), code


def _err(message="Bad request", code=400):
    return jsonify({"success": False, "message": message}), code


def _iso(dt):
    return isoformat_api(dt)


def _parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except Exception:
        return None


def _ensure_parcel_name_columns_runtime():
    """Best-effort runtime safety: add free-text parcel columns if missing."""
    try:
        from sqlalchemy import inspect, text

        insp = inspect(db.engine)
        tables = set(insp.get_table_names())
        dialect = db.engine.dialect.name

        def addcol(table, col):
            if table not in tables:
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            if col in existing:
                return
            if dialect == "postgresql":
                stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} VARCHAR(120) NULL')
            else:
                stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} VARCHAR(120) NULL")
            with db.engine.begin() as conn:
                conn.execute(stmt)
            current_app.logger.info("Added missing parcel column %s.%s at runtime", table, col)

        addcol("it_parcel_imports", "received_by_name")
        addcol("it_parcel_exports", "exported_by_name")
        addcol("it_parcel_exports", "inventory_category")
        addcol("it_parcel_export_items", "make")
    except Exception as e:
        current_app.logger.warning("parcel runtime column ensure skipped: %s", e)


def _current_admin():
    try:
        admin_id = int(get_jwt_identity())
    except Exception:
        return None
    return Admin.query.get(admin_id)


def _admin_name(admin):
    if not admin:
        return None
    return (admin.first_name or "").strip() or admin.email or f"Admin-{admin.id}"


def _serialize_admin_employee(admin, assigned_assets=None):
    photo = photo_url_for_admin(admin)
    return {
        "id": admin.emp_id or str(admin.id),
        "empId": admin.emp_id or str(admin.id),
        "adminId": admin.id,
        "name": admin.first_name or "",
        "type": admin.emp_type or "",
        "circle": admin.circle or "",
        "email": admin.email or "",
        "photo": photo,
        "photo_url": photo,
        "activated": bool(admin.is_active),
        "assignedAssets": assigned_assets if assigned_assets is not None else _serialize_emp_assets(admin),
    }


def _resolve_admin_by_emp_key(emp_key):
    """Resolve Admin from URL/key: emp_id, numeric admin id, or email."""
    key = str(emp_key or "").strip()
    if not key:
        return None
    emp = Admin.query.filter(
        db.func.lower(db.func.coalesce(Admin.emp_id, "")) == key.lower()
    ).first()
    if emp:
        return emp
    if key.isdigit():
        return Admin.query.get(int(key))
    return Admin.query.filter(
        db.func.lower(db.func.coalesce(Admin.email, "")) == key.lower()
    ).first()


def _is_qty_managed_inventory(category, inventory_category=None):
    cat = (category or "").strip().lower()
    if cat in ("accessories", "consumables", "stock"):
        return True
    inv = (inventory_category or "").strip()
    if inv in ("Office Assets", "Infrastructure Assets"):
        return cat == "stock" or cat in ("accessories", "consumables")
    return False


def _coerce_optional_int(value):
    """Return int id or None — rejects frontend synthetic tokens like inv-slot-12-0."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    try:
        s = str(value).strip()
        if not s or not s.lstrip("-").isdigit():
            return None
        return int(s)
    except (TypeError, ValueError):
        return None


def _inventory_id_from_export_slot(value):
    """Parse inv-slot-{inventoryId}-{index} from Ready for Export UI."""
    s = str(value or "").strip()
    if not s.startswith("inv-slot-"):
        return None
    parts = s.split("-")
    if len(parts) >= 4:
        return _coerce_optional_int(parts[2])
    return None


def _resolve_parcel_export_item_ids(it):
    """Map export payload row to real asset_unit_id and optional inventory_item_id."""
    raw_uid = it.get("asset_unit_id")
    if raw_uid is None:
        raw_uid = it.get("id")
    asset_unit_id = _coerce_optional_int(raw_uid)
    inventory_item_id = _coerce_optional_int(it.get("inventory_item_id"))
    if inventory_item_id is None:
        inventory_item_id = _inventory_id_from_export_slot(raw_uid)
    return asset_unit_id, inventory_item_id


def _effective_inventory_category(item):
    """Align stored inventory_category with item.category (fixes legacy mis-tagged rows)."""
    ic = (item.inventory_category or "").strip()
    cat = (item.category or "").strip().lower()
    if cat == "vehicle":
        return "Transport Assets"
    if cat == "equipment":
        return "Infrastructure Assets"
    if cat == "stock":
        if ic in ("Office Assets", "Infrastructure Assets", "Transport Assets"):
            return ic
        return ic
    if cat in ("hardware", "software", "accessories", "consumables"):
        return "IT Assets"
    return ic or "IT Assets"


def _serialize_inventory_item(item):
    return {
        "id": item.id,
        "inventory_code": item.inventory_code,
        "name": item.name,
        "category": item.category,
        "inventory_category": _effective_inventory_category(item),
        "hw_type": item.hw_type,
        "photos": item.photos_json or [],
        "vendor": item.vendor or "",
        "purchase_date": item.purchase_date.isoformat() if item.purchase_date else None,
        "receipts": item.receipts_json or [],
        "location": item.location or "",
        "notes": item.notes or "",
        "totalQuantity": int(item.total_quantity or 0),
        "availableQuantity": int(item.available_quantity or 0),
        "assignedQuantity": int(item.assigned_quantity or 0),
        "notWorkingQuantity": int(item.not_working_quantity or 0),
        "repairQuantity": int(item.repair_quantity or 0),
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


def _serialize_asset_unit(unit):
    assigned_admin = unit.assigned_to_admin
    return {
        "id": unit.id,
        "unitCode": unit.unit_code,
        "inventoryId": unit.inventory_item_id,
        "assetName": unit.asset_name,
        "category": unit.category,
        "hwType": unit.hw_type,
        "brand": unit.brand,
        "make": unit.make,
        "model": unit.model,
        "serialNumber": unit.serial_number,
        "imei1": unit.imei1,
        "imei2": unit.imei2,
        "status": unit.status,
        "assignedTo": unit.assigned_to_admin_id,
        "assignedToName": _admin_name(unit.assigned_to_admin),
        "assignedToEmpId": (assigned_admin.emp_id if assigned_admin else None),
        "assignedToPhoto": photo_url_for_admin(assigned_admin),
        "assignedDate": _iso(unit.assigned_at),
        "assetTag": unit.asset_tag,
        "exportedTo": unit.exported_to,
        "exportedAt": _iso(unit.exported_at),
        "repairDate": _iso(unit.repair_date),
        "photos": unit.photos_json or [],
        "assignmentPhotos": unit.assignment_photos_json or [],
        "created_at": _iso(unit.created_at),
        "updated_at": _iso(unit.updated_at),
    }


def _serialize_license(lic):
    assigned_admin = lic.assigned_to_admin
    return {
        "id": lic.id,
        "licenseCode": lic.license_code,
        "inventoryId": lic.inventory_item_id,
        "name": lic.name,
        "subscriptionStart": lic.subscription_start.isoformat() if lic.subscription_start else None,
        "subscriptionEnd": lic.subscription_end.isoformat() if lic.subscription_end else None,
        "status": lic.status,
        "assignedTo": lic.assigned_to_admin_id,
        "assignedToName": _admin_name(lic.assigned_to_admin),
        "assignedToEmpId": (assigned_admin.emp_id if assigned_admin else None),
        "assignedToPhoto": photo_url_for_admin(assigned_admin),
        "assignedDate": _iso(lic.assigned_at),
        "created_at": _iso(lic.created_at),
        "updated_at": _iso(lic.updated_at),
    }


def _serialize_ticket(t):
    return {
        "id": t.id,
        "ticketCode": t.ticket_code,
        "requesterAdminId": t.requester_admin_id,
        "requesterName": _admin_name(t.requester_admin),
        "assigneeAdminId": t.assignee_admin_id,
        "assigneeName": _admin_name(t.assignee_admin),
        "title": t.title,
        "description": t.description,
        "priority": t.priority,
        "status": t.status,
        "resolvedAt": _iso(t.resolved_at),
        "created_at": _iso(t.created_at),
        "updated_at": _iso(t.updated_at),
    }


def _serialize_removed_asset(r):
    return {
        "id": r.id,
        "removedCode": r.removed_code,
        "assetUnitId": r.asset_unit_id,
        "inventoryId": r.inventory_item_id,
        "ownerAdminId": r.owner_admin_id,
        "ownerName": _admin_name(r.owner_admin),
        "removedByAdminId": r.removed_by_admin_id,
        "removedByName": _admin_name(r.removed_by_admin),
        "name": r.name,
        "category": r.category,
        "reason": r.reason,
        "photos": r.photos_json or [],
        "removedAt": _iso(r.removed_at),
    }


def _serialize_deleted_log(d):
    return {
        "id": d.id,
        "deleteCode": d.delete_code,
        "assetUnitId": d.asset_unit_id,
        "inventoryId": d.inventory_item_id,
        "deletedByAdminId": d.deleted_by_admin_id,
        "deletedByName": (d.deleted_by_name or "").strip() or _admin_name(d.deleted_by_admin),
        "assetName": d.asset_name,
        "category": d.category,
        "serialNumber": d.serial_number,
        "reason": d.reason,
        "deletedAt": _iso(d.deleted_at),
    }


def _serialize_parcel_import(i):
    return {
        "id": i.id,
        "importCode": i.import_code,
        "from": i.source,
        "assetName": i.asset_name,
        "count": i.count,
        "idNo": i.id_no,
        "receivedByAdminId": i.received_by_admin_id,
        "receivedBy": (i.received_by_name or "").strip() or _admin_name(i.received_by_admin),
        "date": _iso(i.received_at),
        "photos": i.photos_json or [],
    }


def _serialize_parcel_export(e):
    return {
        "id": e.id,
        "exportCode": e.export_code,
        "to": e.destination,
        "idNo": e.id_no,
        "exportedByAdminId": e.exported_by_admin_id,
        "exportedBy": (e.exported_by_name or "").strip() or _admin_name(e.exported_by_admin),
        "date": _iso(e.exported_at),
        "photos": e.parcel_photos_json or [],
        "inventoryCategory": (e.inventory_category or "").strip() or None,
        "count": len(e.items),
        "assets": [
            {
                "id": it.id,
                "assetUnitId": it.asset_unit_id,
                "assetName": it.asset_name,
                "serialNo": it.serial_number,
                "brand": it.brand,
                "make": (it.make or "").strip()
                or ((it.asset_unit.make or "").strip() if it.asset_unit else ""),
                "model": it.model,
                "individualPhoto": (it.individual_photo_json or [None])[0]
                if isinstance(it.individual_photo_json, list)
                else it.individual_photo_json,
            }
            for it in e.items
        ],
    }


def _serialize_return_request(r):
    return {
        "id": r.id,
        "requestCode": r.request_code,
        "requesterAdminId": r.requester_admin_id,
        "requesterEmpId": r.requester_emp_id,
        "requesterName": _admin_name(r.requester_admin),
        "requesterEmail": (r.requester_admin.email if r.requester_admin else None),
        "assetUnitId": r.asset_unit_id,
        "softwareLicenseId": r.software_license_id,
        "inventoryItemId": r.inventory_item_id,
        "quantity": int(r.quantity or 1),
        "assetName": r.asset_name,
        "category": r.category,
        "reason": r.reason,
        "returnDestination": r.return_destination or "available",
        "photos": r.photos_json or [],
        "status": r.status,
        "approvedByAdminId": r.approved_by_admin_id,
        "approvedByName": _admin_name(r.approved_by_admin),
        "approvedAt": _iso(r.approved_at),
        "receiptConfirmedByAdminId": r.receipt_confirmed_by_admin_id,
        "receiptConfirmedByName": _admin_name(r.receipt_confirmed_by_admin),
        "receiptConfirmedAt": _iso(r.receipt_confirmed_at),
        "rejectionReason": r.rejection_reason,
        "createdAt": _iso(r.created_at),
        "updatedAt": _iso(r.updated_at),
    }


def _next_code(prefix, model, field_name):
    latest = model.query.order_by(model.id.desc()).first()
    if not latest:
        return f"{prefix}-0001"
    current = getattr(latest, field_name, "") or ""
    try:
        n = int(current.split("-")[-1]) + 1
    except Exception:
        n = latest.id + 1
    return f"{prefix}-{str(n).zfill(4)}"


def _serialize_emp_assets(emp):
    units = ITAssetUnit.query.filter_by(assigned_to_admin_id=emp.id).all()
    licenses = ITSoftwareLicense.query.filter_by(assigned_to_admin_id=emp.id).all()
    qty_rows = (
        ITInventoryQuantityAssignment.query.filter_by(assigned_to_admin_id=emp.id)
        .filter(ITInventoryQuantityAssignment.quantity > 0)
        .all()
    )
    assets = []
    for u in units:
        assets.append(
            {
                "id": u.id,
                "assetId": u.unit_code,
                "assetTag": u.asset_tag,
                "name": u.asset_name,
                "category": u.category or "Hardware",
                "status": "Assigned" if u.status == "assigned" else (u.status or "Assigned"),
                "hwType": u.hw_type,
                "brand": u.brand or "",
                "make": u.make or "",
                "model": u.model or "",
                "serialNumber": u.serial_number or "",
                "imei1": u.imei1,
                "imei2": u.imei2,
                "photos": u.assignment_photos_json or u.photos_json or [],
                "assignedDate": _iso(u.assigned_at),
            }
        )
    for s in licenses:
        assets.append(
            {
                "id": s.id,
                "licenseId": s.id,
                "name": s.name,
                "category": "Software",
                "status": "Assigned" if s.status == "assigned" else (s.status or "Assigned"),
                "subscriptionStart": s.subscription_start.isoformat() if s.subscription_start else None,
                "subscriptionEnd": s.subscription_end.isoformat() if s.subscription_end else None,
                "photos": [],
                "assignedDate": _iso(s.assigned_at),
            }
        )
    for qa in qty_rows:
        item = qa.inventory_item
        category = (item.category if item else "") or ""
        cat_norm = category.strip().lower()
        if cat_norm.startswith("consumable"):
            category = "Consumables"
        elif cat_norm.startswith("accessor"):
            category = "Accessories"
        assets.append(
            {
                "id": f"invq-{qa.id}",
                "inventoryAssignmentId": qa.id,
                "inventoryId": qa.inventory_item_id,
                "name": item.name if item else "Inventory item",
                "category": category or "Accessories",
                "quantity": int(qa.quantity or 0),
                "status": "Assigned",
                "photos": [],
                "assignedDate": _iso(qa.updated_at or qa.created_at),
            }
        )
    return assets


@it_bp.route("/employees/assigned-assets", methods=["GET"])
@jwt_required()
def list_employee_assigned_assets():
    rows = Admin.query.order_by(Admin.id.asc()).all()
    out = []
    for emp in rows:
        assets = _serialize_emp_assets(emp)
        if not assets:
            continue
        out.append(_serialize_admin_employee(emp, assets))
    return _ok({"employees": out})


def _recalc_inventory_counts(inventory_id):
    item = ITInventoryItem.query.get(inventory_id)
    if not item:
        return
    units = ITAssetUnit.query.filter_by(inventory_item_id=inventory_id).all()
    if item.category.lower() == "software":
        seats = ITSoftwareLicense.query.filter_by(inventory_item_id=inventory_id).all()
        item.total_quantity = len(seats)
        item.available_quantity = len([s for s in seats if s.status == "available"])
        item.assigned_quantity = len([s for s in seats if s.status == "assigned"])
        item.not_working_quantity = 0
        item.repair_quantity = 0
    else:
        item.total_quantity = len(units)
        item.available_quantity = len([u for u in units if u.status == "available"])
        item.assigned_quantity = len([u for u in units if u.status == "assigned"])
        item.not_working_quantity = len([u for u in units if u.status in ("not-working", "notWorking")])
        item.repair_quantity = len([u for u in units if u.status == "repair"])


@it_bp.route("/summary", methods=["GET"])
@jwt_required()
def it_summary():
    total_assets = db.session.query(db.func.count(ITAssetUnit.id)).scalar() or 0
    open_tickets = db.session.query(db.func.count(ITSupportTicket.id)).filter(ITSupportTicket.status == "pending").scalar() or 0
    assigned_assets = db.session.query(db.func.count(ITAssetUnit.id)).filter(ITAssetUnit.status == "assigned").scalar() or 0
    available_software = db.session.query(db.func.count(ITSoftwareLicense.id)).filter(ITSoftwareLicense.status == "available").scalar() or 0
    return _ok(
        {
            "summary": {
                "total_assets": total_assets,
                "open_tickets": open_tickets,
                "assigned_assets": assigned_assets,
                "available_software": available_software,
            }
        }
    )


@it_bp.route("/employees/<string:emp_id>/assets", methods=["GET"])
@jwt_required()
def employee_assets(emp_id):
    emp = _resolve_admin_by_emp_key(emp_id)
    if not emp:
        return _err("Employee not found", 404)
    payload = {"employee": _serialize_admin_employee(emp)}
    return _ok(payload)


@it_bp.route("/employees/<string:emp_id>/return-requests", methods=["GET"])
@jwt_required()
def employee_return_requests(emp_id):
    """Return requests raised by this employee (matches submit flow / requester)."""
    emp = _resolve_admin_by_emp_key(emp_id)
    if not emp:
        return _err("Employee not found", 404)
    status = (request.args.get("status") or "").strip().lower()
    q = ITAssetReturnRequest.query.filter(
        ITAssetReturnRequest.requester_admin_id == emp.id
    )
    if status:
        q = q.filter(db.func.lower(ITAssetReturnRequest.status) == status)
    rows = q.order_by(
        ITAssetReturnRequest.created_at.desc(),
        ITAssetReturnRequest.id.desc(),
    ).all()
    return _ok({"requests": [_serialize_return_request(r) for r in rows]})


@it_bp.route("/employees/lookup", methods=["GET"])
@jwt_required()
def lookup_employee():
    q = (request.args.get("q") or "").strip()
    if not q:
        return _err("q is required")

    ql = q.lower()
    rows = Admin.query.filter(
        db.or_(
            db.func.lower(db.func.coalesce(Admin.emp_id, "")) == ql,
            db.func.lower(db.func.coalesce(Admin.email, "")) == ql,
        )
    ).order_by(Admin.id.desc()).all()

    return _ok(
        {
            "employees": [_serialize_admin_employee(r) for r in rows]
        }
    )


@it_bp.route("/inventory/items", methods=["GET"])
@jwt_required()
def list_inventory_items():
    category = (request.args.get("category") or "").strip()
    inventory_category = (request.args.get("inventory_category") or "").strip()
    q = ITInventoryItem.query
    if category:
        q = q.filter(db.func.lower(ITInventoryItem.category) == category.lower())
    if inventory_category:
        q = q.filter(db.func.lower(ITInventoryItem.inventory_category) == inventory_category.lower())
    items = q.order_by(ITInventoryItem.id.desc()).all()
    return _ok({"items": [_serialize_inventory_item(i) for i in items]})


@it_bp.route("/inventory/items", methods=["POST"])
@jwt_required()
def create_inventory_item():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    category = (data.get("category") or "").strip()
    if not name or not category:
        return _err("name and category are required")
    inventory_category = (data.get("inventory_category") or "IT Assets").strip()
    inv_lower = inventory_category.lower()
    if inv_lower == "office assets" and category.strip().lower() not in (
        "accessories",
        "consumables",
        "stock",
    ):
        category = "Stock"
    if inv_lower == "infrastructure assets" and category.strip().lower() not in (
        "accessories",
        "consumables",
        "stock",
        "equipment",
    ):
        category = "Stock"
    if inv_lower == "transport assets" and category.strip().lower() != "vehicle":
        category = "Vehicle"

    initial_quantity = int(data.get("initial_quantity") or 0)
    is_qty_managed = _is_qty_managed_inventory(category, inventory_category)
    if is_qty_managed and initial_quantity < 1:
        return _err("initial_quantity must be >= 1 for quantity-based stock items")

    current_admin = _current_admin()
    item = ITInventoryItem(
        inventory_code=data.get("inventory_code") or _next_code("INV", ITInventoryItem, "inventory_code"),
        name=name,
        category=category,
        inventory_category=inventory_category,
        hw_type=(data.get("hw_type") or None),
        photos_json=data.get("photos") or [],
        vendor=(data.get("vendor") or "").strip() or None,
        purchase_date=_parse_date(data.get("purchase_date")),
        receipts_json=data.get("receipts") or [],
        location=(data.get("location") or "").strip() or None,
        notes=(data.get("notes") or "").strip() or None,
        total_quantity=initial_quantity if is_qty_managed else 0,
        available_quantity=initial_quantity if is_qty_managed else 0,
        assigned_quantity=0,
        created_by_admin_id=current_admin.id if current_admin else None,
    )
    db.session.add(item)
    db.session.commit()
    return _ok({"item": _serialize_inventory_item(item)}, "Inventory item created", 201)


@it_bp.route("/inventory/items/<int:item_id>", methods=["PATCH"])
@jwt_required()
def update_inventory_item(item_id):
    item = ITInventoryItem.query.get(item_id)
    if not item:
        return _err("Inventory item not found", 404)
    data = request.get_json(silent=True) or {}
    for key, attr in (
        ("name", "name"),
        ("category", "category"),
        ("inventory_category", "inventory_category"),
        ("hw_type", "hw_type"),
        ("photos", "photos_json"),
        ("vendor", "vendor"),
        ("location", "location"),
        ("notes", "notes"),
        ("receipts", "receipts_json"),
    ):
        if key in data:
            setattr(item, attr, (data.get(key) or None))
    if "purchase_date" in data:
        item.purchase_date = _parse_date(data.get("purchase_date"))

    for key, attr in (
        ("total_quantity", "total_quantity"),
        ("available_quantity", "available_quantity"),
        ("assigned_quantity", "assigned_quantity"),
        ("not_working_quantity", "not_working_quantity"),
        ("repair_quantity", "repair_quantity"),
    ):
        if key in data and data.get(key) is not None:
            try:
                setattr(item, attr, max(0, int(data.get(key) or 0)))
            except (TypeError, ValueError):
                return _err(f"{key} must be an integer")
    db.session.commit()
    return _ok({"item": _serialize_inventory_item(item)}, "Inventory item updated")


@it_bp.route("/units", methods=["GET"])
@jwt_required()
def list_units():
    status = (request.args.get("status") or "").strip()
    inventory_id = request.args.get("inventory_id", type=int)
    q = ITAssetUnit.query
    if status:
        q = q.filter(db.func.lower(ITAssetUnit.status) == status.lower())
    if inventory_id:
        q = q.filter(ITAssetUnit.inventory_item_id == inventory_id)
    rows = q.order_by(ITAssetUnit.id.desc()).all()
    return _ok({"units": [_serialize_asset_unit(r) for r in rows]})


@it_bp.route("/units/bulk", methods=["POST"])
@jwt_required()
def create_units_bulk():
    data = request.get_json(silent=True) or {}
    inventory_id = data.get("inventory_item_id")
    units = data.get("units") or []
    if not inventory_id or not isinstance(units, list) or not units:
        return _err("inventory_item_id and non-empty units array are required")
    inv = ITInventoryItem.query.get(inventory_id)
    if not inv:
        return _err("Inventory item not found", 404)

    created = []
    for row in units:
        unit_code = (row.get("unit_code") or row.get("serial_number") or "").strip()
        if not unit_code:
            continue
        unit = ITAssetUnit(
            unit_code=unit_code,
            inventory_item_id=inventory_id,
            asset_name=(row.get("asset_name") or inv.name or "").strip(),
            category=(row.get("category") or inv.category or "Hardware").strip(),
            hw_type=row.get("hw_type") or inv.hw_type,
            brand=row.get("brand"),
            make=row.get("make"),
            model=row.get("model"),
            serial_number=row.get("serial_number"),
            imei1=row.get("imei1"),
            imei2=row.get("imei2"),
            status=(row.get("status") or "available").strip(),
            photos_json=row.get("photos") or [],
        )
        db.session.add(unit)
        created.append(unit)
    if not created:
        return _err("No valid units provided")
    db.session.flush()
    _recalc_inventory_counts(inventory_id)
    db.session.commit()
    return _ok({"units": [_serialize_asset_unit(u) for u in created]}, "Units created", 201)


@it_bp.route("/units/<int:unit_id>/status", methods=["PATCH"])
@jwt_required()
def update_unit_status(unit_id):
    unit = ITAssetUnit.query.get(unit_id)
    if not unit:
        return _err("Unit not found", 404)
    data = request.get_json(silent=True) or {}
    status = (data.get("status") or "").strip()
    if not status:
        return _err("status is required")

    unit.status = status
    if status == "repair" and not unit.repair_date:
        unit.repair_date = utc_now()
    if status == "available":
        unit.repair_date = None
    _recalc_inventory_counts(unit.inventory_item_id)
    db.session.commit()
    return _ok({"unit": _serialize_asset_unit(unit)}, "Unit status updated")


@it_bp.route("/units/<int:unit_id>", methods=["DELETE"])
@jwt_required()
def delete_unit(unit_id):
    unit = ITAssetUnit.query.get(unit_id)
    if not unit:
        return _err("Unit not found", 404)
    if unit.status == "assigned":
        return _err("Unassign this unit before permanent removal", 400)

    inv_id = unit.inventory_item_id

    ITDeletedAssetLog.query.filter_by(asset_unit_id=unit_id).update(
        {ITDeletedAssetLog.asset_unit_id: None},
        synchronize_session=False,
    )
    ITRemovedAsset.query.filter_by(asset_unit_id=unit_id).update(
        {ITRemovedAsset.asset_unit_id: None},
        synchronize_session=False,
    )
    ITParcelExportItem.query.filter_by(asset_unit_id=unit_id).update(
        {ITParcelExportItem.asset_unit_id: None},
        synchronize_session=False,
    )

    db.session.delete(unit)
    _recalc_inventory_counts(inv_id)
    db.session.commit()
    return _ok(message="Unit deleted")


@it_bp.route("/assignments/units", methods=["POST"])
@jwt_required()
def assign_unit():
    data = request.get_json(silent=True) or {}
    unit_id = data.get("unit_id")
    assigned_to_admin_id = data.get("assigned_to_admin_id")
    assigned_to_emp_id = (data.get("assigned_to_emp_id") or "").strip()
    if not unit_id or (not assigned_to_admin_id and not assigned_to_emp_id):
        return _err("unit_id and assigned_to_admin_id/assigned_to_emp_id are required")

    unit = ITAssetUnit.query.get(unit_id)
    target_admin = Admin.query.get(assigned_to_admin_id) if assigned_to_admin_id else None
    if not target_admin and assigned_to_emp_id:
        target_admin = Admin.query.filter(
            db.func.lower(db.func.coalesce(Admin.emp_id, "")) == assigned_to_emp_id.lower()
        ).first()
    actor = _current_admin()
    if not unit:
        return _err("Unit not found", 404)
    if not target_admin:
        return _err("Target admin not found", 404)
    if unit.status == "assigned":
        return _err("Unit is already assigned")

    unit.status = "assigned"
    unit.assigned_to_admin_id = target_admin.id
    unit.assigned_at = _parse_dt(data.get("assigned_at")) or utc_now()
    unit.asset_tag = (data.get("asset_tag") or unit.asset_tag)
    unit.assignment_photos_json = data.get("assignment_photos") or unit.assignment_photos_json or []

    assignment = ITAssetAssignment(
        assignment_type="assign",
        assigned_to_admin_id=target_admin.id,
        assigned_by_admin_id=actor.id if actor else None,
        asset_unit_id=unit.id,
        notes=data.get("notes"),
        assigned_at=unit.assigned_at,
    )
    db.session.add(assignment)
    _recalc_inventory_counts(unit.inventory_item_id)
    db.session.commit()
    try:
        ok, msg = send_it_assignment_notification(
            target_admin=target_admin,
            actor_admin=actor,
            assignment_kind="unit",
            unit=unit,
        )
        if ok:
            current_app.logger.info(
                "[IT assign_unit] notification sent | unit_id=%s target_admin_id=%s msg=%s",
                unit.id,
                target_admin.id,
                msg,
            )
        else:
            current_app.logger.warning(
                "[IT assign_unit] notification failed | unit_id=%s target_admin_id=%s msg=%s",
                unit.id,
                target_admin.id,
                msg,
            )
    except Exception as e:
        current_app.logger.warning(
            "[IT assign_unit] notification exception | unit_id=%s target_admin_id=%s err=%s",
            unit.id,
            target_admin.id,
            e,
        )
    return _ok({"unit": _serialize_asset_unit(unit), "assignment_id": assignment.id}, "Unit assigned")


@it_bp.route("/assignments/units/<int:unit_id>/return", methods=["POST"])
@jwt_required()
def return_unit(unit_id):
    data = request.get_json(silent=True) or {}
    unit = ITAssetUnit.query.get(unit_id)
    actor = _current_admin()
    if not unit:
        return _err("Unit not found", 404)

    previous_assigned_to = unit.assigned_to_admin_id
    if not previous_assigned_to:
        return _err("Unit is not assigned")

    new_status = (data.get("status") or "available").strip()
    unit.status = new_status
    unit.assigned_to_admin_id = None
    unit.assigned_at = None
    if new_status == "repair":
        unit.repair_date = utc_now()
    elif new_status == "available":
        unit.repair_date = None

    assignment = ITAssetAssignment(
        assignment_type="return",
        assigned_to_admin_id=previous_assigned_to,
        assigned_by_admin_id=actor.id if actor else None,
        asset_unit_id=unit.id,
        notes=data.get("notes"),
        assigned_at=utc_now(),
        unassigned_at=utc_now(),
    )
    db.session.add(assignment)
    _recalc_inventory_counts(unit.inventory_item_id)
    db.session.commit()
    return _ok({"unit": _serialize_asset_unit(unit), "assignment_id": assignment.id}, "Unit returned")


@it_bp.route("/software/licenses", methods=["GET"])
@jwt_required()
def list_software_licenses():
    name = (request.args.get("name") or "").strip()
    status = (request.args.get("status") or "").strip()
    q = ITSoftwareLicense.query
    if name:
        q = q.filter(db.func.lower(ITSoftwareLicense.name) == name.lower())
    if status:
        q = q.filter(db.func.lower(ITSoftwareLicense.status) == status.lower())
    rows = q.order_by(ITSoftwareLicense.id.desc()).all()
    return _ok({"licenses": [_serialize_license(r) for r in rows]})


@it_bp.route("/software/licenses/bulk", methods=["POST"])
@jwt_required()
def create_software_licenses():
    data = request.get_json(silent=True) or {}
    inventory_id = data.get("inventory_item_id")
    name = (data.get("name") or "").strip()
    quantity = int(data.get("quantity") or 0)
    if not inventory_id or not name or quantity < 1:
        return _err("inventory_item_id, name and quantity>=1 are required")
    inv = ITInventoryItem.query.get(inventory_id)
    if not inv:
        return _err("Inventory item not found", 404)

    created = []
    start_date = _parse_date(data.get("subscription_start"))
    end_date = _parse_date(data.get("subscription_end"))
    for _ in range(quantity):
        lic = ITSoftwareLicense(
            license_code=_next_code("SW", ITSoftwareLicense, "license_code"),
            inventory_item_id=inventory_id,
            name=name,
            subscription_start=start_date,
            subscription_end=end_date,
            status="available",
        )
        db.session.add(lic)
        created.append(lic)
    db.session.flush()
    _recalc_inventory_counts(inventory_id)
    db.session.commit()
    return _ok({"licenses": [_serialize_license(i) for i in created]}, "Software licenses created", 201)


@it_bp.route("/assignments/software", methods=["POST"])
@jwt_required()
def assign_software():
    data = request.get_json(silent=True) or {}
    license_id = data.get("license_id")
    assigned_to_admin_id = data.get("assigned_to_admin_id")
    assigned_to_emp_id = (data.get("assigned_to_emp_id") or "").strip()
    if not license_id or (not assigned_to_admin_id and not assigned_to_emp_id):
        return _err("license_id and assigned_to_admin_id/assigned_to_emp_id are required")
    lic = ITSoftwareLicense.query.get(license_id)
    target_admin = Admin.query.get(assigned_to_admin_id) if assigned_to_admin_id else None
    if not target_admin and assigned_to_emp_id:
        target_admin = Admin.query.filter(
            db.func.lower(db.func.coalesce(Admin.emp_id, "")) == assigned_to_emp_id.lower()
        ).first()
    actor = _current_admin()
    if not lic:
        return _err("Software license not found", 404)
    if not target_admin:
        return _err("Target admin not found", 404)
    if lic.status == "assigned":
        return _err("License is already assigned")

    lic.status = "assigned"
    lic.assigned_to_admin_id = target_admin.id
    lic.assigned_at = utc_now()

    assignment = ITAssetAssignment(
        assignment_type="assign",
        assigned_to_admin_id=target_admin.id,
        assigned_by_admin_id=actor.id if actor else None,
        software_license_id=lic.id,
        notes=data.get("notes"),
    )
    db.session.add(assignment)
    _recalc_inventory_counts(lic.inventory_item_id)
    db.session.commit()
    try:
        ok, msg = send_it_assignment_notification(
            target_admin=target_admin,
            actor_admin=actor,
            assignment_kind="software",
            license_obj=lic,
        )
        if ok:
            current_app.logger.info(
                "[IT assign_software] notification sent | license_id=%s target_admin_id=%s msg=%s",
                lic.id,
                target_admin.id,
                msg,
            )
        else:
            current_app.logger.warning(
                "[IT assign_software] notification failed | license_id=%s target_admin_id=%s msg=%s",
                lic.id,
                target_admin.id,
                msg,
            )
    except Exception as e:
        current_app.logger.warning(
            "[IT assign_software] notification exception | license_id=%s target_admin_id=%s err=%s",
            lic.id,
            target_admin.id,
            e,
        )
    return _ok({"license": _serialize_license(lic), "assignment_id": assignment.id}, "Software assigned")


@it_bp.route("/assignments/software/<int:license_id>/return", methods=["POST"])
@jwt_required()
def return_software(license_id):
    data = request.get_json(silent=True) or {}
    lic = ITSoftwareLicense.query.get(license_id)
    actor = _current_admin()
    if not lic:
        return _err("Software license not found", 404)
    if lic.status != "assigned":
        return _err("Software license is not assigned")

    prev_target = lic.assigned_to_admin_id
    lic.status = "available"
    lic.assigned_to_admin_id = None
    lic.assigned_at = None

    assignment = ITAssetAssignment(
        assignment_type="return",
        assigned_to_admin_id=prev_target,
        assigned_by_admin_id=actor.id if actor else None,
        software_license_id=lic.id,
        notes=data.get("notes"),
        unassigned_at=utc_now(),
    )
    db.session.add(assignment)
    _recalc_inventory_counts(lic.inventory_item_id)
    db.session.commit()
    return _ok({"license": _serialize_license(lic), "assignment_id": assignment.id}, "Software returned")


@it_bp.route("/return-requests", methods=["POST"])
@jwt_required()
def create_return_request():
    actor = _current_admin()
    if not actor:
        return _err("Unauthorized", 401)
    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "").strip()
    unit_id = data.get("asset_unit_id")
    license_id = data.get("software_license_id")
    inventory_id = data.get("inventory_item_id")
    quantity = int(data.get("quantity") or 1)
    return_destination = (data.get("return_destination") or "available").strip().lower()
    photos = data.get("photos") or []
    if not reason:
        return _err("reason is required")
    if return_destination not in ("available", "removed_from_it"):
        return _err("return_destination must be available or removed_from_it")
    if not any([unit_id, license_id, inventory_id]):
        return _err("asset_unit_id/software_license_id/inventory_item_id is required")

    asset_name = None
    category = None
    if unit_id:
        unit = ITAssetUnit.query.get(unit_id)
        if not unit:
            return _err("Unit not found", 404)
        if unit.assigned_to_admin_id != actor.id:
            return _err("You can only request return for your assigned assets", 403)
        asset_name = unit.asset_name or unit.brand or unit.unit_code
        category = unit.category or "Hardware"
    elif license_id:
        lic = ITSoftwareLicense.query.get(license_id)
        if not lic:
            return _err("Software license not found", 404)
        if lic.assigned_to_admin_id != actor.id:
            return _err("You can only request return for your assigned licenses", 403)
        asset_name = lic.name or lic.license_code
        category = "Software"
    else:
        item = ITInventoryItem.query.get(inventory_id)
        if not item:
            return _err("Inventory item not found", 404)
        if quantity < 1:
            return _err("quantity must be >= 1")
        qa = ITInventoryQuantityAssignment.query.filter_by(
            inventory_item_id=item.id,
            assigned_to_admin_id=actor.id,
        ).first()
        assigned_qty = int(qa.quantity or 0) if qa else 0
        if assigned_qty < quantity:
            return _err("You do not have enough assigned quantity to return", 403)
        asset_name = item.name
        category = item.category

    dup = ITAssetReturnRequest.query.filter(
        ITAssetReturnRequest.status.in_(["pending", "approved"]),
        ITAssetReturnRequest.requester_admin_id == actor.id,
        ITAssetReturnRequest.asset_unit_id == unit_id,
        ITAssetReturnRequest.software_license_id == license_id,
        ITAssetReturnRequest.inventory_item_id == inventory_id,
    ).first()
    if dup:
        return _err("A return request for this asset is already pending/approved", 409)

    req = ITAssetReturnRequest(
        request_code=_next_code("RTR", ITAssetReturnRequest, "request_code"),
        requester_admin_id=actor.id,
        requester_emp_id=(actor.emp_id or str(actor.id)),
        asset_unit_id=unit_id,
        software_license_id=license_id,
        inventory_item_id=inventory_id,
        quantity=quantity,
        asset_name=asset_name,
        category=category,
        reason=reason,
        return_destination=return_destination,
        photos_json=photos if isinstance(photos, list) else [],
        status="pending",
    )
    db.session.add(req)
    db.session.commit()

    dest_label = (
        "Removed From IT"
        if return_destination == "removed_from_it"
        else "Available"
    )
    ok, msg = send_it_return_request_email(
        requester_admin=actor,
        reason=f"{reason} | Return to: {dest_label}",
        asset_label=f"{asset_name or '-'} ({category or '-'})",
    )
    if ok:
        current_app.logger.info("[IT return-request] mail sent | request_id=%s msg=%s", req.id, msg)
    else:
        current_app.logger.warning("[IT return-request] mail failed | request_id=%s msg=%s", req.id, msg)
    return _ok({"request": _serialize_return_request(req)}, "Return request created", 201)


@it_bp.route("/return-requests", methods=["GET"])
@jwt_required()
def list_return_requests():
    status = (request.args.get("status") or "").strip().lower()
    only_mine = str(request.args.get("mine") or "").strip().lower() in {"1", "true", "yes"}
    emp_id = (request.args.get("emp_id") or "").strip()
    actor = _current_admin()
    q = ITAssetReturnRequest.query
    if status:
        q = q.filter(db.func.lower(ITAssetReturnRequest.status) == status)
    if emp_id:
        emp = _resolve_admin_by_emp_key(emp_id)
        if not emp:
            return _ok({"requests": []})
        q = q.filter(ITAssetReturnRequest.requester_admin_id == emp.id)
    elif only_mine and actor:
        q = q.filter(ITAssetReturnRequest.requester_admin_id == actor.id)
    rows = q.order_by(ITAssetReturnRequest.created_at.desc(), ITAssetReturnRequest.id.desc()).all()
    return _ok({"requests": [_serialize_return_request(r) for r in rows]})


@it_bp.route("/return-requests/<int:request_id>/approve", methods=["PATCH"])
@jwt_required()
def approve_return_request(request_id):
    actor = _current_admin()
    row = ITAssetReturnRequest.query.get(request_id)
    if not row:
        return _err("Return request not found", 404)
    if row.status != "pending":
        return _err("Only pending requests can be approved")
    row.status = "approved"
    row.approved_by_admin_id = actor.id if actor else None
    row.approved_at = utc_now()
    db.session.commit()
    if row.requester_admin:
        send_it_return_request_status_email(
            requester_admin=row.requester_admin,
            status="approved",
            asset_label=f"{row.asset_name or '-'} ({row.category or '-'})",
            acted_by=actor,
        )
    return _ok({"request": _serialize_return_request(row)}, "Return request approved")


@it_bp.route("/return-requests/<int:request_id>/reject", methods=["PATCH"])
@jwt_required()
def reject_return_request(request_id):
    actor = _current_admin()
    row = ITAssetReturnRequest.query.get(request_id)
    if not row:
        return _err("Return request not found", 404)
    if row.status != "pending":
        return _err("Only pending requests can be rejected")
    data = request.get_json(silent=True) or {}
    rejection_reason = (data.get("rejection_reason") or "").strip()
    if not rejection_reason:
        return _err("rejection_reason is required")
    row.status = "rejected"
    row.approved_by_admin_id = actor.id if actor else None
    row.approved_at = utc_now()
    row.rejection_reason = rejection_reason
    db.session.commit()
    if row.requester_admin:
        send_it_return_request_status_email(
            requester_admin=row.requester_admin,
            status="rejected",
            asset_label=f"{row.asset_name or '-'} ({row.category or '-'})",
            acted_by=actor,
            rejection_reason=rejection_reason,
        )
    return _ok({"request": _serialize_return_request(row)}, "Return request rejected")


@it_bp.route("/return-requests/<int:request_id>/complete", methods=["PATCH"])
@jwt_required()
def complete_return_request(request_id):
    actor = _current_admin()
    row = ITAssetReturnRequest.query.get(request_id)
    if not row:
        return _err("Return request not found", 404)
    if row.status != "approved":
        return _err("Only approved requests can be completed")

    dest = (row.return_destination or "available").strip().lower()
    to_removed = dest == "removed_from_it"
    return_photos = row.photos_json if isinstance(row.photos_json, list) else []

    if row.asset_unit_id:
        unit = ITAssetUnit.query.get(row.asset_unit_id)
        if unit and unit.assigned_to_admin_id == row.requester_admin_id:
            if to_removed:
                unit.status = "not-working"
                db.session.add(
                    ITRemovedAsset(
                        removed_code=_next_code("RIT", ITRemovedAsset, "removed_code"),
                        asset_unit_id=unit.id,
                        inventory_item_id=unit.inventory_item_id,
                        owner_admin_id=row.requester_admin_id,
                        removed_by_admin_id=actor.id if actor else None,
                        name=row.asset_name or unit.asset_name or unit.unit_code,
                        category=row.category or unit.category,
                        reason=row.reason,
                        photos_json=return_photos,
                    )
                )
            else:
                unit.status = "available"
            unit.assigned_to_admin_id = None
            unit.assigned_at = None
            unit.repair_date = None
            assignment = ITAssetAssignment(
                assignment_type="return",
                assigned_to_admin_id=row.requester_admin_id,
                assigned_by_admin_id=actor.id if actor else None,
                asset_unit_id=unit.id,
                notes=f"Return request completed ({row.request_code})",
                assigned_at=utc_now(),
                unassigned_at=utc_now(),
            )
            db.session.add(assignment)
            _recalc_inventory_counts(unit.inventory_item_id)

    if row.software_license_id:
        lic = ITSoftwareLicense.query.get(row.software_license_id)
        if lic and lic.assigned_to_admin_id == row.requester_admin_id:
            if to_removed:
                lic.status = "not-working"
                db.session.add(
                    ITRemovedAsset(
                        removed_code=_next_code("RIT", ITRemovedAsset, "removed_code"),
                        inventory_item_id=lic.inventory_item_id,
                        owner_admin_id=row.requester_admin_id,
                        removed_by_admin_id=actor.id if actor else None,
                        name=row.asset_name or lic.name or lic.license_code,
                        category="Software",
                        reason=row.reason,
                        photos_json=return_photos,
                    )
                )
            else:
                lic.status = "available"
            lic.assigned_to_admin_id = None
            lic.assigned_at = None
            assignment = ITAssetAssignment(
                assignment_type="return",
                assigned_to_admin_id=row.requester_admin_id,
                assigned_by_admin_id=actor.id if actor else None,
                software_license_id=lic.id,
                notes=f"Return request completed ({row.request_code})",
                unassigned_at=utc_now(),
            )
            db.session.add(assignment)
            _recalc_inventory_counts(lic.inventory_item_id)

    if row.inventory_item_id and int(row.quantity or 0) > 0:
        item = ITInventoryItem.query.get(row.inventory_item_id)
        if item:
            qty = int(row.quantity or 0)
            qa = ITInventoryQuantityAssignment.query.filter_by(
                inventory_item_id=item.id,
                assigned_to_admin_id=row.requester_admin_id,
            ).first()
            if qa:
                qa.quantity = max(0, int(qa.quantity or 0) - qty)
                if qa.quantity == 0:
                    db.session.delete(qa)
            item.assigned_quantity = max(0, int(item.assigned_quantity or 0) - qty)
            if to_removed:
                db.session.add(
                    ITRemovedAsset(
                        removed_code=_next_code("RIT", ITRemovedAsset, "removed_code"),
                        inventory_item_id=item.id,
                        owner_admin_id=row.requester_admin_id,
                        removed_by_admin_id=actor.id if actor else None,
                        name=row.asset_name or item.name,
                        category=row.category or item.category,
                        reason=row.reason,
                        photos_json=return_photos,
                    )
                )
            else:
                item.available_quantity = int(item.available_quantity or 0) + qty

    row.status = "completed"
    row.receipt_confirmed_by_admin_id = actor.id if actor else None
    row.receipt_confirmed_at = utc_now()
    db.session.commit()
    if row.requester_admin:
        send_it_return_request_status_email(
            requester_admin=row.requester_admin,
            status="completed",
            asset_label=f"{row.asset_name or '-'} ({row.category or '-'})",
            acted_by=actor,
        )
    return _ok({"request": _serialize_return_request(row)}, "Return request completed")


@it_bp.route("/software/licenses/<int:license_id>/renew", methods=["PATCH"])
@jwt_required()
def renew_software_license(license_id):
    lic = ITSoftwareLicense.query.get(license_id)
    if not lic:
        return _err("Software license not found", 404)

    data = request.get_json(silent=True) or {}
    end_date = _parse_date(data.get("subscription_end") or data.get("new_expiry"))
    if not end_date:
        return _err("subscription_end/new_expiry is required in YYYY-MM-DD format")

    if lic.subscription_start and end_date <= lic.subscription_start:
        return _err("subscription_end must be after subscription_start")

    lic.subscription_end = end_date
    db.session.commit()
    return _ok({"license": _serialize_license(lic)}, "Software license renewed")


@it_bp.route("/assignments/inventory-quantity", methods=["POST"])
@jwt_required()
def assign_inventory_quantity():
    data = request.get_json(silent=True) or {}
    inventory_item_id = data.get("inventory_item_id")
    quantity = int(data.get("quantity") or 0)
    action = (data.get("action") or "assign").strip().lower()
    assigned_to_admin_id = data.get("assigned_to_admin_id")
    assigned_to_emp_id = (data.get("assigned_to_emp_id") or "").strip()
    target_admin = None
    actor = _current_admin()

    if not inventory_item_id or quantity < 1:
        return _err("inventory_item_id and quantity>=1 are required")
    if action not in ("assign", "return"):
        return _err("action must be assign or return")

    item = ITInventoryItem.query.get(inventory_item_id)
    if not item:
        return _err("Inventory item not found", 404)

    if action == "assign":
        if not assigned_to_admin_id and not assigned_to_emp_id:
            return _err("assigned_to_admin_id/assigned_to_emp_id is required for assign", 400)
        target_admin = Admin.query.get(assigned_to_admin_id) if assigned_to_admin_id else None
        if not target_admin and assigned_to_emp_id:
            target_admin = Admin.query.filter(
                db.func.lower(db.func.coalesce(Admin.emp_id, "")) == assigned_to_emp_id.lower()
            ).first()
        if not target_admin:
            return _err("Target admin not found", 404)
        if int(item.available_quantity or 0) < quantity:
            return _err("Not enough available quantity", 400)
        item.available_quantity = int(item.available_quantity or 0) - quantity
        item.assigned_quantity = int(item.assigned_quantity or 0) + quantity
        row = ITInventoryQuantityAssignment.query.filter_by(
            inventory_item_id=item.id,
            assigned_to_admin_id=target_admin.id,
        ).first()
        if row:
            row.quantity = int(row.quantity or 0) + quantity
        else:
            db.session.add(
                ITInventoryQuantityAssignment(
                    inventory_item_id=item.id,
                    assigned_to_admin_id=target_admin.id,
                    quantity=quantity,
                )
            )
    else:
        if int(item.assigned_quantity or 0) < quantity:
            return _err("Return quantity exceeds assigned quantity", 400)
        item.assigned_quantity = int(item.assigned_quantity or 0) - quantity
        item.available_quantity = int(item.available_quantity or 0) + quantity
        if assigned_to_admin_id or assigned_to_emp_id:
            target_admin = Admin.query.get(assigned_to_admin_id) if assigned_to_admin_id else None
            if not target_admin and assigned_to_emp_id:
                target_admin = Admin.query.filter(
                    db.func.lower(db.func.coalesce(Admin.emp_id, "")) == assigned_to_emp_id.lower()
                ).first()
            if target_admin:
                row = ITInventoryQuantityAssignment.query.filter_by(
                    inventory_item_id=item.id,
                    assigned_to_admin_id=target_admin.id,
                ).first()
                if row:
                    row.quantity = max(0, int(row.quantity or 0) - quantity)
                    if row.quantity == 0:
                        db.session.delete(row)

    db.session.commit()
    if action == "assign" and target_admin:
        try:
            ok, msg = send_it_assignment_notification(
                target_admin=target_admin,
                actor_admin=actor,
                assignment_kind="inventory_quantity",
                inventory_item=item,
                quantity=quantity,
            )
            if ok:
                current_app.logger.info(
                    "[IT assign_inventory_quantity] notification sent | inventory_item_id=%s target_admin_id=%s qty=%s msg=%s",
                    item.id,
                    target_admin.id,
                    quantity,
                    msg,
                )
            else:
                current_app.logger.warning(
                    "[IT assign_inventory_quantity] notification failed | inventory_item_id=%s target_admin_id=%s qty=%s msg=%s",
                    item.id,
                    target_admin.id,
                    quantity,
                    msg,
                )
        except Exception as e:
            current_app.logger.warning(
                "[IT assign_inventory_quantity] notification exception | inventory_item_id=%s target_admin_id=%s qty=%s err=%s",
                item.id,
                target_admin.id,
                quantity,
                e,
            )
    return _ok({"item": _serialize_inventory_item(item)}, "Inventory quantity updated")


_DEPLOY_INVENTORY_CATEGORIES = frozenset(
    {"Office Assets", "Transport Assets", "Infrastructure Assets"}
)


def _inventory_deploy_mode(item):
    """Return 'stock' (qty), 'unit' (vehicle/equipment), or None."""
    inv_cat = (item.inventory_category or "").strip()
    if inv_cat not in _DEPLOY_INVENTORY_CATEGORIES:
        return None
    item_cat = (item.category or "").strip().lower()
    if inv_cat == "Office Assets":
        return "stock" if _is_qty_managed_inventory(item.category, item.inventory_category) else None
    if inv_cat == "Infrastructure Assets":
        if item_cat == "stock":
            return "stock"
        if item_cat == "equipment":
            return "unit"
        return None
    if inv_cat == "Transport Assets" and item_cat == "vehicle":
        return "unit"
    return None


def _serialize_office_deployment(row):
    unit = row.asset_unit if row.asset_unit_id else None
    unit_label = ""
    if unit:
        reg = (unit.serial_number or "").strip()
        make_model = " ".join(
            p for p in [(unit.make or "").strip(), (unit.model or "").strip()] if p
        ).strip()
        unit_label = reg or make_model or unit.unit_code or f"Unit #{unit.id}"
    return {
        "id": row.id,
        "inventoryItemId": row.inventory_item_id,
        "inventoryCategory": row.inventory_category or "",
        "assetUnitId": row.asset_unit_id,
        "unitLabel": unit_label,
        "quantity": int(row.quantity or 0),
        "deploymentLocation": row.deployment_location or "",
        "custodianName": row.custodian_name or "",
        "custodianEmpId": row.custodian_emp_id or "",
        "notes": row.notes or "",
        "createdAt": _iso(row.created_at),
    }


def _list_stock_deployments_impl():
    inventory_item_id = request.args.get("inventory_item_id")
    inventory_category = (request.args.get("inventory_category") or "").strip()
    q = ITOfficeStockDeployment.query.join(ITInventoryItem).filter(
        ITOfficeStockDeployment.quantity > 0,
        ITInventoryItem.inventory_category.in_(list(_DEPLOY_INVENTORY_CATEGORIES)),
    )
    if inventory_category:
        if inventory_category not in _DEPLOY_INVENTORY_CATEGORIES:
            return _err("Invalid inventory_category", 400)
        q = q.filter(ITInventoryItem.inventory_category == inventory_category)
    if inventory_item_id:
        try:
            iid = int(inventory_item_id)
        except (TypeError, ValueError):
            return _err("inventory_item_id must be an integer", 400)
        q = q.filter(ITOfficeStockDeployment.inventory_item_id == iid)
    rows = q.order_by(ITOfficeStockDeployment.created_at.desc()).all()
    return _ok({"deployments": [_serialize_office_deployment(r) for r in rows]})


def _stock_deploy_impl():
    data = request.get_json(silent=True) or {}
    try:
        inventory_item_id = int(data.get("inventory_item_id"))
    except (TypeError, ValueError):
        return _err("inventory_item_id is required", 400)
    quantity = int(data.get("quantity") or 0)
    location = (data.get("deployment_location") or data.get("location") or "").strip()
    custodian_name = (data.get("custodian_name") or "").strip() or None
    custodian_emp_id = (data.get("custodian_emp_id") or "").strip() or None
    notes = (data.get("notes") or "").strip() or None
    asset_unit_id = data.get("asset_unit_id")

    if not location:
        return _err("deployment_location is required", 400)

    item = ITInventoryItem.query.get(inventory_item_id)
    if not item:
        return _err("Inventory item not found", 404)

    mode = _inventory_deploy_mode(item)
    if not mode:
        return _err("This item cannot be issued from inventory", 400)

    actor = _current_admin()
    inv_cat = (item.inventory_category or "").strip()

    if mode == "unit":
        try:
            uid = int(asset_unit_id)
        except (TypeError, ValueError):
            return _err("asset_unit_id is required for vehicles and installed equipment", 400)
        unit = ITAssetUnit.query.get(uid)
        if not unit or unit.inventory_item_id != item.id:
            return _err("Asset unit not found for this item", 404)
        if (unit.status or "").lower() != "available":
            return _err("This unit is not available to issue", 400)
        quantity = 1
        unit.status = "assigned"
        db.session.add(
            ITOfficeStockDeployment(
                inventory_item_id=item.id,
                inventory_category=inv_cat,
                asset_unit_id=unit.id,
                quantity=1,
                deployment_location=location,
                custodian_name=custodian_name,
                custodian_emp_id=custodian_emp_id,
                notes=notes,
                created_by_admin_id=actor.id if actor else None,
            )
        )
        _recalc_inventory_counts(item.id)
        db.session.commit()
        return _ok(
            {"item": _serialize_inventory_item(item)},
            f"Issued to {location}",
            201,
        )

    if quantity < 1:
        return _err("quantity must be >= 1", 400)
    if int(item.available_quantity or 0) < quantity:
        return _err("Not enough available quantity", 400)

    item.available_quantity = int(item.available_quantity or 0) - quantity
    item.assigned_quantity = int(item.assigned_quantity or 0) + quantity
    db.session.add(
        ITOfficeStockDeployment(
            inventory_item_id=item.id,
            inventory_category=inv_cat,
            quantity=quantity,
            deployment_location=location,
            custodian_name=custodian_name,
            custodian_emp_id=custodian_emp_id,
            notes=notes,
            created_by_admin_id=actor.id if actor else None,
        )
    )
    db.session.commit()
    return _ok(
        {"item": _serialize_inventory_item(item)},
        f"Issued {quantity} to {location}",
        201,
    )


def _stock_return_impl():
    data = request.get_json(silent=True) or {}
    try:
        deployment_id = int(data.get("deployment_id"))
    except (TypeError, ValueError):
        return _err("deployment_id is required", 400)
    quantity = int(data.get("quantity") or 0)
    if quantity < 1:
        return _err("quantity must be >= 1", 400)

    row = ITOfficeStockDeployment.query.get(deployment_id)
    if not row:
        return _err("Deployment not found", 404)
    item = ITInventoryItem.query.get(row.inventory_item_id)
    if not item or _inventory_deploy_mode(item) is None:
        return _err("Inventory item not found", 404)
    if int(row.quantity or 0) < quantity:
        return _err("Return quantity exceeds issued quantity", 400)

    if row.asset_unit_id:
        if quantity != 1:
            return _err("Return quantity must be 1 for a single vehicle or equipment unit", 400)
        unit = ITAssetUnit.query.get(row.asset_unit_id)
        if unit:
            unit.status = "available"
        db.session.delete(row)
        _recalc_inventory_counts(item.id)
    else:
        row.quantity = int(row.quantity or 0) - quantity
        if row.quantity <= 0:
            db.session.delete(row)
        item.assigned_quantity = max(0, int(item.assigned_quantity or 0) - quantity)
        item.available_quantity = int(item.available_quantity or 0) + quantity

    db.session.commit()
    return _ok(
        {"item": _serialize_inventory_item(item)},
        f"Returned {quantity} to available",
    )


@it_bp.route("/office-stock/deployments", methods=["GET"])
@it_bp.route("/inventory-stock/deployments", methods=["GET"])
@jwt_required()
def list_office_stock_deployments():
    return _list_stock_deployments_impl()


@it_bp.route("/office-stock/deploy", methods=["POST"])
@it_bp.route("/inventory-stock/deploy", methods=["POST"])
@jwt_required()
def office_stock_deploy():
    return _stock_deploy_impl()


@it_bp.route("/office-stock/return", methods=["POST"])
@it_bp.route("/inventory-stock/return", methods=["POST"])
@jwt_required()
def office_stock_return():
    return _stock_return_impl()


@it_bp.route("/tickets", methods=["GET"])
@jwt_required()
def list_tickets():
    status = (request.args.get("status") or "").strip()
    q = ITSupportTicket.query
    if status:
        q = q.filter(db.func.lower(ITSupportTicket.status) == status.lower())
    rows = q.order_by(ITSupportTicket.created_at.desc(), ITSupportTicket.id.desc()).all()
    return _ok({"tickets": [_serialize_ticket(t) for t in rows]})


@it_bp.route("/tickets", methods=["POST"])
@jwt_required()
def create_ticket():
    data = request.get_json(silent=True) or {}
    requester_admin_id = data.get("requester_admin_id")
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip()
    if not requester_admin_id or not title or not description:
        return _err("requester_admin_id, title and description are required")
    requester = Admin.query.get(requester_admin_id)
    if not requester:
        return _err("Requester not found", 404)
    t = ITSupportTicket(
        ticket_code=_next_code("TKT", ITSupportTicket, "ticket_code"),
        requester_admin_id=requester.id,
        assignee_admin_id=data.get("assignee_admin_id"),
        title=title,
        description=description,
        priority=(data.get("priority") or "medium").strip().lower(),
        status=(data.get("status") or "pending").strip().lower(),
    )
    db.session.add(t)
    db.session.commit()
    return _ok({"ticket": _serialize_ticket(t)}, "Ticket created", 201)


@it_bp.route("/tickets/<int:ticket_id>/resolve", methods=["PATCH"])
@jwt_required()
def resolve_ticket(ticket_id):
    t = ITSupportTicket.query.get(ticket_id)
    if not t:
        return _err("Ticket not found", 404)
    t.status = "completed"
    t.resolved_at = utc_now()
    db.session.commit()
    return _ok({"ticket": _serialize_ticket(t)}, "Ticket resolved")


@it_bp.route("/removed-assets", methods=["GET"])
@jwt_required()
def list_removed_assets():
    rows = ITRemovedAsset.query.order_by(ITRemovedAsset.removed_at.desc(), ITRemovedAsset.id.desc()).all()
    return _ok({"removed_assets": [_serialize_removed_asset(r) for r in rows]})


@it_bp.route("/removed-assets", methods=["POST"])
@jwt_required()
def create_removed_asset():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return _err("name is required")
    r = ITRemovedAsset(
        removed_code=data.get("removed_code") or _next_code("RIT", ITRemovedAsset, "removed_code"),
        asset_unit_id=data.get("asset_unit_id"),
        inventory_item_id=data.get("inventory_item_id"),
        owner_admin_id=data.get("owner_admin_id"),
        removed_by_admin_id=data.get("removed_by_admin_id"),
        name=name,
        category=data.get("category"),
        reason=data.get("reason"),
        photos_json=data.get("photos") or [],
        removed_at=_parse_dt(data.get("removed_at")) or utc_now(),
    )
    db.session.add(r)
    db.session.commit()
    return _ok({"removed_asset": _serialize_removed_asset(r)}, "Removed asset logged", 201)


@it_bp.route("/removed-assets/<int:removed_id>", methods=["DELETE"])
@jwt_required()
def delete_removed_asset(removed_id):
    row = ITRemovedAsset.query.get(removed_id)
    if not row:
        return _err("Removed asset not found", 404)
    db.session.delete(row)
    db.session.commit()
    return _ok(message="Removed asset record deleted")


@it_bp.route("/deleted-logs", methods=["GET"])
@jwt_required()
def list_deleted_logs():
    rows = ITDeletedAssetLog.query.order_by(ITDeletedAssetLog.deleted_at.desc(), ITDeletedAssetLog.id.desc()).all()
    return _ok({"logs": [_serialize_deleted_log(d) for d in rows]})


@it_bp.route("/deleted-logs", methods=["POST"])
@jwt_required()
def create_deleted_log():
    data = request.get_json(silent=True) or {}
    d = ITDeletedAssetLog(
        delete_code=data.get("delete_code") or _next_code("DEL", ITDeletedAssetLog, "delete_code"),
        asset_unit_id=data.get("asset_unit_id"),
        inventory_item_id=data.get("inventory_item_id"),
        deleted_by_admin_id=data.get("deleted_by_admin_id"),
        deleted_by_name=(data.get("deleted_by_name") or "").strip() or None,
        asset_name=data.get("asset_name"),
        category=data.get("category"),
        serial_number=data.get("serial_number"),
        reason=data.get("reason"),
        deleted_at=_parse_dt(data.get("deleted_at")) or utc_now(),
    )
    db.session.add(d)
    db.session.commit()
    return _ok({"log": _serialize_deleted_log(d)}, "Deleted asset log created", 201)


@it_bp.route("/deleted-logs/<string:delete_code>", methods=["DELETE"])
@jwt_required()
def delete_deleted_log(delete_code):
    row = ITDeletedAssetLog.query.filter(
        db.func.lower(db.func.coalesce(ITDeletedAssetLog.delete_code, "")) == str(delete_code).lower()
    ).first()
    if not row:
        return _err("Deleted log not found", 404)
    db.session.delete(row)
    db.session.commit()
    return _ok(message="Deleted log removed")


@it_bp.route("/deleted-logs", methods=["DELETE"])
@jwt_required()
def delete_all_deleted_logs():
    ITDeletedAssetLog.query.delete(synchronize_session=False)
    db.session.commit()
    return _ok(message="All deleted logs removed")


@it_bp.route("/parcels/imports", methods=["GET"])
@jwt_required()
def list_parcel_imports():
    _ensure_parcel_name_columns_runtime()
    try:
        page = max(int(request.args.get("page", 1) or 1), 1)
    except (TypeError, ValueError):
        page = 1
    try:
        per_page = int(request.args.get("per_page", 200) or 200)
    except (TypeError, ValueError):
        per_page = 200
    per_page = min(max(per_page, 1), 500)

    query = ITParcelImport.query.order_by(
        ITParcelImport.received_at.desc(), ITParcelImport.id.desc()
    )
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    return _ok(
        {
            "imports": [_serialize_parcel_import(r) for r in pagination.items],
            "page": page,
            "per_page": per_page,
            "total": pagination.total,
            "pages": pagination.pages,
            "has_next": pagination.has_next,
            "has_prev": pagination.has_prev,
        }
    )


@it_bp.route("/parcels/imports", methods=["POST"])
@jwt_required()
def create_parcel_import():
    _ensure_parcel_name_columns_runtime()
    data = request.get_json(silent=True) or {}
    source = (data.get("source") or data.get("from") or "").strip()
    asset_name = (data.get("asset_name") or data.get("assetName") or "").strip()
    if not source or not asset_name:
        return _err("source/from and asset_name/assetName are required")
    received_by_name = (
        (data.get("received_by_name") or data.get("receivedBy") or "").strip() or None
    )
    row = ITParcelImport(
        import_code=data.get("import_code") or _next_code("IMP", ITParcelImport, "import_code"),
        source=source,
        asset_name=asset_name,
        count=int(data.get("count") or 1),
        id_no=data.get("id_no") or data.get("idNo"),
        received_by_admin_id=data.get("received_by_admin_id"),
        received_by_name=received_by_name,
        received_at=_parse_dt(data.get("received_at") or data.get("date")) or utc_now(),
        photos_json=data.get("photos") or [],
    )
    db.session.add(row)
    db.session.commit()
    return _ok({"import": _serialize_parcel_import(row)}, "Parcel import created", 201)


@it_bp.route("/parcels/exports", methods=["GET"])
@jwt_required()
def list_parcel_exports():
    _ensure_parcel_name_columns_runtime()
    try:
        page = max(int(request.args.get("page", 1) or 1), 1)
    except (TypeError, ValueError):
        page = 1
    try:
        per_page = int(request.args.get("per_page", 200) or 200)
    except (TypeError, ValueError):
        per_page = 200
    per_page = min(max(per_page, 1), 500)

    query = ITParcelExport.query.order_by(
        ITParcelExport.exported_at.desc(), ITParcelExport.id.desc()
    )
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    return _ok(
        {
            "exports": [_serialize_parcel_export(r) for r in pagination.items],
            "page": page,
            "per_page": per_page,
            "total": pagination.total,
            "pages": pagination.pages,
            "has_next": pagination.has_next,
            "has_prev": pagination.has_prev,
        }
    )


@it_bp.route("/parcels/exports", methods=["POST"])
@jwt_required()
def create_parcel_export():
    _ensure_parcel_name_columns_runtime()
    data = request.get_json(silent=True) or {}
    destination = (data.get("destination") or data.get("to") or "").strip()
    if not destination:
        return _err("destination/to is required")
    items = data.get("items") or data.get("assets") or []
    if not isinstance(items, list) or not items:
        return _err("items/assets must be a non-empty array")

    exported_by_name = (
        (data.get("exported_by_name") or data.get("exportedBy") or "").strip() or None
    )
    inventory_category = (
        (data.get("inventory_category") or data.get("inventoryCategory") or "").strip() or None
    )
    row = ITParcelExport(
        export_code=data.get("export_code") or _next_code("EXP", ITParcelExport, "export_code"),
        destination=destination,
        id_no=data.get("id_no") or data.get("idNo"),
        exported_by_admin_id=_coerce_optional_int(data.get("exported_by_admin_id")),
        exported_by_name=exported_by_name,
        exported_at=_parse_dt(data.get("exported_at") or data.get("date")) or utc_now(),
        parcel_photos_json=data.get("photos") or [],
        inventory_category=inventory_category,
    )
    db.session.add(row)
    db.session.flush()

    created_items = []
    inventory_export_qty = {}
    for it in items:
        asset_unit_id, inventory_item_id = _resolve_parcel_export_item_ids(it)
        make_val = (it.get("make") or "").strip() or None
        if not make_val and asset_unit_id:
            unit_for_make = ITAssetUnit.query.get(asset_unit_id)
            if unit_for_make and unit_for_make.make:
                make_val = (unit_for_make.make or "").strip() or None
        export_item = ITParcelExportItem(
            parcel_export_id=row.id,
            asset_unit_id=asset_unit_id,
            asset_name=(it.get("asset_name") or it.get("assetName") or "").strip(),
            serial_number=it.get("serial_number") or it.get("serialNo"),
            brand=it.get("brand"),
            make=make_val,
            model=it.get("model"),
            individual_photo_json=it.get("individual_photo") or it.get("individualPhoto"),
        )
        if not export_item.asset_name:
            continue
        db.session.add(export_item)
        created_items.append(export_item)

        if asset_unit_id:
            unit = ITAssetUnit.query.get(asset_unit_id)
            if unit:
                unit.status = "exported"
                unit.exported_to = destination
                unit.exported_at = row.exported_at
                _recalc_inventory_counts(unit.inventory_item_id)
        elif inventory_item_id:
            inventory_export_qty[inventory_item_id] = (
                inventory_export_qty.get(inventory_item_id, 0) + 1
            )

    if not created_items:
        db.session.rollback()
        return _err("No valid parcel items found")

    for inv_id, qty in inventory_export_qty.items():
        item = ITInventoryItem.query.get(inv_id)
        if not item or qty < 1:
            continue
        if _is_qty_managed_inventory(item.category, item.inventory_category):
            item.available_quantity = max(0, int(item.available_quantity or 0) - qty)
            item.total_quantity = max(0, int(item.total_quantity or 0) - qty)
        else:
            units = ITAssetUnit.query.filter_by(inventory_item_id=inv_id).count()
            if units == 0:
                item.available_quantity = max(0, int(item.available_quantity or 0) - qty)
                item.total_quantity = max(0, int(item.total_quantity or 0) - qty)

    db.session.commit()
    row = ITParcelExport.query.get(row.id)
    return _ok({"export": _serialize_parcel_export(row)}, "Parcel export created", 201)


def _norm_emp_type_label(s):
    return " ".join(((s or "").strip().lower().replace("-", " ")).split())


def _ensure_it_staff_admin():
    claims = get_jwt()
    email = (claims.get("email") or "").strip()
    if not email:
        return None, _err("Unauthorized", 401)
    admin = Admin.query.filter_by(email=email).first()
    if not admin:
        return None, _err("Employee not found", 404)
    et = _norm_emp_type_label(admin.emp_type or "")
    if et not in ("it", "it department", "information technology"):
        return None, _err("IT access required", 403)
    return admin, None


@it_bp.route("/noc-requests", methods=["GET"])
@jwt_required()
def it_list_noc_department_requests():
    admin, err = _ensure_it_staff_admin()
    if err:
        return err
    status_raw = (request.args.get("status") or "All").strip()
    try:
        items = list_noc_requests("it", admin, status_raw)
        return _ok({"requests": items})
    except Exception:
        current_app.logger.exception("it_list_noc_department_requests")
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Unable to load NOC requests. Check that database migrations include noc_department_requests.",
                }
            ),
            500,
        )


@it_bp.route("/noc-requests/<int:req_id>/upload", methods=["POST"])
@jwt_required()
def it_upload_noc_department_document(req_id):
    admin, err = _ensure_it_staff_admin()
    if err:
        return err
    file = request.files.get("file")
    out = upload_noc_document("it", admin, req_id, file)
    code = out.pop("http", 200)
    return jsonify({k: v for k, v in out.items()}), code


@it_bp.route("/noc-requests/<int:req_id>/download", methods=["GET"])
@jwt_required()
def it_download_noc_department_document(req_id):
    admin, err = _ensure_it_staff_admin()
    if err:
        return err
    out = download_noc_document("it", admin, req_id)
    if not out.get("success"):
        return jsonify({"success": False, "message": out.get("message", "Error")}), out.get("http", 400)
    return send_file(
        out["path"],
        as_attachment=True,
        download_name=out["download_name"],
        mimetype="application/octet-stream",
    )

