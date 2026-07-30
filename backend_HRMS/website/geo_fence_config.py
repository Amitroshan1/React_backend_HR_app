"""
Geo-fencing V2 — centralized tunable thresholds.

All Decision / Confidence / GPS acquisition knobs live here.
Override via environment variables (or Flask app.config with the same keys).

NETWORK MATCH is a confidence booster only — it never grants INSIDE by itself.
See Decision Engine (geo_fence_engine.py) for enforcement.
"""
from __future__ import annotations

import os
from typing import Any


def _env_float(key: str, default: float) -> float:
    raw = os.getenv(key)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def _env_int(key: str, default: int) -> int:
    raw = os.getenv(key)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _env_bool(key: str, default: bool) -> bool:
    raw = os.getenv(key)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------------
# Defaults (documented for ops / analytics tuning)
# ---------------------------------------------------------------------------
#
# Confidence weights — must sum to 1.0 (validated at load).
# NETWORK is a booster inside the score only; Policy never uses network alone
# to classify INSIDE.
#
DEFAULTS: dict[str, Any] = {
    # Execution mode: LEGACY | SHADOW | V2  (replaces relying on GEO_FENCE_V2 alone)
    "GEO_ENGINE_MODE": "SHADOW",
    # Derived / backward-compat bool — kept in sync from GEO_ENGINE_MODE in get_geo_fence_config
    "GEO_FENCE_V2": False,
    # When mode=V2 and engine raises, fall back to legacy (never crash punch)
    "GEO_V2_FALLBACK_ON_ERROR": True,

    # --- Confidence weights (sum = 1.0) ---
    "GPS_ACCURACY_WEIGHT": 0.40,
    "GPS_CONSISTENCY_WEIGHT": 0.25,
    "SAMPLE_COUNT_WEIGHT": 0.10,
    "FRESHNESS_WEIGHT": 0.10,
    "DEVICE_WEIGHT": 0.08,
    "NETWORK_WEIGHT": 0.07,

    # --- Accuracy gates (meters) ---
    "ACC_GOOD": 30.0,              # early-stop / high-quality fix
    "ACC_USABLE": 50.0,            # secondary early-stop with more samples
    "ACC_MAX_MOBILE": 250.0,       # above → LOW_SIGNAL on mobile
    "ACC_MAX_DESKTOP": 400.0,      # above → LOW_SIGNAL on desktop

    # --- Confidence cutoffs (0–100) ---
    "INSIDE_CONFIDENCE": 70,       # CONTAINED + confidence ≥ this → INSIDE
    "OUTSIDE_CONFIDENCE": 60,      # DISJOINT + confidence ≥ this → OUTSIDE
    "UNCERTAIN_CONFIDENCE": 0,     # reserved; INTERSECTS always UNCERTAIN

    # --- GPS acquisition (client contract; also returned to frontend) ---
    "MAX_GPS_ATTEMPTS": 5,
    "GPS_TIMEOUT_MS": 8000,            # per getCurrentPosition attempt
    "GPS_TOTAL_TIMEOUT_MS": 12000,     # wall clock for acquisition window
    "GPS_INTER_ATTEMPT_DELAY_MS": 1500,
    "EARLY_STOP_ACCURACY": 30.0,       # alias of ACC_GOOD for client docs
    "EARLY_STOP_SPREAD_M": 50.0,
    "EARLY_STOP_ACCURACY_LOOSE": 50.0,
    "EARLY_STOP_SPREAD_LOOSE_M": 75.0,
    "EARLY_STOP_MIN_SAMPLES": 2,
    "EARLY_STOP_MIN_SAMPLES_LOOSE": 3,

    # --- Sample selection ---
    "OUTLIER_MIN_METERS": 100.0,       # max(OUTLIER_MIN, 2 * best.accuracy)

    # --- Fallback when office.grace is NULL ---
    "DEFAULT_OFFICE_GRACE_M": 25.0,
    "DEFAULT_OFFICE_RADIUS_M": 100.0,

    # --- Attempt nonce ---
    "GEO_ATTEMPT_TTL_SECONDS": 120,

    # --- Reason length (existing product rule) ---
    "GEO_REASON_MIN_CHARS": 10,
    # --- Client (frontend) GPS timing — served via /employee/geo/client-config ---
    "CLIENT_DASH_POLL_INTERVAL_MS": 75000,
    "CLIENT_DASH_STALE_THRESHOLD_MS": 300000,
    "CLIENT_DASH_MIN_RECHECK_MS": 45000,
    "CLIENT_DASH_CACHE_MAX_AGE_MS": 60000,
    "CLIENT_DASH_REFINE_DELAY_MS": 4000,
    "CLIENT_DASH_IDLE_CB_TIMEOUT_MS": 150,
    "CLIENT_DASH_HA_TIMEOUT_MS": 8000,
    "CLIENT_DASH_LA_TIMEOUT_MS": 3000,
    "CLIENT_DASH_HA_MAX_AGE_MS": 60000,
    "CLIENT_DASH_LA_MAX_AGE_MS": 90000,
    "CLIENT_PUNCH_MAX_ATTEMPTS": 5,
    "CLIENT_PUNCH_TIMEOUT_MS": 8000,
    "CLIENT_PUNCH_TOTAL_TIMEOUT_MS": 12000,
    "CLIENT_PUNCH_INTER_ATTEMPT_DELAY_MS": 1500,
    "CLIENT_PUNCH_EARLY_STOP_ACCURACY_M": 30,
    "CLIENT_PUNCH_EARLY_STOP_SPREAD_M": 50,
    "CLIENT_PUNCH_EARLY_STOP_ACCURACY_LOOSE_M": 50,
    "CLIENT_PUNCH_EARLY_STOP_SPREAD_LOOSE_M": 75,
    "CLIENT_PUNCH_EARLY_STOP_MIN_SAMPLES": 2,
    "CLIENT_PUNCH_EARLY_STOP_MIN_SAMPLES_LOOSE": 3,
    "CLIENT_PUNCH_OUTLIER_MIN_M": 100,
    "CLIENT_PUNCH_ACC_MAX_MOBILE_M": 250,
    "CLIENT_PUNCH_ACC_MAX_DESKTOP_M": 400,
    # --- Trusted location cache (frontend Punch reuse of recent INSIDE dash fix) ---
    "CLIENT_TRUSTED_CACHE_LIFETIME_MS": 10000,
    "CLIENT_TRUSTED_CACHE_MIN_CONFIDENCE": 80,
    "CLIENT_TRUSTED_CACHE_MAX_ACCURACY_M": 25,
}


_WEIGHT_KEYS = (
    "GPS_ACCURACY_WEIGHT",
    "GPS_CONSISTENCY_WEIGHT",
    "SAMPLE_COUNT_WEIGHT",
    "FRESHNESS_WEIGHT",
    "DEVICE_WEIGHT",
    "NETWORK_WEIGHT",
)


def _coerce(key: str, default: Any) -> Any:
    if isinstance(default, bool):
        return _env_bool(key, default)
    if isinstance(default, int) and not isinstance(default, bool):
        # floats stored as int in defaults for cutoffs
        if key in {
            "INSIDE_CONFIDENCE",
            "OUTSIDE_CONFIDENCE",
            "UNCERTAIN_CONFIDENCE",
            "MAX_GPS_ATTEMPTS",
            "GPS_TIMEOUT_MS",
            "GPS_TOTAL_TIMEOUT_MS",
            "GPS_INTER_ATTEMPT_DELAY_MS",
            "EARLY_STOP_MIN_SAMPLES",
            "EARLY_STOP_MIN_SAMPLES_LOOSE",
            "GEO_ATTEMPT_TTL_SECONDS",
            "GEO_REASON_MIN_CHARS",
            "CLIENT_TRUSTED_CACHE_LIFETIME_MS",
            "CLIENT_TRUSTED_CACHE_MIN_CONFIDENCE",
            "CLIENT_TRUSTED_CACHE_MAX_ACCURACY_M",
        }:
            return _env_int(key, default)
        return _env_float(key, float(default))
    if isinstance(default, float):
        return _env_float(key, default)
    return os.getenv(key, default)


def _normalize_engine_mode(raw: Any, geo_fence_v2_fallback: Any = None) -> str:
    s = str(raw or "").strip().upper()
    if s in {"LEGACY", "SHADOW", "V2"}:
        return s
    # Backward compat: boolean GEO_FENCE_V2 when mode missing/invalid
    if geo_fence_v2_fallback is not None:
        return "V2" if bool(geo_fence_v2_fallback) else "LEGACY"
    return "SHADOW"


def get_geo_fence_config(app_config: dict | None = None) -> dict[str, Any]:
    """
    Resolve geo V2 settings: defaults → env → Flask app.config (incl. DB Admin overrides).
    When app_config is omitted and a Flask app context exists, current_app.config is used
    so Admin UI overrides apply without modifying the geo-fence engine.
    """
    cfg = {k: _coerce(k, v) for k, v in DEFAULTS.items()}

    if app_config is None:
        try:
            from flask import current_app, has_app_context

            if has_app_context():
                app_config = current_app.config
        except Exception:
            app_config = None

    if app_config:
        for k in DEFAULTS:
            if k in app_config and app_config[k] is not None:
                cfg[k] = app_config[k]

    # GEO_ENGINE_MODE is authoritative; GEO_FENCE_V2 is derived for older callers
    mode_explicit = None
    if os.getenv("GEO_ENGINE_MODE"):
        mode_explicit = os.getenv("GEO_ENGINE_MODE")
    elif app_config and app_config.get("GEO_ENGINE_MODE") is not None:
        mode_explicit = app_config.get("GEO_ENGINE_MODE")
    cfg["GEO_ENGINE_MODE"] = _normalize_engine_mode(
        mode_explicit if mode_explicit is not None else cfg.get("GEO_ENGINE_MODE"),
        cfg.get("GEO_FENCE_V2"),
    )
    cfg["GEO_FENCE_V2"] = cfg["GEO_ENGINE_MODE"] == "V2"

    # Keep EARLY_STOP_ACCURACY aligned with ACC_GOOD unless explicitly set
    if os.getenv("EARLY_STOP_ACCURACY") is None and not (
        app_config and "EARLY_STOP_ACCURACY" in (app_config or {})
    ):
        cfg["EARLY_STOP_ACCURACY"] = cfg["ACC_GOOD"]

    weight_sum = sum(float(cfg[k]) for k in _WEIGHT_KEYS)
    if abs(weight_sum - 1.0) > 0.02:
        # Normalize rather than crash production boots
        for k in _WEIGHT_KEYS:
            cfg[k] = float(cfg[k]) / weight_sum if weight_sum else DEFAULTS[k]

    return cfg


def geo_client_acquisition_settings(cfg: dict | None = None) -> dict[str, Any]:
    """Subset safe to expose to the browser for the retry engine."""
    c = cfg or get_geo_fence_config()
    return {
        "max_attempts": int(c["MAX_GPS_ATTEMPTS"]),
        "timeout_ms": int(c["GPS_TIMEOUT_MS"]),
        "total_timeout_ms": int(c["GPS_TOTAL_TIMEOUT_MS"]),
        "inter_attempt_delay_ms": int(c["GPS_INTER_ATTEMPT_DELAY_MS"]),
        "early_stop_accuracy_m": float(c["EARLY_STOP_ACCURACY"]),
        "early_stop_spread_m": float(c["EARLY_STOP_SPREAD_M"]),
        "early_stop_accuracy_loose_m": float(c["EARLY_STOP_ACCURACY_LOOSE"]),
        "early_stop_spread_loose_m": float(c["EARLY_STOP_SPREAD_LOOSE_M"]),
        "early_stop_min_samples": int(c["EARLY_STOP_MIN_SAMPLES"]),
        "early_stop_min_samples_loose": int(c["EARLY_STOP_MIN_SAMPLES_LOOSE"]),
        "outlier_min_meters": float(c["OUTLIER_MIN_METERS"]),
        "acc_max_mobile_m": float(c["ACC_MAX_MOBILE"]),
        "acc_max_desktop_m": float(c["ACC_MAX_DESKTOP"]),
        "geo_fence_v2": bool(c["GEO_FENCE_V2"]),
        "geo_engine_mode": str(c.get("GEO_ENGINE_MODE") or "SHADOW"),
    }


# Human-readable documentation for ops / Admin UI later
CONFIG_DOCS: dict[str, str] = {
    "GEO_ENGINE_MODE": "Punch geo execution mode: LEGACY | SHADOW | V2. SHADOW = legacy truth + V2 compare.",
    "GEO_FENCE_V2": "Derived bool (mode==V2). Prefer GEO_ENGINE_MODE.",
    "GEO_V2_FALLBACK_ON_ERROR": "If mode=V2 and engine fails, fall back to legacy for that request.",
    "GPS_ACCURACY_WEIGHT": "Confidence weight for GPS accuracy component (0–1).",
    "GPS_CONSISTENCY_WEIGHT": "Confidence weight for multi-sample spread consistency.",
    "SAMPLE_COUNT_WEIGHT": "Confidence weight for number of GPS samples collected.",
    "FRESHNESS_WEIGHT": "Confidence weight for age of chosen fix.",
    "DEVICE_WEIGHT": "Confidence weight for device class (mobile vs desktop).",
    "NETWORK_WEIGHT": "Confidence weight for office-network match (booster only; never grants INSIDE alone).",
    "ACC_GOOD": "Meters; high-quality accuracy threshold / early-stop primary.",
    "ACC_USABLE": "Meters; secondary early-stop accuracy with more samples.",
    "ACC_MAX_MOBILE": "Meters; above this on mobile → LOW_SIGNAL.",
    "ACC_MAX_DESKTOP": "Meters; above this on desktop → LOW_SIGNAL.",
    "INSIDE_CONFIDENCE": "Min confidence (0–100) for CONTAINED → INSIDE.",
    "OUTSIDE_CONFIDENCE": "Min confidence (0–100) for DISJOINT → OUTSIDE.",
    "UNCERTAIN_CONFIDENCE": "Reserved cutoff for uncertain band.",
    "MAX_GPS_ATTEMPTS": "Max getCurrentPosition attempts per punch acquisition.",
    "GPS_TIMEOUT_MS": "Per-attempt Geolocation timeout (ms).",
    "GPS_TOTAL_TIMEOUT_MS": "Max wall-clock acquisition window (ms).",
    "GPS_INTER_ATTEMPT_DELAY_MS": "Delay between GPS attempts (ms).",
    "EARLY_STOP_ACCURACY": "Primary early-stop accuracy (m).",
    "DEFAULT_OFFICE_GRACE_M": "Fallback grace (m) when location.grace is NULL.",
    "DEFAULT_OFFICE_RADIUS_M": "Fallback radius (m) when location.radius is NULL.",
    "GEO_ATTEMPT_TTL_SECONDS": "Single-use attempt_id lifetime.",
    "GEO_REASON_MIN_CHARS": "Min chars for outside / weak-GPS reason.",
    "CLIENT_TRUSTED_CACHE_LIFETIME_MS": "Max age (ms) of dashboard INSIDE fix reusable for Punch (skip fresh GPS).",
    "CLIENT_TRUSTED_CACHE_MIN_CONFIDENCE": "Min confidence (0–100) to reuse dashboard location for Punch.",
    "CLIENT_TRUSTED_CACHE_MAX_ACCURACY_M": "Max GPS accuracy (m) to reuse dashboard location for Punch.",
}
