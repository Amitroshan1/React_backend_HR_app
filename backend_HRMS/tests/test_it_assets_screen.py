"""
GET /api/it/assets/screen must show what the Asset Management screen built from localStorage.

``Browser`` repeats AssetsDashboard.jsx (buildAvailableData, buildAssignedData, the filters,
search, sort and header total) on the old endpoints that filled localStorage, using the
browser's own string order from collation_key (checked against Node's localeCompare).
"""
from datetime import datetime

import pytest

from it_perf_support import count_queries, it_headers, make_app, normalize, seed
from website import db
from website.models.it_models import ITAssetUnit, ITInventoryItem, ITInventoryQuantityAssignment
from website.query_utils import collation_key

TABS = ("IT Assets", "Fixed Assets", "Transport Assets", "Infrastructure Assets")
_IT_LINES = ["hardware", "software", "accessories", "consumables", "consumable", "accessory"]


def _seed_assets():
    t = datetime(2025, 3, 1, 9, 0, 0)

    def item(iid, name, category, inv_cat="IT Assets", **kw):
        return ITInventoryItem(
            id=iid, tenant_id=1, inventory_code=f"INV-{iid}", name=name, category=category,
            inventory_category=inv_cat, created_by_admin_id=1, created_at=t, updated_at=t, **kw,
        )

    db.session.add_all([
        item(60, "ThinkPad", "Hardware", hw_type="Laptop", total_quantity=3, available_quantity=2, assigned_quantity=1),
        item(61, "Galaxy", "Hardware", hw_type="Mobile", total_quantity=2, available_quantity=2),
        item(62, "Galaxy", "hardware", hw_type="mobile", total_quantity=1, available_quantity=1),
        item(63, "Éclair pad", "Hardware", hw_type="Tablet", total_quantity=1, available_quantity=1),
        item(64, "_Spare", "Accessories", hw_type="Cable", total_quantity=5, available_quantity=5),
        item(65, "Toner", "Consumables", total_quantity=4, available_quantity=3, assigned_quantity=1),
        item(66, "Loose stock", "Stock", "", total_quantity=2, available_quantity=2),
        item(67, "Desk", "Stock", "Fixed Assets", total_quantity=2, available_quantity=2),
        item(68, "Licence", "Software", total_quantity=2, available_quantity=2),
        item(69, "Headset", "accessory", total_quantity=2, available_quantity=1, assigned_quantity=1),
        item(70, "Router", "Equipment", "", total_quantity=1, available_quantity=1),
        item(71, "ThinkPad", "Hardware", hw_type="Laptop", total_quantity=1, available_quantity=1),
    ])
    db.session.flush()

    def unit(uid, iid, status, **kw):
        return ITAssetUnit(
            id=uid, inventory_item_id=iid, unit_code=kw.pop("unit_code", f"U-{uid}"),
            asset_name=kw.pop("asset_name", "Unit"), category=kw.pop("category", "Hardware"),
            status=status, created_at=t, updated_at=t, **kw,
        )

    db.session.add_all([
        unit(6101, 60, "available", asset_name="ThinkPad", hw_type="Laptop", model="LC-7"),
        unit(6102, 60, "available", asset_name="ThinkPad", hw_type="Laptop", model="—", unit_code="TP-2"),
        unit(6103, 60, "assigned", asset_name="ThinkPad", hw_type="Laptop", brand="Lenovo", model="T14",
             assigned_to_admin_id=2, assigned_at=t),
        unit(6104, 61, "available", asset_name="Galaxy", hw_type="Mobile", imei2="IMEI-2"),
        unit(6105, 61, "Available", asset_name="Galaxy", hw_type="Mobile", imei1="IMEI-1"),
        unit(6106, 64, "assigned", asset_name="USB cable", category="accessories", hw_type="Cable",
             assigned_to_admin_id=3, assigned_at=t),
        unit(6107, 60, "Assigned", asset_name="ThinkPad", assigned_to_admin_id=3, assigned_at=t),
        unit(6108, 65, "assigned", asset_name="Toner pack", category="Consumable", assigned_to_admin_id=2,
             assigned_at=t, brand=""),
        unit(6109, 60, "available", asset_name="ThinkPad", unit_code="61"),
        unit(6110, 60, "daily_out", asset_name="Spare cable", category="Accessories", assigned_to_admin_id=4),
    ])
    db.session.add_all([
        ITInventoryQuantityAssignment(id=6201, inventory_item_id=65, assigned_to_admin_id=3, quantity=3, created_at=t, updated_at=t),
        ITInventoryQuantityAssignment(id=6202, inventory_item_id=69, assigned_to_admin_id=4, quantity=1, created_at=t, updated_at=t),
        ITInventoryQuantityAssignment(id=6203, inventory_item_id=67, assigned_to_admin_id=4, quantity=2, created_at=t, updated_at=t),
    ])
    db.session.commit()


def _client(paging_on):
    app = make_app(extra_config={"API_PAGINATION_V1": paging_on})
    with app.app_context():
        db.create_all()
        seed(n=4)
        _seed_assets()
    return app, app.test_client(), it_headers(app)


@pytest.fixture(scope="module")
def on():
    app, client, headers = _client(True)
    yield client, headers
    with app.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture(scope="module")
def off():
    app, client, headers = _client(False)
    yield client, headers
    with app.app_context():
        db.session.remove()
        db.drop_all()


def _get(ctx, path, **params):
    from urllib.parse import urlencode

    client, headers = ctx
    url = f"{path}?{urlencode(params)}" if params else path
    resp = client.get(url, headers=headers)
    assert resp.status_code == 200, (url, resp.get_json())
    return resp.get_json()


# ── Old browser logic ────────────────────────────────────────────────────────


def _resolve(item):
    explicit = str(item.get("inventory_category") or "").strip()
    cat = str(item.get("category") or "").strip().lower()
    if cat == "vehicle":
        return "Transport Assets"
    if cat == "equipment":
        return "Infrastructure Assets"
    if cat == "stock":
        return explicit if explicit in ("Fixed Assets", "Infrastructure Assets", "Transport Assets") else ""
    if cat in _IT_LINES:
        return explicit if explicit in TABS else "IT Assets"
    return explicit if explicit in TABS else ""


def _norm_cat(c):
    if not c:
        return "Hardware"
    key = str(c).strip().lower()
    mapped = {"software": "Software", "hardware": "Hardware", "accessories": "Accessories"}
    if key in mapped:
        return mapped[key]
    if key.startswith("consumable"):
        return "Consumable"
    return str(c).strip()


def _js_number(v):
    try:
        n = float(str(v).strip()) if str(v).strip() else 0.0
    except ValueError:
        return 0
    return n if n == n and abs(n) != float("inf") else 0


class Browser:
    def __init__(self, ctx):
        self.inventory = _get(ctx, "/api/it/inventory/items")["items"]
        self.units = [
            {
                **u,
                "assetId": u["unitCode"] or u["id"],
                "assetName": u["assetName"] or "",
                "status": u["status"] or "available",
                "category": u["category"] or "Hardware",
            }
            for u in _get(ctx, "/api/it/units")["units"]
        ]
        self.employees = _get(ctx, "/api/it/employees/assigned-assets")["employees"]

    def _available_units(self, item):
        avail = [u for u in self.units if str(u["status"]).lower() == "available"]
        by_id = [u for u in avail if str(u["inventoryId"]) == str(item["id"])]
        if by_id:
            return by_id
        if item["hw_type"]:
            typed = [
                u for u in avail
                if u["assetName"] == item["name"] and str(u["hwType"] or "").lower() == item["hw_type"].lower()
            ]
            if typed:
                return typed
        return [u for u in avail if u["assetName"] == item["name"]]

    @staticmethod
    def _laptop_code(u):
        model = str(u["model"] or "").strip()
        if model and model != "—":
            return model
        code = str(u["assetId"] or "").strip()
        return code if code and code != "—" else ""

    def available(self):
        rows = []
        for a in self.inventory:
            if (_resolve(a) or "IT Assets") != "IT Assets" or _norm_cat(a["category"]) == "Software":
                continue
            if a["availableQuantity"] <= 0:
                continue
            laptop, imei = "", ""
            for u in self._available_units(a):
                laptop = laptop or self._laptop_code(u)
                imei = imei or str(u["imei1"] or "").strip() or str(u["imei2"] or "").strip()
                if laptop and imei:
                    break
            rows.append({
                "id": a["id"], "name": a["name"] or "", "hwType": a["hw_type"] or None,
                "category": _norm_cat(a["category"]), "availableQty": a["availableQuantity"],
                "assignedQty": a["assignedQuantity"], "totalQty": a["totalQuantity"],
                "vendor": a["vendor"] or None, "seats": a["totalQuantity"] or None,
                "laptopCode": laptop, "imei": imei,
            })
        return rows

    def _employee(self, u):
        admin_id = u["assignedTo"]
        emp_id = u["assignedToEmpId"] or str(admin_id)
        name = u["assignedToName"] or "—"
        for e in self.employees:
            if (e["id"] or e["empId"] or "").upper() == emp_id.upper() or str(e["adminId"] or e["id"]) == str(admin_id):
                return e["empId"] or e["id"] or emp_id, e["name"] or name
        return emp_id, name

    def assigned(self):
        rows, seen = [], set()
        for u in self.units:
            if u["status"] != "assigned" or u["assignedTo"] is None or u["id"] in seen:
                continue
            seen.add(u["id"])
            emp_id, emp_name = self._employee(u)
            name = f"{u['brand']}{' ' + u['model'] if u['model'] else ''}" if u["brand"] else (u["assetName"] or "—")
            rows.append({
                "id": u["assetId"], "unitId": u["id"], "name": name, "category": _norm_cat(u["category"]),
                "hwType": u["hwType"] or None, "empId": emp_id, "empName": emp_name,
            })
        for e in self.employees:
            emp_id, emp_name = e["empId"] or e["id"] or "—", e["name"] or "—"
            for a in e["assignedAssets"]:
                category = _norm_cat(a.get("category"))
                if category not in ("Accessories", "Consumable"):
                    continue
                qty = max(1, int(a.get("quantity") or 1))
                base = a.get("name") or "—"
                uid = f"inv-{emp_id}-{category}-{a.get('inventoryId') or a.get('id') or base}-{qty}"
                if uid in seen:
                    continue
                seen.add(uid)
                rows.append({
                    "id": uid, "unitId": uid, "name": f"{base} (x{qty})" if qty > 1 else base,
                    "category": category, "hwType": a.get("hwType") or None,
                    "empId": str(emp_id), "empName": str(emp_name),
                })
        return rows

    @staticmethod
    def _blob(a):
        keys = ("name", "hwType", "category", "id", "unitId", "empId", "empName", "vendor", "version",
                "licenseKey", "laptopCode", "imei")
        return " ".join("" if a.get(k) is None else str(a[k]).lower() for k in keys)

    def screen(self, view, category="ALL", hw="All", q="", order="name-asc"):
        data = self.available() if view == "available" else self.assigned()
        scoped = data if category == "ALL" else [a for a in data if a["category"] == category]
        rows = scoped
        if category != "ALL" and hw != "All":
            rows = [a for a in rows if str(a["hwType"] or "").strip().lower() == hw.strip().lower()]
        tokens = q.strip().lower().split()
        rows = [a for a in rows if all(t in self._blob(a) for t in tokens)]

        import functools

        def cmp(a, b):
            if order in ("name-asc", "name-desc"):
                ka, kb = collation_key(str(a["name"]).lower()), collation_key(str(b["name"]).lower())
                c = (ka > kb) - (ka < kb)
                if order == "name-desc":
                    c = -c
            else:
                na, nb = _js_number(a["id"]), _js_number(b["id"])
                c = (nb > na) - (nb < na) if order == "recent" else (na > nb) - (na < nb)
            if c == 0:
                ia, ib = collation_key(str(a["id"])), collation_key(str(b["id"]))
                c = (ia > ib) - (ia < ib)
            return c

        rows = sorted(rows, key=functools.cmp_to_key(cmp))
        counts = {"ALL": len(data)}
        for a in data:
            counts[a["category"]] = counts.get(a["category"], 0) + 1
        types = {"All": len(scoped)}
        for a in scoped:
            key = str(a["hwType"] or "").strip().lower()
            types[key] = types.get(key, 0) + 1
        if view == "available":
            total = 0
            for a in rows:
                n = sum(1 for u in self.units if str(u["inventoryId"]) == str(a["id"]) or str(u["assetId"]) == str(a["id"]))
                total += n or a["availableQty"]
        else:
            total = len(rows)
        return rows, {"category": counts, "type": types}, total


@pytest.fixture(scope="module")
def browser(on):
    return Browser(on)


_AVAILABLE_KEYS = ("id", "name", "hwType", "category", "availableQty", "assignedQty", "totalQty",
                   "vendor", "seats", "laptopCode", "imei")
_ASSIGNED_KEYS = ("id", "unitId", "name", "category", "hwType", "empId", "empName")

_CASES = [
    {},
    {"order": "name-desc"},
    {"order": "recent"},
    {"order": "oldest"},
    {"category": "Hardware"},
    {"category": "Hardware", "type": "Mobile"},
    {"category": "Hardware", "type": "laptop"},
    {"category": "Accessories"},
    {"category": "Consumable"},
    {"category": "accessory"},
    {"type": "Mobile"},
    {"q": "thinkpad"},
    {"q": "lc-7 laptop"},
    {"q": "imei-1"},
    {"q": "e3"},
    {"q": "x3"},
    {"q": "nothing-matches"},
]


def _case_id(case):
    return "-".join(f"{k}={v}" for k, v in case.items()) or "default"


@pytest.mark.parametrize("case", _CASES, ids=_case_id)
@pytest.mark.parametrize("view", ["available", "assigned"])
def test_screen_matches_browser(on, browser, view, case):
    expected, counts, total = browser.screen(
        view, case.get("category", "ALL"), case.get("type", "All"), case.get("q", ""), case.get("order", "name-asc"),
    )
    body = _get(on, "/api/it/assets/screen", view=view, **case)
    keys = _AVAILABLE_KEYS if view == "available" else _ASSIGNED_KEYS
    assert [{k: r[k] for k in keys} for r in body["rows"]] == [{k: r[k] for k in keys} for r in expected]
    assert body["counts"] == counts
    assert body["totalAssets"] == total


def test_seed_covers_edge_cases(browser):
    available = {a["id"]: a for a in browser.available()}
    assert available[61]["imei"] == "IMEI-1" and available[61]["laptopCode"] == "U-6105"
    assert available[60]["laptopCode"] == "61"  # unit code, newest available unit first
    assert 62 in available and available[62]["laptopCode"] == "U-6105"  # name + type fallback
    assert 66 in available and 67 not in available and 68 not in available and 70 not in available
    assigned = browser.assigned()
    assert any(r["unitId"] == 6106 for r in assigned)  # accessory unit as a unit row
    assert any(r["id"].startswith("inv-") and r["category"] == "Accessories" for r in assigned)
    assert any(r["name"] == "Toner (x3)" for r in assigned)
    assert not any(r["unitId"] == 6107 for r in assigned)  # "Assigned" is not "assigned"
    _, _, total = browser.screen("available", q="imei-1")
    # item 61: two own units plus unit code "61" on another item; item 62 has no units, so its qty
    assert total == 3 + 1


def test_rows_carry_employee_photo_and_no_media(on):
    body = _get(on, "/api/it/assets/screen", view="assigned")
    assert all("empPhoto" in r for r in body["rows"])
    available = _get(on, "/api/it/assets/screen", view="available")
    assert all("photos" not in r for r in available["rows"])


@pytest.mark.parametrize("view", ["available", "assigned"])
def test_pages_add_up(on, view):
    full = [r["id"] for r in _get(on, "/api/it/assets/screen", view=view)["rows"]]
    collected, page = [], 1
    while True:
        body = _get(on, "/api/it/assets/screen", view=view, page=page, per_page=3)
        assert body["pagination"]["total"] == len(full)
        collected += [r["id"] for r in body["rows"]]
        if not body["pagination"]["has_next"]:
            break
        page += 1
    assert collected == full and page > 1


def test_switch_off_ignores_page_but_filters(off):
    full = _get(off, "/api/it/assets/screen", view="available")
    assert "pagination" not in full
    assert normalize(_get(off, "/api/it/assets/screen", view="available", page=1, per_page=1)) == normalize(full)
    searched = _get(off, "/api/it/assets/screen", view="available", q="galaxy")
    assert {r["name"].lower() for r in searched["rows"]} == {"galaxy"}


@pytest.mark.parametrize("params", [{"view": "list"}, {"view": "available", "order": "price"}])
def test_bad_arguments_are_rejected(on, params):
    from urllib.parse import urlencode

    client, headers = on
    assert client.get(f"/api/it/assets/screen?{urlencode(params)}", headers=headers).status_code == 400


@pytest.mark.parametrize("view", ["available", "assigned"])
def test_query_count_does_not_grow_with_rows(view):
    counts = []
    for n in (4, 16):
        app = make_app(itam_flags_on=True, extra_config={"API_PAGINATION_V1": True})
        with app.app_context():
            db.create_all()
            seed(n=n)
            _seed_assets()
            engine = db.engine
        client, headers = app.test_client(), it_headers(app)
        path = f"/api/it/assets/screen?view={view}&page=1&per_page=3"
        client.get(path, headers=headers)
        with count_queries(engine) as statements:
            assert client.get(path, headers=headers).status_code == 200
        counts.append(len(statements))
        with app.app_context():
            db.session.remove()
            db.drop_all()
    assert counts[0] == counts[1], f"{view}: {counts}"


def test_other_tenant_rows_never_show(on):
    rows = _get(on, "/api/it/assets/screen", view="assigned")["rows"]
    assert all(r["empId"] != "IT1" or r["empName"] != "Two IT" for r in rows)
    available = _get(on, "/api/it/assets/screen", view="available")["rows"]
    assert 20 not in [r["id"] for r in available]
