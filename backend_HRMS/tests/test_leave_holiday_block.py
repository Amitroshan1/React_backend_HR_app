from datetime import date

from website.leave_attendence import calendar_block_for_leave_type


def test_optional_leave_not_blocked_by_calendar_helper():
    msg = calendar_block_for_leave_type(
        emp_type="Software Developer",
        start_date=date(2026, 8, 15),
        end_date=date(2026, 8, 15),
        leave_type="Optional Leave",
        tenant_id=1,
    )
    assert msg is None


def test_pl_on_mandatory_holiday_is_blocked(monkeypatch):
    d = date(2026, 8, 15)
    monkeypatch.setattr(
        "website.leave_attendence._holiday_entries",
        lambda *a, **k: {d: {"name": "INDEPENDENCE DAY", "is_optional": False}},
    )
    monkeypatch.setattr(
        "website.leave_attendence._compute_working_and_sandwich_days",
        lambda **k: (0.0, 0.0),
    )
    msg = calendar_block_for_leave_type(
        emp_type="Software Developer",
        start_date=d,
        end_date=d,
        leave_type="Privilege Leave",
        tenant_id=1,
    )
    assert msg is not None
    assert "public holiday" in msg.lower()
    assert "INDEPENDENCE DAY" in msg


def test_pl_on_optional_holiday_points_to_optional_leave(monkeypatch):
    d = date(2026, 3, 19)
    monkeypatch.setattr(
        "website.leave_attendence._holiday_entries",
        lambda *a, **k: {d: {"name": "GUDI PADWA", "is_optional": True}},
    )
    monkeypatch.setattr(
        "website.leave_attendence._compute_working_and_sandwich_days",
        lambda **k: (0.0, 0.0),
    )
    msg = calendar_block_for_leave_type(
        emp_type="Software Developer",
        start_date=d,
        end_date=d,
        leave_type="Casual Leave",
        tenant_id=1,
    )
    assert msg is not None
    assert "Optional Leave" in msg


def test_range_with_working_days_not_blocked(monkeypatch):
    h = date(2026, 8, 15)
    monkeypatch.setattr(
        "website.leave_attendence._holiday_entries",
        lambda *a, **k: {h: {"name": "INDEPENDENCE DAY", "is_optional": False}},
    )
    monkeypatch.setattr(
        "website.leave_attendence._compute_working_and_sandwich_days",
        lambda **k: (2.0, 1.0),
    )
    msg = calendar_block_for_leave_type(
        emp_type="Software Developer",
        start_date=date(2026, 8, 14),
        end_date=date(2026, 8, 17),
        leave_type="Privilege Leave",
        tenant_id=1,
    )
    assert msg is None


def test_weekend_only_range_blocked(monkeypatch):
    monkeypatch.setattr(
        "website.leave_attendence._holiday_entries",
        lambda *a, **k: {},
    )
    monkeypatch.setattr(
        "website.leave_attendence._compute_working_and_sandwich_days",
        lambda **k: (0.0, 0.0),
    )
    msg = calendar_block_for_leave_type(
        emp_type="Software Developer",
        start_date=date(2026, 8, 15),  # Saturday in 2026? helper doesn't care
        end_date=date(2026, 8, 16),
        leave_type="Privilege Leave",
        tenant_id=1,
    )
    assert msg is not None
    assert "no working days" in msg.lower()
