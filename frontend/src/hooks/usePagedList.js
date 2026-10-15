import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useDebounced(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const EMPTY = { rows: [], total: 0, pages: 1, page: 1 };

/**
 * One page of a list endpoint, with debounced search.
 *
 * fetchList(params) must resolve to the API body. With `enabled`, params carry
 * page / per_page / q; if the body has `pagination` the server paged it. Otherwise the
 * server sent the full list (API_PAGINATION_V1 off) and paging + search happen here,
 * without refetching until filters change or reload() is called.
 * With `enabled` false the full list is requested exactly as before and not paged.
 * With `skip` nothing is requested and the list is empty.
 * `selectMeta(body)` keeps extra response fields (e.g. per-category counts) as `meta`.
 */
export function usePagedList({
  fetchList,
  select,
  selectMeta = null,
  filters = {},
  perPage = 25,
  enabled = true,
  skip = false,
  matchesSearch = null,
  searchDelayMs = 300,
}) {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim(), searchDelayMs);
  const [reloadToken, setReloadToken] = useState(0);
  const filterKey = JSON.stringify(filters);
  const fullKey = `${filterKey}|${reloadToken}|${enabled}`;

  // The page belongs to one filter + search combination; changing either starts at page 1.
  const pageScope = `${filterKey}|${search}`;
  const [pageState, setPageState] = useState({ scope: pageScope, page: 1 });
  const page = pageState.scope === pageScope ? pageState.page : 1;
  const setPage = useCallback(
    (next) => setPageState({ scope: pageScope, page: Math.max(1, Number(next) || 1) }),
    [pageScope],
  );

  // { key, fullKey, mode: "server" | "full", rows, pagination, error }
  const [result, setResult] = useState(null);

  const fetchRef = useRef(fetchList);
  const selectRef = useRef(select);
  const selectMetaRef = useRef(selectMeta);
  useEffect(() => {
    fetchRef.current = fetchList;
    selectRef.current = select;
    selectMetaRef.current = selectMeta;
  });

  const requestKey = `${fullKey}|${page}|${search}`;
  const haveFullList = result?.mode === "full" && result.fullKey === fullKey;
  const pending = !skip && !haveFullList && result?.key !== requestKey;

  useEffect(() => {
    if (!pending) return undefined;
    let cancelled = false;
    const params = JSON.parse(filterKey);
    if (enabled) {
      params.page = page;
      params.per_page = perPage;
      if (search) params.q = search;
    }
    Promise.resolve(fetchRef.current(params))
      .then((body) => {
        if (cancelled) return;
        const rows = selectRef.current(body) || [];
        const meta = selectMetaRef.current ? selectMetaRef.current(body) : null;
        const pg = enabled ? body?.pagination : null;
        if (pg) {
          if (rows.length === 0 && pg.total > 0 && page > pg.pages) {
            setPage(pg.pages);
            return;
          }
          setResult({ key: requestKey, fullKey, mode: "server", rows, meta, pagination: pg });
        } else {
          setResult({ key: requestKey, fullKey, mode: "full", rows, meta });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setResult((prev) => ({ ...(prev || { rows: [] }), key: requestKey, error }));
      });
    return () => {
      cancelled = true;
    };
  }, [pending, requestKey, fullKey, filterKey, enabled, page, perPage, search, setPage]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const view = useMemo(() => {
    if (skip || !result) return EMPTY;
    if (result.mode === "server") {
      const pg = result.pagination;
      return { rows: result.rows, total: pg.total, pages: pg.pages, page: pg.page };
    }
    let rows = result.rows || [];
    if (!enabled) return { rows, total: rows.length, pages: 1, page: 1 };
    if (search && matchesSearch) {
      const needle = search.toLowerCase();
      rows = rows.filter((row) => matchesSearch(row, needle));
    }
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    const current = Math.min(page, pages);
    return {
      rows: rows.slice((current - 1) * perPage, current * perPage),
      total: rows.length,
      pages,
      page: current,
    };
  }, [skip, result, enabled, search, matchesSearch, page, perPage]);

  return {
    ...view,
    meta: skip ? null : result?.meta ?? null,
    perPage,
    enabled,
    loading: pending,
    error: !skip && result?.key === requestKey ? result.error || null : null,
    searchInput,
    setSearchInput,
    setPage,
    reload,
  };
}
