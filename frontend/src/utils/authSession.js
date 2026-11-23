/**
 * Login JWT: in-memory + HttpOnly cookie (hrms_access).
 * Do not persist the JWT in localStorage/sessionStorage (audit: plain-text token).
 * Do not monkey-patch Storage.
 */

const TOKEN_KEY = "token";
const SIGNED_IN_KEY = "hrms_signed_in";
const SESSION_KEY = "hrms_session";

let memToken = null;

function readStore(store, key) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(store, key, value) {
  try {
    if (value == null || value === "") store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export function isLikelyJwt(value) {
  if (!value || typeof value !== "string") return false;
  const t = value.trim();
  if (!t || t === "null" || t === "undefined") return false;
  const parts = t.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function purgePersistedJwt() {
  writeStore(localStorage, TOKEN_KEY, null);
  writeStore(sessionStorage, SESSION_KEY, null);
}

function adoptFromDisk() {
  const fromLocal = readStore(localStorage, TOKEN_KEY);
  if (isLikelyJwt(fromLocal)) return fromLocal;
  const fromSession = readStore(sessionStorage, SESSION_KEY);
  if (isLikelyJwt(fromSession)) return fromSession;
  return null;
}

export function getAccessToken() {
  if (isLikelyJwt(memToken)) return memToken;
  const fromDisk = adoptFromDisk();
  purgePersistedJwt();
  if (fromDisk) {
    memToken = fromDisk;
    writeStore(localStorage, SIGNED_IN_KEY, "1");
    return memToken;
  }
  return null;
}

export function setAccessToken(token) {
  memToken = isLikelyJwt(token) ? token.trim() : null;
  purgePersistedJwt();
  writeStore(localStorage, SIGNED_IN_KEY, memToken ? "1" : null);
  if (memToken) {
    writeStore(localStorage, "lastActivityAt", String(Date.now()));
  }
}

/** Cookie session is live; do not store a JWT. */
export function markSignedIn() {
  purgePersistedJwt();
  writeStore(localStorage, SIGNED_IN_KEY, "1");
  writeStore(localStorage, "lastActivityAt", String(Date.now()));
}

export function clearAccessToken() {
  memToken = null;
  purgePersistedJwt();
  writeStore(localStorage, SIGNED_IN_KEY, null);
}

export function hasSignedInHint() {
  if (getAccessToken()) return true;
  return readStore(localStorage, SIGNED_IN_KEY) === "1";
}

/** Load leftover disk JWT into memory, then delete it from Storage. */
export function installAccessTokenMemory() {
  getAccessToken();
  purgePersistedJwt();
}

/** New tab / refresh: HttpOnly cookie re-issues JWT into memory (not disk). */
export async function hydrateAccessTokenFromCookie() {
  if (getAccessToken()) return true;
  try {
    const res = await fetch("/api/auth/session/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      clearAccessToken();
      return false;
    }
    if (res.ok && data?.success) {
      if (isLikelyJwt(data.token)) setAccessToken(data.token);
      else markSignedIn();
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function clearAccessCookie() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    /* ignore */
  }
}
