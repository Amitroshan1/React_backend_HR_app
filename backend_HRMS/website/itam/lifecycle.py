"""Canonical asset lifecycle statuses and legacy ↔ canonical mapping (P3 live behind flag)."""

from __future__ import annotations

from enum import Enum
from typing import Optional


class CanonicalStatus(str, Enum):
    ORDERED = "Ordered"
    IN_TRANSIT = "InTransit"
    RECEIVED = "Received"
    IN_STOCK = "InStock"
    RESERVED = "Reserved"
    CHECKED_OUT = "CheckedOut"
    DEPLOYED = "Deployed"
    PENDING_RETURN = "PendingReturn"
    IN_REPAIR = "InRepair"
    QUARANTINE = "Quarantine"
    EXPORTED = "Exported"
    RETIRED = "Retired"
    LOST = "Lost"


class CustodyType(str, Enum):
    EMPLOYEE = "EMPLOYEE"
    LOCATION = "LOCATION"
    VENDOR = "VENDOR"
    NONE = "NONE"


class ConditionGrade(str, Enum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    FAIL = "Fail"


class LegacyStatus(str, Enum):
    """Statuses currently stored on ITAssetUnit.status / related UI."""

    AVAILABLE = "available"
    ASSIGNED = "assigned"
    NOT_WORKING = "not-working"
    NOT_WORKING_CAMEL = "notWorking"
    REPAIR = "repair"
    IN_REPAIR = "in-repair"
    IN_REPAIR_CAMEL = "inRepair"
    EXPORTED = "exported"
    REMOVED_FROM_IT = "removed_from_it"
    REMOVED = "removed"
    DEAD = "dead"
    DELETED = "deleted"


CANONICAL_STATUSES: tuple[str, ...] = tuple(s.value for s in CanonicalStatus)
CUSTODY_TYPES: tuple[str, ...] = tuple(c.value for c in CustodyType)
CONDITION_GRADES: tuple[str, ...] = tuple(g.value for g in ConditionGrade)

TERMINAL_STATUSES = frozenset(
    {
        CanonicalStatus.EXPORTED.value,
        CanonicalStatus.RETIRED.value,
        CanonicalStatus.LOST.value,
    }
)

STATUS_LABELS: dict[str, str] = {
    CanonicalStatus.ORDERED.value: "Ordered",
    CanonicalStatus.IN_TRANSIT.value: "In transit",
    CanonicalStatus.RECEIVED.value: "Received",
    CanonicalStatus.IN_STOCK.value: "In stock",
    CanonicalStatus.RESERVED.value: "Reserved",
    CanonicalStatus.CHECKED_OUT.value: "Checked out",
    CanonicalStatus.DEPLOYED.value: "Deployed",
    CanonicalStatus.PENDING_RETURN.value: "Pending return",
    CanonicalStatus.IN_REPAIR.value: "In repair",
    CanonicalStatus.QUARANTINE.value: "Quarantine",
    CanonicalStatus.EXPORTED.value: "Exported",
    CanonicalStatus.RETIRED.value: "Retired",
    CanonicalStatus.LOST.value: "Lost",
}

CUSTODY_LABELS: dict[str, str] = {
    CustodyType.EMPLOYEE.value: "Employee",
    CustodyType.LOCATION.value: "Location",
    CustodyType.VENDOR.value: "Vendor",
    CustodyType.NONE.value: "None",
}

DEFAULT_CUSTODY_FOR_STATUS: dict[str, str] = {
    CanonicalStatus.IN_STOCK.value: CustodyType.NONE.value,
    CanonicalStatus.RESERVED.value: CustodyType.NONE.value,
    CanonicalStatus.CHECKED_OUT.value: CustodyType.EMPLOYEE.value,
    CanonicalStatus.DEPLOYED.value: CustodyType.LOCATION.value,
    CanonicalStatus.PENDING_RETURN.value: CustodyType.EMPLOYEE.value,
    CanonicalStatus.IN_REPAIR.value: CustodyType.VENDOR.value,
    CanonicalStatus.QUARANTINE.value: CustodyType.NONE.value,
    CanonicalStatus.EXPORTED.value: CustodyType.NONE.value,
    CanonicalStatus.RETIRED.value: CustodyType.NONE.value,
    CanonicalStatus.LOST.value: CustodyType.NONE.value,
    CanonicalStatus.ORDERED.value: CustodyType.NONE.value,
    CanonicalStatus.IN_TRANSIT.value: CustodyType.NONE.value,
    CanonicalStatus.RECEIVED.value: CustodyType.NONE.value,
}

# Dual-write: canonical → legacy column (Deployed stays "assigned" for old counts).
CANONICAL_TO_LEGACY: dict[str, str] = {
    CanonicalStatus.IN_STOCK.value: LegacyStatus.AVAILABLE.value,
    CanonicalStatus.RESERVED.value: LegacyStatus.AVAILABLE.value,
    CanonicalStatus.CHECKED_OUT.value: LegacyStatus.ASSIGNED.value,
    CanonicalStatus.DEPLOYED.value: LegacyStatus.ASSIGNED.value,
    CanonicalStatus.PENDING_RETURN.value: LegacyStatus.ASSIGNED.value,
    CanonicalStatus.IN_REPAIR.value: LegacyStatus.REPAIR.value,
    CanonicalStatus.QUARANTINE.value: LegacyStatus.NOT_WORKING.value,
    CanonicalStatus.EXPORTED.value: LegacyStatus.EXPORTED.value,
    CanonicalStatus.RETIRED.value: LegacyStatus.DEAD.value,
    CanonicalStatus.LOST.value: LegacyStatus.NOT_WORKING.value,
    CanonicalStatus.ORDERED.value: LegacyStatus.AVAILABLE.value,
    CanonicalStatus.IN_TRANSIT.value: LegacyStatus.AVAILABLE.value,
    CanonicalStatus.RECEIVED.value: LegacyStatus.AVAILABLE.value,
}

LEGACY_STATUS_MAP: dict[str, str] = {
    LegacyStatus.AVAILABLE.value: CanonicalStatus.IN_STOCK.value,
    LegacyStatus.ASSIGNED.value: CanonicalStatus.CHECKED_OUT.value,
    LegacyStatus.NOT_WORKING.value: CanonicalStatus.QUARANTINE.value,
    LegacyStatus.NOT_WORKING_CAMEL.value: CanonicalStatus.QUARANTINE.value,
    LegacyStatus.REPAIR.value: CanonicalStatus.IN_REPAIR.value,
    LegacyStatus.IN_REPAIR.value: CanonicalStatus.IN_REPAIR.value,
    LegacyStatus.IN_REPAIR_CAMEL.value: CanonicalStatus.IN_REPAIR.value,
    LegacyStatus.EXPORTED.value: CanonicalStatus.EXPORTED.value,
    LegacyStatus.REMOVED_FROM_IT.value: CanonicalStatus.QUARANTINE.value,
    LegacyStatus.REMOVED.value: CanonicalStatus.QUARANTINE.value,
    LegacyStatus.DEAD.value: CanonicalStatus.RETIRED.value,
    LegacyStatus.DELETED.value: CanonicalStatus.RETIRED.value,
}

ASSIGNED_LOCATION_HINT_CATEGORIES = frozenset(
    {
        "Office Assets",
        "Transport Assets",
        "Infrastructure Assets",
    }
)

ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    CanonicalStatus.ORDERED.value: frozenset(
        {CanonicalStatus.IN_TRANSIT.value, CanonicalStatus.RECEIVED.value, CanonicalStatus.RETIRED.value}
    ),
    CanonicalStatus.IN_TRANSIT.value: frozenset(
        {CanonicalStatus.RECEIVED.value, CanonicalStatus.LOST.value, CanonicalStatus.RETIRED.value}
    ),
    CanonicalStatus.RECEIVED.value: frozenset(
        {CanonicalStatus.IN_STOCK.value, CanonicalStatus.QUARANTINE.value, CanonicalStatus.RETIRED.value}
    ),
    CanonicalStatus.IN_STOCK.value: frozenset(
        {
            CanonicalStatus.RESERVED.value,
            CanonicalStatus.CHECKED_OUT.value,
            CanonicalStatus.DEPLOYED.value,
            CanonicalStatus.IN_REPAIR.value,
            CanonicalStatus.QUARANTINE.value,
            CanonicalStatus.EXPORTED.value,
            CanonicalStatus.RETIRED.value,
        }
    ),
    CanonicalStatus.RESERVED.value: frozenset(
        {
            CanonicalStatus.IN_STOCK.value,
            CanonicalStatus.CHECKED_OUT.value,
            CanonicalStatus.DEPLOYED.value,
            CanonicalStatus.RETIRED.value,
        }
    ),
    CanonicalStatus.CHECKED_OUT.value: frozenset(
        {
            CanonicalStatus.IN_STOCK.value,
            CanonicalStatus.PENDING_RETURN.value,
            CanonicalStatus.IN_REPAIR.value,
            CanonicalStatus.QUARANTINE.value,
            CanonicalStatus.LOST.value,
            CanonicalStatus.RETIRED.value,
        }
    ),
    CanonicalStatus.DEPLOYED.value: frozenset(
        {
            CanonicalStatus.IN_STOCK.value,
            CanonicalStatus.IN_REPAIR.value,
            CanonicalStatus.QUARANTINE.value,
            CanonicalStatus.RETIRED.value,
        }
    ),
    CanonicalStatus.PENDING_RETURN.value: frozenset(
        {
            CanonicalStatus.CHECKED_OUT.value,
            CanonicalStatus.IN_STOCK.value,
            CanonicalStatus.QUARANTINE.value,
            CanonicalStatus.IN_REPAIR.value,
        }
    ),
    CanonicalStatus.IN_REPAIR.value: frozenset(
        {
            CanonicalStatus.IN_STOCK.value,
            CanonicalStatus.QUARANTINE.value,
            CanonicalStatus.RETIRED.value,
            CanonicalStatus.CHECKED_OUT.value,
        }
    ),
    CanonicalStatus.QUARANTINE.value: frozenset(
        {
            CanonicalStatus.IN_STOCK.value,
            CanonicalStatus.IN_REPAIR.value,
            CanonicalStatus.RETIRED.value,
            CanonicalStatus.EXPORTED.value,
        }
    ),
    CanonicalStatus.EXPORTED.value: frozenset(),
    CanonicalStatus.RETIRED.value: frozenset(),
    CanonicalStatus.LOST.value: frozenset({CanonicalStatus.IN_STOCK.value, CanonicalStatus.RETIRED.value}),
}


def canonical_status(
    legacy_or_canonical: Optional[str],
    *,
    inventory_category: Optional[str] = None,
    has_employee_assignee: Optional[bool] = None,
) -> Optional[str]:
    """
    Map a stored status string to canonical. Returns None if empty/unknown.

    Special case: legacy `assigned` + non-IT category (or no employee) → Deployed.
    """
    raw = str(legacy_or_canonical or "").strip()
    if not raw:
        return None

    if raw in CANONICAL_STATUSES:
        return raw

    lookup = None
    for legacy_key in LEGACY_STATUS_MAP:
        if legacy_key.lower() == raw.lower():
            lookup = legacy_key
            break

    if lookup is None:
        return None

    mapped = LEGACY_STATUS_MAP[lookup]

    if mapped == CanonicalStatus.CHECKED_OUT.value:
        cat = (inventory_category or "").strip()
        if cat in ASSIGNED_LOCATION_HINT_CATEGORIES:
            return CanonicalStatus.DEPLOYED.value
        if has_employee_assignee is False:
            return CanonicalStatus.DEPLOYED.value

    return mapped


def legacy_status_for_canonical(canonical: Optional[str]) -> Optional[str]:
    if not canonical:
        return None
    if canonical in CANONICAL_TO_LEGACY:
        return CANONICAL_TO_LEGACY[canonical]
    for legacy_key in LEGACY_STATUS_MAP:
        if legacy_key.lower() == str(canonical).lower():
            return legacy_key
    return None


def default_custody_type(canonical: Optional[str]) -> str:
    if not canonical:
        return CustodyType.NONE.value
    return DEFAULT_CUSTODY_FOR_STATUS.get(canonical, CustodyType.NONE.value)


def status_label(canonical_or_legacy: Optional[str]) -> str:
    canon = canonical_status(canonical_or_legacy) or str(canonical_or_legacy or "").strip()
    if not canon:
        return "—"
    return STATUS_LABELS.get(canon, canon)


def custody_label(custody_type: Optional[str]) -> str:
    raw = str(custody_type or CustodyType.NONE.value).strip().upper()
    return CUSTODY_LABELS.get(raw, raw or "None")


def is_terminal_status(status: Optional[str]) -> bool:
    return canonical_status(status) in TERMINAL_STATUSES or status in TERMINAL_STATUSES


def is_allowed_transition(from_status: Optional[str], to_status: Optional[str]) -> bool:
    """Soft allow-list. Unknown from → allow (backfill / first write)."""
    src = canonical_status(from_status)
    dst = canonical_status(to_status)
    if not dst:
        return False
    if not src:
        return True
    if src == dst:
        return True
    allowed = ALLOWED_TRANSITIONS.get(src)
    if allowed is None:
        return True
    return dst in allowed


def lifecycle_snapshot() -> dict:
    return {
        "canonical_statuses": list(CANONICAL_STATUSES),
        "custody_types": list(CUSTODY_TYPES),
        "condition_grades": list(CONDITION_GRADES),
        "terminal_statuses": sorted(TERMINAL_STATUSES),
        "legacy_status_map": dict(LEGACY_STATUS_MAP),
        "canonical_to_legacy": dict(CANONICAL_TO_LEGACY),
        "status_labels": dict(STATUS_LABELS),
        "custody_labels": dict(CUSTODY_LABELS),
        "default_custody_for_status": dict(DEFAULT_CUSTODY_FOR_STATUS),
        "assigned_location_hint_categories": sorted(ASSIGNED_LOCATION_HINT_CATEGORIES),
        "allowed_transitions": {k: sorted(v) for k, v in ALLOWED_TRANSITIONS.items()},
        "note": (
            "When itam_lifecycle_v1=1, dual-write lifecycle_status + custody_type "
            "while keeping legacy status for old filters. Deployed ≠ CheckedOut."
        ),
    }
