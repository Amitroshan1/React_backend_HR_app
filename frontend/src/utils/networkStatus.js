export const NO_INTERNET_MESSAGE =
  "No internet connection. Please check your network and try again.";

/** True when the browser reports offline or fetch failed to reach the server. */
export function isLikelyNetworkError(err) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("failed to fetch")
    || msg.includes("networkerror")
    || msg.includes("network error")
    || msg.includes("load failed")
    || msg.includes("err_internet_disconnected")
  );
}

export function parseLeaveDays(value) {
  if (value == null || value === "" || value === "N/A" || value === "—") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatLeaveDays(value) {
  const n = parseLeaveDays(value);
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
