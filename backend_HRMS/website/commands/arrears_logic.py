"""Salary revision arrears — pure calculation (no DB)."""
from __future__ import annotations

import calendar
from datetime import date


def _month_range(start: date, end_year: int, end_month: int) -> list[tuple[int, int]]:
    """Inclusive months from start through end_year/end_month."""
    months: list[tuple[int, int]] = []
    y, m = start.year, start.month
    last_y, last_m = int(end_year), int(end_month)
    while (y < last_y) or (y == last_y and m <= last_m):
        months.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return months


def compute_salary_arrears(
    *,
    effective_from: date,
    through_year: int,
    through_month: int,
    old_gross_monthly: float,
    new_gross_monthly: float,
    payroll_days_by_month: dict[tuple[int, int], float] | None = None,
    calendar_days_by_month: dict[tuple[int, int], int] | None = None,
) -> dict:
    """
    Compute gross arrears for months from effective_from through through_month.
    Uses per-day delta × payable days when payroll_days_by_month is supplied;
    otherwise full calendar-month delta.
    """
    old_g = max(0.0, float(old_gross_monthly or 0))
    new_g = max(0.0, float(new_gross_monthly or 0))
    if new_g <= old_g:
        return {"months": [], "total_arrears_gross": 0.0, "month_count": 0}

    payroll_days_by_month = payroll_days_by_month or {}
    calendar_days_by_month = calendar_days_by_month or {}
    lines = []
    total = 0.0

    for y, m in _month_range(effective_from, through_year, through_month):
        cal_days = calendar_days_by_month.get((y, m)) or calendar.monthrange(y, m)[1]
        payable = payroll_days_by_month.get((y, m))
        if payable is not None and cal_days > 0:
            old_one = old_g / float(cal_days)
            new_one = new_g / float(cal_days)
            delta = round((new_one - old_one) * float(payable), 2)
        else:
            delta = round(new_g - old_g, 2)
        if delta > 0:
            lines.append({
                "year": y,
                "month_num": m,
                "arrears_gross": delta,
                "payable_days": payable,
                "calendar_days": cal_days,
            })
            total += delta

    return {
        "months": lines,
        "total_arrears_gross": round(total, 2),
        "month_count": len(lines),
        "old_gross_monthly": round(old_g, 2),
        "new_gross_monthly": round(new_g, 2),
        "effective_from": effective_from.isoformat(),
        "through_year": through_year,
        "through_month": through_month,
    }
