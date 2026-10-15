/**
 * Per-screen switch for server-side paging (Phase 4).
 *
 * A screen listed here asks the API for one page at a time. Turning a screen off makes it
 * load the old way again (full list, or the localStorage copy for inventory screens):
 *   - build time: VITE_PAGED_SCREENS_OFF=itReturnRequests,itDayUsePicker   (or "all")
 *   - in a browser: localStorage.setItem("paged_screens_off", "itReturnRequests")   (or "all")
 */

export const PAGED_SCREENS = [
  "itReturnRequests",
  "itDayUsePicker",
  "itInventoryCards",
  "itInventoryOverview",
  "itTotalAssets",
  "itNotWorking",
  "itInRepair",
  "itDeadAssets",
  "itRemovedFromIT",
  "itAssetManagement",
  "adminLeaves",
  "adminEmployees",
  "hrLeaveUpdation",
];

const STORAGE_KEY = "paged_screens_off";

function parseList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function switchedOff() {
  const fromEnv =
    typeof import.meta !== "undefined" && import.meta.env
      ? parseList(import.meta.env.VITE_PAGED_SCREENS_OFF)
      : [];
  let fromStorage = [];
  try {
    fromStorage = parseList(localStorage.getItem(STORAGE_KEY));
  } catch {
    /* storage unavailable */
  }
  return new Set([...fromEnv, ...fromStorage]);
}

export function isPagedScreenEnabled(screen) {
  if (!PAGED_SCREENS.includes(screen)) return false;
  const off = switchedOff();
  return !off.has("all") && !off.has(screen);
}
