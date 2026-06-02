import { useCallback, useEffect, useState } from "react";

/**
 * Persists a string "view" id in localStorage and optional URL ?view= param.
 * Survives browser refresh on panel pages that use internal view state.
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
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [view, defaultView, searchParamName, syncUrl]);

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
