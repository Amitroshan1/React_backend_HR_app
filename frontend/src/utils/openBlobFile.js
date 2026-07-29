/**
 * Shared helpers for opening/downloading blobs after authenticated async fetches.
 * Avoids window.open() which browsers block after await (popup blocker).
 */

const INLINE_VIEWABLE_PREFIXES = ["image/", "text/", "application/pdf"];

export function isInlineViewableBlob(blob, fileName = "") {
  const type = String(blob?.type || "").toLowerCase();
  if (INLINE_VIEWABLE_PREFIXES.some((p) => type.startsWith(p))) return true;
  const name = String(fileName || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg|pdf|txt|csv|html?)$/i.test(name);
}

export function displayFileName(storedName, fallback = "attachment") {
  const name = String(storedName || "").trim();
  if (!name) return fallback;
  // Strip leading uuid_/hex_ prefixes commonly used in uploads
  const idx = name.indexOf("_");
  if (idx >= 0 && idx < name.length - 1 && /^[a-f0-9-]{8,}$/i.test(name.slice(0, idx))) {
    return name.slice(idx + 1);
  }
  return name.split("/").pop() || name;
}

/**
 * Open or download a blob via a temporary <a> click (popup-safe after async work).
 */
export function openOrDownloadBlob(blob, { fileName = "attachment", preferDownload = false } = {}) {
  if (!blob) throw new Error("No file data");
  const url = URL.createObjectURL(blob);
  const name = displayFileName(fileName);
  const forceDownload = preferDownload || !isInlineViewableBlob(blob, name);

  try {
    const link = document.createElement("a");
    link.href = url;
    link.rel = "noopener noreferrer";
    if (forceDownload) {
      link.download = name;
    } else {
      link.target = "_blank";
    }
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
}

/**
 * Fetch an authenticated URL and open/download the response blob.
 */
export async function fetchAndOpenAuthenticatedFile(url, {
  token,
  fileName,
  preferDownload = false,
  headers = {},
} = {}) {
  const authToken = token || (typeof localStorage !== "undefined" ? localStorage.getItem("token") : null);
  if (!authToken) {
    throw new Error("Please log in again to view this file.");
  }
  if (!url) {
    throw new Error("Invalid file path");
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
      ...headers,
    },
  });

  if (!response.ok) {
    let message = "Unable to open file";
    try {
      const data = await response.clone().json();
      message = data?.message || data?.msg || message;
    } catch {
      /* ignore non-JSON bodies */
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  if (!blob || blob.size === 0) {
    throw new Error("File is empty or unavailable");
  }

  const nameFromHeader = (() => {
    const cd = response.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);
    return m?.[1] ? decodeURIComponent(m[1].replace(/"/g, "").trim()) : "";
  })();

  openOrDownloadBlob(blob, {
    fileName: fileName || nameFromHeader || "attachment",
    preferDownload,
  });
}
