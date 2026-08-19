"""ITAM feature flags — env-driven, default OFF for production safety."""

from __future__ import annotations

import os
from typing import Any, Mapping, Optional

# Canonical flag names (API / frontend / docs). Env vars use UPPER_SNAKE.
ITAM_FLAG_KEYS = (
    "itam_transitions_v1",  # P1: mandatory remarks + transition writes
    "itam_timeline_v1",  # P2: asset history timeline UI/API
    "itam_lifecycle_v1",  # P3: canonical status + custody_type live
    "itam_api_first_v1",  # P4: dual-write / localStorage mutate off
    "itam_self_service_v1",  # P5: employee my-assets / return
    "itam_offboard_gate_v1",  # P6: NOC blocked on open custody
)

_ENV_BY_FLAG = {
    "itam_transitions_v1": "ITAM_TRANSITIONS_V1",
    "itam_timeline_v1": "ITAM_TIMELINE_V1",
    "itam_lifecycle_v1": "ITAM_LIFECYCLE_V1",
    "itam_api_first_v1": "ITAM_API_FIRST_V1",
    "itam_self_service_v1": "ITAM_SELF_SERVICE_V1",
    "itam_offboard_gate_v1": "ITAM_OFFBOARD_GATE_V1",
}

_TRUTHY = frozenset({"1", "true", "yes", "on"})


def _parse_bool(raw: Optional[str], default: bool = False) -> bool:
    if raw is None:
        return default
    return str(raw).strip().lower() in _TRUTHY


def load_itam_flags_from_env(environ: Optional[Mapping[str, str]] = None) -> dict[str, bool]:
    """Load all ITAM flags from environment. Defaults are False."""
    src = environ if environ is not None else os.environ
    return {
        key: _parse_bool(src.get(env_name), default=False)
        for key, env_name in _ENV_BY_FLAG.items()
    }


def get_itam_flags(config: Optional[Mapping[str, Any]] = None) -> dict[str, bool]:
    """
    Resolve flags from Flask app.config when available, else env.

    App config keys match flag names (e.g. config['itam_transitions_v1']).
    """
    if config is None:
        try:
            from flask import current_app, has_app_context

            if has_app_context():
                config = current_app.config
        except Exception:
            config = None

    if not config:
        return load_itam_flags_from_env()

    flags: dict[str, bool] = {}
    for key in ITAM_FLAG_KEYS:
        if key in config:
            flags[key] = bool(config[key])
        else:
            flags[key] = _parse_bool(os.getenv(_ENV_BY_FLAG[key]), default=False)
    return flags


def is_itam_flag_enabled(flag_key: str, config: Optional[Mapping[str, Any]] = None) -> bool:
    if flag_key not in ITAM_FLAG_KEYS:
        return False
    return bool(get_itam_flags(config).get(flag_key, False))
