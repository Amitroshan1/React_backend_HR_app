"""ITAM P1 — transition recording + remark enforcement (behind itam_transitions_v1)."""

from __future__ import annotations

from typing import Any, Optional

from .. import db
from ..datetime_utils import utc_now
from ..models.it_models import ITAssetTransition
from .actions import ACTION_LABELS, TransitionAction, is_valid_action
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


def _snapshot_related(
    related: Optional[dict],
    *,
    asset_unit_id: Optional[int] = None,
    inventory_item_id: Optional[int] = None,
) -> tuple[Optional[dict], Optional[int], Optional[str]]:
    """Attach asset name / category so the activity log still reads after deletes."""
    out = dict(related) if isinstance(related, dict) else {}
    item_id = int(inventory_item_id) if inventory_item_id is not None else None
    category = out.get("inventory_category")
    if isinstance(category, str):
        category = category.strip() or None
    else:
        category = None

    try:
        from ..models.it_models import ITAssetUnit, ITInventoryItem
    except Exception:
        if category:
            out["inventory_category"] = category
        return (out or None), item_id, category

    unit = None
    if asset_unit_id is not None:
        try:
            unit = ITAssetUnit.query.get(int(asset_unit_id))
        except Exception:
            unit = None
        if unit:
            out.setdefault("asset_name", unit.asset_name)
            if unit.serial_number:
                out.setdefault("serial_number", unit.serial_number)
            if unit.unit_code:
                out.setdefault("unit_code", unit.unit_code)
            if unit.brand:
                out.setdefault("brand", unit.brand)
            if unit.make:
                out.setdefault("make", unit.make)
            if unit.model:
                out.setdefault("model", unit.model)
                # Laptop / device code is stored on unit.model in this product.
                out.setdefault("laptop_code", unit.model)
            if unit.hw_type:
                out.setdefault("hw_type", unit.hw_type)
            if unit.imei1:
                out.setdefault("imei1", unit.imei1)
            if unit.imei2:
                out.setdefault("imei2", unit.imei2)
            if getattr(unit, "project_code", None):
                out.setdefault("project_code", unit.project_code)
            if getattr(unit, "device_location", None):
                out.setdefault("device_location", unit.device_location)
            if item_id is None:
                item_id = unit.inventory_item_id

    item = None
    if item_id is not None:
        try:
            item = ITInventoryItem.query.get(int(item_id))
        except Exception:
            item = None
        if item:
            out.setdefault("asset_name", item.name)
            if not category:
                category = (item.inventory_category or "").strip() or None
            if item.hw_type:
                out.setdefault("hw_type", item.hw_type)

    if category:
        out["inventory_category"] = category
    return (out or None), item_id, category


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
    Append an audit TransitionRecord.

    require=False → never write
    require=True → always write and enforce remark policy
    require=None → always write; enforce remarks only when itam_transitions_v1 is ON
    """
    if require is False:
        return None

    enforce = transitions_enabled(config) or (require is True)

    code = str(action_code or "").strip().upper()
    if not is_valid_action(code):
        raise TransitionValidationError(f"Unknown action_code: {action_code}")

    text = (remark or "").strip()
    if not text:
        text = ACTION_LABELS.get(code, code)

    if enforce:
        ok, err = validate_remark(
            code,
            text,
            reason_code=reason_code,
            condition_grade=condition_grade,
        )
        if not ok:
            raise TransitionValidationError(err or "Invalid remark")

    related_out, item_id, category = _snapshot_related(
        related,
        asset_unit_id=asset_unit_id,
        inventory_item_id=inventory_item_id,
    )

    row = ITAssetTransition(
        transition_code=_next_transition_code(),
        asset_unit_id=asset_unit_id,
        software_license_id=software_license_id,
        inventory_item_id=item_id,
        action_code=code,
        from_status=from_status,
        to_status=to_status,
        from_custody_json=from_custody,
        to_custody_json=to_custody,
        remark=text,
        reason_code=(reason_code or "").strip() or None,
        condition_grade=(condition_grade or "").strip() or None,
        actor_admin_id=actor_admin_id,
        related_json=related_out,
        attachments_json=attachments if isinstance(attachments, list) else None,
        inventory_category=category,
        occurred_at=utc_now(),
    )
    db.session.add(row)
    return row


def serialize_transition(row: ITAssetTransition) -> dict[str, Any]:
    related = row.related_json if isinstance(row.related_json, dict) else {}
    imei1 = (related.get("imei1") or "").strip() or None
    imei2 = (related.get("imei2") or "").strip() or None
    imei = imei1 or imei2
    brand = (related.get("brand") or "").strip() or None
    make = (related.get("make") or "").strip() or None
    model = (related.get("model") or "").strip() or None
    laptop_code = (related.get("laptop_code") or model or "").strip() or None
    hw_type = (related.get("hw_type") or "").strip() or None
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
        "inventoryCategory": getattr(row, "inventory_category", None) or related.get("inventory_category"),
        "assetName": related.get("asset_name"),
        "serialNumber": related.get("serial_number"),
        "unitCode": related.get("unit_code"),
        "brand": brand,
        "make": make,
        "model": model,
        "laptopCode": laptop_code,
        "hwType": hw_type,
        "imei1": imei1,
        "imei2": imei2,
        "imei": imei,
        "projectCode": (related.get("project_code") or "").strip() or None,
        "deviceLocation": (related.get("device_location") or "").strip() or None,
        "related": row.related_json,
        "attachments": row.attachments_json or [],
        "occurredAt": row.occurred_at.isoformat() if row.occurred_at else None,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
    }
