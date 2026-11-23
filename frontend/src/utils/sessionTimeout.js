import { clearPlanContext } from "./planFeatures";
import { clearSensitiveToken } from "./sensitiveDataAuth";
import { clearPersistedPanelViews } from "../hooks/usePersistedView";
import { clearClientPrivacyCaches } from "./clientPrivacy";
import {
  clearAccessCookie,
  clearAccessToken,
  getAccessToken,
  hasSignedInHint,
  isLikelyJwt,
  markSignedIn,
  setAccessToken,
} from "./authSession";

function sessionToken() {
  return getAccessToken();
}

function stripBadAuthorization(headers) {
  const auth = headers.get("Authorization");
  if (!auth) return;
  const raw = auth.replace(/^Bearer\s+/i, "").trim();
  if (!isLikelyJwt(raw)) {
    headers.delete("Authorization");
  }
}

/** Idle session timeouts by emp_type (must match backend session_timeout.py). */

export const EXTENDED_SESSION_MS = 60 * 60 * 1000;
export const DEFAULT_SESSION_MS = 15 * 60 * 1000;
export const ACTIVITY_KEY = "lastActivityAt";
export const SESSION_TIMEOUT_KEY = "sessionTimeoutMs";
export const SESSION_ENDED_KEY = "sessionExpired";
export const TENANT_SUSPENDED_CODE = "tenant_suspended";
export const SESSION_EXPIRED_CODE = "session_expired";
export const INVALID_SESSION_CODE = "invalid_session";

const REFRESH_THROTTLE_MS = 2 * 60 * 1000;
const REFRESH_BEFORE_EXPIRY_MS = 2 * 60 * 1000;

export function persistSessionTimeoutMinutes(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return;
  const ms = Math.round(n * 60 * 1000);
  const clamped = Math.min(EXTENDED_SESSION_MS, Math.max(DEFAULT_SESSION_MS, ms));
  localStorage.setItem(SESSION_TIMEOUT_KEY, String(clamped));
}

function readJsonBody(res) {
  return res.clone().json().catch(() => ({}));
}

/** Remember why a 401 ended the session so the login page can explain it. */
export async function noteSessionEnded(res) {
  const body = await readJsonBody(res);
  if (body?.code === TENANT_SUSPENDED_CODE) {
    localStorage.setItem(SESSION_ENDED_KEY, TENANT_SUSPENDED_CODE);
    return TENANT_SUSPENDED_CODE;
  }
  return "1";
}

/** True only for JWT death / tenant block — not module 401s. */
export function isSessionEndingUnauthorized(body) {
  const code = String(body?.code || "");
  if (code === TENANT_SUSPENDED_CODE || code === SESSION_EXPIRED_CODE || code === INVALID_SESSION_CODE) {
    return true;
  }
  const msg = String(body?.message || "").toLowerCase();
  if (!msg) return false;
  if (msg.includes("session expired") || msg.includes("token has expired")) return true;
  if (msg.includes("invalid session") || msg.includes("signature verification failed")) return true;
  if (msg.includes("not enough segments") || msg.includes("invalid token")) return true;
  return false;
}

/** Server said the login is over. Ignore client JWT clock and generic invalid_session. */
export function shouldEndSessionFor401(body) {
  const code = String(body?.code || "");
  return code === TENANT_SUSPENDED_CODE || code === SESSION_EXPIRED_CODE;
}

let sessionEnding = false;
let fetchGuardInstalled = false;
let refreshInFlight = null;
let lastRefreshAt = 0;

const PUBLIC_API_HINTS = [
  "/api/auth/request-otp",
  "/api/auth/verify-otp",
  "/api/auth/resend-otp",
  "/api/auth/select-tenant",
  "/api/auth/login",
  "/api/files/signed/",
];

function isPublicApi(url) {
  const path = String(url || "");
  return PUBLIC_API_HINTS.some((hint) => path.includes(hint));
}

function isSessionRefreshUrl(url) {
  return String(url || "").includes("/api/auth/session/refresh");
}

/** Clear the session and send the user to login once. */
export function endSession(reason = "1") {
  if (sessionEnding) return;
  if (!hasSignedInHint() && window.location.pathname === "/") return;
  sessionEnding = true;
  if (!localStorage.getItem(SESSION_ENDED_KEY)) {
    localStorage.setItem(SESSION_ENDED_KEY, reason);
  }
  clearAccessToken();
  localStorage.removeItem(ACTIVITY_KEY);
  localStorage.removeItem(SESSION_TIMEOUT_KEY);
  clearSensitiveToken();
  clearPlanContext();
  clearClientPrivacyCaches();
  clearPersistedPanelViews();
  void clearAccessCookie();
  const path = window.location.pathname || "/";
  if (path !== "/" && path !== "") {
    window.location.assign("/");
  } else {
    sessionEnding = false;
  }
}

function shouldInspectUnauthorized(url) {
  if (!hasSignedInHint()) return false;
  if (isPublicApi(url)) return false;
  return String(url || "").includes("/api/");
}

function currentEmpType() {
  return empTypeFromToken(sessionToken());
}

/** Stamp last activity. Does not refresh. */
export function markLocalActivity() {
  if (!hasSignedInHint()) return;
  const now = Date.now();
  localStorage.setItem(ACTIVITY_KEY, String(now));
}

/**
 * Start/reset the idle clock for a live JWT. Leftover lastActivityAt from a
 * previous visit must not idle-out a newly issued token.
 */
export function ensureActivityStamp() {
  const token = sessionToken();
  if (!token && !hasSignedInHint()) return;
  if (!token) {
    const now = Date.now();
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const lastActivity = Number(raw);
    const missing = !raw || Number.isNaN(lastActivity);
    const future = lastActivity > now + 5000;
    if (missing || future) {
      localStorage.setItem(ACTIVITY_KEY, String(now));
    }
    return;
  }
  const payload = parseJwtPayload(token);
  const now = Date.now();
  const iatMs = payload?.iat ? payload.iat * 1000 : now;
  const timeoutMs = getIdleTimeoutMs(payload?.emp_type);
  const raw = localStorage.getItem(ACTIVITY_KEY);
  const lastActivity = Number(raw);
  const missing = !raw || Number.isNaN(lastActivity);
  const future = lastActivity > now + 5000;
  const beforeThisJwt = lastActivity < iatMs - 2000;
  const idleAlready = !missing && now - lastActivity > timeoutMs;
  const jwtStillInIdleWindow = now - iatMs < timeoutMs + 5000;
  if (missing || future || beforeThisJwt || (idleAlready && jwtStillInIdleWindow)) {
    localStorage.setItem(ACTIVITY_KEY, String(now));
  }
}

/** Any authenticated /api 401 that is a real session death ends the session. */
export function installSessionFetchGuard() {
  if (fetchGuardInstalled || typeof window === "undefined" || typeof window.fetch !== "function") {
    return;
  }
  fetchGuardInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const nextInit = { ...init, credentials: "include" };
    if (String(url).includes("/api/")) {
      const headers = new Headers(nextInit.headers || {});
      stripBadAuthorization(headers);
      const token = sessionToken();
      if (token && !isPublicApi(url) && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      nextInit.headers = headers;
    }
    const response = await nativeFetch(input, nextInit);
    if (response.ok && shouldInspectUnauthorized(url) && !isSessionRefreshUrl(url)) {
      markLocalActivity();
    }
    if (
      response.status === 401
      && shouldInspectUnauthorized(url)
      && !isSessionRefreshUrl(url)
    ) {
      const body = await readJsonBody(response);
      if (shouldEndSessionFor401(body)) {
        const reason = body?.code === TENANT_SUSPENDED_CODE ? TENANT_SUSPENDED_CODE : "1";
        if (reason === TENANT_SUSPENDED_CODE) {
          localStorage.setItem(SESSION_ENDED_KEY, TENANT_SUSPENDED_CODE);
        }
        endSession(reason);
      }
    }
    return response;
  };

  const enforce = () => {
    ensureActivityStamp();
    if (sessionShouldEnd(currentEmpType())) {
      endSession("1");
      return;
    }
    refreshIfDue();
  };
  window.setInterval(enforce, 15000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") enforce();
  });
}

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
  "finance",
  "finance department",
  "finance team",
  "admin",
  "administrator",
  "administration",
  "super admin",
  "superadmin",
  "manager",
  "managers",
]);

export function normalizeEmpType(empType) {
  return String(empType || "")
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ");
}

export function isExtendedSessionEmpType(empType) {
  const n = normalizeEmpType(empType);
  return EXTENDED_EMP_TYPES.has(n) || n.replace(/\s+/g, "") === "superadmin";
}

export function getIdleTimeoutMs(empType) {
  const stored = Number(localStorage.getItem(SESSION_TIMEOUT_KEY));
  if (Number.isFinite(stored) && stored > 0) {
    return Math.min(EXTENDED_SESSION_MS, Math.max(DEFAULT_SESSION_MS, stored));
  }
  return isExtendedSessionEmpType(empType) ? EXTENDED_SESSION_MS : DEFAULT_SESSION_MS;
}

/** Idle only. Client JWT exp must not log the user out while the server still accepts the token. */
export function sessionShouldEnd(empType) {
  const token = sessionToken();
  if (!token && !hasSignedInHint()) return false;
  ensureActivityStamp();
  const raw = localStorage.getItem(ACTIVITY_KEY);
  const lastActivity = Number(raw);
  const timeoutMs = getIdleTimeoutMs(empType);
  if (!raw || Number.isNaN(lastActivity)) {
    return false;
  }
  if (lastActivity > Date.now() + 5000) {
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    return false;
  }
  return Date.now() - lastActivity > timeoutMs;
}

export function jwtIsExpired(token = sessionToken()) {
  const payload = parseJwtPayload(token);
  if (!payload?.exp) return false;
  const now = Date.now();
  const iatMs = payload.iat ? payload.iat * 1000 : 0;
  if (iatMs && now - iatMs < 2 * 60 * 1000) return false;
  return payload.exp * 1000 <= now;
}

export function jwtNeedsRefresh(token = sessionToken()) {
  const payload = parseJwtPayload(token);
  if (!payload?.exp) return false;
  const remaining = payload.exp * 1000 - Date.now();
  return remaining <= REFRESH_BEFORE_EXPIRY_MS;
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
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefreshSessionToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefreshSessionToken() {
  const token = sessionToken();
  if (!token && !hasSignedInHint()) return false;
  if (sessionShouldEnd(empTypeFromToken(token))) {
    endSession("1");
    return false;
  }
  try {
    const res = await fetch("/api/auth/session/refresh", {
      method: "POST",
      credentials: "include",
      headers: {
        ...(isLikelyJwt(token) ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
    });
    if (res.status === 401) {
      const body = await readJsonBody(res);
      if (shouldEndSessionFor401(body)) {
        const reason = await noteSessionEnded(res);
        endSession(reason);
      }
      return false;
    }
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    if (data?.success) {
      if (data?.token) setAccessToken(data.token);
      else markSignedIn();
      persistSessionTimeoutMinutes(data.session_timeout_minutes);
      lastRefreshAt = Date.now();
      return true;
    }
  } catch {
    /* ignore transient network errors */
  }
  return false;
}

/** Refresh when the token is half-spent or due, if the user is not idle. */
export function refreshIfDue({ force = false } = {}) {
  const token = sessionToken();
  if (!token && !hasSignedInHint()) return Promise.resolve(false);
  if (sessionShouldEnd(empTypeFromToken(token))) {
    endSession("1");
    return Promise.resolve(false);
  }
  const now = Date.now();
  if (!token && hasSignedInHint()) {
    if (!force && lastRefreshAt && now - lastRefreshAt < REFRESH_THROTTLE_MS) {
      return Promise.resolve(false);
    }
    lastRefreshAt = now;
    return refreshSessionToken();
  }
  if (!force && !jwtNeedsRefresh(token)) {
    return Promise.resolve(false);
  }
  if (!force && lastRefreshAt && now - lastRefreshAt < REFRESH_THROTTLE_MS) {
    return Promise.resolve(false);
  }
  lastRefreshAt = now;
  return refreshSessionToken();
}

export function recordUserActivity() {
  if (!hasSignedInHint()) return;
  markLocalActivity();
}
