import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Re-runs callback whenever the user navigates to a route (pathname or search change),
 * including the first mount. Pass extraDeps for panel sub-views (e.g. internal HR view id).
 */
export function useRefreshOnNavigate(callback, extraDeps = []) {
  const location = useLocation();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    callbackRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, ...extraDeps]);
}
