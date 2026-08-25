"""Org-wide IT / Inventory activity log (reads it_asset_transitions)."""

from __future__ import annotations

from typing import Optional

from .activity_log_scope import resolve_scope_actions
from .timeline_service import query_transitions, timeline_to_csv


def query_activity_log(
    *,
    scope: Optional[str] = None,
    actions: Optional[list[str]] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    inventory_category: Optional[str] = None,
    actor_admin_id: Optional[int] = None,
    asset_unit_id: Optional[int] = None,
    inventory_item_id: Optional[int] = None,
    page: int = 1,
    limit: int = 50,
) -> dict:
    resolved = resolve_scope_actions(scope, actions)
    return query_transitions(
        actions=resolved,
        q=q,
        date_from=date_from,
        date_to=date_to,
        inventory_category=inventory_category,
        actor_admin_id=actor_admin_id,
        asset_unit_id=asset_unit_id,
        inventory_item_id=inventory_item_id,
        page=page,
        limit=limit,
    )


def activity_log_to_csv(result: dict) -> str:
    return timeline_to_csv(result.get("transitions") or [])
