/**
 * ITAM contracts — mirror of backend_HRMS/website/itam/*
 * P0 contracts + P1 remark helpers + P2 timeline API paths.
 */

export const ITAM_CONTRACT_VERSION = "itam-p0-2026-08-13";
export const ITAM_PHASE = "P3";

export const TRANSITION_ACTIONS = Object.freeze({
  RECEIVE: "RECEIVE",
  CHECKOUT: "CHECKOUT",
  CHECKIN: "CHECKIN",
  TRANSFER: "TRANSFER",
  DEPLOY: "DEPLOY",
  UNDEPLOY: "UNDEPLOY",
  MARK_QUARANTINE: "MARK_QUARANTINE",
  SEND_REPAIR: "SEND_REPAIR",
  COMPLETE_REPAIR: "COMPLETE_REPAIR",
  REQUEST_RETURN: "REQUEST_RETURN",
  APPROVE_RETURN: "APPROVE_RETURN",
  REJECT_RETURN: "REJECT_RETURN",
  EXPORT: "EXPORT",
  RETIRE: "RETIRE",
  LOST: "LOST",
  NOTE: "NOTE",
  ACK_CUSTODY: "ACK_CUSTODY",
});

export const ACTION_LABELS = Object.freeze({
  RECEIVE: "Received into stock",
  CHECKOUT: "Assigned to employee",
  CHECKIN: "Returned to stock",
  TRANSFER: "Custody transfer",
  DEPLOY: "Deployed to location",
  UNDEPLOY: "Returned from location",
  MARK_QUARANTINE: "Marked not working",
  SEND_REPAIR: "Sent for repair",
  COMPLETE_REPAIR: "Repair completed",
  REQUEST_RETURN: "Return requested",
  APPROVE_RETURN: "Return approved",
  REJECT_RETURN: "Return rejected",
  EXPORT: "Exported",
  RETIRE: "Retired / dead",
  LOST: "Marked lost",
  NOTE: "Comment only",
  ACK_CUSTODY: "Employee acknowledgement",
});

/** @type {Record<string, { minLength: number, reasonCodeRequired: boolean, conditionGradeRequired: boolean }>} */
export const REMARK_POLICIES = Object.freeze({
  RECEIVE: { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: false },
  CHECKOUT: { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: false },
  CHECKIN: { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: true },
  TRANSFER: { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: false },
  DEPLOY: { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: false },
  UNDEPLOY: { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: false },
  MARK_QUARANTINE: { minLength: 15, reasonCodeRequired: false, conditionGradeRequired: false },
  SEND_REPAIR: { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: false },
  COMPLETE_REPAIR: { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: true },
  REQUEST_RETURN: { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: false },
  APPROVE_RETURN: { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: false },
  REJECT_RETURN: { minLength: 10, reasonCodeRequired: false, conditionGradeRequired: false },
  EXPORT: { minLength: 20, reasonCodeRequired: true, conditionGradeRequired: false },
  RETIRE: { minLength: 20, reasonCodeRequired: true, conditionGradeRequired: true },
  LOST: { minLength: 20, reasonCodeRequired: true, conditionGradeRequired: false },
  NOTE: { minLength: 5, reasonCodeRequired: false, conditionGradeRequired: false },
  ACK_CUSTODY: { minLength: 5, reasonCodeRequired: false, conditionGradeRequired: false },
});

export const CANONICAL_STATUSES = Object.freeze([
  "Ordered",
  "InTransit",
  "Received",
  "InStock",
  "Reserved",
  "CheckedOut",
  "Deployed",
  "PendingReturn",
  "InRepair",
  "Quarantine",
  "Exported",
  "Retired",
  "Lost",
]);

export const LEGACY_STATUS_MAP = Object.freeze({
  available: "InStock",
  assigned: "CheckedOut",
  "not-working": "Quarantine",
  notWorking: "Quarantine",
  repair: "InRepair",
  "in-repair": "InRepair",
  inRepair: "InRepair",
  exported: "Exported",
  removed_from_it: "Quarantine",
  removed: "Quarantine",
  dead: "Retired",
  deleted: "Retired",
});

/**
 * Client-side remark validation (mirrors backend validate_remark).
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateRemark(actionCode, remark, { reasonCode, conditionGrade } = {}) {
  const code = String(actionCode || "").trim().toUpperCase();
  const policy = REMARK_POLICIES[code];
  if (!policy) return { ok: false, error: `Unknown action_code: ${actionCode}` };

  const text = String(remark || "").trim();
  if (!text) return { ok: false, error: "Remark is required" };
  if (text.length < policy.minLength) {
    return { ok: false, error: `Remark must be at least ${policy.minLength} characters` };
  }
  if (policy.reasonCodeRequired && !String(reasonCode || "").trim()) {
    return { ok: false, error: "Reason code is required for this action" };
  }
  if (policy.conditionGradeRequired && !String(conditionGrade || "").trim()) {
    return { ok: false, error: "Condition grade is required for this action" };
  }
  return { ok: true };
}

/** Active ITAM API paths (P1–P3). */
export const ITAM_API_PATHS = Object.freeze({
  meta: "/api/it/itam/meta",
  unitTransition: (unitId) => `/api/it/units/${unitId}/transitions`,
  unitTimeline: (unitId) => `/api/it/units/${unitId}/timeline`,
  unitTimelineCsv: (unitId) => `/api/it/units/${unitId}/timeline.csv`,
  backfillAssignmentHistory: "/api/it/itam/backfill-assignment-history",
  backfillLifecycle: "/api/it/itam/backfill-lifecycle",
});
