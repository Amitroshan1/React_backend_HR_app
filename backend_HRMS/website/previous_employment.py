"""Limits for previous-employment dates and experience years."""
from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta

from .datetime_utils import IST

PREV_EMP_MAX_YEARS = 50.0
PREV_EMP_MIN_CALENDAR_YEAR = 1980
PREV_EMP_MIN_WORKING_AGE = 16
_YEARS_RE = re.compile(r"^\d{1,2}(\.\d)?$")


def _today_ist(today=None) -> date:
    if today is not None:
        return today
    return datetime.now(IST).date()


def _add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d.replace(year=d.year + years, month=2, day=28)


def earliest_leaving_date(dob: date | None) -> date:
    floor = date(PREV_EMP_MIN_CALENDAR_YEAR, 1, 1)
    if dob is None:
        return floor
    return max(floor, _add_years(dob, PREV_EMP_MIN_WORKING_AGE))


def latest_leaving_date(company_doj: date | None, *, today=None) -> date:
    today = _today_ist(today)
    if company_doj is None:
        return today
    return min(today, company_doj)


def parse_experience_years(raw):
    """Return (years: float, error: str|None). Blank means 0."""
    s = str(raw or "").strip().replace(",", ".")
    if not s:
        return 0.0, None
    if "e" in s.lower() or "+" in s:
        return None, "Experience years must be between 0 and 50 (one decimal allowed)."
    if not _YEARS_RE.fullmatch(s):
        return None, "Experience years must be between 0 and 50, with at most one decimal (for example 2.5)."
    try:
        yrs = float(s)
    except ValueError:
        return None, "Experience years must be a number between 0 and 50."
    if not math.isfinite(yrs) or yrs < 0 or yrs > PREV_EMP_MAX_YEARS:
        return None, "Experience years must be between 0 and 50."
    return round(yrs, 1), None


def validate_previous_employment_dates(
    dol: date,
    years: float,
    *,
    dob: date | None = None,
    company_doj: date | None = None,
    today=None,
):
    """Return (doj, error_message). doj is inferred from leaving date minus years."""
    today = _today_ist(today)
    earliest = earliest_leaving_date(dob)
    latest = latest_leaving_date(company_doj, today=today)

    if dol > latest:
        if company_doj and latest == company_doj and dol > company_doj:
            return None, "Date of leaving cannot be after your date of joining this company."
        return None, "Date of leaving cannot be in the future."
    if dol < earliest:
        return None, (
            f"Date of leaving cannot be before {earliest.isoformat()} "
            f"(minimum working age {PREV_EMP_MIN_WORKING_AGE})."
        )

    days = int(round(float(years) * 365.25))
    days = max(0, min(days, int(PREV_EMP_MAX_YEARS * 365.25) + 1))
    doj = dol - timedelta(days=days)
    if doj > dol:
        return None, "Experience years cannot be negative."
    if doj < earliest:
        return None, (
            "Experience years go back before a valid working age. "
            "Use at most 50 years and a leaving date that matches the tenure."
        )
    return doj, None
