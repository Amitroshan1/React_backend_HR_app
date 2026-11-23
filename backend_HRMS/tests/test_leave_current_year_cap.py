from datetime import date

from website.leave_settings import (
    current_leave_year_end,
    leave_beyond_current_year_message,
)


def test_year_end_moves_with_today():
    assert current_leave_year_end(date(2026, 11, 6)) == date(2026, 12, 31)
    assert current_leave_year_end(date(2027, 1, 1)) == date(2027, 12, 31)


def test_current_year_dates_allowed():
    today = date(2026, 11, 6)
    assert leave_beyond_current_year_message(today, today, today=today) is None
    assert leave_beyond_current_year_message(today, date(2026, 12, 31), today=today) is None


def test_next_year_and_far_future_blocked():
    today = date(2026, 11, 6)
    msg = leave_beyond_current_year_message(date(2027, 1, 1), date(2027, 1, 2), today=today)
    assert msg is not None
    assert "2026" in msg
    far = leave_beyond_current_year_message(date(2056, 1, 1), date(2056, 1, 2), today=today)
    assert far is not None
