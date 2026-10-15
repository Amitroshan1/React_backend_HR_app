import React, { useCallback, useMemo, useState } from "react";
import { BadgeCheck, CalendarDays, Clock3, Inbox, RotateCcw } from "lucide-react";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { formatDate } from "../../utils/dateFormat";

const API_BASE = "/api/HumanResource";

const TYPE_OPTIONS = [
  { value: "all", label: "Leave and WFH" },
  { value: "leave", label: "Leave only" },
  { value: "wfh", label: "WFH only" },
];

const STAGE_TABS = [
  { key: "all", label: "All" },
  { key: "l2_pending", label: "L1 approved · L2 pending" },
  { key: "approved", label: "Fully approved" },
];

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function initials(name) {
  const parts = String(name || "").replace(/[^a-zA-Z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "E";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function levelTone(status) {
  const value = String(status || "").toLowerCase();
  if (value === "approved") return "is-approved";
  if (value === "pending") return "is-pending";
  if (value === "applied by hr") return "is-hr";
  return "is-skip";
}

function formatDays(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function Level({ label, level }) {
  const tone = levelTone(level?.status);
  return (
    <div className={`ap-level ${tone}`}>
      <span className="ap-level-dot">
        {tone === "is-approved" ? <BadgeCheck size={14} /> : tone === "is-pending" ? <Clock3 size={14} /> : null}
      </span>
      <span className="ap-level-text">
        <span>{label} · {level?.status || "—"}</span>
        <strong>{level?.name || (tone === "is-skip" ? "No separate L2" : "Not assigned")}</strong>
      </span>
    </div>
  );
}

export function HRApprovedLeaves({ empTypeOptions = [], circleOptions = [] }) {
  const [filters, setFilters] = useState({ month: currentMonth(), emp_type: "", circle: "", request_type: "all" });
  const [stage, setStage] = useState("all");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.month) params.set("month", filters.month);
      if (filters.emp_type) params.set("emp_type", filters.emp_type);
      if (filters.circle) params.set("circle", filters.circle);
      params.set("request_type", filters.request_type);
      const res = await fetch(`${API_BASE}/leave-updation/approved?${params.toString()}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not load approved requests");
      setRows(data.rows || []);
      setError("");
    } catch (err) {
      setRows([]);
      setError(err.message || "Could not load approved requests");
    } finally {
      setLoading(false);
    }
  }, [filters.month, filters.emp_type, filters.circle, filters.request_type]);

  useRefreshOnNavigate(load, [filters.month, filters.emp_type, filters.circle, filters.request_type]);

  const counts = useMemo(() => ({
    all: rows.length,
    l2_pending: rows.filter((r) => r.stage === "l2_pending").length,
    approved: rows.filter((r) => r.stage === "approved").length,
  }), [rows]);

  const visible = useMemo(
    () => (stage === "all" ? rows : rows.filter((r) => r.stage === stage)),
    [rows, stage],
  );

  const isDefault = filters.month === currentMonth() && !filters.emp_type && !filters.circle && filters.request_type === "all";

  return (
    <section className="lob-card ap-card">
      <div className="lob-head">
        <span className="lob-icon ap-icon"><BadgeCheck size={20} /></span>
        <div className="lob-copy">
          <h3>Approved leaves</h3>
          <p>Leave and work-from-home that the L1 manager has approved, and whether L2 has approved it yet.</p>
        </div>
      </div>

      <div className="ap-filters">
        <label className="lob-field">
          <span>Month</span>
          <input
            type="month"
            value={filters.month}
            onChange={(e) => setFilters((p) => ({ ...p, month: e.target.value }))}
          />
        </label>
        <label className="lob-field">
          <span>Employee type</span>
          <select value={filters.emp_type} onChange={(e) => setFilters((p) => ({ ...p, emp_type: e.target.value }))}>
            <option value="">All employee types</option>
            {empTypeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="lob-field">
          <span>Circle</span>
          <select value={filters.circle} onChange={(e) => setFilters((p) => ({ ...p, circle: e.target.value }))}>
            <option value="">All circles</option>
            {circleOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="lob-field">
          <span>Request</span>
          <select value={filters.request_type} onChange={(e) => setFilters((p) => ({ ...p, request_type: e.target.value }))}>
            {TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          className="ap-reset"
          disabled={isDefault}
          onClick={() => setFilters({ month: currentMonth(), emp_type: "", circle: "", request_type: "all" })}
        >
          <RotateCcw size={15} /> Reset
        </button>
      </div>

      <div className="ap-tabs" role="tablist">
        {STAGE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={stage === tab.key}
            className={`ap-tab${stage === tab.key ? " is-active" : ""} ap-tab-${tab.key}`}
            onClick={() => setStage(tab.key)}
          >
            {tab.label}
            <span>{counts[tab.key]}</span>
          </button>
        ))}
      </div>

      {error ? <div className="lob-error">{error}</div> : null}

      {loading ? (
        <div className="ap-list">
          {[0, 1, 2].map((key) => <div key={key} className="ap-skeleton" />)}
        </div>
      ) : null}

      {!loading && visible.length === 0 ? (
        <div className="ap-empty">
          <Inbox size={32} />
          <strong>No approved requests</strong>
          <span>Nothing matches these filters. Try another month or clear the filters.</span>
        </div>
      ) : null}

      {!loading && visible.length > 0 ? (
        <ul className="ap-list">
          {visible.map((row) => {
            const days = formatDays(row.days);
            const paid = formatDays(row.paid_days);
            const lwp = formatDays(row.lwp_days);
            return (
              <li key={row.row_key} className={`ap-row ${row.stage === "l2_pending" ? "is-waiting" : "is-done"}`}>
                <div className="ap-who">
                  <span className="ap-avatar">{initials(row.employee_name)}</span>
                  <span className="ap-who-text">
                    <strong>{row.employee_name || "Employee"}</strong>
                    <span>{row.emp_id || "—"} · {row.emp_type || "—"} · {row.circle || "—"}</span>
                  </span>
                </div>

                <div className="ap-what">
                  <span className={`ap-type ${row.request_type === "wfh" ? "is-wfh" : ""}`}>{row.leave_type}</span>
                  <span className="ap-dates">
                    <CalendarDays size={13} />
                    {formatDate(row.start_date)}
                    {row.end_date && row.end_date !== row.start_date ? ` – ${formatDate(row.end_date)}` : ""}
                    {days ? <em>{days} {days === "1" ? "day" : "days"}</em> : null}
                  </span>
                  {row.request_type === "leave" && (paid != null || lwp != null) ? (
                    <span className="ap-paid">Paid {paid ?? "—"} · LWP {lwp ?? "—"}</span>
                  ) : null}
                  {row.reason ? <span className="ap-reason" title={row.reason}>{row.reason}</span> : null}
                </div>

                <div className="ap-flow">
                  <Level label="L1" level={row.l1} />
                  <span className="ap-flow-line" aria-hidden />
                  <Level label="L2" level={row.l2} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

export default HRApprovedLeaves;
