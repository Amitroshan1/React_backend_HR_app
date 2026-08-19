"""Remark policy per transition action — enforced in P1+."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Optional

from .actions import TransitionAction


@dataclass(frozen=True)
class RemarkPolicy:
    action_code: str
    remark_required: bool
    min_length: int
    reason_code_required: bool
    condition_grade_required: bool
    notes: str = ""


def _p(
    action: TransitionAction,
    *,
    min_length: int,
    reason_code_required: bool = False,
    condition_grade_required: bool = False,
    notes: str = "",
) -> RemarkPolicy:
    return RemarkPolicy(
        action_code=action.value,
        remark_required=True,
        min_length=min_length,
        reason_code_required=reason_code_required,
        condition_grade_required=condition_grade_required,
        notes=notes,
    )


REMARK_POLICIES: dict[str, RemarkPolicy] = {
    TransitionAction.RECEIVE.value: _p(
        TransitionAction.RECEIVE, min_length=10, notes="GRN / stock-in narrative"
    ),
    TransitionAction.CHECKOUT.value: _p(
        TransitionAction.CHECKOUT, min_length=10, notes="Assign to employee"
    ),
    TransitionAction.CHECKIN.value: _p(
        TransitionAction.CHECKIN,
        min_length=10,
        condition_grade_required=True,
        notes="Return to stock",
    ),
    TransitionAction.TRANSFER.value: _p(
        TransitionAction.TRANSFER, min_length=10, notes="Custody transfer"
    ),
    TransitionAction.DEPLOY.value: _p(
        TransitionAction.DEPLOY, min_length=10, notes="Location deploy"
    ),
    TransitionAction.UNDEPLOY.value: _p(
        TransitionAction.UNDEPLOY, min_length=10, notes="Return from location"
    ),
    TransitionAction.MARK_QUARANTINE.value: _p(
        TransitionAction.MARK_QUARANTINE,
        min_length=15,
        notes="Not-working / quarantine symptom",
    ),
    TransitionAction.SEND_REPAIR.value: _p(
        TransitionAction.SEND_REPAIR, min_length=10, notes="Send to repair"
    ),
    TransitionAction.COMPLETE_REPAIR.value: _p(
        TransitionAction.COMPLETE_REPAIR,
        min_length=10,
        condition_grade_required=True,
        notes="Repair complete / restore",
    ),
    TransitionAction.REQUEST_RETURN.value: _p(
        TransitionAction.REQUEST_RETURN, min_length=10, notes="Employee return request"
    ),
    TransitionAction.APPROVE_RETURN.value: _p(
        TransitionAction.APPROVE_RETURN, min_length=10, notes="IT approve return"
    ),
    TransitionAction.REJECT_RETURN.value: _p(
        TransitionAction.REJECT_RETURN, min_length=10, notes="IT reject return"
    ),
    TransitionAction.EXPORT.value: _p(
        TransitionAction.EXPORT,
        min_length=20,
        reason_code_required=True,
        notes="Export out of stock",
    ),
    TransitionAction.RETIRE.value: _p(
        TransitionAction.RETIRE,
        min_length=20,
        reason_code_required=True,
        condition_grade_required=True,
        notes="Retire / dead / wipe",
    ),
    TransitionAction.LOST.value: _p(
        TransitionAction.LOST,
        min_length=20,
        reason_code_required=True,
        notes="Marked lost",
    ),
    TransitionAction.NOTE.value: _p(
        TransitionAction.NOTE, min_length=5, notes="Comment-only, no state change"
    ),
    TransitionAction.ACK_CUSTODY.value: _p(
        TransitionAction.ACK_CUSTODY, min_length=5, notes="Employee acknowledgement"
    ),
}


def get_remark_policy(action_code: str) -> Optional[RemarkPolicy]:
    code = str(action_code or "").strip().upper()
    return REMARK_POLICIES.get(code)


def validate_remark(
    action_code: str,
    remark: Optional[str],
    *,
    reason_code: Optional[str] = None,
    condition_grade: Optional[str] = None,
) -> tuple[bool, Optional[str]]:
    """
    Validate remark payload against frozen policy.

    Returns (ok, error_message). Used by P1 transition_service; safe to call in P0 tests.
    """
    policy = get_remark_policy(action_code)
    if policy is None:
        return False, f"Unknown action_code: {action_code}"

    text = (remark or "").strip()
    if policy.remark_required and not text:
        return False, "Remark is required"
    if text and len(text) < policy.min_length:
        return False, f"Remark must be at least {policy.min_length} characters"

    if policy.reason_code_required and not (reason_code or "").strip():
        return False, "Reason code is required for this action"

    if policy.condition_grade_required and not (condition_grade or "").strip():
        return False, "Condition grade is required for this action"

    return True, None


def policies_as_dict() -> dict[str, dict]:
    return {k: asdict(v) for k, v in REMARK_POLICIES.items()}
