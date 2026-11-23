/** Drop leftover PII / privilege caches from this browser. */

export const EMPLOYEES_STORAGE_KEY = "employees";
export const PLAN_CONTEXT_STORAGE_KEY = "hrms_plan_context";
export const PRIVACY_CLEAR_EVENT = "hrms-privacy-clear";

export function clearClientPrivacyCaches() {
  try {
    localStorage.removeItem(EMPLOYEES_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(PLAN_CONTEXT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PRIVACY_CLEAR_EVENT));
  }
}
