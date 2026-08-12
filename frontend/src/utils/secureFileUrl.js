/**
 * Secure HRMS file URLs.
 * Private uploads must not be loaded as bare /static/uploads/... (blocked without auth/signature).
 */

export function getAuthToken() {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem("token");
}

/** Strip host; return pathname + search. */
export function toPathOnly(url) {
  if (!url || typeof url !== "string") return "";
  let path = url.trim();
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) {
    try {
      const u = new URL(path);
      path = `${u.pathname || ""}${u.search || ""}`;
    } catch {
      /* keep */
    }
  }
  if (path.startsWith("/public/")) path = path.replace("/public/", "/");
  return path;
}

/**
 * Relative key under uploads (no static/uploads prefix).
 */
export function normalizeUploadRel(pathOrUrl) {
  let path = toPathOnly(pathOrUrl).split("?")[0];
  if (!path) return "";
  path = path.replace(/^\/+/, "");
  if (path.startsWith("api/files/signed/")) {
    path = path.slice("api/files/signed/".length);
  } else if (path.startsWith("api/files/content/")) {
    path = path.slice("api/files/content/".length);
  } else if (path.startsWith("static/uploads/")) {
    path = path.slice("static/uploads/".length);
  } else if (path.startsWith("uploads/")) {
    path = path.slice("uploads/".length);
  }
  return path.replace(/^\/+/, "");
}

export function isAlreadySignedFileUrl(url) {
  const p = toPathOnly(url);
  return p.includes("/api/files/signed/") && p.includes("sig=");
}

export function isSecureApiFileUrl(url) {
  const p = toPathOnly(url);
  return p.startsWith("/api/files/") || p.includes("/api/accounts/file/");
}

export function isLegacyStaticUploadUrl(url) {
  const p = toPathOnly(url).split("?")[0];
  return p.includes("/static/uploads/") || p.startsWith("static/uploads/");
}

/** JWT content URL for a relative upload key or legacy path. */
export function toAuthContentUrl(pathOrUrl) {
  if (isAlreadySignedFileUrl(pathOrUrl) || (isSecureApiFileUrl(pathOrUrl) && !isLegacyStaticUploadUrl(pathOrUrl))) {
    return toPathOnly(pathOrUrl).split("?")[0] + (toPathOnly(pathOrUrl).includes("?") ? "" : "");
  }
  if (isSecureApiFileUrl(pathOrUrl) && pathOrUrl.includes("/api/accounts/file/")) {
    return toPathOnly(pathOrUrl);
  }
  const rel = normalizeUploadRel(pathOrUrl);
  if (!rel) return "";
  const encoded = rel
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `/api/files/content/${encoded}`;
}

/** Accounts file helper — keeps existing payslip/form16 flow. */
export function toAccountsFileUrl(pathOrUrl) {
  const rel = normalizeUploadRel(pathOrUrl);
  if (!rel) return "";
  const encoded = rel
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `/api/accounts/file/${encoded}`;
}

/**
 * Resolve a display URL for <img>: prefer signed API URL when given legacy static path.
 */
export async function resolveDisplayFileUrl(pathOrUrl) {
  const raw = toPathOnly(pathOrUrl);
  if (!raw) return "";
  if (isAlreadySignedFileUrl(raw)) return raw.split("#")[0];

  const token = getAuthToken();
  if (!token) return "";

  // Already /api/files/content — fetch will add auth via blob helper
  if (raw.startsWith("/api/files/content/") || raw.startsWith("/api/accounts/file/")) {
    return raw;
  }

  const rel = normalizeUploadRel(raw);
  if (!rel) return "";

  try {
    const res = await fetch(`/api/files/resolve?path=${encodeURIComponent(rel)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success && data.url) return data.url;
  } catch {
    /* fall through */
  }
  return toAuthContentUrl(rel);
}

/**
 * Load a private image with JWT into a blob: URL (for avatars).
 * Returns { objectUrl, revoke } or { objectUrl: '', revoke: noop }.
 */
export async function fetchAuthenticatedObjectUrl(pathOrUrl) {
  const noop = { objectUrl: "", revoke: () => {} };
  let url = toPathOnly(pathOrUrl);
  if (!url) return noop;

  const token = getAuthToken();
  if (!token) return noop;

  if (isLegacyStaticUploadUrl(url) && !isAlreadySignedFileUrl(url)) {
    url = await resolveDisplayFileUrl(url);
  }
  if (!url) return noop;

  // Signed URLs do not need Authorization
  const headers = {};
  if (!isAlreadySignedFileUrl(url)) {
    headers.Authorization = `Bearer ${token}`;
    if (!isSecureApiFileUrl(url)) {
      url = toAuthContentUrl(url);
    }
  }

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return noop;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return noop;
    const objectUrl = URL.createObjectURL(blob);
    return {
      objectUrl,
      revoke: () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    return noop;
  }
}
