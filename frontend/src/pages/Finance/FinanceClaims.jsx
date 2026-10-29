import { useCallback, useState } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  FileSpreadsheet,
  Inbox,
  IndianRupee,
  MapPin,
  Paperclip,
  Receipt,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { formatDate } from "../../utils/dateFormat";

const API = "/api/accounts";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value === "approved") return "is-approved";
  if (value === "rejected") return "is-rejected";
  if (value.includes("partial")) return "is-partial";
  return "is-pending";
}

function inr(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function linesFullyApproved(claim) {
  const lines = claim.line_items || [];
  return lines.length > 0 && lines.every((item) => String(item.status || "").toLowerCase() === "approved");
}

function payoutLabel(status) {
  const value = String(status || "to_pay").toLowerCase();
  if (value === "paid") return "Paid";
  if (value === "hold") return "On hold";
  return "To pay";
}

function initials(name) {
  const parts = String(name || "").replace(/[^a-zA-Z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "E";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

export function FinanceClaims() {
  const [filters, setFilters] = useState({ circle: "All", emp_type: "All", month_year: "", q: "" });
  const [options, setOptions] = useState({ circles: [], emp_types: [] });
  const [claims, setClaims] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [excelId, setExcelId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.circle && filters.circle !== "All") params.set("circle", filters.circle);
      if (filters.emp_type && filters.emp_type !== "All") params.set("emp_type", filters.emp_type);
      if (filters.month_year) params.set("month_year", filters.month_year);
      if (filters.q.trim()) params.set("q", filters.q.trim());
      const response = await fetch(`${API}/expense-claims?${params}`, { headers: authHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Could not load claims");
      }
      setClaims(data.claims || []);
      setOptions(data.filter_options || { circles: [], emp_types: [] });
      setError("");
    } catch (err) {
      setError(err.message || "Could not load claims");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useRefreshOnNavigate(load, [filters.circle, filters.emp_type, filters.month_year, filters.q]);

  const decide = async (claimId, lineId, action, rejectionReason = "") => {
    try {
      setBusyId(lineId);
      const response = await fetch(`${API}/expense-claims/line-items/${lineId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ action, rejection_reason: rejectionReason || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || "Could not update this item");
      setClaims((prev) => prev.map((claim) => {
        if (claim.id !== claimId) return claim;
        return {
          ...claim,
          status: data.claim_status || claim.status,
          line_items: (claim.line_items || []).map((item) => (
            item.id === lineId
              ? { ...item, status: data.line_item?.status, rejection_reason: data.line_item?.rejection_reason || null }
              : item
          )),
        };
      }));
      setRejecting(null);
      setReason("");
      setError("");
    } catch (err) {
      setError(err.message || "Could not update this item");
    } finally {
      setBusyId(null);
    }
  };

  const payout = async (claimId, action) => {
    try {
      setBusyId(`payout-${claimId}`);
      const response = await fetch(`/api/finance/expense-claims/${claimId}/payout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.message || "Could not update payout");
      }
      setClaims((prev) => prev.map((claim) => (
        claim.id === claimId ? { ...claim, payout_status: action } : claim
      )));
      setError("");
    } catch (err) {
      setError(err.message || "Could not update payout");
    } finally {
      setBusyId(null);
    }
  };

  const downloadExcel = async (claim) => {
    try {
      setExcelId(claim.id);
      const response = await fetch(`${API}/expense-claims/${claim.id}/excel`, { headers: authHeaders() });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || contentType.includes("application/json")) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Could not download this claim");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Expense_Claim_${claim.emp_id || claim.id}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Could not download this claim");
    } finally {
      setExcelId(null);
    }
  };

  const downloadFile = async (filePath) => {
    try {
      const normalized = String(filePath || "").replace(/^\/+/, "");
      const response = await fetch(`${API}/file/${normalized}`, { headers: authHeaders() });
      if (!response.ok) throw new Error("Could not download the attachment");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = normalized.split("/").pop() || "attachment";
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Could not download the attachment");
    }
  };

  const pendingCount = claims.filter((claim) => statusClass(claim.status) !== "is-approved" && statusClass(claim.status) !== "is-rejected").length;
  const totalAmount = claims.reduce((sum, claim) => sum + Number(claim.total_amount || 0), 0);
  const hasFilters = filters.circle !== "All" || filters.emp_type !== "All" || filters.month_year || filters.q.trim();

  return (
    <div className="fc">
      <header className="fc-head">
        <div>
          <h2>Claims</h2>
          <p>Review each line, then pay or hold the claim after every line is approved.</p>
        </div>
        <div className="fc-stats">
          <div className="fc-stat">
            <span><Receipt size={15} /> Claims</span>
            <strong>{claims.length}</strong>
          </div>
          <div className="fc-stat is-warn">
            <span><Clock3 size={15} /> Waiting</span>
            <strong>{pendingCount}</strong>
          </div>
          <div className="fc-stat is-brand">
            <span><IndianRupee size={15} /> Total</span>
            <strong>{inr(totalAmount)}</strong>
          </div>
        </div>
      </header>

      <div className="fc-filters">
        <label className="fc-field">
          <span>Circle</span>
          <select value={filters.circle} onChange={(e) => setFilters((prev) => ({ ...prev, circle: e.target.value }))}>
            <option value="All">All circles</option>
            {(options.circles || []).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="fc-field">
          <span>Department</span>
          <select value={filters.emp_type} onChange={(e) => setFilters((prev) => ({ ...prev, emp_type: e.target.value }))}>
            <option value="All">All departments</option>
            {(options.emp_types || []).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="fc-field">
          <span>Month</span>
          <input type="month" value={filters.month_year} onChange={(e) => setFilters((prev) => ({ ...prev, month_year: e.target.value }))} />
        </label>
        <label className="fc-field fc-search">
          <span>Search</span>
          <div className="fc-search-box">
            <Search size={16} />
            <input value={filters.q} placeholder="Name, ID or project" onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))} />
          </div>
        </label>
        <button
          type="button"
          className="fc-clear"
          disabled={!hasFilters}
          onClick={() => setFilters({ circle: "All", emp_type: "All", month_year: "", q: "" })}
        >
          <RotateCcw size={15} /> Clear
        </button>
      </div>

      {error ? <p className="fc-error">{error}</p> : null}

      {loading ? (
        <div className="fc-list">
          {[0, 1, 2].map((key) => <div key={key} className="fc-skeleton" />)}
        </div>
      ) : null}

      {!loading && claims.length === 0 ? (
        <div className="fc-empty">
          <Inbox size={34} />
          <strong>No expense claims found</strong>
          <span>{hasFilters ? "Try clearing the filters." : "New claims will appear here."}</span>
        </div>
      ) : null}

      {!loading && claims.length > 0 ? (
        <ul className="fc-list">
          {claims.map((claim) => {
            const open = openId === claim.id;
            const lines = claim.line_items || [];
            const canPay = linesFullyApproved(claim);
            const payoutStatus = String(claim.payout_status || "to_pay").toLowerCase();
            return (
              <li key={claim.id} className={`fc-card${open ? " is-open" : ""}`}>
                <div className="fc-row">
                  <button
                    type="button"
                    className="fc-main"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : claim.id)}
                  >
                    <span className="fc-avatar">{initials(claim.employee_name)}</span>
                    <span className="fc-info">
                      <span className="fc-name">
                        {claim.employee_name || "Employee"}
                        <em>{claim.emp_id}</em>
                      </span>
                      <span className="fc-meta">
                        <span><MapPin size={13} /> {claim.circle || "—"}</span>
                        <span><Building2 size={13} /> {claim.emp_type || "—"}</span>
                        <span><CalendarDays size={13} /> {formatDate(claim.travel_from_date)} – {formatDate(claim.travel_to_date)}</span>
                      </span>
                      {claim.project_name ? <span className="fc-project">{claim.project_name}</span> : null}
                    </span>
                  </button>
                  <div className="fc-side">
                    <div className="fc-amount">
                      <strong>{inr(claim.total_amount)}</strong>
                      <span className={`fc-badge ${statusClass(claim.status)}`}>{claim.status}</span>
                      {canPay ? (
                        <span className={`fc-badge ${payoutStatus === "paid" ? "is-approved" : payoutStatus === "hold" ? "is-partial" : "is-pending"}`}>
                          {payoutLabel(payoutStatus)}
                        </span>
                      ) : null}
                    </div>
                    {canPay && payoutStatus !== "paid" ? (
                      <div className="fc-decide">
                        <button
                          type="button"
                          className="fc-approve"
                          disabled={busyId === `payout-${claim.id}`}
                          onClick={() => payout(claim.id, "paid")}
                        >
                          Mark paid
                        </button>
                        {payoutStatus !== "hold" ? (
                          <button
                            type="button"
                            className="fc-btn is-ghost"
                            disabled={busyId === `payout-${claim.id}`}
                            onClick={() => payout(claim.id, "hold")}
                          >
                            Hold
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    <button type="button" className="fc-btn" disabled={excelId === claim.id} onClick={() => downloadExcel(claim)}>
                      <FileSpreadsheet size={15} />
                      {excelId === claim.id ? "Downloading…" : "Excel"}
                    </button>
                    <button
                      type="button"
                      className="fc-chevron"
                      aria-label={open ? "Hide items" : "Show items"}
                      onClick={() => setOpenId(open ? null : claim.id)}
                    >
                      <ChevronDown size={18} />
                    </button>
                  </div>
                </div>

                {open ? (
                  <div className="fc-items">
                    {lines.length === 0 ? <p className="fc-items-empty">No line items on this claim.</p> : (
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Purpose</th>
                            <th className="is-num">Amount</th>
                            <th>Status</th>
                            <th>Bill</th>
                            <th className="is-end">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((item) => (
                            <tr key={item.id}>
                              <td className="is-date">{formatDate(item.date)}</td>
                              <td>
                                {item.purpose || "—"}
                                {item.status === "Rejected" && item.rejection_reason ? <div className="fc-reason">Reason: {item.rejection_reason}</div> : null}
                              </td>
                              <td className="is-num">{item.currency && item.currency !== "INR" ? `${item.currency} ${Number(item.amount || 0).toLocaleString("en-IN")}` : inr(item.amount)}</td>
                              <td><span className={`fc-badge ${statusClass(item.status)}`}>{item.status || "Pending"}</span></td>
                              <td>
                                {item.file_path ? (
                                  <button type="button" className="fc-link" onClick={() => downloadFile(item.file_path)}>
                                    <Paperclip size={14} /> View
                                  </button>
                                ) : <span className="fc-dash">—</span>}
                              </td>
                              <td className="is-end">
                                {(item.status || "Pending") === "Pending" ? (
                                  <div className="fc-decide">
                                    <button type="button" className="fc-approve" disabled={busyId === item.id} onClick={() => decide(claim.id, item.id, "approve")}>
                                      <Check size={14} /> Approve
                                    </button>
                                    <button type="button" className="fc-reject" disabled={busyId === item.id} onClick={() => { setRejecting(item); setReason(""); }}>
                                      <X size={14} /> Reject
                                    </button>
                                  </div>
                                ) : <span className="fc-dash">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {rejecting ? (
        <div className="fc-modal" role="presentation" onClick={() => setRejecting(null)}>
          <div className="fc-modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h3>Reject this item</h3>
            <p>The employee and their manager receive this reason.</p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="Reason for rejection" autoFocus />
            <div className="fc-modal-actions">
              <button type="button" className="fc-btn is-ghost" onClick={() => setRejecting(null)}>Cancel</button>
              <button
                type="button"
                className="fc-btn is-danger"
                disabled={!reason.trim() || busyId === rejecting.id}
                onClick={() => {
                  const claim = claims.find((row) => (row.line_items || []).some((item) => item.id === rejecting.id));
                  if (claim) decide(claim.id, rejecting.id, "reject", reason.trim());
                }}
              >
                Reject item
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
