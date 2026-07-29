"""
Geo Validation Service — attendance-facing facade over geo_fence_engine.

Punch / location-check APIs must call this service, never the engine directly.

Responsibilities:
- Load offices + geo config
- Build measurement from request payload
- Call geo_fence_engine (V2) or legacy resolve_geofence (flag off)
- Persist geo_punch_attempts audit (single place)
- Return a stable GeoValidationResult for attendance rules

Does NOT know: leave, WFH, shifts, punch session business rules.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping, Optional

from flask import current_app, has_app_context, request

from . import db
from .geo_fence_config import get_geo_fence_config
from .geo_fence_engine import (
    GEO_INSIDE,
    GEO_LOW_SIGNAL,
    GEO_NO_GPS,
    GEO_NO_OFFICE,
    GEO_OUTSIDE,
    GEO_UNCERTAIN,
    POLICY_ALLOW,
    POLICY_ALLOW_FLAGGED,
    POLICY_REQUIRE_REASON,
    office_records_from_orm,
)
from .models.attendance import Location
from .models.geo_punch_attempt import GeoPunchAttempt

logger = logging.getLogger(__name__)


@dataclass
class GeoValidationResult:
    """Standardized result for Attendance / location-check."""

    engine: str  # v2 | legacy
    success: bool
    geo_decision: str
    policy_action: str
    confidence: float
    distance_m: Optional[float]
    matched_radius_m: Optional[float]
    matched_grace_m: Optional[float]
    office_id: Optional[int]
    office_name: Optional[str]
    location_status: str
    zone: str  # backward-compatible zone label for existing clients
    in_range: bool
    requires_reason: bool
    attempt_id: str
    latitude: Optional[float]
    longitude: Optional[float]
    accuracy_m: Optional[float]
    network_match: bool
    spatial_class: Optional[str] = None
    diagnostics: dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    audit_id: Optional[int] = None

    def to_location_check_dict(self) -> dict[str, Any]:
        return {
            "success": True,
            "zone": self.zone,
            "in_range": self.in_range,
            "distance_meters": int(self.distance_m) if self.distance_m is not None else None,
            "radius_meters": self.matched_radius_m,
            "grace_meters": self.matched_grace_m,
            "requires_reason": self.requires_reason,
            "message": f"{self.zone} zone",
            # V2 extras (safe for old clients to ignore)
            "geo_engine": self.engine,
            "geo_decision": self.geo_decision,
            "policy_action": self.policy_action,
            "confidence": self.confidence,
            "spatial_class": self.spatial_class,
            "office_id": self.office_id,
            "office_name": self.office_name,
            "accuracy_m": self.accuracy_m,
            "attempt_id": self.attempt_id,
            "network_match": self.network_match,
        }


def _cfg() -> dict[str, Any]:
    if has_app_context():
        # Prefer live app.config (env loaded at boot)
        keys = get_geo_fence_config()
        merged = dict(keys)
        for k in keys:
            if k in current_app.config and current_app.config[k] is not None:
                merged[k] = current_app.config[k]
        return merged
    return get_geo_fence_config()


def is_geo_v2_enabled(cfg: Optional[Mapping[str, Any]] = None) -> bool:
    c = dict(cfg or _cfg())
    return bool(c.get("GEO_FENCE_V2", True))


def _new_attempt_id(explicit: Any) -> str:
    raw = str(explicit or "").strip()
    if raw and len(raw) <= 64:
        return raw
    return str(uuid.uuid4())


def _client_ip() -> Optional[str]:
    try:
        if not has_app_context() or request is None:
            return None
        forwarded = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        return forwarded or (request.remote_addr or None)
    except Exception:
        return None


def _parse_ua_bits(user_agent: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    ua = (user_agent or "").strip()
    if not ua:
        return None, None
    browser = None
    os_name = None
    low = ua.lower()
    if "edg/" in low:
        browser = "Edge"
    elif "chrome/" in low and "chromium" not in low:
        browser = "Chrome"
    elif "firefox/" in low:
        browser = "Firefox"
    elif "safari/" in low and "chrome/" not in low:
        browser = "Safari"
    if "windows" in low:
        os_name = "Windows"
    elif "android" in low:
        os_name = "Android"
    elif "iphone" in low or "ipad" in low or "ios" in low:
        os_name = "iOS"
    elif "mac os" in low or "macintosh" in low:
        os_name = "macOS"
    elif "linux" in low:
        os_name = "Linux"
    return browser, os_name


def geo_decision_to_location_status(geo_decision: str) -> str:
    return {
        GEO_INSIDE: "inside_geofence",
        GEO_UNCERTAIN: "uncertain_geofence",
        GEO_OUTSIDE: "outside_geofence",
        GEO_LOW_SIGNAL: "low_signal",
        GEO_NO_GPS: "gps_unavailable",
        GEO_NO_OFFICE: "office_not_configured",
    }.get(geo_decision or "", "location_not_captured")


def geo_decision_to_legacy_zone(geo_decision: str) -> str:
    """Map V2 decisions onto legacy zone strings used by existing UI."""
    return {
        GEO_INSIDE: "INSIDE",
        GEO_UNCERTAIN: "NEAR",  # in_range true, soft edge — closest legacy analog
        GEO_OUTSIDE: "OUTSIDE",
        GEO_LOW_SIGNAL: "NO_GPS",
        GEO_NO_GPS: "NO_GPS",
        GEO_NO_OFFICE: "NO_OFFICE_CONFIG",
    }.get(geo_decision or "", "NO_GPS")


def _load_office_rows() -> list:
    try:
        return Location.query.all()
    except Exception:
        logger.exception("geo_validation: failed to load Location rows")
        return []


def write_geo_audit(
    *,
    result: GeoValidationResult,
    admin_id: Optional[int],
    direction: str,
    payload: Mapping[str, Any],
    punch_session_id: Optional[int] = None,
    user_agent: Optional[str] = None,
) -> Optional[int]:
    """
    Single audit writer for all APIs. Never raises.
    Uses a short-lived Session so audits survive punch rollbacks / early 400s.
    """
    from sqlalchemy.orm import Session

    try:
        browser, os_name = _parse_ua_bits(user_agent)
        device = (
            payload.get("device_class") or payload.get("device_type") or result.diagnostics.get("device_class")
        )
        row = GeoPunchAttempt(
            attempt_id=result.attempt_id[:64],
            admin_id=admin_id,
            punch_session_id=punch_session_id,
            direction=(direction or "check")[:10],
            latitude=result.latitude,
            longitude=result.longitude,
            accuracy_m=result.accuracy_m,
            distance_m=result.distance_m,
            office_id=result.office_id,
            office_name=(result.office_name or None),
            radius_m=result.matched_radius_m,
            grace_m=result.matched_grace_m,
            confidence_score=result.confidence,
            geo_decision=result.geo_decision,
            spatial_class=result.spatial_class,
            policy_action=result.policy_action,
            network_match=bool(result.network_match),
            device_type=str(device)[:20] if device else None,
            browser=browser,
            operating_system=os_name,
            user_agent=(user_agent or "")[:512] or None,
            sample_count=_safe_int(payload.get("sample_count")),
            spread_m=_safe_float(payload.get("spread_m", payload.get("spread"))),
            retry_count=_safe_int(payload.get("retry_count")),
            acquisition_ms=_safe_int(payload.get("acquisition_ms", payload.get("acquisition_time"))),
            client_ip=_client_ip(),
            flag_reason=(result.diagnostics.get("flag_reason") if result.diagnostics else None),
            error_code=result.error,
            created_at=datetime.utcnow(),
        )
        bind = db.session.get_bind()
        with Session(bind) as audit_sess:
            audit_sess.add(row)
            audit_sess.commit()
            return row.id
    except Exception:
        logger.exception("geo_validation: audit write failed (non-fatal)")
        return None


def attach_audit_to_session(audit_id: Optional[int], punch_session_id: int) -> None:
    """
    Link geo_punch_attempts.punch_session_id after the punch transaction has committed.

    Must NOT run while the punch Session still holds an open transaction / row lock on
    punch_sessions: this uses a separate connection, and the FK update will block until
    innodb_lock_wait_timeout (MySQL 1205), stalling Punch In/Out for ~50s.
    Never raises — audit must not own or roll back the punch transaction.
    """
    if not audit_id or not punch_session_id:
        return
    from sqlalchemy.orm import Session

    try:
        bind = db.session.get_bind()
        with Session(bind) as audit_sess:
            row = audit_sess.get(GeoPunchAttempt, audit_id)
            if row:
                row.punch_session_id = punch_session_id
                audit_sess.commit()
    except Exception:
        logger.exception("geo_validation: attach audit failed (non-fatal)")


def _safe_int(v: Any) -> Optional[int]:
    try:
        if v is None or v == "":
            return None
        return int(v)
    except (TypeError, ValueError):
        return None


def _safe_float(v: Any) -> Optional[float]:
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _legacy_validate(payload: Mapping[str, Any], attempt_id: str) -> GeoValidationResult:
    """Feature flag off — use existing auth.resolve_geofence_for_coordinates."""
    from .auth import (
        GEOFENCE_GRACE_METERS,
        needs_reason_for_zone,
        resolve_geofence_for_coordinates,
    )

    lat = payload.get("lat", payload.get("latitude"))
    lon = payload.get("lon", payload.get("longitude"))
    geo = resolve_geofence_for_coordinates(lat, lon)
    zone = geo.get("zone") or "NO_GPS"
    in_range = bool(geo.get("in_range"))
    requires = needs_reason_for_zone(zone)
    decision = {
        "INSIDE": GEO_INSIDE,
        "NEAR": GEO_UNCERTAIN,
        "OUTSIDE": GEO_OUTSIDE,
        "NO_GPS": GEO_NO_GPS,
        "NO_OFFICE_CONFIG": GEO_NO_OFFICE,
    }.get(zone, GEO_NO_GPS)
    policy = POLICY_REQUIRE_REASON if requires else (POLICY_ALLOW if in_range else POLICY_ALLOW_FLAGGED)
    return GeoValidationResult(
        engine="legacy",
        success=True,
        geo_decision=decision,
        policy_action=policy,
        confidence=0.0,
        distance_m=float(geo["distance_meters"]) if geo.get("distance_meters") is not None else None,
        matched_radius_m=geo.get("radius_meters"),
        matched_grace_m=float(GEOFENCE_GRACE_METERS),
        office_id=None,
        office_name=None,
        location_status=geo.get("location_status") or "location_not_captured",
        zone=zone,
        in_range=in_range,
        requires_reason=requires,
        attempt_id=attempt_id,
        latitude=_safe_float(lat),
        longitude=_safe_float(lon),
        accuracy_m=_safe_float(payload.get("accuracy") or payload.get("accuracy_m")),
        network_match=bool(payload.get("network_match")),
        spatial_class=None,
        diagnostics={"legacy": True},
    )


def _v2_validate(payload: Mapping[str, Any], attempt_id: str, cfg: Mapping[str, Any]) -> GeoValidationResult:
    from .geo_fence_engine import build_measurement, evaluate_geofence

    offices = office_records_from_orm(_load_office_rows(), cfg)
    body = dict(payload)
    if "latitude" not in body and "lat" in body:
        body["latitude"] = body.get("lat")
    if "longitude" not in body and "lon" in body:
        body["longitude"] = body.get("lon")

    measurement = build_measurement(**body)
    engine_result = evaluate_geofence(measurement=measurement, offices=offices, cfg=cfg)

    office = engine_result.office or {}
    decision = engine_result.geo_decision
    policy = engine_result.policy_action

    if decision == GEO_INSIDE:
        in_range = True
    elif decision == GEO_UNCERTAIN:
        in_range = True
    else:
        in_range = False

    return GeoValidationResult(
        engine="v2",
        success=True,
        geo_decision=decision,
        policy_action=policy,
        confidence=float(engine_result.confidence or 0),
        distance_m=engine_result.distance_m,
        matched_radius_m=engine_result.matched_radius_m,
        matched_grace_m=engine_result.matched_grace_m,
        office_id=office.get("id"),
        office_name=office.get("name"),
        location_status=geo_decision_to_location_status(decision),
        zone=geo_decision_to_legacy_zone(decision),
        in_range=in_range,
        requires_reason=(policy == POLICY_REQUIRE_REASON),
        attempt_id=attempt_id,
        latitude=measurement.latitude,
        longitude=measurement.longitude,
        accuracy_m=measurement.accuracy_m,
        network_match=bool(measurement.network_match),
        spatial_class=engine_result.spatial_class,
        diagnostics=dict(engine_result.diagnostics or {}),
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
    Main entry for Punch In / Out / Location Check.

    Never raises for geo/DB issues — returns a safe REQUIRE_REASON / NO_GPS style result.
    """
    payload = dict(payload or {})
    cfg = _cfg()
    attempt_id = _new_attempt_id(payload.get("attempt_id"))
    payload["attempt_id"] = attempt_id

    if not user_agent and has_app_context():
        try:
            user_agent = request.headers.get("User-Agent")
        except Exception:
            user_agent = None

    try:
        if force_legacy or not is_geo_v2_enabled(cfg):
            result = _legacy_validate(payload, attempt_id)
        else:
            result = _v2_validate(payload, attempt_id, cfg)
    except Exception as e:
        logger.exception("geo_validation: engine failure — safe fallback")
        result = GeoValidationResult(
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
            diagnostics={"error": str(e)},
            error="GEO_ENGINE_FAILURE",
        )

    if write_audit:
        audit_id = write_geo_audit(
            result=result,
            admin_id=admin_id,
            direction=direction,
            payload=payload,
            user_agent=user_agent,
        )
        result.audit_id = audit_id

    return result


def reason_min_chars(cfg: Optional[Mapping[str, Any]] = None) -> int:
    c = dict(cfg or _cfg())
    try:
        return int(c.get("GEO_REASON_MIN_CHARS") or 10)
    except (TypeError, ValueError):
        return 10


def apply_session_geo_fields(session_obj: Any, result: GeoValidationResult, *, direction: str) -> None:
    """Best-effort set optional V2 columns on PunchSession if present."""
    if session_obj is None or result is None:
        return
    try:
        if hasattr(session_obj, "accuracy_m"):
            session_obj.accuracy_m = result.accuracy_m
        if hasattr(session_obj, "geo_decision"):
            session_obj.geo_decision = result.geo_decision
        if hasattr(session_obj, "geo_office_id"):
            session_obj.geo_office_id = result.office_id
        if hasattr(session_obj, "confidence_score"):
            session_obj.confidence_score = result.confidence
    except Exception:
        logger.exception("geo_validation: apply_session_geo_fields failed")
