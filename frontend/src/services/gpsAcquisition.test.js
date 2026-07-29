/**
 * Lightweight unit checks for gpsAcquisition (no browser GPS required).
 * Run: node src/services/gpsAcquisition.test.js
 */
import {
  haversineMeters,
  selectBestSample,
  shouldEarlyStop,
  zoneToLocationLabel,
  GPS_ACQUISITION_DEFAULTS,
} from "./gpsAcquisition.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

assert(haversineMeters(28.6139, 77.209, 28.6139, 77.209) < 0.01, "haversine zero");

const samples = [
  { lat: 28.6139, lon: 77.209, accuracy: 180, timestamp: 1 },
  { lat: 28.614, lon: 77.2091, accuracy: 80, timestamp: 2 },
  { lat: 28.61395, lon: 77.20905, accuracy: 18, timestamp: 3 },
];
const { chosen, accepted, spreadM } = selectBestSample(samples);
assert(chosen.accuracy === 18, "best accuracy chosen");
assert(accepted.length >= 2, "accepted cluster");
assert(spreadM != null && spreadM < 200, "spread computed");

// Wild outlier with worse accuracy should be dropped relative to best cluster
const withOutlier = [
  ...samples,
  { lat: 29.0, lon: 78.0, accuracy: 5, timestamp: 4 }, // precise but far — kept if it's best accuracy!
];
// Spec: best = min accuracy first (the 5m wild point), then gate around it.
// That wild precise point becomes "best" — accepted may be only itself.
const out = selectBestSample(withOutlier);
assert(out.chosen.accuracy === 5, "min accuracy is selected before gate");

assert(
  shouldEarlyStop(samples, GPS_ACQUISITION_DEFAULTS) === true,
  "early stop when good accuracy + samples",
);
assert(shouldEarlyStop(samples.slice(0, 1)) === false, "no early stop on 1 sample");

assert(zoneToLocationLabel("INSIDE", true).text === "Inside", "inside label");
assert(zoneToLocationLabel("NEAR", true).text === "Approximate", "near label");
assert(zoneToLocationLabel("OUTSIDE", false).text === "Outside", "outside label");

console.log("gpsAcquisition.selftest: PASS");
