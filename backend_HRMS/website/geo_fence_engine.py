"""
Geo-fencing V2 — isolated evaluation engine.

Knows NOTHING about leave, WFH, punch sessions, employees, or attendance policy.
Callers (Punch In/Out, location-check, mobile) supply offices + measurement and
interpret GeofenceResult.policy_action.

Network match increases confidence ONLY (via NETWORK_WEIGHT). It never forces INSIDE.

Legacy auth.calculate_distance / resolve_geofence_for_coordinates remain unchanged
until Step 3 migration.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from math import atan2, cos, radians, sin, sqrt
from typing import Any, Iterable, Mapping, Optional, Sequence

from .geo_fence_config import get_geo_fence_config


# ---------------------------------------------------------------------------
# Public constants
# ---------------------------------------------------------------------------

GEO_INSIDE = "INSIDE"
GEO_UNCERTAIN = "UNCERTAIN"
GEO_LOW_SIGNAL = "LOW_SIGNAL"
GEO_OUTSIDE = "OUTSIDE"
GEO_NO_GPS = "NO_GPS"
GEO_NO_OFFICE = "NO_OFFICE"

SPATIAL_CONTAINED = "CONTAINED"
SPATIAL_INTERSECTS = "INTERSECTS"
SPATIAL_DISJOINT = "DISJOINT"

POLICY_ALLOW = "ALLOW"
POLICY_ALLOW_FLAGGED = "ALLOW_FLAGGED"
POLICY_REQUIRE_REASON = "REQUIRE_REASON"
POLICY_DENY = "DENY"  # reserved; geo engine does not emit DENY by default


# ---------------------------------------------------------------------------
# Data contracts
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class OfficeRecord:
    """Injectable office fence — no ORM dependency."""

    id: Optional[int]
    name: str
    latitude: float
    longitude: float
    radius_m: float
    grace_m: float

    @staticmethod
    def from_mapping(row: Mapping[str, Any], *, default_radius: float, default_grace: float) -> Optional["OfficeRecord"]:
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (KeyError, TypeError, ValueError):
            return None
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return None
        radius = row.get("radius", row.get("radius_m"))
        grace = row.get("grace", row.get("grace_m"))
        try:
            radius_m = float(radius) if radius is not None else default_radius
        except (TypeError, ValueError):
            radius_m = default_radius
        try:
            grace_m = float(grace) if grace is not None else default_grace
        except (TypeError, ValueError):
            grace_m = default_grace
        if radius_m <= 0:
            return None
        if grace_m < 0:
            grace_m = default_grace
        return OfficeRecord(
            id=row.get("id"),
            name=str(row.get("name") or "Office"),
            latitude=lat,
            longitude=lon,
            radius_m=radius_m,
            grace_m=grace_m,
        )


@dataclass(frozen=True)
class GeoMeasurement:
    """Validated client measurement. Client confidence/decision fields are ignored."""

    latitude: Optional[float]
    longitude: Optional[float]
    accuracy_m: Optional[float]
    sample_count: int
    spread_m: Optional[float]
    acquisition_ms: Optional[int]
    device_class: str  # mobile | desktop
    network_match: bool
    fix_age_ms: Optional[int] = None  # age of chosen fix; None → treat as fresh within window


@dataclass
class GeofenceResult:
    office: Optional[dict[str, Any]]
    distance_m: Optional[float]
    confidence: float
    geo_decision: str
    policy_action: str
    matched_radius_m: Optional[float]
    matched_grace_m: Optional[float]
    spatial_class: Optional[str]
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "office": self.office,
            "distance": self.distance_m,
            "distance_m": self.distance_m,
            "confidence": self.confidence,
            "geo_decision": self.geo_decision,
            "policy_action": self.policy_action,
            "matched_radius": self.matched_radius_m,
            "matched_radius_m": self.matched_radius_m,
            "matched_grace": self.matched_grace_m,
            "matched_grace_m": self.matched_grace_m,
            "spatial_class": self.spatial_class,
            "diagnostics": self.diagnostics,
        }


# ---------------------------------------------------------------------------
# 1) Distance Engine
# ---------------------------------------------------------------------------

def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters (same formula as legacy auth.calculate_distance)."""
    r = 6371000.0
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    a = (
        sin(d_lat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
    )
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return r * c


# ---------------------------------------------------------------------------
# 2) Office Selection Engine
# ---------------------------------------------------------------------------

def select_nearest_office(
    lat: float,
    lon: float,
    offices: Sequence[OfficeRecord],
) -> tuple[Optional[OfficeRecord], Optional[float]]:
    """
    Pick office with minimum distance. Multi-office safe.
    Returns (office, distance_m) or (None, None) if no usable offices.
    """
    best: Optional[OfficeRecord] = None
    best_d: Optional[float] = None
    for office in offices:
        d = haversine_distance_m(lat, lon, office.latitude, office.longitude)
        if best_d is None or d < best_d:
            best = office
            best_d = d
    return best, best_d


def offices_from_rows(
    rows: Iterable[Mapping[str, Any]],
    cfg: Optional[Mapping[str, Any]] = None,
) -> list[OfficeRecord]:
    c = dict(cfg or get_geo_fence_config())
    default_r = float(c["DEFAULT_OFFICE_RADIUS_M"])
    default_g = float(c["DEFAULT_OFFICE_GRACE_M"])
    out: list[OfficeRecord] = []
    for row in rows or []:
        rec = OfficeRecord.from_mapping(row, default_radius=default_r, default_grace=default_g)
        if rec:
            out.append(rec)
    return out


# ---------------------------------------------------------------------------
# 3) Sample / input evaluation
# ---------------------------------------------------------------------------

def parse_latitude(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if -90 <= f <= 90:
        return f
    return None


def parse_longitude(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if -180 <= f <= 180:
        return f
    return None


def normalize_device_class(value: Any) -> str:
    v = str(value or "").strip().lower()
    if v in {"mobile", "phone", "android", "ios"}:
        return "mobile"
    return "desktop"


def build_measurement(
    *,
    latitude: Any = None,
    longitude: Any = None,
    accuracy: Any = None,
    accuracy_m: Any = None,
    sample_count: Any = None,
    spread: Any = None,
    spread_m: Any = None,
    acquisition_ms: Any = None,
    acquisition_time: Any = None,
    device_class: Any = None,
    device_type: Any = None,
    network_match: Any = False,
    fix_age_ms: Any = None,
    # Explicitly ignored if present on payload:
    confidence: Any = None,
    geo_decision: Any = None,
    policy_action: Any = None,
    **_ignored: Any,
) -> GeoMeasurement:
    """
    Validate and normalize engine inputs.
    Client-supplied confidence / geo_decision / policy_action are discarded.
    """
    _ = (confidence, geo_decision, policy_action)

    lat = parse_latitude(latitude)
    lon = parse_longitude(longitude)

    acc_raw = accuracy_m if accuracy_m is not None else accuracy
    try:
        acc = float(acc_raw) if acc_raw is not None and acc_raw != "" else None
    except (TypeError, ValueError):
        acc = None
    if acc is not None and (acc < 0 or acc != acc):  # NaN check
        acc = None

    try:
        n = int(sample_count) if sample_count is not None else 1
    except (TypeError, ValueError):
        n = 1
    if n < 1:
        n = 1
    if n > 50:
        n = 50

    spread_raw = spread_m if spread_m is not None else spread
    try:
        spr = float(spread_raw) if spread_raw is not None and spread_raw != "" else None
    except (TypeError, ValueError):
        spr = None
    if spr is not None and spr < 0:
        spr = None

    acq_raw = acquisition_ms if acquisition_ms is not None else acquisition_time
    try:
        acq = int(acq_raw) if acq_raw is not None and acq_raw != "" else None
    except (TypeError, ValueError):
        acq = None
    if acq is not None and acq < 0:
        acq = None

    try:
        age = int(fix_age_ms) if fix_age_ms is not None and fix_age_ms != "" else None
    except (TypeError, ValueError):
        age = None
    if age is not None and age < 0:
        age = None

    net = bool(network_match) if network_match not in (None, "") else False
    device = normalize_device_class(device_class if device_class is not None else device_type)

    return GeoMeasurement(
        latitude=lat,
        longitude=lon,
        accuracy_m=acc,
        sample_count=n,
        spread_m=spr,
        acquisition_ms=acq,
        device_class=device,
        network_match=net,
        fix_age_ms=age,
    )


# ---------------------------------------------------------------------------
# 4) Confidence Engine (server-side only)
# ---------------------------------------------------------------------------

def _accuracy_component_score(accuracy_m: Optional[float]) -> float:
    if accuracy_m is None:
        return 20.0
    a = float(accuracy_m)
    if a <= 20:
        return 100.0
    if a <= 50:
        return 85.0
    if a <= 100:
        return 65.0
    if a <= 200:
        return 40.0
    if a <= 400:
        return 20.0
    return 0.0


def _consistency_component_score(spread_m: Optional[float], sample_count: int) -> float:
    if sample_count < 2:
        return 40.0
    if spread_m is None:
        return 40.0
    s = float(spread_m)
    if s <= 30:
        return 100.0
    if s <= 50:
        return 80.0
    if s <= 100:
        return 55.0
    if s <= 200:
        return 25.0
    return 0.0


def _sample_count_component_score(sample_count: int) -> float:
    if sample_count <= 1:
        return 30.0
    if sample_count == 2:
        return 60.0
    if sample_count == 3:
        return 85.0
    return 100.0


def _freshness_component_score(fix_age_ms: Optional[int], acquisition_ms: Optional[int], cfg: Mapping[str, Any]) -> float:
    """Prefer explicit fix age; else infer from acquisition duration vs total window."""
    age = fix_age_ms
    if age is None and acquisition_ms is not None:
        # If acquisition finished quickly, treat as fresh
        total = float(cfg.get("GPS_TOTAL_TIMEOUT_MS") or 12000)
        age = max(0, int(acquisition_ms) - int(min(acquisition_ms, total * 0.25)))
    if age is None:
        return 80.0
    if age <= 3000:
        return 100.0
    if age <= 8000:
        return 80.0
    if age <= 12000:
        return 55.0
    return 20.0


def _device_component_score(device_class: str) -> float:
    return 100.0 if device_class == "mobile" else 40.0


def _network_component_score(network_match: bool) -> float:
    """Booster only: match → 100, else neutral 50 (never 0 punishment)."""
    return 100.0 if network_match else 50.0


def compute_confidence(measurement: GeoMeasurement, cfg: Optional[Mapping[str, Any]] = None) -> tuple[float, dict[str, Any]]:
    """
    Server-side confidence 0–100.
    Network match only affects the NETWORK_WEIGHT term — never forces INSIDE.
    """
    c = dict(cfg or get_geo_fence_config())
    parts = {
        "accuracy": _accuracy_component_score(measurement.accuracy_m),
        "consistency": _consistency_component_score(measurement.spread_m, measurement.sample_count),
        "sample_count": _sample_count_component_score(measurement.sample_count),
        "freshness": _freshness_component_score(measurement.fix_age_ms, measurement.acquisition_ms, c),
        "device": _device_component_score(measurement.device_class),
        "network": _network_component_score(measurement.network_match),
    }
    score = (
        float(c["GPS_ACCURACY_WEIGHT"]) * parts["accuracy"]
        + float(c["GPS_CONSISTENCY_WEIGHT"]) * parts["consistency"]
        + float(c["SAMPLE_COUNT_WEIGHT"]) * parts["sample_count"]
        + float(c["FRESHNESS_WEIGHT"]) * parts["freshness"]
        + float(c["DEVICE_WEIGHT"]) * parts["device"]
        + float(c["NETWORK_WEIGHT"]) * parts["network"]
    )
    score = max(0.0, min(100.0, round(score, 2)))
    return score, parts


# ---------------------------------------------------------------------------
# 5) Decision Engine (geo states only)
# ---------------------------------------------------------------------------

def compute_spatial_class(distance_m: float, accuracy_m: Optional[float], radius_m: float, grace_m: float) -> str:
    """Accuracy-aware geometry: containment vs intersection vs disjoint."""
    a = float(accuracy_m) if accuracy_m is not None else 0.0
    d = float(distance_m)
    r = float(radius_m)
    g = float(grace_m)
    if d + a <= r:
        return SPATIAL_CONTAINED
    if d - a <= r + g:
        return SPATIAL_INTERSECTS
    return SPATIAL_DISJOINT


def compute_geo_decision(
    *,
    measurement: GeoMeasurement,
    office: Optional[OfficeRecord],
    distance_m: Optional[float],
    confidence: float,
    cfg: Optional[Mapping[str, Any]] = None,
) -> tuple[str, Optional[str], dict[str, Any]]:
    """
    Returns (geo_decision, spatial_class, extras).
    Network match is NOT consulted here for INSIDE — only confidence already includes it.
    """
    c = dict(cfg or get_geo_fence_config())
    extras: dict[str, Any] = {}

    if measurement.latitude is None or measurement.longitude is None:
        return GEO_NO_GPS, None, extras

    if office is None or distance_m is None:
        return GEO_NO_OFFICE, None, extras

    acc_max = float(
        c["ACC_MAX_MOBILE"] if measurement.device_class == "mobile" else c["ACC_MAX_DESKTOP"]
    )
    extras["acc_max_m"] = acc_max
    accuracy = measurement.accuracy_m
    if accuracy is None:
        # Missing accuracy → treat as Acc_max (conservative; tends LOW_SIGNAL/UNCERTAIN)
        accuracy = acc_max
        extras["accuracy_assumed_m"] = accuracy

    if accuracy > acc_max:
        return GEO_LOW_SIGNAL, None, extras

    spatial = compute_spatial_class(distance_m, accuracy, office.radius_m, office.grace_m)
    extras["accuracy_used_m"] = accuracy

    inside_cut = float(c["INSIDE_CONFIDENCE"])
    outside_cut = float(c["OUTSIDE_CONFIDENCE"])

    if spatial == SPATIAL_CONTAINED:
        if confidence >= inside_cut:
            return GEO_INSIDE, spatial, extras
        return GEO_UNCERTAIN, spatial, extras

    if spatial == SPATIAL_INTERSECTS:
        return GEO_UNCERTAIN, spatial, extras

    # DISJOINT
    if confidence >= outside_cut:
        return GEO_OUTSIDE, spatial, extras
    return GEO_LOW_SIGNAL, spatial, extras


# ---------------------------------------------------------------------------
# 6) Policy Engine (geo → policy_action only)
# ---------------------------------------------------------------------------

def compute_policy_action(geo_decision: str) -> str:
    """
    Map geo decision → policy action.
    Network never appears here as an INSIDE shortcut.
    DENY is not emitted by default (attendance layer may DENY for leave etc.).
    """
    if geo_decision == GEO_INSIDE:
        return POLICY_ALLOW
    if geo_decision == GEO_UNCERTAIN:
        return POLICY_ALLOW_FLAGGED
    if geo_decision == GEO_NO_OFFICE:
        # Missing fence config is an ops fault — do not punish as Outside
        return POLICY_ALLOW_FLAGGED
    if geo_decision in (GEO_OUTSIDE, GEO_LOW_SIGNAL, GEO_NO_GPS):
        return POLICY_REQUIRE_REASON
    return POLICY_REQUIRE_REASON


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def evaluate_geofence(
    *,
    measurement: GeoMeasurement,
    offices: Sequence[OfficeRecord],
    cfg: Optional[Mapping[str, Any]] = None,
) -> GeofenceResult:
    """
    Full isolated evaluation. Pure given measurement + offices + config.
    """
    c = dict(cfg or get_geo_fence_config())
    confidence, confidence_parts = compute_confidence(measurement, c)

    office: Optional[OfficeRecord] = None
    distance_m: Optional[float] = None

    if measurement.latitude is not None and measurement.longitude is not None:
        if not offices:
            geo_decision, spatial, extras = GEO_NO_OFFICE, None, {}
        else:
            office, distance_m = select_nearest_office(
                measurement.latitude, measurement.longitude, offices
            )
            geo_decision, spatial, extras = compute_geo_decision(
                measurement=measurement,
                office=office,
                distance_m=distance_m,
                confidence=confidence,
                cfg=c,
            )
    else:
        geo_decision, spatial, extras = GEO_NO_GPS, None, {}

    # Safety assertion: network must not create INSIDE without geometry
    if geo_decision == GEO_INSIDE and measurement.network_match:
        # Allowed only if spatial was CONTAINED with confidence — already enforced
        pass
    if measurement.network_match and geo_decision != GEO_INSIDE:
        # Explicit: network alone cannot upgrade to INSIDE
        extras["network_booster_only"] = True

    policy = compute_policy_action(geo_decision)

    office_dict = None
    if office is not None:
        office_dict = {
            "id": office.id,
            "name": office.name,
            "latitude": office.latitude,
            "longitude": office.longitude,
            "radius_m": office.radius_m,
            "grace_m": office.grace_m,
        }

    diagnostics = {
        "confidence_parts": confidence_parts,
        "network_match": measurement.network_match,
        "network_role": "confidence_booster_only",
        "device_class": measurement.device_class,
        "sample_count": measurement.sample_count,
        "spread_m": measurement.spread_m,
        "acquisition_ms": measurement.acquisition_ms,
        "accuracy_m": measurement.accuracy_m,
        "config_snapshot": {
            "INSIDE_CONFIDENCE": c.get("INSIDE_CONFIDENCE"),
            "OUTSIDE_CONFIDENCE": c.get("OUTSIDE_CONFIDENCE"),
            "ACC_MAX_MOBILE": c.get("ACC_MAX_MOBILE"),
            "ACC_MAX_DESKTOP": c.get("ACC_MAX_DESKTOP"),
            "NETWORK_WEIGHT": c.get("NETWORK_WEIGHT"),
        },
        **extras,
    }

    return GeofenceResult(
        office=office_dict,
        distance_m=round(distance_m, 2) if distance_m is not None else None,
        confidence=confidence,
        geo_decision=geo_decision,
        policy_action=policy,
        matched_radius_m=office.radius_m if office else None,
        matched_grace_m=office.grace_m if office else None,
        spatial_class=spatial,
        diagnostics=diagnostics,
    )


def evaluate_geofence_from_payload(
    payload: Mapping[str, Any],
    office_rows: Sequence[Mapping[str, Any]],
    cfg: Optional[Mapping[str, Any]] = None,
) -> GeofenceResult:
    """Convenience: raw JSON-like payload + office dict rows → result."""
    c = dict(cfg or get_geo_fence_config())
    measurement = build_measurement(**dict(payload))
    offices = offices_from_rows(office_rows, c)
    return evaluate_geofence(measurement=measurement, offices=offices, cfg=c)


def office_records_from_orm(location_models: Iterable[Any], cfg: Optional[Mapping[str, Any]] = None) -> list[OfficeRecord]:
    """Optional helper for Step 3 — converts Location ORM rows without importing attendance logic."""
    rows = []
    for loc in location_models or []:
        rows.append({
            "id": getattr(loc, "id", None),
            "name": getattr(loc, "name", None),
            "latitude": getattr(loc, "latitude", None),
            "longitude": getattr(loc, "longitude", None),
            "radius": getattr(loc, "radius", None),
            "grace": getattr(loc, "grace", None),
        })
    return offices_from_rows(rows, cfg)
