import { useEffect, useRef } from "react";

/**
 * Runs callback on an interval only while the document tab is visible.
 * Also runs once when the tab becomes visible again.
 */
export function useVisibilityInterval(callback, delayMs, enabled = true) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled || delayMs == null || delayMs <= 0) return undefined;

    let timerId = null;

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      callbackRef.current();
    };

    const clear = () => {
      if (timerId != null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };

    const start = () => {
      clear();
      timerId = window.setInterval(tick, delayMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
        start();
      } else {
        clear();
      }
    };

    if (typeof document === "undefined" || document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [delayMs, enabled]);
}

/** True when the browser tab is currently visible. */
export function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}
