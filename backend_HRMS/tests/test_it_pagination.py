"""
Opt-in paging, search, sort and summary rows on IT list endpoints (API_PAGINATION_V1).

Without ``page`` (or with the switch off) every endpoint must answer exactly as before.
"""
import json
from pathlib import Path

import pytest

from it_perf_support import LIST_ENDPOINTS, count_queries, it_headers, make_app, normalize, seed
from website import db

SNAPSHOT = Path(__file__).parent / "snapshots" / "it_list_contracts.json"

# (path, list key, id field)
PAGED = (
    ("/api/it/inventory/items", "items", "id"),
    ("/api/it/units", "units", "id"),
    ("/api/it/software/licenses", "licenses", "id"),
    ("/api/it/tickets", "tickets", "id"),
    ("/api/it/return-requests", "requests", "id"),
    ("/api/it/removed-assets", "removed_assets", "id"),
    ("/api/it/deleted-logs", "logs", "id"),
    ("/api/it/office-stock/deployments", "deployments", "id"),
    ("/api/it/employees/assigned-assets", "employees", "adminId"),
    ("/api/it/daily-checkout/available-units", "units", "id"),
)
EXTRAS = "page=1&per_page=2&q=zzz&sort=nope&fields=summary&hw_type=Mobile&priority=high"


def _client(paging_on, n=7, itam_flags_on=False):
    app = make_app(itam_flags_on=itam_flags_on, extra_config={"API_PAGINATION_V1": paging_on})
    with app.app_context():
        db.create_all()
        seed(n=n)
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
    return resp.status_code, resp.get_json()


def _with(path, query):
    return f"{path}{'&' if '?' in path else '?'}{query}"


@pytest.mark.parametrize("itam_flags_on", [False, True], ids=["flags_off", "flags_on"])
def test_switch_on_without_page_matches_snapshot(itam_flags_on):
    expected = json.loads(SNAPSHOT.read_text(encoding="utf-8"))["flags_on" if itam_flags_on else "flags_off"]
    app = make_app(itam_flags_on=itam_flags_on, extra_config={"API_PAGINATION_V1": True})
    with app.app_context():
        db.create_all()
        seed(n=3)
    client, headers = app.test_client(), it_headers(app)
    try:
        for path in LIST_ENDPOINTS:
            resp = client.get(path, headers=headers)
            assert {"status": resp.status_code, "body": normalize(resp.get_json())} == expected[path], path
    finally:
        with app.app_context():
            db.session.remove()
            db.drop_all()


@pytest.mark.parametrize("path,key,_id", PAGED)
def test_switch_off_ignores_every_list_option(off, path, key, _id):
    extras = EXTRAS
    if "daily-checkout" in path:
        # q and hw_type were already filters on this endpoint.
        extras = "page=1&per_page=2&sort=nope&fields=summary"
    plain, extra = _get(off, path), _get(off, _with(path, extras))
    assert (plain[0], normalize(plain[1])) == (extra[0], normalize(extra[1]))


@pytest.mark.parametrize("path,key,id_field", PAGED)
def test_pages_add_up_to_the_full_list(on, path, key, id_field):
    status, full = _get(on, path)
    assert status == 200 and "pagination" not in full
    expected = full[key]
    assert len(expected) > 3, "seed must span several pages"

    collected, page = [], 1
    while True:
        status, body = _get(on, _with(path, f"page={page}&per_page=3"))
        assert status == 200
        meta = body["pagination"]
        assert meta["page"] == page and meta["per_page"] == 3
        assert meta["total"] == len(expected)
        assert meta["pages"] == -(-len(expected) // 3)
        assert meta["has_prev"] == (page > 1)
        collected += body[key]
        if not meta["has_next"]:
            break
        assert len(body[key]) == 3
        page += 1
    if path.endswith("/deployments"):
        # Old order has no tie-break on equal created_at; paging adds id.
        key_of = lambda row: row[id_field]  # noqa: E731
        assert sorted(collected, key=key_of) == sorted(expected, key=key_of)
    else:
        assert collected == expected


@pytest.mark.parametrize("path,key,_id", PAGED)
def test_page_past_the_end_is_empty(on, path, key, _id):
    status, body = _get(on, _with(path, "page=999&per_page=3"))
    assert status == 200 and body[key] == []
    assert body["pagination"]["total"] > 0 and body["pagination"]["has_next"] is False


def test_page_and_per_page_are_clamped(on):
    _, body = _get(on, "/api/it/units?page=0&per_page=1000")
    assert body["pagination"]["page"] == 1 and body["pagination"]["per_page"] == 100
    _, body = _get(on, "/api/it/units?page=abc&per_page=-5")
    assert body["pagination"]["page"] == 1 and body["pagination"]["per_page"] == 50
    _, body = _get(on, "/api/it/units?page=-3&per_page=xyz")
    assert body["pagination"]["page"] == 1 and body["pagination"]["per_page"] == 50


def test_totals_stay_inside_the_tenant(on):
    _, body = _get(on, "/api/it/units?page=1")
    assert "LAP-T2" not in [u["unitCode"] for u in body["units"]]
    assert body["pagination"]["total"] == len(_get(on, "/api/it/units")[1]["units"])


def test_search_matches_any_listed_column_ignoring_case(on):
    _, body = _get(on, "/api/it/units?q=MOBILE&page=1&per_page=100")
    assert body["units"] and all("mobile" in u["unitCode"].lower() for u in body["units"])
    _, body = _get(on, "/api/it/units?q=SN1&page=1")
    assert body["units"] and all(u["serialNumber"].startswith("SN1") for u in body["units"])
    _, body = _get(on, "/api/it/tickets?q=issue 2")
    assert [t["title"] for t in body["tickets"]] == ["Issue 2"]
    _, body = _get(on, "/api/it/employees/assigned-assets?q=emp3@")
    assert [e["email"] for e in body["employees"]] == ["emp3@x.com"]


def test_search_treats_wildcards_as_text(on):
    _, body = _get(on, "/api/it/units?q=%25&page=1")
    assert body["units"] == [] and body["pagination"]["total"] == 0
    _, body = _get(on, "/api/it/deleted-logs?q=_")
    assert body["logs"] == []


def test_new_filters_apply_only_with_switch_on(on, off):
    _, body = _get(on, "/api/it/units?hw_type=mobile")
    assert body["units"] and {u["hwType"] for u in body["units"]} == {"Mobile"}
    _, body = _get(on, "/api/it/tickets?priority=low")
    assert body["tickets"] == []
    filtered, plain = _get(off, "/api/it/units?hw_type=mobile"), _get(off, "/api/it/units")
    assert (filtered[0], normalize(filtered[1])) == (plain[0], normalize(plain[1]))


def test_sort_by_allowed_column_with_id_tie_break(on):
    _, body = _get(on, "/api/it/units?sort=unit_code&page=1&per_page=100")
    codes = [u["unitCode"] for u in body["units"]]
    assert codes == sorted(codes)
    _, body = _get(on, "/api/it/units?sort=-unit_code&page=1&per_page=100")
    assert [u["unitCode"] for u in body["units"]] == sorted(codes, reverse=True)
    _, body = _get(on, "/api/it/tickets?sort=created_at")
    stamps = [t["created_at"] for t in body["tickets"]]
    assert stamps == sorted(stamps)


def test_unknown_sort_is_rejected(on):
    status, body = _get(on, "/api/it/units?sort=password")
    assert status == 400 and "sort must be one of" in body["message"]


@pytest.mark.parametrize(
    "path,key,dropped",
    [
        ("/api/it/units", "units", {"photos", "assignmentPhotos"}),
        ("/api/it/inventory/items", "items", {"photos", "receipts"}),
        ("/api/it/return-requests", "requests", {"photos"}),
        ("/api/it/removed-assets", "removed_assets", {"photos"}),
        ("/api/it/daily-checkout/available-units", "units", {"photos", "assignmentPhotos"}),
    ],
)
def test_summary_rows_drop_only_media(on, path, key, dropped):
    _, full = _get(on, path)
    _, light = _get(on, _with(path, "fields=summary"))
    assert len(light[key]) == len(full[key])
    for big, small in zip(full[key], light[key]):
        assert dropped <= set(big)
        assert not dropped & set(small)
        assert {k: v for k, v in big.items() if k not in dropped} == small


def test_unknown_employee_filter_still_returns_pagination(on):
    _, body = _get(on, "/api/it/return-requests?emp_id=NOPE&page=2")
    assert body["requests"] == [] and body["pagination"]["total"] == 0


def test_option_endpoints_return_small_rows(on):
    _, body = _get(on, "/api/it/units/options?q=mobile&limit=2")
    assert len(body["options"]) == 2
    assert set(body["options"][0]) == {"id", "unitCode", "assetName", "hwType", "serialNumber", "status"}
    _, body = _get(on, "/api/it/inventory/items/options?q=lap")
    assert [o["name"] for o in body["options"]] == ["Laptop"]
    _, body = _get(on, "/api/it/employees/options?q=emp 2")
    assert body["options"] == [{"adminId": 2, "empId": "E2", "name": "Emp 2", "email": "emp2@x.com"}]
    _, body = _get(on, "/api/it/employees/options?q=two it")
    assert body["options"] == []


@pytest.mark.parametrize("path,key,_id", PAGED)
def test_paged_query_count_does_not_grow_with_rows(path, key, _id):
    counts = []
    for n in (4, 16):
        app, client, headers = _client(True, n=n, itam_flags_on=True)
        paged = _with(path, "page=1&per_page=3")
        client.get(paged, headers=headers)
        with app.app_context():
            engine = db.engine
        with count_queries(engine) as statements:
            assert client.get(paged, headers=headers).status_code == 200
        counts.append(len(statements))
        with app.app_context():
            db.session.remove()
            db.drop_all()
    assert counts[0] == counts[1], f"{path}: {counts}"
