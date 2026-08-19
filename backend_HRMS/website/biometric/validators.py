"""Request / device / timestamp validators (Phase 3B)."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Optional, Tuple

from ..datetime_utils import IST

# Reject only extreme future clocks (clock skew); delayed/offline past events are OK.
_MAX_FUTURE_SKEW = timedelta(hours=24)


def normalize_serial(sn: Optional[str]) -> str:
    return re.sub(r"\s+", "", (sn or "")).strip()


def is_valid_serial(sn: Optional[str]) -> bool:
    s = normalize_serial(sn)
    if not s or len(s) > 64:
        return False
    # Alphanumeric plus common device separators
    return bool(re.fullmatch(r"[A-Za-z0-9._\-]+", s))


def is_valid_device_user_id(pin: Optional[str]) -> bool:
    s = (pin or "").strip()
    if not s or len(s) > 64:
        return False
    return True


def validate_punch_time_basic(
    punch_time: Optional[datetime],
    *,
    now_ist: Optional[datetime] = None,
) -> Tuple[bool, Optional[str]]:
    """
    Basic timestamp checks for Phase 3B.
    - Missing/invalid already flagged by parser
    - Far-future rejected; past/offline accepted
    """
    if punch_time is None:
        return False, "missing_or_invalid_timestamp"
    now = now_ist or datetime.now(IST).replace(tzinfo=None)
    if punch_time > now + _MAX_FUTURE_SKEW:
        return False, "timestamp_too_far_in_future"
    return True, None


def client_ip_from_request(request) -> str:
    """Best-effort client IP (honours X-Forwarded-For first hop)."""
    xff = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    if xff:
        return xff
    return (request.remote_addr or "").strip()
