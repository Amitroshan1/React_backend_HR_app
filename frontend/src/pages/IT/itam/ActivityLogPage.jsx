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

function isMobileTabletType(hwType) {
  const t = String(hwType || "").trim().toLowerCase();
  return t === "mobile" || t === "tablet";
}

function isLaptopLikeType(hwType) {
  const t = String(hwType || "").trim().toLowerCase();
  return t === "laptop" || t === "desktop";
}

/** Compact device identity lines for the activity Asset cell. */
function deviceDetailLines(row) {
  const lines = [];
  const hw = String(row?.hwType || "").trim();
  if (hw) lines.push({ label: "Type", value: hw });

  const brand = String(row?.brand || "").trim();
  const make = String(row?.make || "").trim();
  const model = String(row?.model || "").trim();
  if (isMobileTabletType(hw)) {
    const phoneModel = make || model;
    if (brand && phoneModel) lines.push({ label: "Model", value: `${brand} · ${phoneModel}` });
    else if (brand || phoneModel) lines.push({ label: "Model", value: brand || phoneModel });
    const imei = String(row?.imei || row?.imei1 || row?.imei2 || "").trim();
    if (imei) lines.push({ label: "IMEI", value: imei });
    const project = String(row?.projectCode || "").trim();
    if (project) lines.push({ label: "Project", value: project });
  } else if (isLaptopLikeType(hw)) {
    if (brand && make) lines.push({ label: "Brand / Make", value: `${brand} · ${make}` });
    else if (brand || make) lines.push({ label: "Brand", value: brand || make });
    const code = String(row?.laptopCode || row?.unitCode || "").trim();
    if (code) lines.push({ label: hw === "Desktop" ? "Desktop Code" : "Laptop Code", value: code });
  } else {
    if (brand && (make || model)) {
      lines.push({ label: "Brand / Model", value: `${brand} · ${make || model}` });
    } else if (brand || make || model) {
      lines.push({ label: "Brand / Model", value: brand || make || model });
    }
    const code = String(row?.laptopCode || row?.unitCode || "").trim();
    if (code) lines.push({ label: "Code", value: code });
  }

  const serial = String(row?.serialNumber || "").trim();
  if (serial) lines.push({ label: "Serial", value: serial });
  const location = String(row?.deviceLocation || "").trim();
  if (location) lines.push({ label: "Location", value: location });
  return lines;
}

export default function ActivityLogPage({ defaultScope = "inventory", embedded = false }) {
  const navigate = useNavigate();
  const isInventory = defaultScope === "inventory";
  const isParcel = defaultScope === "parcel";
  const lockScope = isParcel || embedded;
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

  useEffect(() => {
    setScope(defaultScope);
  }, [defaultScope]);

  const actionOptions = useMemo(() => activityActionsForScope(scope), [scope]);

  const range = useMemo(() => monthRange(month), [month]);

  const filters = useMemo(
    () => ({
      scope,
      action,
      q: qApplied,
      from: range.from,
      to: range.to,
      inventoryCategory:
        !isParcel && (isInventory || scope === "inventory") ? category : "",
      page,
      limit: 50,
    }),
    [scope, action, qApplied, range.from, range.to, category, page, isInventory, isParcel],
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

  const kicker = isParcel
    ? "Parcels"
    : isInventory
      ? "Inventory"
      : "IT · Asset Management";
  const title = isParcel ? "Parcel activity log" : "Activity log";
  const subtitle = isParcel
    ? "Import and export movements only — stock and IT assignment events are excluded."
    : isInventory
      ? "Inventory stock movements for audit — add, assign, repair, remove. Parcel import/export is in Parcel Log."
      : "Every recorded movement for audit — add, assign, repair, remove.";
  const emptyHint = isParcel
    ? "No parcel import/export events in this range."
    : isInventory
      ? "No inventory movements in this range. Parcel import/export events are listed under Parcels → Parcel Log."
      : "No movements in this range. New inventory and IT actions are logged automatically.";

  return (
    <div className={`alog-page${embedded ? " alog-page--embedded" : ""}`}>
      <div className="alog-container">
        {!embedded ? (
          <header className="alog-topbar">
            <button type="button" className="alog-back" onClick={() => navigate(backTo)}>
              ← Back
            </button>
            <div className="alog-title-block">
              <p className="alog-kicker">{kicker}</p>
              <h1 className="alog-title">{title}</h1>
            </div>
            <p className="alog-total">
              {loading ? "Loading…" : (
                <>
                  <strong>{pagination.total || 0}</strong> event{(pagination.total || 0) === 1 ? "" : "s"}
                </>
              )}
            </p>
          </header>
        ) : (
          <div className="alog-embedded-meta">
            <p className="alog-sub alog-sub--tight">{subtitle}</p>
            <p className="alog-total">
              {loading ? "Loading…" : (
                <>
                  <strong>{pagination.total || 0}</strong> event{(pagination.total || 0) === 1 ? "" : "s"}
                </>
              )}
            </p>
          </div>
        )}

        {!embedded ? <p className="alog-sub">{subtitle}</p> : null}

        <div className="alog-filters">
          {!lockScope ? (
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
          ) : null}
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
          {!isParcel && (scope === "inventory" || scope === "all") ? (
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
          ) : null}
          <div className="alog-search">
            <input
              type="search"
              placeholder={
                isParcel
                  ? "Search parcel code, destination, remark…"
                  : "Search remark, action, serial…"
              }
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
                <th>Device details</th>
                <th>Category</th>
                <th>From → To</th>
                <th>By</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="alog-empty it-m-empty">
                    {emptyHint}
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const details = deviceDetailLines(row);
                  return (
                  <tr key={row.id || row.transitionCode}>
                    <td data-label="When">{formatWhen(row.occurredAt)}</td>
                    <td data-label="Action">
                      <span className="alog-action">{row.actionLabel || row.actionCode}</span>
                    </td>
                    <td data-label="Asset">
                      <div className="alog-asset">
                        <strong>{row.assetName || "—"}</strong>
                        {row.hwType ? <span className="alog-hw-type">{row.hwType}</span> : null}
                      </div>
                    </td>
                    <td data-label="Device details">
                      {details.length ? (
                        <div className="alog-device-details">
                          {details.map((d) => (
                            <div key={`${d.label}-${d.value}`} className="alog-device-line">
                              <span className="alog-device-label">{d.label}</span>
                              <span className="alog-device-value" title={d.value}>{d.value}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="alog-muted">—</span>
                      )}
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
                  );
                })
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
