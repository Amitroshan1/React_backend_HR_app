"""ITAM Phase P0 — frozen contracts, flags (default OFF), lifecycle mapping.

No runtime behavior change until P1+ enables flags and wires transition_service.
"""

from .actions import ACTION_CODES, ACTION_LABELS, TransitionAction
from .contracts import (
    CONTRACT_VERSION,
    PHASE,
    TRANSITION_RECORD_FIELDS,
    api_contract_snapshot,
)
from .flags import (
    ITAM_FLAG_KEYS,
    get_itam_flags,
    is_itam_flag_enabled,
    load_itam_flags_from_env,
)
from .lifecycle import (
    CANONICAL_STATUSES,
    CUSTODY_TYPES,
    LEGACY_STATUS_MAP,
    ConditionGrade,
    CustodyType,
    LegacyStatus,
    canonical_status,
    custody_label,
    default_custody_type,
    is_allowed_transition,
    is_terminal_status,
    legacy_status_for_canonical,
    status_label,
)
from .remark_policy import (
    REMARK_POLICIES,
    RemarkPolicy,
    get_remark_policy,
    validate_remark,
)
from .transition_service import (
    TransitionValidationError,
    action_for_return_destination,
    action_for_unit_status,
    extract_remark_fields,
    record_transition,
    serialize_transition,
    transitions_enabled,
)
from .timeline_service import (
    backfill_from_assignments,
    latest_by_unit_ids,
    query_transitions,
    timeline_enabled,
    timeline_to_csv,
)
from .lifecycle_service import (
    LifecycleValidationError,
    apply_unit_lifecycle,
    backfill_unit_lifecycle,
    lifecycle_enabled,
    lifecycle_for_legacy_status_change,
    open_custody_count,
    resolve_unit_lifecycle,
    serialize_lifecycle_fields,
)

__all__ = [
    "ACTION_CODES",
    "ACTION_LABELS",
    "TransitionAction",
    "CONTRACT_VERSION",
    "PHASE",
    "TRANSITION_RECORD_FIELDS",
    "api_contract_snapshot",
    "ITAM_FLAG_KEYS",
    "get_itam_flags",
    "is_itam_flag_enabled",
    "load_itam_flags_from_env",
    "CANONICAL_STATUSES",
    "CUSTODY_TYPES",
    "LEGACY_STATUS_MAP",
    "ConditionGrade",
    "CustodyType",
    "LegacyStatus",
    "canonical_status",
    "custody_label",
    "default_custody_type",
    "is_allowed_transition",
    "is_terminal_status",
    "legacy_status_for_canonical",
    "status_label",
    "REMARK_POLICIES",
    "RemarkPolicy",
    "get_remark_policy",
    "validate_remark",
    "TransitionValidationError",
    "action_for_return_destination",
    "action_for_unit_status",
    "extract_remark_fields",
    "record_transition",
    "serialize_transition",
    "transitions_enabled",
    "backfill_from_assignments",
    "latest_by_unit_ids",
    "query_transitions",
    "timeline_enabled",
    "timeline_to_csv",
    "LifecycleValidationError",
    "apply_unit_lifecycle",
    "backfill_unit_lifecycle",
    "lifecycle_enabled",
    "lifecycle_for_legacy_status_change",
    "open_custody_count",
    "resolve_unit_lifecycle",
    "serialize_lifecycle_fields",
]
