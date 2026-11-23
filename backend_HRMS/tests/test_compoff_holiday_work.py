from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import patch

from website.commands.compoff import (
    _mandatory_holiday_dates,
    _worked_public_holiday,
    _worked_sunday,
)
from website.compoff_utils import holiday_dedupe_key, sunday_dedupe_key, work_gain_dedupe_key


def test_holiday_requires_punch_in_and_out():
    assert _worked_public_holiday(None) is False
    assert _worked_public_holiday(SimpleNamespace(punch_in=datetime(2026, 10, 2, 9), punch_out=None)) is False
    assert _worked_public_holiday(SimpleNamespace(punch_in=None, punch_out=datetime(2026, 10, 2, 18))) is False
    assert _worked_public_holiday(
        SimpleNamespace(punch_in=datetime(2026, 10, 2, 9), punch_out=datetime(2026, 10, 2, 18))
    ) is True


def test_sunday_still_allows_either_punch():
    assert _worked_sunday(SimpleNamespace(punch_in=datetime(2026, 10, 4, 9), punch_out=None)) is True


def test_holiday_on_sunday_uses_sunday_dedupe_key():
    sunday = date(2026, 10, 4)
    friday = date(2026, 10, 2)
    assert sunday.weekday() == 6
    assert work_gain_dedupe_key(7, sunday) == sunday_dedupe_key(7, sunday)
    assert work_gain_dedupe_key(7, friday) == holiday_dedupe_key(7, friday)


def test_mandatory_holidays_skip_optional():
    rows = [
        {"holiday_date": "2026-10-02", "is_optional": False, "holiday_name": "Gandhi Jayanti"},
        {"holiday_date": "2026-10-20", "is_optional": True, "holiday_name": "Optional"},
        {"holiday_date": "2026-09-01", "is_optional": False, "holiday_name": "Outside range"},
    ]
    with patch("website.cache.active_holidays_for_year", lambda tid, year: rows if year == 2026 else []):
        dates = _mandatory_holiday_dates(date(2026, 10, 1), date(2026, 10, 31), tenant_id=1)
    assert date(2026, 10, 2) in dates
    assert date(2026, 10, 20) not in dates
    assert date(2026, 9, 1) not in dates
