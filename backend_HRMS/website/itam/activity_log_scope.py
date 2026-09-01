"""Activity log scope mapping — no DB imports."""

from __future__ import annotations

from typing import Optional

from .actions import TransitionAction

IT_SCOPE_ACTIONS = (
    TransitionAction.CHECKOUT.value,
    TransitionAction.CHECKIN.value,
    TransitionAction.TRANSFER.value,
    TransitionAction.REQUEST_RETURN.value,
    TransitionAction.APPROVE_RETURN.value,
    TransitionAction.REJECT_RETURN.value,
    TransitionAction.ACK_CUSTODY.value,
)

INVENTORY_SCOPE_ACTIONS = (
    TransitionAction.RECEIVE.value,
    TransitionAction.DEPLOY.value,
    TransitionAction.UNDEPLOY.value,
    TransitionAction.EXPORT.value,
    TransitionAction.RETIRE.value,
    TransitionAction.MARK_QUARANTINE.value,
    TransitionAction.SEND_REPAIR.value,
    TransitionAction.COMPLETE_REPAIR.value,
    TransitionAction.LOST.value,
    TransitionAction.NOTE.value,
)


def resolve_scope_actions(scope: Optional[str], actions: Optional[list[str]] = None) -> Optional[list[str]]:
    requested = [str(a).strip().upper() for a in (actions or []) if str(a).strip()]
    if requested:
        return requested
    key = str(scope or "all").strip().lower()
    if key == "it":
        return list(IT_SCOPE_ACTIONS)
    if key == "inventory":
        return list(INVENTORY_SCOPE_ACTIONS)
    return None


def should_log_catalog_receive(is_qty_managed: bool) -> bool:
    """Qty-managed stock has no units; hardware/software log RECEIVE per unit/license."""
    return bool(is_qty_managed)
