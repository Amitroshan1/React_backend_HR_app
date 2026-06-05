"""Pure leave accrual scheduling helpers (no Flask/SQLAlchemy imports)."""
import calendar
from datetime import date


ANNUAL_PL_ENTITLEMENT = 15.0
ANNUAL_CL_ENTITLEMENT = 6.0
ACCRUAL_TRIGGER_DAY = 20
PROBATION_MONTHS = 6


def probation_end_date(doj):
    """Return date when 6-month probation ends (DOJ + 6 calendar months)."""
    if doj is None:
        return None
    mo = doj.month + PROBATION_MONTHS
    yr = doj.year + (mo - 1) // 12
    mo = (mo - 1) % 12 + 1
    last = calendar.monthrange(yr, mo)[1]
    return date(yr, mo, min(doj.day, last))


def first_eligible_month_in_year(probation_end, year):
    """
    First calendar month in `year` when accrual applies.
    If probation ends before the 20th, that month counts; otherwise the next month.
    """
    if probation_end is None:
        return None
    if probation_end.year > year:
        return None
    if probation_end.year < year:
        return 1
    if probation_end.day < ACCRUAL_TRIGGER_DAY:
        return probation_end.month
    next_month = probation_end.month + 1
    return next_month if next_month <= 12 else None


def eligible_months_in_year(probation_end, year):
    """Month numbers (1-12) from first eligible month through December."""
    first = first_eligible_month_in_year(probation_end, year)
    if first is None:
        return []
    return list(range(first, 13))


def annual_targets(eligible_month_count):
    """Prorated PL/CL targets for eligible months in a calendar year."""
    n = max(0, int(eligible_month_count))
    if n <= 0:
        return 0, 0
    pl_target = round((ANNUAL_PL_ENTITLEMENT / 12) * n)
    cl_target = round((ANNUAL_CL_ENTITLEMENT / 12) * n)
    return pl_target, cl_target


def distribute_integer_credits(eligible_months, total):
    """
    Spread integer leave credits across eligible months (20th triggers).
    Early months get +1; remainder is lumped on the last two eligible months.
    """
    total = int(total)
    if total <= 0 or not eligible_months:
        return {}

    months = list(eligible_months)
    n = len(months)
    schedule = {}
    remaining = total

    if n == 1:
        schedule[months[0]] = total
        return schedule

    single_months = months[: max(0, n - 2)]
    for month in single_months:
        if remaining <= 0:
            break
        schedule[month] = 1
        remaining -= 1

    if remaining > 0:
        last_two = months[-2:]
        if len(last_two) == 2:
            half = remaining // 2
            extra = remaining % 2
            schedule[last_two[0]] = schedule.get(last_two[0], 0) + half + extra
            schedule[last_two[1]] = schedule.get(last_two[1], 0) + half
        else:
            month = last_two[0]
            schedule[month] = schedule.get(month, 0) + remaining

    return schedule


def build_yearly_accrual_schedule(probation_end, year):
    """Return (pl_schedule, cl_schedule, meta) for a calendar year."""
    eligible_months = eligible_months_in_year(probation_end, year)
    pl_target, cl_target = annual_targets(len(eligible_months))
    pl_schedule = distribute_integer_credits(eligible_months, pl_target)
    cl_schedule = distribute_integer_credits(eligible_months, cl_target)
    meta = {
        "year": year,
        "eligible_months": eligible_months,
        "eligible_month_count": len(eligible_months),
        "pl_target": pl_target,
        "cl_target": cl_target,
    }
    return pl_schedule, cl_schedule, meta
