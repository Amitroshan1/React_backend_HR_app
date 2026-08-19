/**
 * ITAM feature flags — mirror of backend_HRMS/website/itam/flags.py
 * Defaults OFF until synced from GET /api/it/itam/meta or Vite env.
 */

const STORAGE_KEY = "itam_flags_cache_v1";

export const ITAM_FLAG_KEYS = [
  "itam_transitions_v1",
  "itam_timeline_v1",
  "itam_lifecycle_v1",
  "itam_api_first_v1",
  "itam_self_service_v1",
  "itam_offboard_gate_v1",
];

const ENV_BY_FLAG = {
  itam_transitions_v1: "VITE_ITAM_TRANSITIONS_V1",
  itam_timeline_v1: "VITE_ITAM_TIMELINE_V1",
  itam_lifecycle_v1: "VITE_ITAM_LIFECYCLE_V1",
  itam_api_first_v1: "VITE_ITAM_API_FIRST_V1",
  itam_self_service_v1: "VITE_ITAM_SELF_SERVICE_V1",
  itam_offboard_gate_v1: "VITE_ITAM_OFFBOARD_GATE_V1",
};

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function parseBool(raw, defaultValue = false) {
  if (raw == null || raw === "") return defaultValue;
  return TRUTHY.has(String(raw).trim().toLowerCase());
}

function flagsFromEnv() {
  const out = {};
  for (const key of ITAM_FLAG_KEYS) {
    const envName = ENV_BY_FLAG[key];
    const raw =
      typeof import.meta !== "undefined" && import.meta.env
        ? import.meta.env[envName]
        : undefined;
    out[key] = parseBool(raw, false);
  }
  return out;
}

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.flags) return null;
    return parsed.flags;
  } catch {
    return null;
  }
}

export function defaultItamFlags() {
  return Object.fromEntries(ITAM_FLAG_KEYS.map((k) => [k, false]));
}

/** Merge: defaults OFF ← Vite env ← last meta cache (server is source of truth when set). */
export function getItamFlags() {
  const merged = { ...defaultItamFlags(), ...flagsFromEnv() };
  const cached = readCache();
  if (cached && typeof cached === "object") {
    for (const key of ITAM_FLAG_KEYS) {
      if (typeof cached[key] === "boolean") merged[key] = cached[key];
    }
  }
  return merged;
}

export function isItamFlagEnabled(flagKey) {
  if (!ITAM_FLAG_KEYS.includes(flagKey)) return false;
  return Boolean(getItamFlags()[flagKey]);
}

export function setItamFlagsCache(flags) {
  if (!flags || typeof flags !== "object") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ flags, cachedAt: new Date().toISOString() })
    );
  } catch {
    /* ignore */
  }
}

export function clearItamFlagsCache() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Fetch P0 meta and cache flags. Safe no-op on failure (flags stay OFF).
 * Call from IT shell when ready (P1+); optional in P0.
 */
export async function syncItamFlagsFromApi(authHeaders = {}) {
  try {
    const res = await fetch("/api/it/itam/meta", {
      method: "GET",
      headers: { ...authHeaders },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.flags) return getItamFlags();
    setItamFlagsCache(data.flags);
    return getItamFlags();
  } catch {
    return getItamFlags();
  }
}
