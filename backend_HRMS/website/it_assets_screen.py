"""
Rows and counts for the IT Asset Management screen (Available / Assigned tables), so the
browser no longer builds them from every unit and employee kept in localStorage.

The rules repeat frontend/src/pages/IT/AssetsPage/AssetsDashboard.jsx (buildAvailableData,
buildAssignedData, normCat, assetSearchBlob, compareAssetRows); keep them in step.
"""
import re

from flask import request
from flask_jwt_extended import jwt_required
from sqlalchemy.orm import selectinload

from . import db
from .employee_photo import photo_url_for_admin, prime_photo_urls
from .it import _INVENTORY_MEDIA, _admin_name, _err, _ok, it_bp
from .it_inventory_screens import item_tab
from .itam.tenancy import it_query
from .models.Admin_models import Admin
from .models.it_models import ITAssetUnit, ITInventoryItem, ITInventoryQuantityAssignment
from .query_utils import collation_key, list_params, page_slice
from .tenant_context import tenant_admin_query

_VIEWS = ("available", "assigned")
_ORDERS = ("name-asc", "name-desc", "recent", "oldest")
_QTY_CATEGORIES = ("Accessories", "Consumable")
_JS_DECIMAL = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")
_JS_HEX = re.compile(r"^0[xX][0-9a-fA-F]+$")


def norm_cat(category):
    """normCat: blank is Hardware, consumable* is Consumable, known names get their casing."""
    if not category:
        return "Hardware"
    key = str(category).strip().lower()
    known = {"software": "Software", "hardware": "Hardware", "accessories": "Accessories"}
    if key in known:
        return known[key]
    if key.startswith("consumable"):
        return "Consumable"
    return str(category).strip()


def _js_number(value):
    """Number(value) for a row id, 0 when it is not a finite number (as compareAssetRows does)."""
    if isinstance(value, (int, float)):
        return value
    text = str(value if value is not None else "").strip()
    if not text:
        return 0
    if _JS_DECIMAL.match(text):
        number = float(text)
        return number if number not in (float("inf"), float("-inf")) else 0
    if _JS_HEX.match(text):
        return int(text, 16)
    return 0


def _clean(value):
    return str(value or "").strip()


# ── Available ────────────────────────────────────────────────────────────────


def _laptop_code(unit):
    model = _clean(unit.model)
    if model and model != "—":
        return model
    code = _clean(unit.unit_code) or str(unit.id)
    return code if code != "—" else ""


def _imei(unit):
    return _clean(unit.imei1) or _clean(unit.imei2)


def _available_units(items):
    """Available units per item, newest first, matched by id, else name + type, else name."""
    if not items:
        return {}
    cols = (
        ITAssetUnit.id,
        ITAssetUnit.inventory_item_id,
        ITAssetUnit.asset_name,
        ITAssetUnit.hw_type,
        ITAssetUnit.status,
        ITAssetUnit.model,
        ITAssetUnit.unit_code,
        ITAssetUnit.imei1,
        ITAssetUnit.imei2,
    )
    rows = [
        r for r in it_query(ITAssetUnit)
        .filter(db.func.lower(ITAssetUnit.status) == "available")
        .with_entities(*cols)
        .order_by(ITAssetUnit.id.desc())
        .all()
        if (r.status or "").lower() == "available"
    ]
    by_id = {}
    for r in rows:
        by_id.setdefault(r.inventory_item_id, []).append(r)
    out = {}
    for item in items:
        units = by_id.get(item.id)
        if not units:
            same = [r for r in rows if r.asset_name == item.name]
            typed = [r for r in same if (r.hw_type or "").lower() == (item.hw_type or "").lower()] if item.hw_type else []
            units = typed or same
        out[item.id] = units
    return out


def _available_rows():
    items = [
        i for i in it_query(ITInventoryItem).options(*_INVENTORY_MEDIA).order_by(ITInventoryItem.id.desc()).all()
        if (item_tab(i) or "IT Assets") == "IT Assets"
        and norm_cat(i.category) != "Software"
        and int(i.available_quantity or 0) > 0
    ]
    units = _available_units(items)
    rows = []
    for i in items:
        laptop_code = imei = ""
        for u in units.get(i.id, ()):
            laptop_code = laptop_code or _laptop_code(u)
            imei = imei or _imei(u)
            if laptop_code and imei:
                break
        total = int(i.total_quantity or 0)
        rows.append({
            "id": i.id,
            "name": i.name or "",
            "hwType": i.hw_type or None,
            "category": norm_cat(i.category),
            "availableQty": int(i.available_quantity or 0),
            "assignedQty": int(i.assigned_quantity or 0),
            "totalQty": total,
            "licenseKey": None,
            "version": None,
            "vendor": i.vendor or None,
            "expiryDate": None,
            "seats": total or None,
            "laptopCode": laptop_code,
            "imei": imei,
        })
    return rows


def _unit_counts(rows):
    """Units per Available row, matched by catalog id or by unit code equal to that id."""
    ids = [r["id"] for r in rows]
    if not ids:
        return {}
    counts = dict(
        it_query(ITAssetUnit)
        .filter(ITAssetUnit.inventory_item_id.in_(ids))
        .with_entities(ITAssetUnit.inventory_item_id, db.func.count(ITAssetUnit.id))
        .group_by(ITAssetUnit.inventory_item_id)
        .all()
    )
    id_codes = {str(i): i for i in ids}
    by_code = (
        it_query(ITAssetUnit)
        .filter(ITAssetUnit.unit_code.in_(list(id_codes)))
        .with_entities(ITAssetUnit.inventory_item_id, ITAssetUnit.unit_code)
        .all()
    )
    for inventory_id, code in by_code:
        target = id_codes.get(code)
        if target is not None and inventory_id != target:
            counts[target] = counts.get(target, 0) + 1
    return counts


# ── Assigned ─────────────────────────────────────────────────────────────────


def _employee_view(admin):
    """(empId, empName, empPhoto) shown for an employee row."""
    return (
        admin.emp_id or str(admin.id),
        admin.first_name or _admin_name(admin) or "—",
        photo_url_for_admin(admin) or "",
    )


def _unit_name(brand, model, asset_name):
    if brand:
        return f"{brand} {model}" if model else brand
    return asset_name or "—"


def _assigned_rows():
    rows = []
    seen = set()
    units = [
        u for u in it_query(ITAssetUnit)
        .filter(ITAssetUnit.status == "assigned", ITAssetUnit.assigned_to_admin_id.isnot(None))
        .with_entities(
            ITAssetUnit.id,
            ITAssetUnit.unit_code,
            ITAssetUnit.inventory_item_id,
            ITAssetUnit.asset_name,
            ITAssetUnit.category,
            ITAssetUnit.hw_type,
            ITAssetUnit.brand,
            ITAssetUnit.model,
            ITAssetUnit.status,
            ITAssetUnit.assigned_to_admin_id,
        )
        .order_by(ITAssetUnit.id.desc())
        .all()
        if u.status == "assigned"
    ]
    holder_ids = {u.assigned_to_admin_id for u in units}
    holders = {a.id: a for a in Admin.query.filter(Admin.id.in_(holder_ids)).all()} if holder_ids else {}
    prime_photo_urls(holders.keys())
    for u in units:
        if u.id in seen:
            continue
        seen.add(u.id)
        admin = holders.get(u.assigned_to_admin_id)
        if admin is not None:
            emp_id, emp_name, emp_photo = _employee_view(admin)
        else:
            emp_id, emp_name, emp_photo = str(u.assigned_to_admin_id), "—", ""
        rows.append({
            "id": u.unit_code or u.id,
            "unitId": u.id,
            "name": _unit_name(u.brand, u.model, u.asset_name),
            "category": norm_cat(u.category or "Hardware"),
            "hwType": u.hw_type or None,
            "empId": emp_id,
            "empName": emp_name,
            "empPhoto": emp_photo,
        })
    rows.extend(_employee_quantity_rows(seen))
    return rows


def _qty_category(item):
    category = (item.category if item else "") or ""
    lower = category.strip().lower()
    if lower.startswith("consumable"):
        return "Consumables"
    if lower.startswith("accessor"):
        return "Accessories"
    return category or "Accessories"


def _employee_quantity_rows(seen):
    """Accessory / consumable lines from each employee's assigned assets (units and stock quantities)."""
    admins = tenant_admin_query().order_by(Admin.id.asc()).all()
    admin_ids = [a.id for a in admins]
    if not admin_ids:
        return []
    assets = {}
    for u in (
        ITAssetUnit.query.filter(ITAssetUnit.assigned_to_admin_id.in_(admin_ids))
        .with_entities(
            ITAssetUnit.id, ITAssetUnit.assigned_to_admin_id, ITAssetUnit.asset_name,
            ITAssetUnit.category, ITAssetUnit.hw_type,
        )
        .order_by(ITAssetUnit.id.asc())
    ):
        category = norm_cat(u.category or "Hardware")
        if category in _QTY_CATEGORIES:
            assets.setdefault(u.assigned_to_admin_id, []).append((u.asset_name, category, u.id, 1, u.hw_type))
    for qa in (
        ITInventoryQuantityAssignment.query.options(selectinload(ITInventoryQuantityAssignment.inventory_item))
        .filter(
            ITInventoryQuantityAssignment.assigned_to_admin_id.in_(admin_ids),
            ITInventoryQuantityAssignment.quantity > 0,
        )
        .order_by(ITInventoryQuantityAssignment.id.asc())
    ):
        category = norm_cat(_qty_category(qa.inventory_item))
        if category in _QTY_CATEGORIES:
            name = qa.inventory_item.name if qa.inventory_item else "Inventory item"
            key = qa.inventory_item_id or f"invq-{qa.id}"
            assets.setdefault(qa.assigned_to_admin_id, []).append((name, category, key, int(qa.quantity or 0), None))
    holders = [a for a in admins if a.id in assets]
    prime_photo_urls(a.id for a in holders)
    rows = []
    for admin in holders:
        emp_id, _, emp_photo = _employee_view(admin)
        emp_name = admin.first_name or "—"
        for name, category, key, quantity, hw_type in assets[admin.id]:
            qty = max(1, quantity or 1)
            base = name or "—"
            uid = f"inv-{emp_id}-{category}-{key or base}-{qty}"
            if uid in seen:
                continue
            seen.add(uid)
            rows.append({
                "id": uid,
                "unitId": uid,
                "name": f"{base} (x{qty})" if qty > 1 else base,
                "category": category,
                "hwType": hw_type or None,
                "empId": str(emp_id),
                "empName": str(emp_name),
                "empPhoto": emp_photo,
            })
    return rows


# ── Filters, search and order ────────────────────────────────────────────────

_AVAILABLE_SEARCH = ("name", "hwType", "category", "id", "unitId", "empId", "empName",
                     "vendor", "version", "licenseKey", "laptopCode", "imei")


def _search_blob(row):
    return " ".join("" if row.get(k) is None else str(row[k]).lower() for k in _AVAILABLE_SEARCH)


def _ordered(rows, order):
    """compareAssetRows plus the id tie-break of the Asset Management table."""
    rows = sorted(rows, key=lambda r: collation_key(str(r["id"])))
    if order in ("name-asc", "name-desc"):
        return sorted(rows, key=lambda r: collation_key(str(r["name"] or "").lower()), reverse=order == "name-desc")
    return sorted(rows, key=lambda r: _js_number(r["id"]), reverse=order == "recent")


def _type_counts(rows):
    counts = {"All": len(rows)}
    for r in rows:
        key = _clean(r["hwType"]).lower()
        counts[key] = counts.get(key, 0) + 1
    return counts


@it_bp.route("/assets/screen", methods=["GET"])
@jwt_required()
def asset_management_rows():
    """
    Available (view=available) or Assigned (view=assigned) rows of the Asset Management screen.

    ``category`` (ALL / Hardware / Accessories / Consumable), ``type`` (hardware type, needs a
    category), ``q`` (every word must match) and ``order`` (name-asc, name-desc, recent, oldest)
    always apply; ``counts`` has per-category and per-type totals and ``totalAssets`` the header
    figure. Only ``page`` / ``per_page`` follow API_PAGINATION_V1.
    """
    view = (request.args.get("view") or "available").strip()
    if view not in _VIEWS:
        return _err("view must be one of: " + ", ".join(_VIEWS))
    order = (request.args.get("order") or "name-asc").strip()
    if order not in _ORDERS:
        return _err("order must be one of: " + ", ".join(_ORDERS))
    category = (request.args.get("category") or "").strip() or "ALL"
    hw_type = (request.args.get("type") or "").strip() or "All"
    tokens = (request.args.get("q") or "").strip().lower().split()

    data = _available_rows() if view == "available" else _assigned_rows()
    by_category = {"ALL": len(data)}
    for r in data:
        by_category[r["category"]] = by_category.get(r["category"], 0) + 1
    scoped = data if category == "ALL" else [r for r in data if r["category"] == category]
    rows = scoped
    if category != "ALL" and hw_type != "All":
        want = hw_type.lower()
        rows = [r for r in rows if _clean(r["hwType"]).lower() == want]
    if tokens:
        rows = [r for r in rows if all(t in _search_blob(r) for t in tokens)]
    rows = _ordered(rows, order)

    if view == "available":
        units = _unit_counts(rows)
        total_assets = sum(units.get(r["id"], 0) or r["availableQty"] for r in rows)
    else:
        total_assets = len(rows)
    page, pagination = page_slice(rows, list_params())
    body = {
        "rows": page,
        "counts": {"category": by_category, "type": _type_counts(scoped)},
        "totalAssets": total_assets,
    }
    if pagination is not None:
        body["pagination"] = pagination
    return _ok(body)
