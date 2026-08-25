import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { downloadActivityLogCsvAPI, fetchActivityLogAPI } from "../Data";
import { ACTION_LABELS, TRANSITION_ACTIONS } from "./contracts";
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

const ACTION_OPTIONS = Object.values(TRANSITION_ACTIONS);

export default function ActivityLogPage({ defaultScope = "inventory" }) {
  const navigate = useNavigate();
  const isInventory = defaultScope === "inventory";
  const backTo = isInventory ? "/it/inventory" : "/it/Assets";

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
      await downloadActivityLogCsvAPI(filters, `${defaultScope}-activity`);
    } catch (err) {
      setError(err?.message || "CSV export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="alog-page">
      <header className="alog-header">
        <button type="button" className="alog-back" onClick={() => navigate(backTo)}>
          ← Back
        </button>
        <div>
          <p className="alog-kicker">{isInventory ? "Inventory" : "IT · Asset Management"}</p>
          <h1>Activity log</h1>
          <p className="alog-sub">Every recorded movement for audit — add, assign, repair, parcel, remove.</p>
        </div>
      </header>

      <div className="alog-filters">
        <label>
          Scope
          <select
            value={scope}
            onChange={(e) => {
              setPage(1);
              setScope(e.target.value);
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
            {ACTION_OPTIONS.map((code) => (
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
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {error ? <p className="alog-error">{error}</p> : null}
      <p className="alog-count">
        {loading ? "Loading…" : `${pagination.total || 0} event${pagination.total === 1 ? "" : "s"}`}
      </p>

      <div className="alog-table-wrap">
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
                <td colSpan={7} className="alog-empty">
                  No movements in this range. New inventory and IT actions are logged automatically.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id || row.transitionCode}>
                  <td>{formatWhen(row.occurredAt)}</td>
                  <td>
                    <span className="alog-action">{row.actionLabel || row.actionCode}</span>
                  </td>
                  <td>
                    <div className="alog-asset">
                      <strong>{row.assetName || "—"}</strong>
                      {row.serialNumber || row.unitCode ? (
                        <span>{row.serialNumber || row.unitCode}</span>
                      ) : null}
                    </div>
                  </td>
                  <td>{row.inventoryCategory || "—"}</td>
                  <td className="alog-status">
                    {(row.fromStatus || "—") + " → " + (row.toStatus || "—")}
                  </td>
                  <td>{row.actor?.name || "—"}</td>
                  <td className="alog-remark" title={row.remark || ""}>
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
  );
}
