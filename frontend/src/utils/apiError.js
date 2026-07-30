/**
 * Shared API error helpers — prefer clear user messages over "Internal Server Error".
 */

const GENERIC_PHRASES = [
  /^internal server error\.?$/i,
  /^server error\.?$/i,
  /^error\.?$/i,
  /^failed\.?$/i,
  /^ok$/i,
];

function isGenericPhrase(msg) {
  const s = String(msg || "").trim();
  if (!s) return true;
  return GENERIC_PHRASES.some((re) => re.test(s));
}

function statusFallback(status) {
  if (status === 400) return "Invalid request. Please check your input and try again.";
  if (status === 401) return "Your session expired. Please sign in again.";
  if (status === 403) return "You do not have permission for this action.";
  if (status === 404) return "The requested item was not found.";
  if (status === 409) return "This record already exists or conflicts with existing data.";
  if (status === 413) return "The upload is too large. Please use a smaller file.";
  if (status === 422) return "Some fields are invalid. Please review and try again.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500) {
    return "The server could not complete this request. Please try again.";
  }
  if (status) return `Request failed (${status}). Please try again.`;
  return "Something went wrong. Please try again.";
}

/**
 * Build an Error from a fetch Response + parsed JSON body (if any).
 */
export function errorFromApiResponse(res, data = {}) {
  const bodyMsg =
    (typeof data?.message === "string" && data.message.trim()) ||
    (typeof data?.error === "string" && data.error.trim()) ||
    (typeof data?.msg === "string" && data.msg.trim()) ||
    null;

  let message = bodyMsg && !isGenericPhrase(bodyMsg) ? bodyMsg : null;
  if (!message) {
    message = statusFallback(res?.status);
  }

  const err = new Error(message);
  err.status = res?.status;
  err.isConflict = res?.status === 409;
  err.data = data;
  return err;
}

/**
 * Extract a user-facing message from thrown errors / strings.
 * Never returns bare "Internal Server Error".
 */
export function getApiErrorMessage(
  err,
  fallback = "Something went wrong. Please try again.",
) {
  if (err == null) return fallback;

  if (typeof err === "string") {
    const s = err.trim();
    if (!s || isGenericPhrase(s) || /^server error \(\d+\)/i.test(s)) {
      return fallback;
    }
    return s;
  }

  const status = err.status ?? err.statusCode;
  const raw =
    (typeof err.message === "string" && err.message.trim()) ||
    (typeof err.data?.message === "string" && err.data.message.trim()) ||
    "";

  if (raw && !isGenericPhrase(raw) && !/^server error \(\d+\)/i.test(raw)) {
    return raw;
  }

  if (status) return statusFallback(status);
  return fallback || statusFallback(status);
}

/** Client/business failures and conflicts — toast as warning. */
export function isApiWarningFailure(err) {
  const status = err?.status ?? err?.statusCode;
  if (err?.isConflict === true) return true;
  if (status != null && status >= 400 && status < 500) return true;

  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("already exist") ||
    msg.includes("duplicate") ||
    msg.includes("unique serial") ||
    msg.includes("unique unit") ||
    msg.includes("required") ||
    msg.includes("not found") ||
    msg.includes("not allowed") ||
    msg.includes("invalid") ||
    msg.includes("permission") ||
    msg.includes("forbidden") ||
    msg.includes("unauthorized") ||
    msg.includes("conflict")
  );
}
