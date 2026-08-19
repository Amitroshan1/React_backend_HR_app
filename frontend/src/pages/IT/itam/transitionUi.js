/**
 * Helpers for P1 transition remarks.
 * Prefer useTransitionRemark() inside React trees under TransitionRemarkProvider.
 * These helpers work even outside provider when flag is OFF (no-op).
 */
import { ACTION_LABELS } from "./contracts";
import { isItamFlagEnabled } from "../../../utils/itamFlags";

/** Map inventory UI action keys / statuses to TransitionAction codes. */
export function actionCodeForStatusChange(actionKeyOrStatus, fromStatus = "") {
  const key = String(actionKeyOrStatus || "").trim();
  const lower = key.toLowerCase();
  if (key === "repair" || lower === "repair" || lower === "in-repair") return "SEND_REPAIR";
  if (key === "notWorking" || lower === "notworking" || lower === "not-working") {
    return "MARK_QUARANTINE";
  }
  if (lower === "available") {
    const from = String(fromStatus || "").toLowerCase();
    if (["repair", "in-repair", "notworking", "not-working"].includes(from)) {
      return "COMPLETE_REPAIR";
    }
    return "CHECKIN";
  }
  if (lower === "assigned") return "CHECKOUT";
  return "NOTE";
}

export function actionLabel(code) {
  return ACTION_LABELS[code] || code;
}

export function transitionsUiEnabled() {
  return isItamFlagEnabled("itam_transitions_v1");
}

/** Build API helper kwargs from remark dialog result (camelCase for Data.js APIs). */
export function remarkPayload(result) {
  if (!result || result.skipped) return {};
  return {
    remark: result.remark || "",
    notes: result.notes || result.remark || "",
    reasonCode: result.reasonCode || undefined,
    conditionGrade: result.conditionGrade || undefined,
  };
}
