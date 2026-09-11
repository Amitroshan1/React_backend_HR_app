import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { downloadActivityLogExcelAPI, fetchActivityLogAPI } from "../Data";
import { ACTION_LABELS, activityActionsForScope } from "./contracts";
import { INV_CATEGORIES } from "../inventoryCategories";
import "./ActivityLogPage.css";

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return { from: "", to: "" };
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(last).padStart(2, "0")}`,
  };
}

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch {
    return String(iso);
  }
}

export default function ActivityLogPage({ defaultScope = "inventory" }) {
  const navigate = useNavigate();
  const isInventory = defaultScope === "inventory";
  const backTo = isInventory ? "/it/inventory" : "/it";

  const [scope, setScope] = useState(defaultScope);
  const [month, setMonth] = useState(currentMonthValue);
  const [action, setAction] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const actionOptions = useMemo(() => activityActionsForScope(scope), [scope]);

  const range = useMemo(() => monthRange(month), [month]);

  const filters = useMemo(
    () => ({
      scope,
      action,
      q: qApplied,
      from: range.from,
      to: range.to,
      inventoryCategory: isInventory || scope === "inventory" ? category : "",
      page,
      limit: 50,
    }),
    [scope, action, qApplied, range.from, range.to, category, page, isInventory],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchActivityLogAPI(filters);
      setRows(Array.isArray(data?.transitions) ? data.transitions : []);
      setPagination(data?.pagination || { page: 1, limit: 50, total: 0, totalPages: 1 });
    } catch (err) {
      setError(err?.message || "Could not load activity log");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const onExport = async () => {
    setExporting(true);
    setError("");
    try {
      await downloadActivityLogExcelAPI(filters, `${defaultScope}-activity`);
    } catch (err) {
      setError(err?.message || "Excel export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="alog-page">
      <div className="alog-container">
        <header className="alog-topbar">
          <button type="button" className="alog-back" onClick={() => navigate(backTo)}>
            ← Back
          </button>
          <div className="alog-title-block">
            <p className="alog-kicker">{isInventory ? "Inventory" : "IT · Asset Management"}</p>
            <h1 className="alog-title">Activity log</h1>
          </div>
          <p className="alog-total">
            {loading ? "Loading…" : (
              <>
                <strong>{pagination.total || 0}</strong> event{(pagination.total || 0) === 1 ? "" : "s"}
              </>
            )}
          </p>
        </header>

        <p className="alog-sub">Every recorded movement for audit — add, assign, repair, parcel, remove.</p>

        <div className="alog-filters">
          <label>
            Scope
            <select
              value={scope}
              onChange={(e) => {
                const nextScope = e.target.value;
                const nextActions = activityActionsForScope(nextScope);
                setPage(1);
                setScope(nextScope);
                if (action && !nextActions.includes(action)) {
                  setAction("");
                }
              }}
            >
              <option value="inventory">Inventory movements</option>
              <option value="it">IT assignments / returns</option>
              <option value="all">All activity</option>
            </select>
          </label>
          <label>
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => {
                setPage(1);
                setMonth(e.target.value);
              }}
            />
          </label>
          <label>
            Action
            <select
              value={action}
              onChange={(e) => {
                setPage(1);
                setAction(e.target.value);
              }}
            >
              <option value="">All actions</option>
              {actionOptions.map((code) => (
                <option key={code} value={code}>
                  {ACTION_LABELS[code] || code}
                </option>
              ))}
            </select>
          </label>
          {(scope === "inventory" || scope === "all") && (
            <label>
              Category
              <select
                value={category}
                onChange={(e) => {
                  setPage(1);
                  setCategory(e.target.value);
                }}
              >
                <option value="">All categories</option>
                {INV_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="alog-search">
            <input
              type="search"
              placeholder="Search remark, action, serial…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setPage(1);
                  setQApplied(q.trim());
                }
              }}
            />
            <button
              type="button"
              className="alog-btn"
              onClick={() => {
                setPage(1);
                setQApplied(q.trim());
              }}
            >
              Search
            </button>
          </div>
          <button type="button" className="alog-btn alog-btn--ghost" onClick={load} disabled={loading}>
            Refresh
          </button>
          <button type="button" className="alog-btn" onClick={onExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export Excel"}
          </button>
        </div>

        {error ? <p className="alog-error">{error}</p> : null}

        <div className="alog-table-wrap it-m-scroll--cards">
          <table className="alog-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Asset</th>
                <th>Category</th>
                <th>From → To</th>
                <th>By</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="alog-empty it-m-empty">
                    No movements in this range. New inventory and IT actions are logged automatically.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id || row.transitionCode}>
                    <td data-label="When">{formatWhen(row.occurredAt)}</td>
                    <td data-label="Action">
                      <span className="alog-action">{row.actionLabel || row.actionCode}</span>
                    </td>
                    <td data-label="Asset">
                      <div className="alog-asset">
                        <strong>{row.assetName || "—"}</strong>
                        {row.serialNumber || row.unitCode ? (
                          <span>{row.serialNumber || row.unitCode}</span>
                        ) : null}
                      </div>
                    </td>
                    <td data-label="Category">{row.inventoryCategory || "—"}</td>
                    <td className="alog-status" data-label="From → To">
                      {(row.fromStatus || "—") + " → " + (row.toStatus || "—")}
                    </td>
                    <td data-label="By">{row.actor?.name || "—"}</td>
                    <td className="alog-remark" data-label="Remark" title={row.remark || ""}>
                      {row.remark || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 ? (
          <div className="alog-pager">
            <button
              type="button"
              className="alog-btn alog-btn--ghost"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span>
              Page {pagination.page} / {pagination.totalPages}
            </span>
            <button
              type="button"
              className="alog-btn alog-btn--ghost"
              disabled={page >= pagination.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
