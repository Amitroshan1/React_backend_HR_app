"""Unit tests for per-session 10h auto punch-out cap."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from website.punch_auto_close import (
    SESSION_CAP_SEC,
    auto_close_deadline,
    capped_daily_work_seconds,
    closed_seconds_for_cap,
    daily_work_seconds,
    evaluate_auto_close,
)


def _sess(clock_in, punch_id=1):
    return SimpleNamespace(id=99, punch_id=punch_id, clock_in=clock_in, clock_out=None)


def test_auto_close_deadline_is_ten_hours_from_clock_in():
    cin = datetime(2026, 9, 22, 10, 0, 0)
    assert auto_close_deadline(_sess(cin)) == cin + timedelta(seconds=SESSION_CAP_SEC)


def test_closed_seconds_never_carry_into_open_segment():
    # Prior closed work must not shrink remaining (fixes immediate re-punch auto-out).
    assert closed_seconds_for_cap(1, _sess(datetime(2026, 9, 22, 15, 0, 0))) == 0


def test_evaluate_auto_close_false_before_ten_hours():
    cin = datetime(2026, 9, 22, 10, 0, 0)
    now = cin + timedelta(hours=2)
    should, reason, out_at = evaluate_auto_close(_sess(cin), now)
    assert should is False
    assert reason is None
    assert out_at is None


def test_evaluate_auto_close_true_at_ten_hours():
    cin = datetime(2026, 9, 22, 10, 0, 0)
    now = cin + timedelta(seconds=SESSION_CAP_SEC)
    should, reason, out_at = evaluate_auto_close(_sess(cin), now)
    assert should is True
    assert out_at == cin + timedelta(seconds=SESSION_CAP_SEC)
    assert reason is not None


def test_daily_work_is_open_segment_only():
    cin = datetime(2026, 9, 22, 10, 0, 0)
    now = cin + timedelta(hours=3, minutes=30)
    assert daily_work_seconds(_sess(cin), now) == 3 * 3600 + 30 * 60
    assert capped_daily_work_seconds(_sess(cin), now) == 3 * 3600 + 30 * 60


def test_capped_daily_work_never_exceeds_session_cap():
    cin = datetime(2026, 9, 22, 10, 0, 0)
    now = cin + timedelta(hours=12)
    assert capped_daily_work_seconds(_sess(cin), now) == SESSION_CAP_SEC
