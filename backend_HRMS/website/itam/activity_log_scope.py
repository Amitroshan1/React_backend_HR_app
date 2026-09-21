"""Activity log scope mapping — no DB imports."""

from __future__ import annotations

from typing import Optional

from .actions import TransitionAction

# Sent when the user asks for an action that does not exist in the current scope.
NO_MATCH_ACTIONS = ("__NO_MATCH__",)

# Actions this product actually records from IT assignment / return flows.
IT_SCOPE_ACTIONS = (
    TransitionAction.CHECKOUT.value,
    TransitionAction.CHECKIN.value,
    TransitionAction.REQUEST_RETURN.value,
    TransitionAction.APPROVE_RETURN.value,
    TransitionAction.REJECT_RETURN.value,
)

# Actions this product actually records from inventory / repair flows.
# Parcel import/export tracking lives in Parcel Log (scope=parcel).
INVENTORY_SCOPE_ACTIONS = (
    TransitionAction.RECEIVE.value,
    TransitionAction.DEPLOY.value,
    TransitionAction.UNDEPLOY.value,
    TransitionAction.MARK_QUARANTINE.value,
    TransitionAction.SEND_REPAIR.value,
    TransitionAction.COMPLETE_REPAIR.value,
    TransitionAction.RETIRE.value,
)

# Parcel Log only — EXPORT + parcel RECEIVE (filtered further by related/remark).
PARCEL_SCOPE_ACTIONS = (
    TransitionAction.RECEIVE.value,
    TransitionAction.EXPORT.value,
)


def _scope_action_list(scope: Optional[str]) -> Optional[list[str]]:
    key = str(scope or "all").strip().lower()
    if key == "it":
        return list(IT_SCOPE_ACTIONS)
    if key == "inventory":
        return list(INVENTORY_SCOPE_ACTIONS)
    if key == "parcel":
        return list(PARCEL_SCOPE_ACTIONS)
    return None


def resolve_scope_actions(scope: Optional[str], actions: Optional[list[str]] = None) -> Optional[list[str]]:
    requested = [str(a).strip().upper() for a in (actions or []) if str(a).strip()]
    scope_list = _scope_action_list(scope)
    if requested:
        if scope_list is None:
            return requested
        allowed = set(scope_list)
        matched = [code for code in requested if code in allowed]
        return matched if matched else list(NO_MATCH_ACTIONS)
    return scope_list


def should_log_catalog_receive(is_qty_managed: bool) -> bool:
    """Qty-managed stock has no units; hardware/software log RECEIVE per unit/license."""
    return bool(is_qty_managed)
