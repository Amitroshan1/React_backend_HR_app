from website.holiday_resolver import merge_company_and_overlay, observed_holidays_for_year


COMPANY = [
    {"id": 1, "holiday_name": "DIWALI", "holiday_date": "2026-11-08", "is_optional": False},
    {"id": 2, "holiday_name": "CHRISTMAS DAY", "holiday_date": "2026-12-25", "is_optional": True},
]


def test_merge_skip_removes_company_holiday():
    overlay = [
        {"id": 9, "holiday_name": "DIWALI", "holiday_date": "2026-11-08", "not_observe": True},
    ]
    merged = merge_company_and_overlay(COMPANY, overlay)
    names = {r["holiday_name"] for r in merged if not r.get("not_observe")}
    assert "DIWALI" not in names
    assert "CHRISTMAS DAY" in names


def test_merge_extra_adds_circle_holiday():
    overlay = [
        {"id": 10, "holiday_name": "CLIENT DAY", "holiday_date": "2026-06-01", "not_observe": False},
    ]
    merged = merge_company_and_overlay(COMPANY, overlay)
    extras = [r for r in merged if r.get("source") == "extra"]
    assert extras[0]["holiday_name"] == "CLIENT DAY"


def test_merge_override_replaces_date():
    overlay = [
        {"id": 11, "holiday_name": "DIWALI", "holiday_date": "2026-11-09", "not_observe": False},
    ]
    merged = merge_company_and_overlay(COMPANY, overlay)
    diwali = next(r for r in merged if r["holiday_name"] == "DIWALI")
    assert diwali["holiday_date"] == "2026-11-09"
    assert diwali["source"] == "override"


def test_observed_without_circle_is_company(monkeypatch):
    monkeypatch.setattr(
        "website.cache.active_holidays_for_year",
        lambda tid, year: COMPANY,
    )
    rows = observed_holidays_for_year(1, 2026, "")
    assert {r["holiday_name"] for r in rows} == {"DIWALI", "CHRISTMAS DAY"}
