"""Idle session lifetimes by employee type (login JWT + refresh)."""
from __future__ import annotations

from datetime import timedelta
from typing import Optional

EXTENDED_SESSION_MINUTES = 60
DEFAULT_SESSION_MINUTES = 15

_EXTENDED_EMP_TYPES = frozenset(
    {
        "hr",
        "human resource",
        "human resources",
        "account",
        "accounts",
        "accountant",
        "it",
        "it department",
        "inventory",
    }
)


def normalize_emp_type(emp_type: Optional[str]) -> str:
    return " ".join(
        str(emp_type or "")
        .strip()
        .lower()
        .replace("-", " ")
        .replace("_", " ")
        .split()
    )


def is_extended_session_emp_type(emp_type: Optional[str]) -> bool:
    return normalize_emp_type(emp_type) in _EXTENDED_EMP_TYPES


def session_timeout_minutes(emp_type: Optional[str]) -> int:
    if is_extended_session_emp_type(emp_type):
        return EXTENDED_SESSION_MINUTES
    return DEFAULT_SESSION_MINUTES


def session_expires_delta(emp_type: Optional[str]) -> timedelta:
    return timedelta(minutes=session_timeout_minutes(emp_type))
