"""
Lists and counts for the inventory screens (summary cards, Overview, Total Assets, Not Working,
In Repair, Dead Assets, Removed From IT) so the browser no longer needs every unit in localStorage.

The category rules repeat frontend/src/pages/IT/inventoryCategories.js and the screens'
own filters; keep them in step so a paged screen shows the same records as the old one.
"""
from flask import request
from flask_jwt_extended import jwt_required
from sqlalchemy.orm import defer, selectinload

from . import db
from .it import (
    _INVENTORY_MEDIA,
    _effective_inventory_category,
    _err,
    _ok,
    _serialize_deleted_log,
    _serialize_inventory_item,
    _serialize_removed_asset,
    it_bp,
    serialize_listed_units,
    units_for_listing,
)
from .itam.tenancy import it_query
from .models.it_models import ITAssetUnit, ITDeletedAssetLog, ITInventoryItem, ITRemovedAsset
from .query_utils import ListParams, ci_equals, list_params, page_slice

INV_CATEGORIES = ("IT Assets", "Fixed Assets", "Transport Assets", "Infrastructure Assets")
_STOCK_TABS = ("Fixed Assets", "Office Assets", "Infrastructure Assets", "Transport Assets")
_IT_LINE_CATEGORIES = {"hardware", "software", "accessories", "consumables", "consumable", "accessory"}
_QTY_CATEGORIES = {"accessories", "consumables", "stock"}
_STATUS_ROWS = ("not_working", "repair")
_SUMMARY_UNITS = ListParams(summary=True)
_MOBILE_TABLET = ("Mobile", "Tablet")
_TYPE_CHIPS = ("Hardware", "Accessories", "Consumables")
_STOCK_STATUSES = ("All", "Available", "Assigned")
_OVERVIEW_VIEWS = ("overview", "total")


def _tab_for(category, explicit=""):
    """Inventory tab for a catalog category plus stored tab; "" when it belongs to none."""
    cat = (category or "").strip().lower()
    explicit = (explicit or "").strip()
    if cat == "vehicle":
        return "Transport Assets"
    if cat == "equipment":
        return "Infrastructure Assets"
    if cat == "stock":
        named = "Fixed Assets" if explicit in ("Office Assets", "Fixed Assets") else explicit
        return named if named in ("Fixed Assets", "Infrastructure Assets", "Transport Assets") else ""
    if cat in _IT_LINE_CATEGORIES:
        named = "Fixed Assets" if explicit in ("Office Assets", "Fixed Assets") else explicit
        return named if named in INV_CATEGORIES else "IT Assets"
    named = "Fixed Assets" if explicit in ("Office Assets", "Fixed Assets") else explicit
    return named if named in INV_CATEGORIES else ""


def item_tab(item):
    return _tab_for(item.category, _effective_inventory_category(item))


def _status_bucket(category):
    """Category chip on Not Working / In Repair: blank is Hardware, consumable* is Consumables."""
    raw = (category or "").strip()
    if not raw:
        return "Hardware"
    return "Consumables" if raw.lower().startswith("consumable") else raw


def _matches(needle, *values):
    return any(needle in (v or "").lower() for v in values)


def _tab_arg():
    tab = (request.args.get("inventory_category") or "").strip()
    if tab in ("Office Assets", "Fixed Assets"):
        return "Fixed Assets", None
    if tab not in INV_CATEGORIES:
        return None, _err("inventory_category must be one of: " + ", ".join(INV_CATEGORIES))
    return tab, None


def _catalog():
    return it_query(ITInventoryItem).options(*_INVENTORY_MEDIA).order_by(ITInventoryItem.id.desc()).all()


def _count_by(rows, key):
    counts = {}
    for row in rows:
        counts[row[key]] = counts.get(row[key], 0) + 1
    return counts


def _filtered(rows, bucket_key, bucket, needle, search_keys):
    if bucket != "All":
        rows = [r for r in rows if r[bucket_key] == bucket]
    if needle:
        rows = [r for r in rows if _matches(needle, *(r[k] for k in search_keys))]
    return rows


# ── Summary cards ────────────────────────────────────────────────────────────


def _log_matcher(catalog):
    """Function telling whether a dead-asset log belongs to a tab, as the Dead Assets screen decides."""
    item_tabs = {i.id: item_tab(i) for i in catalog}

    def unit_info(log_rows):
        ids = {r.asset_unit_id for r in log_rows if r.asset_unit_id and r.inventory_item_id not in item_tabs}
        if not ids:
            return {}
        rows = (
            it_query(ITAssetUnit)
            .filter(ITAssetUnit.id.in_(ids))
            .with_entities(ITAssetUnit.id, ITAssetUnit.inventory_item_id, ITAssetUnit.category)
            .all()
        )
        return {r.id: r for r in rows}

    def belongs(log, tab, units):
        if log.inventory_item_id in item_tabs:
            return item_tabs[log.inventory_item_id] == tab
        explicit = _tab_for(log.category)
        if explicit:
            return explicit == tab
        unit = units.get(log.asset_unit_id)
        if unit is not None:
            if unit.inventory_item_id in item_tabs:
                return item_tabs[unit.inventory_item_id] == tab
            from_unit = _tab_for(unit.category or "Hardware")
            if from_unit:
                return from_unit == tab
        if (log.category or "Hardware").strip().lower() == "stock":
            return tab == "Fixed Assets"
        return _tab_for(log.category or "Hardware") == tab

    return unit_info, belongs


def _dead_log_rows(catalog, tab):
    """Narrow rows for the tab's dead-asset logs, newest first."""
    rows = (
        it_query(ITDeletedAssetLog)
        .with_entities(
            ITDeletedAssetLog.id,
            ITDeletedAssetLog.inventory_item_id,
            ITDeletedAssetLog.asset_unit_id,
            ITDeletedAssetLog.category,
            ITDeletedAssetLog.asset_name,
            ITDeletedAssetLog.serial_number,
        )
        .order_by(ITDeletedAssetLog.deleted_at.desc(), ITDeletedAssetLog.id.desc())
        .all()
    )
    unit_info, belongs = _log_matcher(catalog)
    units = unit_info(rows)
    return [r for r in rows if belongs(r, tab, units)]


@it_bp.route("/inventory/summary", methods=["GET"])
@jwt_required()
def inventory_summary():
    """Counts for the inventory header cards of one tab."""
    tab, err = _tab_arg()
    if err:
        return err
    catalog = _catalog()
    items = [
        i for i in catalog
        if item_tab(i) == tab and (i.category or "").strip().lower() != "software"
    ]
    removed_it = 0
    if tab == "IT Assets":
        removed_it = it_query(ITRemovedAsset).with_entities(db.func.count(ITRemovedAsset.id)).scalar() or 0
    return _ok({
        "summary": {
            "total": sum(int(i.total_quantity or 0) for i in items),
            "records": len(items),
            "not-working": sum(int(i.not_working_quantity or 0) for i in items),
            "in-repair": sum(int(i.repair_quantity or 0) for i in items),
            "removed-assets": len(_dead_log_rows(catalog, tab)),
            "removed-it": int(removed_it),
        }
    })


# ── Overview / Total Assets ──────────────────────────────────────────────────


def _chip_matches(category, chip):
    """inventoryCategoryMatches: a catalog category against a type chip."""
    if not chip or chip == "All":
        return True
    c = (category or "—").strip().lower()
    f = chip.strip().lower()
    if f == "consumables":
        return c in ("consumables", "consumable")
    if f == "accessories":
        return c in ("accessories", "accessory")
    return c == f


def _hw_matches(item, hw_type):
    return not hw_type or hw_type == "All" or (item.hw_type or "").strip().lower() == hw_type.lower()


def _is_mobile_tablet(hw_type):
    return (hw_type or "").strip() in _MOBILE_TABLET


def _unit_lookup(items, *columns):
    """
    Narrow unit rows per catalog item, newest first, matched as getUnitsForAsset does:
    by catalog id, else by asset name and hardware type, else by asset name alone.
    """
    if not items:
        return {}
    cols = (ITAssetUnit.id, ITAssetUnit.inventory_item_id, ITAssetUnit.asset_name, ITAssetUnit.hw_type, *columns)
    by_item = {}
    rows = (
        it_query(ITAssetUnit)
        .filter(ITAssetUnit.inventory_item_id.in_([i.id for i in items]))
        .with_entities(*cols)
        .order_by(ITAssetUnit.id.desc())
        .all()
    )
    for r in rows:
        by_item.setdefault(r.inventory_item_id, []).append(r)
    missing = [i for i in items if i.id not in by_item and i.name]
    if missing:
        named = (
            it_query(ITAssetUnit)
            .filter(ITAssetUnit.asset_name.in_({i.name for i in missing}))
            .with_entities(*cols)
            .order_by(ITAssetUnit.id.desc())
            .all()
        )
        for item in missing:
            same = [r for r in named if r.asset_name == item.name]
            if item.hw_type:
                typed = [r for r in same if (r.hw_type or "").lower() == item.hw_type.lower()]
                if typed:
                    same = typed
            if same:
                by_item[item.id] = same
    return by_item


def _first_units(items):
    """Newest matching unit per catalog item, for the brand / make / model shown in the table."""
    if not items:
        return {}
    newest = dict(
        it_query(ITAssetUnit)
        .filter(ITAssetUnit.inventory_item_id.in_([i.id for i in items]))
        .with_entities(ITAssetUnit.inventory_item_id, db.func.max(ITAssetUnit.id))
        .group_by(ITAssetUnit.inventory_item_id)
        .all()
    )
    chosen = dict(newest)
    fallback = _unit_lookup([i for i in items if i.id not in newest])
    chosen.update({item_id: rows[0].id for item_id, rows in fallback.items()})
    if not chosen:
        return {}
    units = {
        u.id: u
        for u in it_query(ITAssetUnit)
        .filter(ITAssetUnit.id.in_(set(chosen.values())))
        .with_entities(ITAssetUnit.id, ITAssetUnit.brand, ITAssetUnit.make, ITAssetUnit.model)
        .all()
    }
    return {item_id: units[unit_id] for item_id, unit_id in chosen.items() if unit_id in units}


def _project_codes(units):
    """Project names of units: the project code, else the legacy make."""
    codes = set()
    for u in units:
        code = (u.project_code or "").strip()
        legacy = (u.make or "").strip()
        if code or legacy:
            codes.add(code or legacy)
    return codes


def _qty_counts_by_category(items):
    """buildCategoryQtyCounts: summed quantity per IT type chip."""
    def total(chip):
        return sum(int(i.total_quantity or 0) for i in items if _chip_matches(i.category, chip))

    return {
        "All": total("All"),
        "Hardware": total("Hardware"),
        "Software": total("Software"),
        "Accessories": total("Accessories"),
        "Consumables": total("Consumables"),
    }


def _qty_counts_by_hw_type(items, chip):
    """buildHwTypeQtyCounts: summed quantity per hardware type inside a chip, first-seen casing."""
    counts = {"All": 0}
    keys = {}
    for i in items:
        qty = int(i.total_quantity or 0)
        if not _chip_matches(i.category, chip) or qty <= 0:
            continue
        counts["All"] += qty
        raw = (i.hw_type or "").strip() or "Other"
        key = keys.setdefault(raw.lower(), raw)
        counts[key] = counts.get(key, 0) + qty
    return counts


def _stock_counts(items):
    return {
        "All": len(items),
        "Available": sum(1 for i in items if int(i.available_quantity or 0) > 0),
        "Assigned": sum(1 for i in items if int(i.assigned_quantity or 0) > 0),
    }


def _stock_filter(items, status):
    if status == "Available":
        return [i for i in items if int(i.available_quantity or 0) > 0]
    if status == "Assigned":
        return [i for i in items if int(i.assigned_quantity or 0) > 0]
    return items


def _item_matches_search(item, needle, first_unit=None):
    if not needle:
        return True
    return _matches(
        needle,
        item.name,
        item.hw_type,
        item.category or "—",
        getattr(item, "vendor", None),
        getattr(first_unit, "brand", None),
        getattr(first_unit, "make", None),
        getattr(first_unit, "model", None),
        getattr(first_unit, "serial_number", None),
    )


def _overview_rows(base, it_tab, args):
    """(rows, counts, projects) for the Asset Overview screen."""
    status = args["status"]
    if not it_tab:
        rows = _stock_filter(base, status)
        return rows, {"status": _stock_counts(base)}, ["All"]
    chip, hw_type = args["category"], args["hw_type"]
    counts = {"category": _qty_counts_by_category(base), "subType": _qty_counts_by_hw_type(base, chip)}
    rows = [i for i in base if _chip_matches(i.category, chip)]
    if chip in _TYPE_CHIPS:
        rows = [i for i in rows if _hw_matches(i, hw_type)]
    projects = ["All"]
    if chip == "Hardware" and _is_mobile_tablet(hw_type):
        candidates = [i for i in base if _chip_matches(i.category, "Hardware") and _hw_matches(i, hw_type)]
        unit_codes = {
            item_id: _project_codes(units)
            for item_id, units in _unit_lookup(candidates, ITAssetUnit.project_code, ITAssetUnit.make).items()
        }
        offered = set()
        for item in candidates:
            if _is_mobile_tablet(item.hw_type):
                offered |= unit_codes.get(item.id, set())
        projects += sorted(offered, key=str.casefold)
        project = args["project"]
        if project in projects and project != "All":
            needle = project.strip().lower()
            rows = [i for i in rows if any(c.lower() == needle for c in unit_codes.get(i.id, ()))]
    needle = args["q"].lower()
    if needle:
        first = _first_units(rows)
        rows = [i for i in rows if _item_matches_search(i, needle, first.get(i.id))]
    counts["status"] = _stock_counts(rows)
    return _stock_filter(rows, status), counts, projects


def _total_rows(base, it_tab, args):
    """(rows, counts) for the Total Assets screen."""
    if not it_tab:
        return base, {}
    chip = args["category"]
    counts = {"category": _qty_counts_by_category(base), "subType": _qty_counts_by_hw_type(base, chip)}
    rows = [i for i in base if _chip_matches(i.category, chip)]
    if chip in _TYPE_CHIPS:
        rows = [i for i in rows if _hw_matches(i, args["hw_type"])]
    return rows, counts


@it_bp.route("/inventory/overview", methods=["GET"])
@jwt_required()
def inventory_overview():
    """
    Catalog rows of one tab for the Asset Overview (view=overview) or Total Assets (view=total)
    screen: non-software items with a quantity, newest first, each with its newest unit's
    brand / make / model as ``firstUnit``.

    IT Assets also take ``category`` (type chip), ``hw_type`` and, for mobile / tablet hardware,
    ``project``; ``q`` searches name, hardware type and category. ``status`` (All / Available /
    Assigned) applies to the overview. Filters and search always apply so ``counts`` match the
    list; only ``page`` / ``per_page`` follow API_PAGINATION_V1.
    """
    tab, err = _tab_arg()
    if err:
        return err
    view = (request.args.get("view") or "overview").strip()
    if view not in _OVERVIEW_VIEWS:
        return _err("view must be one of: " + ", ".join(_OVERVIEW_VIEWS))
    status = (request.args.get("status") or "").strip() or "All"
    if status not in _STOCK_STATUSES:
        return _err("status must be one of: " + ", ".join(_STOCK_STATUSES))
    args = {
        "status": status,
        "category": (request.args.get("category") or "").strip() or "All",
        "hw_type": (request.args.get("hw_type") or "").strip() or "All",
        "project": (request.args.get("project") or "").strip() or "All",
        "q": (request.args.get("q") or "").strip(),
    }
    it_tab = tab == "IT Assets"
    base = [
        i for i in _catalog()
        if item_tab(i) == tab
        and (i.category or "").strip().lower() != "software"
        and int(i.total_quantity or 0) > 0
    ]
    if view == "total":
        rows, counts = _total_rows(base, it_tab, args)
        projects = ["All"]
    else:
        rows, counts, projects = _overview_rows(base, it_tab, args)
    page, pagination = page_slice(rows, list_params())
    first = _first_units(page)
    items = []
    for item in page:
        payload = _serialize_inventory_item(item, summary=True)
        unit = first.get(item.id)
        payload["firstUnit"] = (
            {"brand": unit.brand, "make": unit.make, "model": unit.model} if unit is not None else None
        )
        items.append(payload)
    body = {"items": items, "counts": counts, "projects": projects}
    if pagination is not None:
        body["pagination"] = pagination
    return _ok(body)


# ── Not Working / In Repair ──────────────────────────────────────────────────


def _status_units(status, item_ids):
    """Narrow unit rows in ``status`` whose catalog item is in ``item_ids``, newest first."""
    if not item_ids:
        return []
    q = it_query(ITAssetUnit).filter(ITAssetUnit.inventory_item_id.in_(item_ids))
    if status == "repair":
        q = q.filter(ci_equals(ITAssetUnit.status, "repair"))
    else:
        q = q.filter(db.or_(ci_equals(ITAssetUnit.status, "notWorking"), ci_equals(ITAssetUnit.status, "not-working")))
    rows = (
        q.with_entities(
            ITAssetUnit.id,
            ITAssetUnit.inventory_item_id,
            ITAssetUnit.status,
            ITAssetUnit.category,
            ITAssetUnit.brand,
            ITAssetUnit.asset_name,
            ITAssetUnit.serial_number,
        )
        .order_by(ITAssetUnit.id.desc())
        .all()
    )
    if status == "repair":
        return [r for r in rows if r.status == "repair"]
    return [r for r in rows if (r.status or "").strip().lower() in ("notworking", "not-working")]


def _unit_row(u):
    return {
        "kind": "unit",
        "id": u.id,
        "bucket": _status_bucket(u.category or "Hardware"),
        "brand": u.brand,
        "assetName": u.asset_name,
        "serial": u.serial_number,
    }


def _qty_row(item, quantity, line=None, lines=None):
    return {
        "kind": "quantity",
        "item": item,
        "quantity": quantity,
        "line": line,
        "lines": lines,
        "bucket": _status_bucket(item.category),
        "brand": item.name,
        "assetName": item.name,
        "serial": "",
    }


def _not_working_rows(items):
    units = _status_units("not_working", [i.id for i in items])
    rows = [_unit_row(u) for u in units]
    for item in items:
        quantity = int(item.not_working_quantity or 0)
        if (item.category or "").lower() in _QTY_CATEGORIES and quantity > 0:
            rows.append(_qty_row(item, quantity))
    return rows


def _repair_rows(items):
    """Repair units, then one row per catalog unit in repair that has no unit record."""
    units = _status_units("repair", [i.id for i in items])
    rows = [_unit_row(u) for u in units]
    units_per_item = {}
    for u in units:
        units_per_item[u.inventory_item_id] = units_per_item.get(u.inventory_item_id, 0) + 1
    for item in items:
        quantity = int(item.repair_quantity or 0)
        if quantity <= 0:
            continue
        if (item.category or "").lower() not in _QTY_CATEGORIES:
            quantity -= units_per_item.get(item.id, 0)
        for line in range(1, quantity + 1):
            rows.append(_qty_row(item, quantity, line, quantity))
    return rows


def _status_row_payload(rows):
    unit_ids = [r["id"] for r in rows if r["kind"] == "unit"]
    units = {}
    if unit_ids:
        loaded, _ = units_for_listing(
            it_query(ITAssetUnit).filter(ITAssetUnit.id.in_(unit_ids)), (ITAssetUnit.id.desc(),), _SUMMARY_UNITS
        )
        units = {u["id"]: u for u in serialize_listed_units(loaded, summary=True)}
    payload = []
    for r in rows:
        if r["kind"] == "unit":
            if r["id"] in units:
                payload.append({"kind": "unit", "unit": units[r["id"]]})
            continue
        payload.append({
            "kind": "quantity",
            "item": _serialize_inventory_item(r["item"], summary=True),
            "quantity": r["quantity"],
            "line": r["line"],
            "lines": r["lines"],
        })
    return payload


@it_bp.route("/inventory/status-rows", methods=["GET"])
@jwt_required()
def inventory_status_rows():
    """
    Not Working (status=not_working) or In Repair (status=repair) rows of one tab.

    ``category`` picks a chip (Hardware, Accessories, ...); ``counts`` are per chip before
    search. Units come first, then quantity rows; In Repair has one row per catalog unit.
    """
    status = (request.args.get("status") or "").strip()
    if status not in _STATUS_ROWS:
        return _err("status must be one of: " + ", ".join(_STATUS_ROWS))
    tab, err = _tab_arg()
    if err:
        return err
    params = list_params()
    items = [i for i in _catalog() if item_tab(i) == tab]
    rows = _repair_rows(items) if status == "repair" else _not_working_rows(items)
    counts = _count_by(rows, "bucket")
    bucket = (request.args.get("category") or "").strip() or "All"
    rows = _filtered(rows, "bucket", bucket, params.search.lower(), ("brand", "assetName", "serial"))
    page, pagination = page_slice(rows, params)
    body = {"rows": _status_row_payload(page), "counts": counts}
    if pagination is not None:
        body["pagination"] = pagination
    return _ok(body)


# ── Dead Assets ──────────────────────────────────────────────────────────────


@it_bp.route("/inventory/dead-assets", methods=["GET"])
@jwt_required()
def inventory_dead_assets():
    """Dead-asset logs of one tab, newest first; ``category`` is an exact category, ``counts`` per category."""
    tab, err = _tab_arg()
    if err:
        return err
    params = list_params()
    rows = [
        {
            "id": r.id,
            "category": r.category or "Hardware",
            "assetName": r.asset_name,
            "serial": r.serial_number,
        }
        for r in _dead_log_rows(_catalog(), tab)
    ]
    counts = _count_by(rows, "category")
    bucket = (request.args.get("category") or "").strip() or "All"
    rows = _filtered(rows, "category", bucket, params.search.lower(), ("assetName", "assetName", "serial"))
    page, pagination = page_slice(rows, params)
    ids = [r["id"] for r in page]
    by_id = {}
    if ids:
        loaded = (
            ITDeletedAssetLog.query.options(selectinload(ITDeletedAssetLog.deleted_by_admin))
            .filter(ITDeletedAssetLog.id.in_(ids))
            .all()
        )
        by_id = {d.id: d for d in loaded}
    body = {"logs": [_serialize_deleted_log(by_id[i]) for i in ids if i in by_id], "counts": counts}
    if pagination is not None:
        body["pagination"] = pagination
    return _ok(body)


# ── Removed From IT ──────────────────────────────────────────────────────────


@it_bp.route("/inventory/removed-it", methods=["GET"])
@jwt_required()
def inventory_removed_it():
    """Removed From IT records except software, newest first; search covers name, id and owner."""
    params = list_params()
    records = (
        it_query(ITRemovedAsset)
        .options(
            defer(ITRemovedAsset.photos_json),
            selectinload(ITRemovedAsset.owner_admin),
            selectinload(ITRemovedAsset.removed_by_admin),
        )
        .order_by(ITRemovedAsset.removed_at.desc(), ITRemovedAsset.id.desc())
        .all()
    )
    rows = []
    for r in records:
        payload = _serialize_removed_asset(r, summary=True)
        category = r.category or "Hardware"
        if category.lower() == "software":
            continue
        rows.append({
            "payload": payload,
            "category": category,
            "name": r.name,
            "id": str(r.id),
            "owner": payload["ownerName"] or "—",
        })
    counts = _count_by(rows, "category")
    bucket = (request.args.get("category") or "").strip() or "All"
    rows = _filtered(rows, "category", bucket, params.search.lower(), ("name", "id", "owner"))
    page, pagination = page_slice(rows, params)
    body = {"removed_assets": [r["payload"] for r in page], "counts": counts}
    if pagination is not None:
        body["pagination"] = pagination
    return _ok(body)
