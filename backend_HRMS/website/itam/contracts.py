"""Frozen API / TransitionRecord contracts for ITAM P0."""

from __future__ import annotations

from .actions import ACTION_CODES, ACTION_LABELS
from .flags import ITAM_FLAG_KEYS, get_itam_flags
from .lifecycle import lifecycle_snapshot
from .remark_policy import policies_as_dict

CONTRACT_VERSION = "itam-p0-2026-08-13"
PHASE = "P0"

# Field contract for append-only TransitionRecord (implemented as ORM in P1; schema frozen here).
TRANSITION_RECORD_FIELDS: tuple[dict, ...] = (
    {"name": "id", "type": "int", "required": True, "notes": "PK"},
    {"name": "transition_code", "type": "string(40)", "required": True, "notes": "Public unique code"},
    {"name": "asset_unit_id", "type": "int|null", "required": False, "notes": "Serialized unit"},
    {"name": "software_license_id", "type": "int|null", "required": False, "notes": "License seat"},
    {"name": "inventory_item_id", "type": "int|null", "required": False, "notes": "Qty / catalog line"},
    {"name": "action_code", "type": "string(32)", "required": True, "notes": "TransitionAction"},
    {"name": "from_status", "type": "string(40)|null", "required": False, "notes": "Before"},
    {"name": "to_status", "type": "string(40)|null", "required": False, "notes": "After"},
    {"name": "from_custody_json", "type": "json|null", "required": False, "notes": "Snapshot"},
    {"name": "to_custody_json", "type": "json|null", "required": False, "notes": "Snapshot"},
    {"name": "remark", "type": "text", "required": True, "notes": "Mandatory narrative"},
    {"name": "reason_code", "type": "string(60)|null", "required": False, "notes": "Enum when policy requires"},
    {"name": "condition_grade", "type": "string(10)|null", "required": False, "notes": "A/B/C/D/Fail"},
    {"name": "actor_admin_id", "type": "int|null", "required": False, "notes": "Who performed"},
    {"name": "related_json", "type": "json|null", "required": False, "notes": "request/return/movement/ticket/noc ids"},
    {"name": "attachments_json", "type": "json|null", "required": False, "notes": "Media refs"},
    {"name": "occurred_at", "type": "datetime", "required": True, "notes": "Event time"},
    {"name": "created_at", "type": "datetime", "required": True, "notes": "Insert time"},
)

# Planned endpoints — not registered until P1/P2. Documented for implementers.
API_ENDPOINTS = (
    {
        "phase": "P1",
        "method": "POST",
        "path": "/api/it/units/<unit_id>/transitions",
        "auth": "IT panel",
        "body": {
            "action_code": "CHECKOUT|SEND_REPAIR|...",
            "remark": "string (required per policy)",
            "reason_code": "optional/required per policy",
            "condition_grade": "optional/required per policy",
            "to_status": "optional override when action implies",
            "custody": {"type": "EMPLOYEE|LOCATION|VENDOR", "id": "..."},
            "related": {"return_id": 1, "request_id": 2},
            "attachments": [],
        },
        "success": "200 { success, transition, unit }",
        "errors": "400 remark/policy; 404 unit; 409 illegal transition",
    },
    {
        "phase": "P1",
        "method": "POST",
        "path": "/api/it/software/licenses/<license_id>/transitions",
        "auth": "IT panel",
        "notes": "Same body shape as unit transitions",
    },
    {
        "phase": "P1",
        "method": "POST",
        "path": "/api/it/inventory/items/<item_id>/transitions",
        "auth": "IT panel",
        "notes": "Qty / deploy line transitions",
    },
    {
        "phase": "P2",
        "method": "GET",
        "path": "/api/it/units/<unit_id>/timeline",
        "auth": "IT panel (employee own in P5)",
        "query": "action[], from, to, q, page, limit",
        "success": "200 { success, transitions[], pagination }",
    },
    {
        "phase": "P3",
        "method": "POST",
        "path": "/api/it/itam/backfill-lifecycle",
        "auth": "IT panel",
        "notes": "Hydrate lifecycle_status + open custody from legacy status/deploy rows",
    },
    {
        "phase": "P0",
        "method": "GET",
        "path": "/api/it/itam/meta",
        "auth": "IT panel",
        "notes": "Read-only contract + flags snapshot (this phase)",
    },
)


def api_contract_snapshot(config=None) -> dict:
    return {
        "contract_version": CONTRACT_VERSION,
        "phase": PHASE,
        "flags": get_itam_flags(config),
        "flag_keys": list(ITAM_FLAG_KEYS),
        "action_codes": list(ACTION_CODES),
        "action_labels": dict(ACTION_LABELS),
        "remark_policies": policies_as_dict(),
        "transition_record_fields": list(TRANSITION_RECORD_FIELDS),
        "api_endpoints": list(API_ENDPOINTS),
        "lifecycle": lifecycle_snapshot(),
        "behavior": {
            "p0": "Contracts and flags only.",
            "p1": (
                "Enable itam_transitions_v1 to require remarks on assign/return/status/"
                "deploy/return-request paths and write it_asset_transitions rows."
            ),
            "p2": (
                "Enable itam_timeline_v1 for GET /units/<id>/timeline (+ CSV export) and History UI. "
                "Optional POST /itam/backfill-assignment-history hydrates from assignments."
            ),
            "p3": (
                "Enable itam_lifecycle_v1 to dual-write lifecycle_status + custody_type / open "
                "ITAssetCustody. Deployed ≠ CheckedOut. POST /itam/backfill-lifecycle hydrates units."
            ),
        },
    }
