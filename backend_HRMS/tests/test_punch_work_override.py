from datetime import date

from website.utility import WORK_OVERRIDE_MIN_CHARS, punch_work_override_context


class _Leave:
    def __init__(self, leave_type):
        self.leave_type = leave_type


def test_override_min_chars_is_at_least_20():
    assert WORK_OVERRIDE_MIN_CHARS >= 20


def test_leave_override_message(monkeypatch):
    monkeypatch.setattr(
        "website.utility._approved_full_day_leaves_on",
        lambda *a, **k: [_Leave("Casual Leave")],
    )
    ctx = punch_work_override_context(1, date(2026, 8, 17), tenant_id=1)
    assert ctx["kind"] == "leave"
    assert "Casual Leave" in ctx["message"]
    assert "not cancelled" in ctx["message"].lower()


def test_holiday_override_message(monkeypatch):
    monkeypatch.setattr("website.utility._approved_full_day_leaves_on", lambda *a, **k: [])
    monkeypatch.setattr(
        "website.leave_attendence._holiday_entries",
        lambda *a, **k: {date(2026, 8, 15): {"name": "INDEPENDENCE DAY", "is_optional": False}},
    )
    ctx = punch_work_override_context(1, date(2026, 8, 15), tenant_id=1)
    assert ctx["kind"] == "holiday"
    assert "INDEPENDENCE DAY" in ctx["message"]


def test_working_day_has_no_override(monkeypatch):
    monkeypatch.setattr("website.utility._approved_full_day_leaves_on", lambda *a, **k: [])
    monkeypatch.setattr("website.leave_attendence._holiday_entries", lambda *a, **k: {})
    assert punch_work_override_context(1, date(2026, 8, 18), tenant_id=1) is None
