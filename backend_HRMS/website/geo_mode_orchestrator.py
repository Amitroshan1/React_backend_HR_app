"""
Geo engine mode orchestrator — Phase 6 Shadow / Rollout.

Does NOT modify geo_fence_engine or geo_validation_service internals.
Reuses _legacy_validate / _v2_validate / write_geo_audit for attendance.

Modes (GEO_ENGINE_MODE):
  LEGACY — legacy is source of truth
  SHADOW — legacy is source of truth; V2 runs for comparison only
  V2     — V2 is source of truth (optional legacy fallback on error)
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any, Mapping, Optional

from flask import has_app_context, request
from sqlalchemy.orm import Session

from . import db
from .geo_fence_config import get_geo_fence_config
from .geo_validation_service import (
    GEO_NO_GPS,
    POLICY_REQUIRE_REASON,
    GeoValidationResult,
    _cfg,
    _legacy_validate,
    _new_attempt_id,
    _safe_float,
    _v2_validate,
    apply_session_geo_fields,
    attach_audit_to_session,
    reason_min_chars,
    write_geo_audit,
)
from .models.geo_engine_comparison import GeoEngineComparison

logger = logging.getLogger(__name__)

# Re-export helpers so auth can import from one place
__all__ = [
    "validate_employee_location",
    "apply_session_geo_fields",
    "attach_audit_to_session",
    "reason_min_chars",
    "get_engine_mode",
]


def get_engine_mode(cfg: Optional[Mapping[str, Any]] = None) -> str:
    c = dict(cfg or get_geo_fence_config())
    mode = str(c.get("GEO_ENGINE_MODE") or "SHADOW").strip().upper()
    return mode if mode in {"LEGACY", "SHADOW", "V2"} else "SHADOW"


def _diff_category(legacy_decision: Optional[str], v2_decision: Optional[str]) -> Optional[str]:
    ld = (legacy_decision or "UNKNOWN").upper()
    vd = (v2_decision or "UNKNOWN").upper()
    if ld == vd:
        return None
    return f"{ld} → {vd}"


def _store_comparison(**kwargs) -> None:
    """Independent session — never rolls back punch transaction."""
    try:
        bind = db.session.get_bind()
        row = GeoEngineComparison(**kwargs)
        with Session(bind) as sess:
            sess.add(row)
            sess.commit()
    except Exception:
        logger.exception("geo_shadow: comparison storage failed (non-fatal)")


def _safe_error_result(payload: dict, attempt_id: str, cfg: dict, err: Exception) -> GeoValidationResult:
    return GeoValidationResult(
        engine="error_fallback",
        success=False,
        geo_decision=GEO_NO_GPS,
        policy_action=POLICY_REQUIRE_REASON,
        confidence=0.0,
        distance_m=None,
        matched_radius_m=None,
        matched_grace_m=float(cfg.get("DEFAULT_OFFICE_GRACE_M") or 25),
        office_id=None,
        office_name=None,
        location_status="gps_unavailable",
        zone="NO_GPS",
        in_range=False,
        requires_reason=True,
        attempt_id=attempt_id,
        latitude=_safe_float(payload.get("lat") or payload.get("latitude")),
        longitude=_safe_float(payload.get("lon") or payload.get("longitude")),
        accuracy_m=_safe_float(payload.get("accuracy") or payload.get("accuracy_m")),
        network_match=bool(payload.get("network_match")),
        diagnostics={"error": str(err)},
        error="GEO_ENGINE_FAILURE",
    )


def validate_employee_location(
    *,
    payload: Optional[Mapping[str, Any]] = None,
    admin_id: Optional[int] = None,
    direction: str = "check",
    write_audit: bool = True,
    user_agent: Optional[str] = None,
    force_legacy: bool = False,
) -> GeoValidationResult:
    """
    Attendance-facing entry (same signature as geo_validation_service.validate_employee_location).

    Shadow V2 results never affect requires_reason / zone returned to punch.
    """
    req_t0 = time.perf_counter()
    payload = dict(payload or {})
    cfg = _cfg()
    mode = "LEGACY" if force_legacy else get_engine_mode(cfg)
    attempt_id = _new_attempt_id(payload.get("attempt_id"))
    payload["attempt_id"] = attempt_id

    if not user_agent and has_app_context():
        try:
            user_agent = request.headers.get("User-Agent")
        except Exception:
            user_agent = None

    device = payload.get("device_class") or payload.get("device_type")
    browser = None  # filled from UA in audit; optional on comparison

    # ----- LEGACY -----
    if mode == "LEGACY":
        t0 = time.perf_counter()
        try:
            result = _legacy_validate(payload, attempt_id)
        except Exception as e:
            logger.exception("geo_mode: legacy failure")
            result = _safe_error_result(payload, attempt_id, cfg, e)
        result.diagnostics = dict(result.diagnostics or {})
        result.diagnostics["geo_engine_mode"] = "LEGACY"
        result.diagnostics["execution_time_ms"] = round((time.perf_counter() - t0) * 1000, 2)
        if write_audit:
            t_audit = time.perf_counter()
            result.audit_id = write_geo_audit(
                result=result,
                admin_id=admin_id,
                direction=direction,
                payload=payload,
                user_agent=user_agent,
            )
            result.diagnostics["audit_insert_ms"] = round((time.perf_counter() - t_audit) * 1000, 2)
        result.diagnostics["total_validation_ms"] = round((time.perf_counter() - req_t0) * 1000, 2)
        return result

    # ----- V2 (source of truth) -----
    if mode == "V2":
        t0 = time.perf_counter()
        try:
            result = _v2_validate(payload, attempt_id, cfg)
        except Exception as e:
            logger.exception("geo_mode: V2 failure")
            if cfg.get("GEO_V2_FALLBACK_ON_ERROR", True):
                try:
                    result = _legacy_validate(payload, attempt_id)
                    result.diagnostics = dict(result.diagnostics or {})
                    result.diagnostics["geo_engine_mode"] = "V2"
                    result.diagnostics["fallback"] = "legacy"
                    result.diagnostics["v2_error"] = str(e)
                except Exception as e2:
                    result = _safe_error_result(payload, attempt_id, cfg, e2)
            else:
                result = _safe_error_result(payload, attempt_id, cfg, e)
        result.diagnostics = dict(result.diagnostics or {})
        result.diagnostics["geo_engine_mode"] = "V2"
        result.diagnostics["execution_time_ms"] = round((time.perf_counter() - t0) * 1000, 2)
        if write_audit:
            t_audit = time.perf_counter()
            result.audit_id = write_geo_audit(
                result=result,
                admin_id=admin_id,
                direction=direction,
                payload=payload,
                user_agent=user_agent,
            )
            result.diagnostics["audit_insert_ms"] = round((time.perf_counter() - t_audit) * 1000, 2)
        result.diagnostics["total_validation_ms"] = round((time.perf_counter() - req_t0) * 1000, 2)
        return result

    # ----- SHADOW (legacy truth + V2 compare) -----
    t0 = time.perf_counter()
    try:
        legacy = _legacy_validate(payload, attempt_id)
    except Exception as e:
        logger.exception("geo_mode: shadow legacy failure")
        legacy = _safe_error_result(payload, attempt_id, cfg, e)
    legacy_ms = round((time.perf_counter() - t0) * 1000, 2)

    v2 = None
    v2_ms = None
    status = "ok"
    err_note = None
    t1 = time.perf_counter()
    try:
        v2 = _v2_validate(payload, attempt_id, cfg)
        v2_ms = round((time.perf_counter() - t1) * 1000, 2)
    except Exception as e:
        status = "v2_failed"
        err_note = str(e)[:200]
        v2_ms = round((time.perf_counter() - t1) * 1000, 2)
        logger.exception("geo_mode: shadow V2 failed (punch continues on legacy)")

    # Comparison storage — never affects returned legacy result
    comparison_store_ms = None
    try:
        t_cmp = time.perf_counter()
        ld = legacy.geo_decision
        vd = v2.geo_decision if v2 else None
        lp = legacy.policy_action
        vp = v2.policy_action if v2 else None
        decision_match = bool(v2 and ld == vd)
        policy_match = bool(v2 and lp == vp)
        reason_match = bool(v2 and bool(legacy.requires_reason) == bool(v2.requires_reason))
        _store_comparison(
            attempt_id=attempt_id[:64],
            admin_id=admin_id,
            office_id=(v2.office_id if v2 and v2.office_id is not None else legacy.office_id),
            office_name=(v2.office_name if v2 and v2.office_name else legacy.office_name),
            legacy_zone=legacy.zone,
            legacy_requires_reason=bool(legacy.requires_reason),
            legacy_distance_m=legacy.distance_m,
            legacy_decision=ld,
            legacy_policy=lp,
            v2_decision=vd,
            v2_policy=vp,
            v2_confidence=(v2.confidence if v2 else None),
            v2_distance_m=(v2.distance_m if v2 else None),
            decision_match=decision_match,
            reason_match=reason_match,
            policy_match=policy_match,
            difference_category=_diff_category(ld, vd),
            execution_time_legacy_ms=legacy_ms,
            execution_time_v2_ms=v2_ms,
            accuracy_m=legacy.accuracy_m or (v2.accuracy_m if v2 else None),
            browser=None,
            device_type=str(device)[:20] if device else None,
            direction=(direction or "check")[:10],
            comparison_status=status,
            error_note=err_note,
            created_at=datetime.utcnow(),
        )
        comparison_store_ms = round((time.perf_counter() - t_cmp) * 1000, 2)
    except Exception:
        logger.exception("geo_mode: comparison build failed (non-fatal)")

    legacy.diagnostics = dict(legacy.diagnostics or {})
    legacy.diagnostics["geo_engine_mode"] = "SHADOW"
    legacy.diagnostics["execution_time_legacy_ms"] = legacy_ms
    legacy.diagnostics["execution_time_v2_ms"] = v2_ms
    legacy.diagnostics["comparison_store_ms"] = comparison_store_ms
    legacy.diagnostics["shadow_v2_decision"] = v2.geo_decision if v2 else None
    legacy.diagnostics["shadow_decision_match"] = bool(v2 and legacy.geo_decision == v2.geo_decision)

    if write_audit:
        t_audit = time.perf_counter()
        legacy.audit_id = write_geo_audit(
            result=legacy,
            admin_id=admin_id,
            direction=direction,
            payload=payload,
            user_agent=user_agent,
        )
        legacy.diagnostics["audit_insert_ms"] = round((time.perf_counter() - t_audit) * 1000, 2)
    legacy.diagnostics["total_validation_ms"] = round((time.perf_counter() - req_t0) * 1000, 2)
    return legacy
