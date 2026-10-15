"""
Server lists for the inventory screens must show what the browser showed from localStorage.

The ``_browser_*`` helpers repeat the old frontend code (inventoryCategories.js, Data.js
mappers, InventoryDashboard readLiveCounts, NotWorking, InRepair, RemovedAssets,
RemovedITAssets) on the old list endpoints, and the new endpoints are compared with them.
"""
from datetime import datetime

import pytest

from it_perf_support import count_queries, it_headers, make_app, normalize, seed
from website import db
from website.models.it_models import ITAssetUnit, ITDeletedAssetLog, ITInventoryItem, ITRemovedAsset

TABS = ("IT Assets", "Office Assets", "Transport Assets", "Infrastructure Assets")
CHIPS = ("All", "Hardware", "Accessories", "Consumables", "Stock", "Vehicle", "Equipment")


def _seed_screens():
    """Edge cases on top of seed(): odd statuses, qty lines, stock tags, logs without a catalog row."""
    t = datetime(2025, 2, 1, 9, 0, 0)

    def item(iid, name, category, inv_cat, **kw):
        return ITInventoryItem(
            id=iid, tenant_id=1, inventory_code=f"INV-{iid}", name=name, category=category,
            inventory_category=inv_cat, created_by_admin_id=1, created_at=t, updated_at=t, **kw,
        )

    db.session.add_all([
        item(30, "Keyboard", "Accessories", "IT Assets", total_quantity=9, not_working_quantity=3, repair_quantity=2),
        item(31, "Pens", "Consumable", "Office Assets", total_quantity=5, not_working_quantity=1, repair_quantity=2),
        item(32, "Desks", "Stock", "Office Assets", total_quantity=8, not_working_quantity=2, repair_quantity=1),
        item(33, "Lost stock", "Stock", "IT Assets", total_quantity=4, not_working_quantity=5, repair_quantity=1),
        item(34, "UPS", "Equipment", "", total_quantity=3, repair_quantity=1),
        item(35, "Toner", "Consumables", "IT Assets", total_quantity=6, not_working_quantity=2),
        item(36, "Docking", "Hardware", "IT Assets", total_quantity=4, repair_quantity=3),
        item(37, "Licence pack", "Software", "IT Assets", total_quantity=7, not_working_quantity=1),
    ])
    db.session.flush()

    def unit(uid, iid, status, category="Hardware", **kw):
        return ITAssetUnit(
            id=uid, inventory_item_id=iid, unit_code=f"U-{uid}", asset_name=kw.pop("asset_name", f"Unit {uid}"),
            category=category, status=status, created_at=t, updated_at=t, **kw,
        )

    db.session.add_all([
        unit(5001, 10, "notWorking", brand="Lenovo", serial_number="NW-1"),
        unit(5002, 10, "not-working", category="", brand="HP", serial_number="NW-2"),
        unit(5003, 10, "NotWorking", brand="Acer"),
        unit(5004, 14, "not-working", category="Vehicle", serial_number="VAN-NW"),
        unit(5005, 20, "not-working"),
        unit(5006, 36, "repair", brand="Dell", serial_number="RP-1", repair_date=t),
        unit(5007, 30, "repair", category="Accessories"),
        unit(5008, 14, "Repair", category="Vehicle"),
        unit(5009, 34, "repair", category="Equipment"),
        unit(5010, 30, "notWorking", category="consumables-x"),
    ])

    def log(lid, **kw):
        return ITDeletedAssetLog(
            id=lid, tenant_id=1, delete_code=f"DEL-X{lid}", asset_name=kw.pop("asset_name", f"Log {lid}"),
            deleted_at=kw.pop("deleted_at", t), **kw,
        )

    db.session.add_all([
        log(6001, inventory_item_id=32, category="Stock"),
        log(6002, category="Stock", asset_name="Old desk"),
        log(6003, category="Vehicle"),
        log(6004, category="Equipment"),
        log(6005, category="weird", asset_unit_id=5004),
        log(6006, category=None),
        log(6007, category="weird"),
        log(6008, inventory_item_id=33, category="Hardware"),
        log(6009, inventory_item_id=999, category="Accessories", serial_number="ZZ-9"),
    ])
    db.session.add_all([
        ITRemovedAsset(id=7001, tenant_id=1, removed_code="RIT-S", name="Office seat", category="Software", removed_at=t),
        ITRemovedAsset(id=7002, tenant_id=1, removed_code="RIT-N", name="No category", category=None, removed_at=t),
        ITRemovedAsset(id=7003, tenant_id=1, removed_code="RIT-A", name="Headset", category="Accessories", removed_at=t),
    ])
    db.session.add_all([
        item(40, "Galaxy", "Hardware", "IT Assets", hw_type="Mobile", total_quantity=5, available_quantity=3, assigned_quantity=2),
        item(41, "iPad", "Hardware", "IT Assets", hw_type="Tablet", total_quantity=2, assigned_quantity=2),
        item(42, "Galaxy", "Hardware", "IT Assets", hw_type="mobile", total_quantity=1, available_quantity=1),
        item(43, "Pixel", "Hardware", "IT Assets", hw_type="Mobile"),
        item(44, "ThinkPad", "Hardware", "IT Assets", hw_type="Laptop", total_quantity=3, available_quantity=1, assigned_quantity=2),
        item(45, "Cables", "Accessory", "IT Assets", hw_type="cable", total_quantity=4, available_quantity=4),
        item(46, "Shelves", "Stock", "Office Assets", total_quantity=2, assigned_quantity=2),
    ])
    db.session.flush()
    db.session.add_all([
        unit(5101, 40, "available", asset_name="Galaxy", hw_type="Mobile", project_code="PRJ-A", brand="Samsung", make="S23", model="M1"),
        unit(5102, 40, "assigned", asset_name="Galaxy", hw_type="Mobile", make="Legacy-B"),
        unit(5103, 41, "assigned", asset_name="iPad", hw_type="Tablet", project_code="prj-a"),
        unit(5104, 41, "assigned", asset_name="iPad", hw_type="Tablet", project_code=" PRJ-C ", brand="Apple"),
        unit(5105, 44, "assigned", asset_name="ThinkPad", hw_type="Laptop", brand="Lenovo", model="LC-1"),
    ])
    db.session.commit()


def _client(paging_on):
    app = make_app(extra_config={"API_PAGINATION_V1": paging_on})
    with app.app_context():
        db.create_all()
        seed(n=4)
        _seed_screens()
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


def _get(ctx, path):
    client, headers = ctx
    resp = client.get(path, headers=headers)
    assert resp.status_code == 200, (path, resp.get_json())
    return resp.get_json()


def _q(path, **params):
    from urllib.parse import urlencode

    return f"{path}?{urlencode(params)}"


# ── Old browser logic ────────────────────────────────────────────────────────

_IT_LINES = ["hardware", "software", "accessories", "consumables", "consumable", "accessory"]


def _resolve(item):
    explicit = str(item.get("inventoryCategory") or item.get("inventory_category") or "").strip()
    cat = str(item.get("category") or "").strip().lower()
    if cat == "vehicle":
        return "Transport Assets"
    if cat == "equipment":
        return "Infrastructure Assets"
    if cat == "stock":
        return explicit if explicit in ("Office Assets", "Infrastructure Assets", "Transport Assets") else ""
    if cat in _IT_LINES:
        return explicit if explicit in TABS else "IT Assets"
    return explicit if explicit in TABS else ""


class Browser:
    def __init__(self, ctx):
        inventory = []
        for i in _get(ctx, "/api/it/inventory/items")["items"]:
            row = {
                "id": i["id"], "name": i["name"], "category": i["category"],
                "inventoryCategory": i["inventory_category"],
                "totalQuantity": i["totalQuantity"], "notWorkingQuantity": i["notWorkingQuantity"],
                "repairQuantity": i["repairQuantity"], "availableQuantity": i["availableQuantity"],
                "assignedQuantity": i["assignedQuantity"], "hwType": i["hw_type"] or None,
            }
            row["inventoryCategory"] = _resolve(row)
            inventory.append(row)
        self.inventory = inventory
        self.units = [
            {
                "id": u["id"], "assetId": u["unitCode"] or u["id"], "inventoryId": u["inventoryId"],
                "assetName": u["assetName"] or "", "category": u["category"] or "Hardware",
                "brand": u["brand"] or "", "serialNumber": u["serialNumber"] or "",
                "status": u["status"] or "available", "hwType": u["hwType"] or None,
                "make": u["make"] or "", "model": u["model"] or "", "projectCode": u["projectCode"] or "",
            }
            for u in _get(ctx, "/api/it/units")["units"]
        ]
        self.deleted = []
        for d in _get(ctx, "/api/it/deleted-logs")["logs"]:
            inv_row = self._row(d["inventoryId"]) if d["inventoryId"] is not None else None
            self.deleted.append({
                "deletedId": d["deleteCode"], "assetUnitId": d["assetUnitId"], "inventoryId": d["inventoryId"],
                "inventoryCategory": (_resolve(inv_row) if inv_row else _resolve({"category": d["category"]})) or None,
                "assetName": d["assetName"] or "", "brand": d["assetName"] or "",
                "category": d["category"] or "Hardware", "serialNumber": d["serialNumber"] or "",
            })
        self.removed_it = [
            {"id": r["id"], "name": r["name"] or "", "category": r["category"] or "Hardware", "owner": r["ownerName"] or "—"}
            for r in _get(ctx, "/api/it/removed-assets")["removed_assets"]
        ]

    def _row(self, inv_id):
        return next((i for i in self.inventory if str(i["id"]) == str(inv_id)), None)

    def _unit_row(self, unit):
        return self._row(unit["inventoryId"]) or self._row(unit["assetId"])

    def _unit_in_tab(self, unit, tab):
        row = self._unit_row(unit)
        return bool(row) and _resolve(row) == tab

    def _log_in_tab(self, rec, tab):
        inv_id = rec["inventoryId"]
        if inv_id is not None and inv_id != "":
            row = self._row(inv_id)
            if row:
                return _resolve(row) == tab
        explicit = str(rec["inventoryCategory"] or "").strip()
        if explicit in TABS:
            return explicit == tab
        if rec["assetUnitId"] is not None:
            unit = next((u for u in self.units if str(u["id"]) == str(rec["assetUnitId"])), None)
            if unit:
                row = self._unit_row(unit)
                if row:
                    return _resolve(row) == tab
                from_unit = _resolve({"category": unit["category"]})
                if from_unit:
                    return from_unit == tab
        cat = str(rec["category"] or "").strip().lower()
        if cat == "vehicle":
            return tab == "Transport Assets"
        if cat == "equipment":
            return tab == "Infrastructure Assets"
        if cat == "stock":
            return tab == "Office Assets"
        return tab == "IT Assets" and cat in _IT_LINES

    def cards(self, tab):
        items = [i for i in self.inventory if _resolve(i) == tab and str(i["category"] or "").strip().lower() != "software"]
        return {
            "total": sum(i["totalQuantity"] for i in items),
            "not-working": sum(i["notWorkingQuantity"] for i in items),
            "in-repair": sum(i["repairQuantity"] for i in items),
            "removed-assets": sum(1 for d in self.deleted if self._log_in_tab(d, tab)),
            "removed-it": len(self.removed_it) if tab == "IT Assets" else 0,
        }

    @staticmethod
    def _chip(category):
        raw = str(category or "").strip()
        if not raw:
            return "Hardware"
        return "Consumables" if raw.lower().startswith("consumable") else raw

    def not_working(self, tab):
        units = [
            ("unit", u["id"], self._chip(u["category"]), (u["brand"], u["assetName"], u["serialNumber"]))
            for u in self.units
            if str(u["status"]).strip().lower() in ("notworking", "not-working") and self._unit_in_tab(u, tab)
        ]
        qty = [
            ("qty", i["id"], self._chip(i["category"]), (i["name"], i["name"], ""), i["notWorkingQuantity"], None)
            for i in self.inventory
            if str(i["category"] or "").lower() in ("accessories", "consumables", "stock")
            and _resolve(i) == tab and i["notWorkingQuantity"] > 0
        ]
        return units + qty

    def repair(self, tab):
        units = [u for u in self.units if u["status"] == "repair" and self._unit_in_tab(u, tab)]
        rows = [("unit", u["id"], self._chip(u["category"]), (u["brand"], u["assetName"], u["serialNumber"])) for u in units]
        for i in self.inventory:
            if _resolve(i) != tab or i["repairQuantity"] <= 0:
                continue
            qty = i["repairQuantity"]
            if str(i["category"] or "").lower() not in ("accessories", "consumables", "stock"):
                qty -= sum(1 for u in units if str(u["inventoryId"]) == str(i["id"]))
            for n in range(1, qty + 1):
                rows.append(("qty", i["id"], self._chip(i["category"]), (i["name"], i["name"], ""), qty, n))
        return rows

    def dead(self, tab):
        return [d for d in self.deleted if self._log_in_tab(d, tab)]

    # InventoryDashboard getMappedInventory / OverviewPage / TotalAssetsPage

    def _units_for(self, item):
        by_id = [u for u in self.units if str(u["inventoryId"]) == str(item["id"])]
        if by_id:
            return by_id
        if item["hwType"]:
            typed = [
                u for u in self.units
                if u["assetName"] == item["name"] and (u["hwType"] or "").lower() == item["hwType"].lower()
            ]
            if typed:
                return typed
        return [u for u in self.units if u["assetName"] == item["name"]]

    def mapped(self, tab):
        rows = []
        for i in self.inventory:
            category = i["category"] or "—"
            if category.strip().lower() == "software" or _resolve(i) != tab or i["totalQuantity"] <= 0:
                continue
            units = self._units_for(i)
            rows.append({**i, "category": category, "first": units[0] if units else None})
        return rows

    @staticmethod
    def _chip_ok(category, chip):
        if not chip or chip == "All":
            return True
        c, f = str(category or "").strip().lower(), chip.strip().lower()
        if f == "consumables":
            return c in ("consumables", "consumable")
        if f == "accessories":
            return c in ("accessories", "accessory")
        return c == f

    @staticmethod
    def _hw_ok(row, hw):
        return not hw or hw == "All" or str(row["hwType"] or "").strip().lower() == hw.lower()

    def _project_ok(self, row, project):
        needle = project.strip().lower()
        for u in self._units_for(row):
            code, legacy = u["projectCode"].strip().lower(), u["make"].strip().lower()
            if code == needle or (not code and legacy == needle):
                return True
        return False

    def _projects(self, base, chip, hw):
        if chip != "Hardware" or str(hw or "").strip() not in ("Mobile", "Tablet"):
            return ["All"]
        names = set()
        for row in base:
            if not (self._chip_ok(row["category"], "Hardware") and self._hw_ok(row, hw)):
                continue
            if str(row["hwType"] or "").strip() not in ("Mobile", "Tablet"):
                continue
            for u in self._units_for(row):
                code = u["projectCode"].strip()
                if code or u["make"].strip():
                    names.add(code or u["make"].strip())
        return ["All", *sorted(names, key=str.casefold)]

    def _qty_by_category(self, base):
        def total(chip):
            return sum(r["totalQuantity"] for r in base if self._chip_ok(r["category"], chip))
        return {k: total(k) for k in ("All", "Hardware", "Software", "Accessories", "Consumables")}

    def _qty_by_hw(self, base, chip):
        counts, keys = {"All": 0}, {}
        for r in base:
            if not self._chip_ok(r["category"], chip) or r["totalQuantity"] <= 0:
                continue
            counts["All"] += r["totalQuantity"]
            raw = str(r["hwType"] or "").strip() or "Other"
            key = keys.setdefault(raw.lower(), raw)
            counts[key] = counts.get(key, 0) + r["totalQuantity"]
        return counts

    @staticmethod
    def _status_counts(rows):
        return {
            "All": len(rows),
            "Available": sum(1 for r in rows if r["availableQuantity"] > 0),
            "Assigned": sum(1 for r in rows if r["assignedQuantity"] > 0),
        }

    @staticmethod
    def _status_ok(row, status):
        if status == "Available":
            return row["availableQuantity"] > 0
        if status == "Assigned":
            return row["assignedQuantity"] > 0
        return True

    def overview(self, tab, category="All", hw="All", project="All", q="", status="All"):
        base = self.mapped(tab)
        if tab != "IT Assets":
            return [r for r in base if self._status_ok(r, status)], {"status": self._status_counts(base)}, ["All"]
        projects = self._projects(base, category, hw)
        if project not in projects:
            project = "All"
        rows = [r for r in base if self._chip_ok(r["category"], category)]
        if category in ("Hardware", "Accessories", "Consumables"):
            rows = [r for r in rows if self._hw_ok(r, hw)]
        if category == "Hardware" and str(hw).strip() in ("Mobile", "Tablet") and project != "All":
            rows = [r for r in rows if self._project_ok(r, project)]
        needle = q.strip().lower()
        if needle:
            rows = [
                r for r in rows
                if needle in r["name"].lower() or needle in (r["hwType"] or "").lower() or needle in r["category"].lower()
            ]
        counts = {
            "category": self._qty_by_category(base),
            "subType": self._qty_by_hw(base, category),
            "status": self._status_counts(rows),
        }
        return [r for r in rows if self._status_ok(r, status)], counts, projects

    def total(self, tab, category="All", hw="All"):
        base = self.mapped(tab)
        if tab != "IT Assets":
            return base, {}
        rows = [r for r in base if self._chip_ok(r["category"], category)]
        if category in ("Hardware", "Accessories", "Consumables"):
            rows = [r for r in rows if self._hw_ok(r, hw)]
        return rows, {"category": self._qty_by_category(base), "subType": self._qty_by_hw(base, category)}


def _status_key(row):
    if row["kind"] == "unit":
        return ("unit", row["unit"]["id"])
    return ("qty", row["item"]["id"], row["quantity"], row["line"])


def _browser_key(row):
    return row[:2] if row[0] == "unit" else ("qty", row[1], row[4], row[5])


# ── Tests ────────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def browser(on):
    return Browser(on)


@pytest.mark.parametrize("tab", TABS)
def test_summary_matches_browser_cards(on, browser, tab):
    assert _get(on, _q("/api/it/inventory/summary", inventory_category=tab))["summary"] == browser.cards(tab)


def test_seed_covers_every_card(browser):
    cards = {tab: browser.cards(tab) for tab in TABS}
    for key in ("total", "not-working", "in-repair", "removed-assets"):
        assert sum(1 for tab in TABS if cards[tab][key]) >= 2, key
    assert cards["IT Assets"]["removed-it"] > 0


@pytest.mark.parametrize("status", ["not_working", "repair"])
@pytest.mark.parametrize("tab", TABS)
def test_status_rows_match_browser(on, browser, status, tab):
    expected = browser.not_working(tab) if status == "not_working" else browser.repair(tab)
    body = _get(on, _q("/api/it/inventory/status-rows", status=status, inventory_category=tab))
    assert [_status_key(r) for r in body["rows"]] == [_browser_key(r) for r in expected]
    for chip in CHIPS[1:]:
        assert body["counts"].get(chip, 0) == sum(1 for r in expected if r[2] == chip), chip
    for chip in CHIPS[1:]:
        chip_body = _get(on, _q("/api/it/inventory/status-rows", status=status, inventory_category=tab, category=chip))
        assert [_status_key(r) for r in chip_body["rows"]] == [_browser_key(r) for r in expected if r[2] == chip]


def test_status_rows_cover_edge_cases(browser):
    assert len(browser.not_working("IT Assets")) >= 6
    assert any(r[0] == "qty" for r in browser.repair("IT Assets"))
    assert browser.repair("Office Assets") and browser.not_working("Transport Assets")


def test_status_rows_search_matches_browser(on, browser):
    expected = [r for r in browser.not_working("IT Assets") if any("nw-" in (v or "").lower() for v in r[3])]
    body = _get(on, _q("/api/it/inventory/status-rows", status="not_working", inventory_category="IT Assets", q="NW-"))
    assert [_status_key(r) for r in body["rows"]] == [_browser_key(r) for r in expected]
    assert expected


@pytest.mark.parametrize("status", ["not_working", "repair"])
def test_status_rows_pages_add_up(on, status):
    path = _q("/api/it/inventory/status-rows", status=status, inventory_category="IT Assets")
    full = [_status_key(r) for r in _get(on, path)["rows"]]
    collected, page = [], 1
    while True:
        body = _get(on, f"{path}&page={page}&per_page=2")
        assert body["pagination"]["total"] == len(full)
        collected += [_status_key(r) for r in body["rows"]]
        if not body["pagination"]["has_next"]:
            break
        page += 1
    assert collected == full and page > 1


def test_status_rows_unit_payload_is_a_summary_unit(on):
    body = _get(on, _q("/api/it/inventory/status-rows", status="repair", inventory_category="IT Assets"))
    unit = next(r["unit"] for r in body["rows"] if r["kind"] == "unit" and r["unit"]["id"] == 5006)
    assert unit["serialNumber"] == "RP-1" and unit["status"] == "repair" and unit["repairDate"]
    assert "photos" not in unit


@pytest.mark.parametrize("tab", TABS)
def test_dead_assets_match_browser(on, browser, tab):
    expected = browser.dead(tab)
    body = _get(on, _q("/api/it/inventory/dead-assets", inventory_category=tab))
    assert [d["deleteCode"] for d in body["logs"]] == [d["deletedId"] for d in expected]
    for chip in CHIPS[1:]:
        assert body["counts"].get(chip, 0) == sum(1 for d in expected if d["category"] == chip)
        chip_body = _get(on, _q("/api/it/inventory/dead-assets", inventory_category=tab, category=chip))
        assert [d["deleteCode"] for d in chip_body["logs"]] == [d["deletedId"] for d in expected if d["category"] == chip]


def test_dead_assets_search(on, browser):
    expected = [d for d in browser.dead("IT Assets") if "zz-9" in d["serialNumber"].lower()]
    body = _get(on, _q("/api/it/inventory/dead-assets", inventory_category="IT Assets", q="zz-9"))
    assert [d["deleteCode"] for d in body["logs"]] == [d["deletedId"] for d in expected] and expected


def test_removed_it_matches_browser(on, browser):
    expected = [a for a in browser.removed_it if a["category"].lower() != "software"]
    body = _get(on, "/api/it/inventory/removed-it")
    assert [r["id"] for r in body["removed_assets"]] == [a["id"] for a in expected]
    for chip in ("Hardware", "Accessories", "Consumables"):
        assert body["counts"].get(chip, 0) == sum(1 for a in expected if a["category"] == chip)
        chip_body = _get(on, _q("/api/it/inventory/removed-it", category=chip))
        assert [r["id"] for r in chip_body["removed_assets"]] == [a["id"] for a in expected if a["category"] == chip]
    assert "photos" not in body["removed_assets"][0]


@pytest.mark.parametrize("needle", ["headset", "7002", "emp 2"])
def test_removed_it_search_matches_browser(on, browser, needle):
    expected = [
        a for a in browser.removed_it
        if a["category"].lower() != "software"
        and any(needle in str(v).lower() for v in (a["name"], a["id"], a["owner"]))
    ]
    body = _get(on, _q("/api/it/inventory/removed-it", q=needle))
    assert [r["id"] for r in body["removed_assets"]] == [a["id"] for a in expected] and expected


def _overview(ctx, **params):
    return _get(ctx, _q("/api/it/inventory/overview", **params))


def _first_unit_view(row):
    first = row["first"]
    return None if first is None else (first["brand"], first["make"], first["model"])


def _server_first_unit(item):
    first = item["firstUnit"]
    return None if first is None else (first["brand"] or "", first["make"] or "", first["model"] or "")


_OVERVIEW_CASES = [
    {},
    {"status": "Available"},
    {"status": "Assigned"},
    {"category": "Hardware"},
    {"category": "Accessories"},
    {"category": "Accessories", "hw_type": "Cable"},
    {"category": "Consumables", "status": "Available"},
    {"category": "Hardware", "hw_type": "Mobile"},
    {"category": "Hardware", "hw_type": "Mobile", "project": "PRJ-A"},
    {"category": "Hardware", "hw_type": "Mobile", "project": "Legacy-B"},
    {"category": "Hardware", "hw_type": "Tablet", "project": "prj-a"},
    {"category": "Hardware", "hw_type": "Tablet", "project": "PRJ-C"},
    {"category": "Hardware", "hw_type": "Tablet", "project": "Unknown"},
    {"category": "All", "hw_type": "Mobile"},
    {"q": "galaxy"},
    {"q": "MOBILE", "status": "Assigned"},
    {"q": "accessor"},
]


@pytest.mark.parametrize("case", _OVERVIEW_CASES, ids=lambda c: "-".join(f"{k}={v}" for k, v in c.items()) or "all")
@pytest.mark.parametrize("tab", TABS)
def test_overview_matches_browser(on, browser, tab, case):
    expected, counts, projects = browser.overview(
        tab,
        category=case.get("category", "All"),
        hw=case.get("hw_type", "All"),
        project=case.get("project", "All"),
        q=case.get("q", ""),
        status=case.get("status", "All"),
    )
    body = _overview(on, inventory_category=tab, **case)
    assert [i["id"] for i in body["items"]] == [r["id"] for r in expected]
    assert [_server_first_unit(i) for i in body["items"]] == [_first_unit_view(r) for r in expected]
    assert body["counts"] == counts
    assert body["projects"] == projects


@pytest.mark.parametrize(
    "case",
    [{}, {"category": "Hardware"}, {"category": "Hardware", "hw_type": "laptop"}, {"category": "Accessories"}],
    ids=lambda c: "-".join(f"{k}={v}" for k, v in c.items()) or "all",
)
@pytest.mark.parametrize("tab", TABS)
def test_total_assets_match_browser(on, browser, tab, case):
    expected, counts = browser.total(tab, case.get("category", "All"), case.get("hw_type", "All"))
    body = _overview(on, inventory_category=tab, view="total", **case)
    assert [i["id"] for i in body["items"]] == [r["id"] for r in expected]
    assert body["counts"] == counts


def test_overview_covers_edge_cases(browser):
    rows = {r["id"]: r for r in browser.mapped("IT Assets")}
    assert rows[42]["first"]["id"] == 5102  # no own units: matched by name and hardware type
    assert 43 not in rows and 37 not in rows  # zero quantity, software
    assert browser.overview("IT Assets", "Hardware", "Tablet")[2] == ["All", "prj-a", "PRJ-C"]
    assert browser.overview("IT Assets", "Hardware", "Mobile", "Legacy-B")[0]


def test_overview_rows_are_summary_items(on):
    item = _overview(on, inventory_category="IT Assets")["items"][0]
    assert "photos" not in item and "receipts" not in item and "firstUnit" in item


def test_overview_pages_add_up(on):
    full = [i["id"] for i in _overview(on, inventory_category="IT Assets")["items"]]
    collected, page = [], 1
    while True:
        body = _overview(on, inventory_category="IT Assets", page=page, per_page=2)
        assert body["pagination"]["total"] == len(full)
        collected += [i["id"] for i in body["items"]]
        if not body["pagination"]["has_next"]:
            break
        page += 1
    assert collected == full and page > 1


def test_overview_switch_off_ignores_page_but_filters(off):
    full = _overview(off, inventory_category="IT Assets")
    assert "pagination" not in full
    paged = _overview(off, inventory_category="IT Assets", page=1, per_page=1)
    assert normalize(paged) == normalize(full)
    searched = _overview(off, inventory_category="IT Assets", q="galaxy")
    assert {i["name"] for i in searched["items"]} == {"Galaxy"}


@pytest.mark.parametrize(
    "path",
    [
        _q("/api/it/inventory/status-rows", status="not_working", inventory_category="IT Assets"),
        _q("/api/it/inventory/dead-assets", inventory_category="IT Assets"),
        "/api/it/inventory/removed-it",
    ],
)
def test_switch_off_ignores_page_and_search(off, path):
    full = _get(off, path)
    assert "pagination" not in full
    extra = _get(off, f"{path}{'&' if '?' in path else '?'}page=1&per_page=1&q=zzz")
    assert normalize(extra) == normalize(full)


@pytest.mark.parametrize(
    "path",
    [
        "/api/it/inventory/summary",
        _q("/api/it/inventory/summary", inventory_category="Nope"),
        _q("/api/it/inventory/status-rows", inventory_category="IT Assets"),
        _q("/api/it/inventory/status-rows", status="dead", inventory_category="IT Assets"),
        "/api/it/inventory/dead-assets",
        "/api/it/inventory/overview",
        _q("/api/it/inventory/overview", inventory_category="IT Assets", view="list"),
        _q("/api/it/inventory/overview", inventory_category="IT Assets", status="Broken"),
    ],
)
def test_bad_arguments_are_rejected(on, path):
    client, headers = on
    assert client.get(path, headers=headers).status_code == 400


@pytest.mark.parametrize(
    "path",
    [
        _q("/api/it/inventory/summary", inventory_category="IT Assets"),
        _q("/api/it/inventory/status-rows", status="not_working", inventory_category="IT Assets"),
        _q("/api/it/inventory/status-rows", status="repair", inventory_category="IT Assets"),
        _q("/api/it/inventory/dead-assets", inventory_category="IT Assets"),
        "/api/it/inventory/removed-it",
        _q("/api/it/inventory/overview", inventory_category="IT Assets"),
        _q("/api/it/inventory/overview", inventory_category="IT Assets", category="Hardware", hw_type="Mobile", project="PRJ-A"),
        _q("/api/it/inventory/overview", inventory_category="IT Assets", view="total"),
    ],
)
def test_query_count_does_not_grow_with_rows(path):
    counts = []
    for n in (4, 16):
        app = make_app(itam_flags_on=True, extra_config={"API_PAGINATION_V1": True})
        with app.app_context():
            db.create_all()
            seed(n=n)
            _seed_screens()
            engine = db.engine
        client, headers = app.test_client(), it_headers(app)
        paged = f"{path}{'&' if '?' in path else '?'}page=1&per_page=3"
        client.get(paged, headers=headers)
        with count_queries(engine) as statements:
            assert client.get(paged, headers=headers).status_code == 200
        counts.append(len(statements))
        with app.app_context():
            db.session.remove()
            db.drop_all()
    assert counts[0] == counts[1], f"{path}: {counts}"


def test_other_tenant_rows_never_show(on):
    body = _get(on, _q("/api/it/inventory/status-rows", status="not_working", inventory_category="IT Assets"))
    assert 5005 not in [r["unit"]["id"] for r in body["rows"] if r["kind"] == "unit"]
    dead = _get(on, _q("/api/it/inventory/dead-assets", inventory_category="IT Assets"))
    assert "DEL-T2" not in [d["deleteCode"] for d in dead["logs"]]
    removed = _get(on, "/api/it/inventory/removed-it")
    assert "RIT-T2" not in [r["removedCode"] for r in removed["removed_assets"]]
