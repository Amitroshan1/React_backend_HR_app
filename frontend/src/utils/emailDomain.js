const DEFAULT_ALLOWED_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.in",
  "yahoo.co.in",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "rediffmail.com",
  "protonmail.com",
  "proton.me",
  "aol.com",
  "zoho.com",
  "mail.com",
]);

const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function extractEmailDomain(email) {
  return String(email || "").trim().toLowerCase().split("@")[1] || "";
}

export function isAllowedPersonalEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!EMAIL_FORMAT_RE.test(normalized)) return false;
  return DEFAULT_ALLOWED_DOMAINS.has(extractEmailDomain(normalized));
}

export function personalEmailValidationError(email) {
  const normalized = String(email || "").trim();
  if (!normalized) return "Email is required.";
  if (!EMAIL_FORMAT_RE.test(normalized.toLowerCase())) {
    return "Please enter a valid email address.";
  }
  if (!isAllowedPersonalEmail(normalized)) {
    return "Please enter a valid email address.";
  }
  return null;
}
