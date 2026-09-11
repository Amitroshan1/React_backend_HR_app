/** Idle session timeouts by emp_type (must match backend session_timeout.py). */

export const EXTENDED_SESSION_MS = 60 * 60 * 1000;
export const DEFAULT_SESSION_MS = 15 * 60 * 1000;
export const ACTIVITY_KEY = "lastActivityAt";

const EXTENDED_EMP_TYPES = new Set([
  "hr",
  "human resource",
  "human resources",
  "account",
  "accounts",
  "accountant",
  "it",
  "it department",
  "inventory",
]);

export function normalizeEmpType(empType) {
  return String(empType || "")
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ");
}

export function isExtendedSessionEmpType(empType) {
  return EXTENDED_EMP_TYPES.has(normalizeEmpType(empType));
}

export function getIdleTimeoutMs(empType) {
  return isExtendedSessionEmpType(empType) ? EXTENDED_SESSION_MS : DEFAULT_SESSION_MS;
}

/** Decode JWT payload without verifying signature (client-side hints only). */
export function parseJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function empTypeFromToken(token) {
  const payload = parseJwtPayload(token);
  return payload?.emp_type || null;
}

/**
 * Re-issue access token while the user is active so JWT lifetime slides with idle policy.
 * Returns true if token was refreshed.
 */
export async function refreshSessionToken() {
  const token = localStorage.getItem("token");
  if (!token) return false;
  try {
    const res = await fetch("/api/auth/session/refresh", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (res.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem(ACTIVITY_KEY);
      return false;
    }
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    if (data?.success && data?.token) {
      localStorage.setItem("token", data.token);
      localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
      return true;
    }
  } catch {
    /* ignore transient network errors */
  }
  return false;
}
