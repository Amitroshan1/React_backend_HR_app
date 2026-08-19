"""ITAM P1 — transition recording + remark enforcement (behind itam_transitions_v1)."""

from __future__ import annotations

from typing import Any, Optional

from .. import db
from ..datetime_utils import utc_now
from ..models.it_models import ITAssetTransition
from .actions import TransitionAction, is_valid_action
from .flags import is_itam_flag_enabled
from .remark_policy import validate_remark


class TransitionValidationError(ValueError):
    """Raised when remark policy fails while transitions are required."""


def transitions_enabled(config=None) -> bool:
    return is_itam_flag_enabled("itam_transitions_v1", config)


def extract_remark_fields(data: Optional[dict]) -> dict[str, Optional[str]]:
    data = data or {}
    remark = (data.get("remark") or data.get("notes") or "").strip() or None
    if not remark:
        remark = (
            (data.get("rejection_reason") or data.get("reason") or "").strip() or None
        )
    reason_code = (data.get("reason_code") or "").strip() or None
    condition_grade = (data.get("condition_grade") or "").strip() or None
    return {
        "remark": remark,
        "reason_code": reason_code,
        "condition_grade": condition_grade,
    }


def action_for_unit_status(to_status: str, *, from_status: Optional[str] = None) -> str:
    """Map legacy unit status changes to TransitionAction codes."""
    to_l = (to_status or "").strip().lower().replace("_", "-")
    from_l = (from_status or "").strip().lower().replace("_", "-")

    if to_l in {"repair", "in-repair", "inrepair"}:
        return TransitionAction.SEND_REPAIR.value
    if to_l in {"notworking", "not-working"}:
        return TransitionAction.MARK_QUARANTINE.value
    if to_l == "available":
        if from_l in {"repair", "in-repair", "inrepair", "notworking", "not-working"}:
            return TransitionAction.COMPLETE_REPAIR.value
        return TransitionAction.CHECKIN.value
    if to_l == "assigned":
        return TransitionAction.CHECKOUT.value
    if to_l == "exported":
        return TransitionAction.EXPORT.value
    if to_l in {"dead", "deleted", "retired"}:
        return TransitionAction.RETIRE.value
    return TransitionAction.NOTE.value


def action_for_return_destination(status: str) -> str:
    s = (status or "available").strip().lower().replace("_", "-")
    if s in {"notworking", "not-working", "removed-from-it"}:
        return TransitionAction.MARK_QUARANTINE.value
    if s in {"repair", "in-repair"}:
        return TransitionAction.SEND_REPAIR.value
    return TransitionAction.CHECKIN.value


def _next_transition_code() -> str:
    prefix = "TRN"
    last = (
        ITAssetTransition.query.filter(ITAssetTransition.transition_code.like(f"{prefix}%"))
        .order_by(ITAssetTransition.id.desc())
        .first()
    )
    n = 1
    if last and last.transition_code:
        digits = "".join(ch for ch in last.transition_code if ch.isdigit())
        if digits:
            n = int(digits) + 1
    return f"{prefix}{n:06d}"


def record_transition(
    *,
    action_code: str,
    remark: Optional[str],
    actor_admin_id: Optional[int] = None,
    asset_unit_id: Optional[int] = None,
    software_license_id: Optional[int] = None,
    inventory_item_id: Optional[int] = None,
    from_status: Optional[str] = None,
    to_status: Optional[str] = None,
    from_custody: Optional[dict] = None,
    to_custody: Optional[dict] = None,
    reason_code: Optional[str] = None,
    condition_grade: Optional[str] = None,
    related: Optional[dict] = None,
    attachments: Optional[list] = None,
    config=None,
    require: Optional[bool] = None,
) -> Optional[ITAssetTransition]:
    """
    Append TransitionRecord when required.

    require=None → follow itam_transitions_v1 flag (ON = enforce+write, OFF = no-op)
    require=True → always enforce+write (dedicated transitions API)
    require=False → never write

    Caller commits the session. This does not mutate asset state.
    """
    enabled = transitions_enabled(config)
    should_write = enabled if require is None else bool(require)
    if not should_write:
        return None

    code = str(action_code or "").strip().upper()
    if not is_valid_action(code):
        raise TransitionValidationError(f"Unknown action_code: {action_code}")

    ok, err = validate_remark(
        code,
        remark,
        reason_code=reason_code,
        condition_grade=condition_grade,
    )
    if not ok:
        raise TransitionValidationError(err or "Invalid remark")

    row = ITAssetTransition(
        transition_code=_next_transition_code(),
        asset_unit_id=asset_unit_id,
        software_license_id=software_license_id,
        inventory_item_id=inventory_item_id,
        action_code=code,
        from_status=from_status,
        to_status=to_status,
        from_custody_json=from_custody,
        to_custody_json=to_custody,
        remark=(remark or "").strip(),
        reason_code=(reason_code or "").strip() or None,
        condition_grade=(condition_grade or "").strip() or None,
        actor_admin_id=actor_admin_id,
        related_json=related or None,
        attachments_json=attachments if isinstance(attachments, list) else None,
        occurred_at=utc_now(),
    )
    db.session.add(row)
    return row


def serialize_transition(row: ITAssetTransition) -> dict[str, Any]:
    return {
        "id": row.id,
        "transitionCode": row.transition_code,
        "actionCode": row.action_code,
        "fromStatus": row.from_status,
        "toStatus": row.to_status,
        "fromCustody": row.from_custody_json,
        "toCustody": row.to_custody_json,
        "remark": row.remark,
        "reasonCode": row.reason_code,
        "conditionGrade": row.condition_grade,
        "actorAdminId": row.actor_admin_id,
        "assetUnitId": row.asset_unit_id,
        "softwareLicenseId": row.software_license_id,
        "inventoryItemId": row.inventory_item_id,
        "related": row.related_json,
        "attachments": row.attachments_json or [],
        "occurredAt": row.occurred_at.isoformat() if row.occurred_at else None,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }
