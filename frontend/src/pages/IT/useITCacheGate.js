import { useCallback, useRef, useState } from "react";
import { syncITDataFromAPI, toastITApiFailure } from "./Data";

const CACHE_FRESH_MS = 60_000;

/**
 * On a server-paged IT screen the detail modals still read the localStorage copy of IT data.
 * `withCache(open, fromCache)` returns a row handler that refreshes that copy (at most once a
 * minute) and then calls `open` with `fromCache(row)` (the full local row) or the row itself.
 * When `paged` is false the handler just calls `open(row)`.
 */
export function useITCacheGate(paged) {
  const syncedAtRef = useRef(0);
  const [preparing, setPreparing] = useState(false);
  const withCache = useCallback(
    (open, fromCache = null) =>
      async (row) => {
        if (!paged) {
          open(row);
          return;
        }
        if (Date.now() - syncedAtRef.current > CACHE_FRESH_MS) {
          setPreparing(true);
          try {
            await syncITDataFromAPI();
            syncedAtRef.current = Date.now();
          } catch (err) {
            toastITApiFailure(
              err,
              "Could not sync IT data from the server. Showing cached details.",
              { toastId: "it-sync-fail" },
            );
          } finally {
            setPreparing(false);
          }
        }
        open((fromCache && fromCache(row)) ?? row);
      },
    [paged],
  );
  return { withCache, preparing };
}
