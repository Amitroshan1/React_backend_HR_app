/**
 * Lightweight checks for HR biometric device status display.
 * Run: node src/pages/HR/deviceStatusDisplay.test.js
 */
import {
  deviceDisplayName,
  formatDeviceClock,
  pickPrimaryDevice,
} from "./deviceStatusDisplay.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

assert(formatDeviceClock(null) === "Never", "null time");
assert(formatDeviceClock("not-a-date") === "Never", "invalid time");
const formatted = formatDeviceClock("2026-08-21T10:20:00Z");
assert(typeof formatted === "string" && formatted.length > 0, "formats iso");
assert(!formatted.includes("T"), "not raw iso");

assert(deviceDisplayName({ name: "NHQ Door", serial_number: "NES1" }) === "NHQ Door (NES1)");
assert(deviceDisplayName({ serial_number: "NES1" }) === "NES1");

const primary = pickPrimaryDevice([
  { serial_number: "A", online: false, is_active: true },
  { serial_number: "B", online: true, is_active: true },
]);
assert(primary.serial_number === "B", "prefers online");

assert(pickPrimaryDevice([]) === null, "empty");
assert(pickPrimaryDevice(null) === null, "null list");

console.log("deviceStatusDisplay.test.js ok");
