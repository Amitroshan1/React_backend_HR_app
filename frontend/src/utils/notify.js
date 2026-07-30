import { toast } from "react-toastify";
import {
  getApiErrorMessage,
  isApiWarningFailure,
} from "./apiError";

const defaultOptions = {
  position: "bottom-right",
  autoClose: 4000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
};

export function notifySuccess(message, options = {}) {
  if (!message) return;
  toast.success(message, { ...defaultOptions, ...options });
}

export function notifyError(message, options = {}) {
  if (!message) return;
  const cleaned = getApiErrorMessage(
    typeof message === "object" ? message : { message: String(message) },
    "Something went wrong. Please try again.",
  );
  // Prefer warning so users see the exact issue (never bare "Internal Server Error").
  toast.warning(cleaned, { ...defaultOptions, autoClose: 5000, ...options });
}

export function notifyInfo(message, options = {}) {
  if (!message) return;
  toast.info(message, { ...defaultOptions, ...options });
}

export function notifyWarning(message, options = {}) {
  if (!message) return;
  toast.warning(message, { ...defaultOptions, autoClose: 5000, ...options });
}

/**
 * Show an API failure toast with the exact backend/user message.
 * Prefer warning for 4xx / conflicts / known business issues.
 * Never surfaces bare "Internal Server Error".
 *
 * @returns {string} message shown
 */
export function notifyApiFailure(err, fallback, options = {}) {
  const message = getApiErrorMessage(
    err,
    fallback || "Something went wrong. Please try again.",
  );
  // Prefer warning so users see a clear issue, not a scary red "server crash".
  if (isApiWarningFailure(err) || options.forceWarning) {
    notifyWarning(message, options);
  } else {
    // Unexpected failures still show the exact message (not "Internal Server Error").
    notifyWarning(message, options);
  }
  return message;
}

export { getApiErrorMessage, isApiWarningFailure } from "./apiError";
