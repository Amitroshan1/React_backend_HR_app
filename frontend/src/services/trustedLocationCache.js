/**
 * Trusted Location Cache — reuse a recent high-quality INSIDE dashboard fix for Punch.
 *
 * Security: NEVER trust Outside / Approximate / Low Signal / No GPS / Unknown.
 * Backend Geo Validation Service still runs on every punch; this only skips a second GPS acquisition.
 */

import { detectDeviceClass } from "./gpsAcquisition";
import { getGeoClientConfig } from "./geoClientConfig";

/** Zones / decisions that must NEVER be reused for punch. */
const UNTRUSTED_STATUSES = new Set([
  "OUTSIDE",
  "NEAR",
  "UNCERTAIN",
  "LOW_SIGNAL",
  "NO_GPS",
  "NO_OFFICE_CONFIG",
  "UNKNOWN",
  "APPROXIMATE",
]);

/**
 * When the server reports confidence 0 (legacy engine), derive a trust score from GPS accuracy.
 * Stricter than the accuracy gate alone so confidence remains a meaningful check.
 */
export function deriveConfidenceFromAccuracy(accuracyM) {
  const acc = Number(accuracyM);
  if (!Number.isFinite(acc) || acc < 0) return 0;
  if (acc <= 10) return 92;
  if (acc <= 15) return 85;
  if (acc <= 20) return 80;
  return 0;
}

export function effectiveConfidence(snapshot) {
  const c = Number(snapshot?.confidence);
  if (Number.isFinite(c) && c > 0) return c;
  return deriveConfidenceFromAccuracy(snapshot?.accuracy_m);
}

function normalizeStatus(snapshot) {
  const decision = String(snapshot?.geo_decision || "").trim().toUpperCase();
  const zone = String(snapshot?.zone || "").trim().toUpperCase();
  return decision || zone || "UNKNOWN";
}

/**
 * @param {object|null} snapshot  lat, lon, accuracy_m, confidence, zone, geo_decision, captured_at
 * @param {object} [overrides]    optional threshold overrides
 * @returns {{ ok: boolean, reason: string, ageMs?: number, confidence?: number }}
 */
export function evaluateTrustedLocation(snapshot, overrides = {}) {
  const cfg = getGeoClientConfig().trustedCache || {};
  const lifetimeMs = Number(overrides.lifetimeMs ?? cfg.lifetimeMs ?? 10000);
  const maxAccuracyM = Number(overrides.maxAccuracyM ?? cfg.maxAccuracyM ?? 25);
  const minConfidence = Number(overrides.minConfidence ?? cfg.minConfidence ?? 80);

  if (!snapshot) {
    return { ok: false, reason: "no_snapshot" };
  }

  const lat = Number(snapshot.lat);
  const lon = Number(snapshot.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, reason: "missing_coords" };
  }

  const status = normalizeStatus(snapshot);
  if (status !== "INSIDE") {
    return { ok: false, reason: `status_${status.toLowerCase() || "unknown"}` };
  }
  if (UNTRUSTED_STATUSES.has(status)) {
    return { ok: false, reason: `untrusted_${status.toLowerCase()}` };
  }

  const capturedAt = Number(snapshot.captured_at || snapshot._ts || 0);
  const ageMs = Date.now() - capturedAt;
  if (!Number.isFinite(capturedAt) || capturedAt <= 0 || ageMs < 0 || ageMs > lifetimeMs) {
    return { ok: false, reason: "stale", ageMs };
  }

  const accuracy = Number(snapshot.accuracy_m);
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > maxAccuracyM) {
    return { ok: false, reason: "accuracy", ageMs };
  }

  if (snapshot.low_signal) {
    return { ok: false, reason: "low_signal", ageMs };
  }

  const confidence = effectiveConfidence(snapshot);
  if (confidence < minConfidence) {
    return { ok: false, reason: "confidence", ageMs, confidence };
  }

  return { ok: true, reason: "trusted", ageMs, confidence };
}

/**
 * Build a punch measurement from a trusted dashboard snapshot (same shape as acquireGpsFix).
 */
export function measurementFromTrustedSnapshot(snapshot, evaluation = null) {
  const attemptId =
    (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
    `trusted-${Date.now()}`;
  return {
    lat: snapshot.lat,
    lon: snapshot.lon,
    accuracy_m: snapshot.accuracy_m,
    sample_count: snapshot.sample_count ?? 1,
    spread_m: snapshot.spread_m ?? 0,
    retry_count: 0,
    acquisition_ms: evaluation?.ageMs ?? 0,
    device_class: snapshot.device_class || detectDeviceClass(),
    attempt_id: attemptId,
    low_signal: false,
    from_trusted_cache: true,
    trusted_age_ms: evaluation?.ageMs ?? null,
    trusted_confidence: evaluation?.confidence ?? effectiveConfidence(snapshot),
  };
}

/**
 * @returns {{ ok: true, measurement: object, evaluation: object } | { ok: false, reason: string }}
 */
export function tryReuseTrustedLocation(snapshot, overrides) {
  const evaluation = evaluateTrustedLocation(snapshot, overrides);
  if (!evaluation.ok) {
    return { ok: false, reason: evaluation.reason, evaluation };
  }
  return {
    ok: true,
    measurement: measurementFromTrustedSnapshot(snapshot, evaluation),
    evaluation,
  };
}

/**
 * Build a snapshot from a dashboard GPS fix + location-check response.
 */
export function buildTrustedSnapshot({
  lat,
  lon,
  accuracy_m,
  locationData,
  device_class,
} = {}) {
  const acc =
    accuracy_m ??
    locationData?.accuracy_m ??
    null;
  return {
    lat,
    lon,
    accuracy_m: acc != null ? Number(acc) : null,
    confidence: locationData?.confidence != null ? Number(locationData.confidence) : 0,
    zone: locationData?.zone || "NO_GPS",
    geo_decision: locationData?.geo_decision || null,
    in_range: !!locationData?.in_range,
    low_signal: false,
    device_class: device_class || detectDeviceClass(),
    sample_count: 1,
    spread_m: 0,
    captured_at: Date.now(),
  };
}
