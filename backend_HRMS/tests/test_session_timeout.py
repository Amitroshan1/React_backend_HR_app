from datetime import timedelta

from website.session_timeout import (
    DEFAULT_SESSION_MINUTES,
    EXTENDED_SESSION_MINUTES,
    is_extended_session_emp_type,
    session_expires_delta,
    session_timeout_minutes,
)


def test_extended_roles_get_60_minutes():
    for emp_type in ("HR", "Accounts", "Account", "IT", "Human Resources", "it-department"):
        assert is_extended_session_emp_type(emp_type) is True
        assert session_timeout_minutes(emp_type) == EXTENDED_SESSION_MINUTES
        assert session_expires_delta(emp_type) == timedelta(minutes=60)


def test_other_roles_get_15_minutes():
    for emp_type in ("Engineering", "Manager", "Sales", "", None, "Admin"):
        assert is_extended_session_emp_type(emp_type) is False
        assert session_timeout_minutes(emp_type) == DEFAULT_SESSION_MINUTES
        assert session_expires_delta(emp_type) == timedelta(minutes=15)
