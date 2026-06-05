import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Persists a string "view" id in localStorage and optional URL ?view= param.
 * Survives browser refresh on panel pages that use internal view state.
 * Browser back/forward navigates between views, matching the in-page back buttons.
 */
export function usePersistedView({
  storageKey,
  defaultView,
  validViews,
  searchParamName = "view",
  syncUrl = true,
}) {
  const validSet = validViews ? new Set(validViews) : null;

  const normalize = useCallback(
    (raw) => {
      if (raw == null || raw === "") return null;
      const v = String(raw).trim();
      if (!v) return null;
      if (validSet && !validSet.has(v)) return null;
      return v;
    },
    [validSet],
  );

  const readStored = useCallback(() => {
    try {
      return normalize(localStorage.getItem(storageKey));
    } catch {
      return null;
    }
  }, [storageKey, normalize]);

  const readFromUrl = useCallback(() => {
    if (!syncUrl || typeof window === "undefined") return null;
    try {
      return normalize(new URLSearchParams(window.location.search).get(searchParamName));
    } catch {
      return null;
    }
  }, [syncUrl, searchParamName, normalize]);

  const [view, setViewState] = useState(() => readFromUrl() || readStored() || defaultView);

  // Track whether the current state change came from a popstate (browser back/fwd)
  // so we don't push a new history entry in that case.
  const fromPopStateRef = useRef(false);

  const setView = useCallback(
    (next) => {
      setViewState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        if (!value) return prev;
        try {
          localStorage.setItem(storageKey, value);
        } catch {
          /* ignore */
        }
        return value;
      });
    },
    [storageKey],
  );

  // Push a new history entry when view changes (so browser back works),
  // unless the change was triggered by popstate itself.
  useEffect(() => {
    if (!syncUrl || typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    if (view === defaultView) {
      params.delete(searchParamName);
    } else {
      params.set(searchParamName, view);
    }
    const search = params.toString();
    const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash || ""}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash || ""}`;

    if (nextUrl !== current) {
      if (fromPopStateRef.current) {
        // Came from browser back/fwd — just update the URL in-place, don't push
        window.history.replaceState({ view }, "", nextUrl);
      } else {
        // User clicked an in-page button — push a new history entry so browser back works
        window.history.pushState({ view }, "", nextUrl);
      }
    }
    fromPopStateRef.current = false;
  }, [view, defaultView, searchParamName, syncUrl]);

  // Listen to browser back/forward and sync view state
  useEffect(() => {
    if (!syncUrl || typeof window === "undefined") return;

    const handlePopState = (event) => {
      // Try the state object first, fall back to reading the URL
      const stateView = event.state && event.state.view ? normalize(event.state.view) : null;
      const urlView = normalize(new URLSearchParams(window.location.search).get(searchParamName));
      const target = stateView || urlView || defaultView;
      fromPopStateRef.current = true;
      setView(target);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [syncUrl, searchParamName, defaultView, normalize, setView]);

  return [view, setView, readStored];
}

export function clearPersistedPanelViews() {
  const keys = [
    "hr_panel_view",
    "manager_active_tab",
    "update_manager_view",
    "account_current_view",
  ];
  keys.forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  });
}
