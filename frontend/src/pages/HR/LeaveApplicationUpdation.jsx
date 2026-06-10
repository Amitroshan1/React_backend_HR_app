import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Edit3, Search } from "lucide-react";
import "./LeaveApplicationUpdation.css";

const API_BASE = "/api/HumanResource";

const REQUEST_TYPE_OPTIONS = [
  { value: "all", label: "All (Leave + WFH)" },
  { value: "leave", label: "Leave Only" },
  { value: "wfh", label: "WFH Only" },
];
const LEAVE_TYPES = [
  "Privilege Leave",
  "Casual Leave",
  "Half Day Leave",
  "Compensatory Leave",
  "Optional Leave",
];

const getAuthHeaders = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const STATUS_FILTERS = ["All", "Pending", "Approved", "Rejected"];

const normalizeRequestStatus = (raw) =>
  String(raw ?? "")
    .trim()
    .toLowerCase();

const rowKey = (row) =>
  row?.row_key || `${String(row?.request_type || "leave").toLowerCase()}-${row?.id}`;

const matchesStatusFilter = (row, statusFilter) => {
  if (statusFilter === "All") return true;
  return normalizeRequestStatus(row?.status) === normalizeRequestStatus(statusFilter);
};

const parseAuditAction = (actionText) => {
  const raw = String(actionText || "");
  const chunks = raw.split("|");
  const details = [];

  const pushDetail = (label, fromVal, toVal) => {
    details.push({
      label,
      from: String(fromVal ?? "-"),
      to: String(toVal ?? "-"),
    });
  };

  for (const chunk of chunks) {
    if (!chunk || chunk === "LEAVE_UPDATION") continue;
    if (chunk.startsWith("status:")) {
      const [fromVal, toVal] = chunk.replace("status:", "").split("->");
      pushDetail("Status", fromVal, toVal);
    } else if (chunk.startsWith("paid:")) {
      const [fromVal, toVal] = chunk.replace("paid:", "").split("->");
      pushDetail("Paid Days", fromVal, toVal);
    } else if (chunk.startsWith("lwp:")) {
      const [fromVal, toVal] = chunk.replace("lwp:", "").split("->");
      pushDetail("LWP", fromVal, toVal);
    } else if (chunk.startsWith("dates:")) {
      const value = chunk.replace("dates:", "");
      const parts = value.split(",");
      if (parts[0]) {
        const [fromVal, toVal] = parts[0].split("->");
        pushDetail("Start Date", fromVal, toVal);
      }
      if (parts[1]) {
        const [fromVal, toVal] = parts[1].split("->");
        pushDetail("End Date", fromVal, toVal);
      }
    } else if (chunk.startsWith("reason:")) {
      details.push({
        label: "Reason",
        from: null,
        to: chunk.replace("reason:", "").trim() || "-",
      });
    }
  }
  return details;
};

export const LeaveApplicationUpdation = ({ onBack, empTypeOptions = [], circleOptions = [] }) => {
  const [filters, setFilters] = useState({
    request_type: "all",
    emp_type: "",
    circle: "",
  });
  const [statusFilter, setStatusFilter] = useState("All");
  const [allRows, setAllRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editRow, setEditRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [form, setForm] = useState({
    leave_type: "",
    start_date: "",
    end_date: "",
    status: "Pending",
    reason: "",
  });

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filters.request_type) params.set("request_type", filters.request_type);
      if (filters.emp_type) params.set("emp_type", filters.emp_type);
      if (filters.circle) params.set("circle", filters.circle);
      const res = await fetch(`${API_BASE}/leave-updation/requests?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to fetch requests");
      }
      setAllRows(data.requests || []);
    } catch (err) {
      setAllRows([]);
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [filters.request_type, filters.emp_type, filters.circle]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const openEditor = (row) => {
    setSuccessMessage("");
    setEditRow(row);
    setForm({
      leave_type: row.leave_type || "Privilege Leave",
      start_date: row.start_date || "",
      end_date: row.end_date || "",
      status: row.status || "Pending",
      reason: row.reason || "",
    });
    setAuditRows([]);
    setAuditLoading(true);
    const isWfh = String(row.request_type || "").toLowerCase() === "wfh";
    const auditUrl = isWfh
      ? `${API_BASE}/leave-updation/wfh-requests/${row.id}/audit`
      : `${API_BASE}/leave-updation/requests/${row.id}/audit`;
    fetch(auditUrl, {
      headers: getAuthHeaders(),
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success) setAuditRows(data.audit || []);
      })
      .finally(() => setAuditLoading(false));
  };

  const closeEditor = () => {
    setEditRow(null);
    setSaving(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editRow?.id) return;
    setSaving(true);
    setError("");
    setSuccessMessage("");
    try {
      const isWfh = String(editRow.request_type || "").toLowerCase() === "wfh";
      const editUrl = isWfh
        ? `${API_BASE}/leave-updation/wfh-requests/${editRow.id}`
        : `${API_BASE}/leave-updation/requests/${editRow.id}`;
      const payload = isWfh
        ? {
            start_date: form.start_date,
            end_date: form.end_date,
            status: form.status,
            reason: form.reason,
          }
        : form;
      const res = await fetch(editUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to update request");
      }
      setSuccessMessage(
        isWfh ? "WFH request updated successfully." : "Leave request updated successfully."
      );
      closeEditor();
      await fetchRows();
    } catch (err) {
      setError(err.message || "Network error");
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => {
    const total = allRows.length;
    const pending = allRows.filter((r) => matchesStatusFilter(r, "Pending")).length;
    const approved = allRows.filter((r) => matchesStatusFilter(r, "Approved")).length;
    const rejected = allRows.filter((r) => matchesStatusFilter(r, "Rejected")).length;
    return { total, pending, approved, rejected };
  }, [allRows]);

  const displayRows = useMemo(
    () => allRows.filter((r) => matchesStatusFilter(r, statusFilter)),
    [allRows, statusFilter],
  );

  return (
    <div className="leave-application-updation-page">
      <div className="leave-application-updation-shell">
        <button type="button" className="lau-back-btn" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>
        <div className="lau-header-card">
          <h2>Leave/WFH Application Updation</h2>
          <p>HR can update Leave/WFH dates, reason, and status (leave balances auto-adjust including reversals).</p>
        </div>

        <div className="lau-filters">
          <div>
            <label>Request Type</label>
            <select
              value={filters.request_type}
              onChange={(e) => setFilters((p) => ({ ...p, request_type: e.target.value }))}
            >
              {REQUEST_TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Employee Type</label>
            <select value={filters.emp_type} onChange={(e) => setFilters((p) => ({ ...p, emp_type: e.target.value }))}>
              <option value="">All</option>
              {empTypeOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Circle</label>
            <select value={filters.circle} onChange={(e) => setFilters((p) => ({ ...p, circle: e.target.value }))}>
              <option value="">All</option>
              {circleOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <button type="button" className="lau-search-btn" onClick={fetchRows} disabled={loading}>
            <Search size={16} /> {loading ? "Loading..." : "Search"}
          </button>
        </div>

        <div className="lau-stats">
          {STATUS_FILTERS.map((status) => {
            const count =
              status === "All"
                ? stats.total
                : status === "Pending"
                  ? stats.pending
                  : status === "Approved"
                    ? stats.approved
                    : stats.rejected;
            return (
              <button
                key={status}
                type="button"
                className={`lau-stat-pill ${statusFilter === status ? "active" : ""}`}
                onClick={() => setStatusFilter(status)}
              >
                {status === "All" ? `Total: ${count}` : `${status}: ${count}`}
              </button>
            );
          })}
        </div>

        {error && <div className="lau-error">{error}</div>}
        {successMessage && <div className="lau-success">{successMessage}</div>}

        <div className="lau-table-wrap">
          <table className="lau-table">
            <thead>
              <tr>
                <th>Emp</th>
                <th>Type</th>
                <th>Period</th>
                <th>Status</th>
                <th>Paid</th>
                <th>LWP</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={rowKey(row)}>
                  <td>
                    <div className="lau-emp-name">{row.employee_name || "-"}</div>
                    <small>{row.emp_id || "-"} • {row.circle || "-"}</small>
                  </td>
                  <td>{row.leave_type || (String(row.request_type).toLowerCase() === "wfh" ? "Work From Home" : "-")}</td>
                  <td>{row.start_date} to {row.end_date}</td>
                  <td>
                    <span className={`lau-status ${normalizeRequestStatus(row.status)}`}>
                      {row.status || "-"}
                    </span>
                  </td>
                  <td>{row.deducted_days == null ? "-" : row.deducted_days}</td>
                  <td>{row.extra_days == null ? "-" : row.extra_days}</td>
                  <td>
                    <button type="button" className="lau-edit-btn" onClick={() => openEditor(row)}>
                      <Edit3 size={14} /> Update
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && displayRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="lau-empty">No requests found for selected filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editRow && (
        <div className="lau-modal-backdrop" onClick={closeEditor}>
          <div className="lau-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{String(editRow.request_type || "").toLowerCase() === "wfh" ? `Update WFH #${editRow.id}` : `Update Leave #${editRow.id}`}</h3>
            <form onSubmit={handleSave}>
              <div className="lau-grid">
                {String(editRow.request_type || "").toLowerCase() !== "wfh" && (
                  <div>
                    <label>Leave Type</label>
                    <select value={form.leave_type} onChange={(e) => setForm((p) => ({ ...p, leave_type: e.target.value }))}>
                      {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label>Status</label>
                  <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                    <option value="Pending">Pending</option>
                    <option value="Approved">Approved</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
                <div>
                  <label>Start Date</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} required />
                </div>
                <div>
                  <label>End Date</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))} required />
                </div>
              </div>
              <div>
                <label>Reason</label>
                <textarea
                  rows={3}
                  value={form.reason}
                  onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                  placeholder="Update reason (optional)"
                />
              </div>
              <div className="lau-modal-actions">
                <button type="button" className="lau-cancel" onClick={closeEditor}>Cancel</button>
                <button type="submit" className="lau-save" disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
            <div className="lau-audit-section">
              <h4>Audit Trail</h4>
              {auditLoading ? (
                <p>Loading audit history...</p>
              ) : auditRows.length === 0 ? (
                <p>No updates recorded yet.</p>
              ) : (
                <div className="lau-audit-table-wrap">
                  <table className="lau-audit-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Updated By</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditRows.map((a) => (
                        <tr key={a.id}>
                          <td>{a.created_at ? new Date(a.created_at).toLocaleString() : "-"}</td>
                          <td>{a.performed_by || "-"}</td>
                          <td className="lau-audit-action">
                            <div className="lau-audit-chips">
                              {parseAuditAction(a.action).map((d, idx) => (
                                <div key={`${a.id}-${idx}`} className="lau-audit-chip">
                                  <span className="lau-chip-label">{d.label}</span>
                                  {d.from == null ? (
                                    <span className="lau-chip-value">{d.to}</span>
                                  ) : (
                                    <>
                                      <span className="lau-chip-from">{d.from}</span>
                                      <span className="lau-chip-arrow">{"->"}</span>
                                      <span className="lau-chip-to">{d.to}</span>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
