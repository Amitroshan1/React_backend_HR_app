import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import "./CircleTransferHistory.css";

const API_BASE = "/api/HumanResource";

const getAuthHeaders = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

export function CircleTransferHistory({ onBack, circleOptions = [] }) {
  const [filters, setFilters] = useState({
    q: "",
    circle: "All",
    effective_from: "",
    effective_to: "",
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filters.q.trim()) params.set("q", filters.q.trim());
      if (filters.circle && filters.circle !== "All") params.set("circle", filters.circle);
      if (filters.effective_from) params.set("effective_from", filters.effective_from);
      if (filters.effective_to) params.set("effective_to", filters.effective_to);
      const res = await fetch(`${API_BASE}/circle-transfers?${params}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to load circle transfer history");
      }
      setRows(data.transfers || []);
    } catch (e) {
      setError(e.message || "Failed to load history");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  return (
    <div className="hr-main-container circle-transfer-page">
      <button type="button" className="btn-back-updates" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Updates
      </button>

      <h2 style={{ marginTop: 8 }}>Circle Transfer History</h2>
      <p className="circle-transfer-muted" style={{ marginTop: 0 }}>
        When HR changes an employee&apos;s circle in Update Signup, the effective date (when they actually moved) and the recorded date are stored here.
      </p>

      <div className="circle-transfer-filters">
        <div>
          <label>Search employee</label>
          <input
            type="text"
            placeholder="Name, email, or emp ID"
            value={filters.q}
            onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
          />
        </div>
        <div>
          <label>Circle</label>
          <select
            value={filters.circle}
            onChange={(e) => setFilters((p) => ({ ...p, circle: e.target.value }))}
          >
            <option value="All">All circles</option>
            {circleOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Effective from (min)</label>
          <input
            type="date"
            value={filters.effective_from}
            onChange={(e) => setFilters((p) => ({ ...p, effective_from: e.target.value }))}
          />
        </div>
        <div>
          <label>Effective from (max)</label>
          <input
            type="date"
            value={filters.effective_to}
            onChange={(e) => setFilters((p) => ({ ...p, effective_to: e.target.value }))}
          />
        </div>
        <button type="button" className="circle-transfer-search-btn" onClick={fetchTransfers} disabled={loading}>
          <Search size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
          {loading ? "Loading…" : "Search"}
        </button>
      </div>

      {error ? <div className="circle-transfer-alert error">{error}</div> : null}

      <div className="circle-transfer-table-wrap">
        <table className="circle-transfer-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>From</th>
              <th>To</th>
              <th>Effective from</th>
              <th>Effective to</th>
              <th>Recorded on</th>
              <th>By</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "#94a3b8", padding: 24 }}>
                  {loading ? "Loading…" : "No circle transfers found."}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.employee_name || "—"}</div>
                    <div className="circle-transfer-muted">{r.emp_id || "—"} · {r.employee_email || "—"}</div>
                  </td>
                  <td>{r.from_circle ? <span className="circle-transfer-badge">{r.from_circle}</span> : "—"}</td>
                  <td>
                    <span className="circle-transfer-badge">{r.to_circle}</span>
                  </td>
                  <td>{formatDate(r.effective_from)}</td>
                  <td>{formatDate(r.effective_to)}</td>
                  <td>{formatDate(r.recorded_at)}</td>
                  <td>{r.recorded_by || "—"}</td>
                  <td>{r.notes || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
