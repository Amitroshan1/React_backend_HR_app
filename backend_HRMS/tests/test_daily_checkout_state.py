"""Day-use Assets state machine (no Flask app import)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_STATE = Path(__file__).resolve().parents[1] / "website" / "daily_checkout" / "state.py"


def _load():
    spec = importlib.util.spec_from_file_location("daily_checkout_state", _STATE)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_open_and_terminal_do_not_overlap():
    s = _load()
    assert not s.OPEN_STATUSES & {"rejected", "cancelled", "returned"}


def test_employee_can_cancel_before_assign():
    s = _load()
    assert s.can_transition("requested", "cancelled")
    assert s.can_transition("approved", "cancelled")
    assert not s.can_transition("assigned", "cancelled")
    assert s.can_employee_cancel("requested")
    assert s.can_employee_cancel("approved")
    assert s.can_employee_cancel("APPROVED")
    assert not s.can_employee_cancel("assigned")
    assert not s.can_employee_cancel("overdue")
    assert not s.can_employee_cancel("return_requested")
    assert s.EMPLOYEE_CANCEL_FROM == frozenset({"requested", "approved"})


def test_employee_return_only_after_assign():
    s = _load()
    assert s.can_employee_request_return("assigned")
    assert s.can_employee_request_return("overdue")
    assert not s.can_employee_request_return("requested")
    assert not s.can_employee_request_return("approved")


def test_it_walk_up_return_from_assigned():
    s = _load()
    assert s.can_transition("assigned", "returned")
    assert "assigned" in s.IT_COMPLETE_RETURN_FROM


def test_overdue_then_return():
    s = _load()
    assert s.can_transition("assigned", "overdue")
    assert s.can_transition("overdue", "returned")


def test_cannot_skip_approve():
    s = _load()
    assert not s.can_transition("requested", "assigned")
