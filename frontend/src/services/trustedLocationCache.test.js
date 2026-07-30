/**
 * Unit tests for Trusted Location Cache eligibility.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  evaluateTrustedLocation,
  tryReuseTrustedLocation,
  deriveConfidenceFromAccuracy,
  buildTrustedSnapshot,
} from "./trustedLocationCache";
import { resetGeoClientConfigCache } from "./geoClientConfig";

function insideSnap(overrides = {}) {
  return {
    lat: 19.0632,
    lon: 72.9988,
    accuracy_m: 15,
    confidence: 85,
    zone: "INSIDE",
    geo_decision: "INSIDE",
    captured_at: Date.now() - 2000,
    ...overrides,
  };
}

describe("trustedLocationCache", () => {
  beforeEach(() => {
    resetGeoClientConfigCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a fresh accurate INSIDE fix", () => {
    const r = evaluateTrustedLocation(insideSnap());
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("trusted");
  });

  it("rejects OUTSIDE even when fresh and accurate", () => {
    const r = evaluateTrustedLocation(
      insideSnap({ zone: "OUTSIDE", geo_decision: "OUTSIDE", confidence: 99 }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/outside/i);
  });

  it("rejects UNCERTAIN / NEAR / LOW_SIGNAL / NO_GPS", () => {
    for (const status of ["UNCERTAIN", "NEAR", "LOW_SIGNAL", "NO_GPS"]) {
      const r = evaluateTrustedLocation(
        insideSnap({ zone: status, geo_decision: status, confidence: 99 }),
      );
      expect(r.ok).toBe(false);
    }
  });

  it("rejects stale fixes beyond lifetime", () => {
    const r = evaluateTrustedLocation(
      insideSnap({ captured_at: Date.now() - 15000 }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("stale");
  });

  it("rejects poor accuracy", () => {
    const r = evaluateTrustedLocation(insideSnap({ accuracy_m: 40 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("accuracy");
  });

  it("rejects low confidence", () => {
    const r = evaluateTrustedLocation(insideSnap({ confidence: 50 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("confidence");
  });

  it("derives confidence from accuracy when server confidence is 0", () => {
    expect(deriveConfidenceFromAccuracy(12)).toBe(85);
    const r = evaluateTrustedLocation(
      insideSnap({ confidence: 0, accuracy_m: 12 }),
    );
    expect(r.ok).toBe(true);
  });

  it("does not derive enough confidence at 25m when server confidence is 0", () => {
    const r = evaluateTrustedLocation(
      insideSnap({ confidence: 0, accuracy_m: 25 }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("confidence");
  });

  it("builds a punch measurement when trusted", () => {
    const result = tryReuseTrustedLocation(insideSnap());
    expect(result.ok).toBe(true);
    expect(result.measurement.from_trusted_cache).toBe(true);
    expect(result.measurement.lat).toBe(19.0632);
    expect(result.measurement.attempt_id).toBeTruthy();
  });

  it("buildTrustedSnapshot captures check fields", () => {
    const snap = buildTrustedSnapshot({
      lat: 1,
      lon: 2,
      accuracy_m: 8,
      locationData: {
        zone: "INSIDE",
        geo_decision: "INSIDE",
        confidence: 88,
        in_range: true,
      },
    });
    expect(snap.zone).toBe("INSIDE");
    expect(snap.confidence).toBe(88);
    expect(snap.captured_at).toBeGreaterThan(0);
  });
});
