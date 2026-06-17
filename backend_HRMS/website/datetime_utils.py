"""
UTC storage and timezone-aware JSON serialization for API responses.

MySQL DateTime columns store naive UTC. API output always includes a UTC offset (Z).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def utc_now() -> datetime:
    """Current time as naive UTC (for SQLAlchemy DateTime columns)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def isoformat_api(value) -> str | None:
    """
    Serialize a date or datetime for JSON API responses.
    - date-only values: YYYY-MM-DD (unchanged)
    - naive datetimes: assumed UTC, suffixed with Z
    - aware datetimes: normalized to UTC with Z suffix
    """
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return f"{value.isoformat()}Z"
        return ensure_utc(value).isoformat().replace("+00:00", "Z")
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def isoformat_punch_clock(value) -> str | None:
    """
    Serialize punch clock times for JSON (clock_in / clock_out / sessions).
    Naive values are wall-clock IST (employee punch flows use datetime.now()).
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            dt = value.replace(tzinfo=IST)
        else:
            dt = value.astimezone(IST)
        return dt.isoformat(timespec="seconds")
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def format_ist_display(value=None) -> str:
    """Human-readable DD/MM/YYYY, h:mm AM/PM in Indian Standard Time."""
    dt = value if isinstance(value, datetime) else utc_now()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    local = dt.astimezone(IST)
    day = local.strftime("%d")
    month = local.strftime("%m")
    year = local.strftime("%Y")
    time_part = local.strftime("%I:%M %p").lstrip("0")
    return f"{day}/{month}/{year}, {time_part}"
