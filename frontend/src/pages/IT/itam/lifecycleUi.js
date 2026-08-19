/**
 * ITAM P3 — canonical lifecycle labels for UI (mirrors backend lifecycle.py).
 * Active when itam_lifecycle_v1 is ON and API sends lifecycleStatus.
 */

import { isItamFlagEnabled } from "../../../utils/itamFlags";

export const STATUS_LABELS = Object.freeze({
  Ordered: "Ordered",
  InTransit: "In transit",
  Received: "Received",
  InStock: "In stock",
  Reserved: "Reserved",
  CheckedOut: "Checked out",
  Deployed: "Deployed",
  PendingReturn: "Pending return",
  InRepair: "In repair",
  Quarantine: "Quarantine",
  Exported: "Exported",
  Retired: "Retired",
  Lost: "Lost",
});

export const CUSTODY_LABELS = Object.freeze({
  EMPLOYEE: "Employee",
  LOCATION: "Location",
  VENDOR: "Vendor",
  NONE: "None",
});

const LEGACY_FALLBACK = Object.freeze({
  available: "In stock",
  assigned: "Checked out",
  "not-working": "Quarantine",
  notWorking: "Quarantine",
  repair: "In repair",
  "in-repair": "In repair",
  inRepair: "In repair",
  exported: "Exported",
  dead: "Retired",
  deleted: "Retired",
});

export function lifecycleUiEnabled() {
  return isItamFlagEnabled("itam_lifecycle_v1");
}

/** Prefer API lifecycleStatus / statusLabel; else map legacy status. */
export function unitStatusLabel(unit) {
  if (!unit) return "—";
  if (unit.statusLabel) return unit.statusLabel;
  if (unit.lifecycleStatus && STATUS_LABELS[unit.lifecycleStatus]) {
    return STATUS_LABELS[unit.lifecycleStatus];
  }
  if (!lifecycleUiEnabled()) {
    const s = String(unit.status || "").trim();
    if (!s) return "—";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const legacy = String(unit.status || "").trim();
  if (unit.isDeployed) return STATUS_LABELS.Deployed;
  if (LEGACY_FALLBACK[legacy]) return LEGACY_FALLBACK[legacy];
  return STATUS_LABELS[legacy] || legacy || "—";
}

export function unitCustodyLabel(unit) {
  if (!unit) return "—";
  if (unit.custodyLabel) return unit.custodyLabel;
  const t = String(unit.custodyType || unit.custody?.type || "NONE").toUpperCase();
  return CUSTODY_LABELS[t] || t;
}

export function isUnitDeployed(unit) {
  if (!unit) return false;
  if (typeof unit.isDeployed === "boolean") return unit.isDeployed;
  return unit.lifecycleStatus === "Deployed";
}

export function isUnitCheckedOut(unit) {
  if (!unit) return false;
  if (typeof unit.isCheckedOut === "boolean") return unit.isCheckedOut;
  return unit.lifecycleStatus === "CheckedOut" || (unit.status === "assigned" && !!unit.assignedTo);
}
