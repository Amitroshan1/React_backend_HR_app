import { useCallback, useState } from "react";
import { ArrowLeft, RefreshCw, Download } from "lucide-react";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { formatDate } from "../../utils/dateFormat";
import "./HRProbationReviews.css";
import "./HrUpdatesShared.css";

const API_BASE = "/api/HumanResource";

const STATUS_FILTERS = [
  { value: "all", label: "All", countKey: null },
  { value: "awaiting_hr", label: "Awaiting HR decision", countKey: "awaiting_hr", hot: true },
  { value: "pending_admin", label: "Pending Admin", countKey: "pending_admin" },
  { value: "pending_manager", label: "Pending manager", countKey: "pending_manager" },
  { value: "overdue", label: "Overdue", countKey: "overdue", hot: true },
  { value: "closed", label: "Closed", countKey: null },
];

const RECOMMENDATION_LABELS = {
  confirm: "Recommend confirmation",
  extend: "Recommend extension",
  not_recommend: "Do not recommend",
};

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseApiJson(response) {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  if (trimmed.startsWith("<")) {
    const hint =
      response.status === 404
        ? "API not found (404). Restart the backend so probation routes are loaded."
        : `Server returned a web page instead of JSON (${response.status}). Check login and backend logs.`;
    throw new Error(hint);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`Invalid response from server (${response.status}). Expected JSON.`);
  }
}

function defaultExtendDate(probationEndDate) {
  if (!probationEndDate) return "";
  try {
    const d = new Date(`${probationEndDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function dayAfter(isoDate) {
  if (!isoDate) return undefined;
  try {
    const d = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return undefined;
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}

export const HRProbationReviews = ({ onBack }) => {
  const [reviews, setReviews] = useState([]);
  const [summary, setSummary] = useState({});
  const [statusFilter, setStatusFilter] = useState("awaiting_hr");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [decision, setDecision] = useState("confirmed");
  const [extendedUntil, setExtendedUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (filter = statusFilter) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      const res = await fetch(`${API_BASE}/probation-reviews?${params.toString()}`, {
        headers: authHeaders(),
      });
      const data = await parseApiJson(res);
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to load probation reviews");
      }
      setReviews(data.reviews || []);
      setSummary(data.summary || {});
    } catch (err) {
      setError(err.message || "Failed to load probation reviews");
      setReviews([]);
      setSummary({});
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useRefreshOnNavigate(() => {
    load(statusFilter);
  });

  const handleFilterChange = async (value) => {
    setStatusFilter(value);
    await load(value);
  };

  const openDecision = (review) => {
    setActiveId(review.id);
    const rec = review.manager_recommendation;
    if (rec === "extend") setDecision("extended");
    else if (rec === "not_recommend") setDecision("failed");
    else setDecision("confirmed");
    setExtendedUntil(defaultExtendDate(review.probation_end_date));
    setNotes("");
    setSuccess("");
    setError("");
  };

  const closeDecision = () => {
    setActiveId(null);
    setNotes("");
    setExtendedUntil("");
  };

  const handleSubmitDecision = async () => {
    if (!activeId) return;
    if (decision === "extended" && !extendedUntil) {
      setError("Select an extension end date.");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        probation_review_id: activeId,
        decision,
        notes,
      };
      if (decision === "extended") {
        payload.extended_until = extendedUntil;
      }
      const res = await fetch(`${API_BASE}/probation-decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(payload),
      });
      const data = await parseApiJson(res);
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to submit for Admin approval");
      }
      setSuccess(
        data.message ||
          (data.pending_approval
            ? "Sent to Admin for approval."
            : "Decision applied.")
      );
      closeDecision();
      await load(statusFilter);
    } catch (err) {
      setError(err.message || "Failed to submit decision");
    } finally {
      setSubmitting(false);
    }
  };

  const downloadConfirmationLetter = async (adminId) => {
    try {
      const res = await fetch(`${API_BASE}/employees/${adminId}/confirmation-letter/pdf`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const data = await parseApiJson(res);
        throw new Error(data.message || "Download failed");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `confirmation-letter-${adminId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Failed to download confirmation letter");
    }
  };

  const awaitingHr = Number(summary.awaiting_hr || 0);
  const pendingAdmin = Number(summary.pending_admin || 0);
  const pendingManager = Number(summary.pending_manager || 0);
  const overdue = Number(summary.overdue || 0);

  return (
    <div className="hr-probation-wrapper">
      <button type="button" className="btn-back-updates" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Updates
      </button>

      <div className="hr-probation-card">
        <div className="hr-probation-header">
          <div>
            <h3>Probation Reviews</h3>
            <p>
              Review manager feedback, then choose On role, Extend, or Reject.
              Each choice is sent to Admin for approval. The employee is emailed
              only after Admin approves On role or Extend.
            </p>
          </div>
          <button type="button" className="hr-probation-refresh" onClick={() => load(statusFilter)} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        {awaitingHr > 0 && (
          <div className="hr-probation-alert" role="status">
            <span className="hr-probation-alert__icon">{awaitingHr}</span>
            <div>
              <strong>
                {awaitingHr === 1
                  ? "1 manager review needs your decision"
                  : `${awaitingHr} manager reviews need your decision`}
              </strong>
              <span>
                Open Awaiting HR decision, choose On role / Extend / Reject, then send to Admin for approval.
              </span>
            </div>
          </div>
        )}

        <div className="hr-probation-summary">
          <div className={`hr-probation-summary__chip${awaitingHr > 0 ? " is-hot" : ""}`}>
            <span className="hr-probation-summary__label">Awaiting HR</span>
            <span className="hr-probation-summary__value">{awaitingHr}</span>
          </div>
          <div className={`hr-probation-summary__chip${pendingAdmin > 0 ? " is-warn" : ""}`}>
            <span className="hr-probation-summary__label">Pending Admin</span>
            <span className="hr-probation-summary__value">{pendingAdmin}</span>
          </div>
          <div className="hr-probation-summary__chip">
            <span className="hr-probation-summary__label">Pending manager</span>
            <span className="hr-probation-summary__value">{pendingManager}</span>
          </div>
          <div className={`hr-probation-summary__chip${overdue > 0 ? " is-danger" : ""}`}>
            <span className="hr-probation-summary__label">Overdue</span>
            <span className="hr-probation-summary__value">{overdue}</span>
          </div>
        </div>

        <div className="hr-probation-filters">
          {STATUS_FILTERS.map((f) => {
            const count = f.countKey != null ? Number(summary[f.countKey] || 0) : null;
            return (
              <button
                key={f.value}
                type="button"
                className={statusFilter === f.value ? "active" : ""}
                onClick={() => handleFilterChange(f.value)}
              >
                {f.label}
                {count != null && count > 0 ? (
                  <span className={`hr-probation-filter-count${f.hot ? " is-hot" : ""}`}>
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {error && <p className="hr-probation-error">{error}</p>}
        {success && <p className="hr-probation-success">{success}</p>}

        {loading ? (
          <p className="hr-probation-loading">Loading…</p>
        ) : reviews.length === 0 ? (
          <p className="hr-probation-empty">No probation reviews found for this filter.</p>
        ) : (
          <div className="hr-probation-list">
            {reviews.map((r) => {
              const itemClass = [
                "hr-probation-item",
                r.awaiting_hr_decision ? "awaiting-hr" : "",
                r.overdue ? "overdue" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div key={r.id} className={itemClass}>
                  <div className="hr-probation-item-head">
                    <strong>{r.employee_name}</strong>
                    <span>{r.employee_email}</span>
                    <div className="hr-probation-item-badges">
                      {r.awaiting_hr_decision ? (
                        <span className="hr-probation-pill hr-probation-pill--new">
                          Manager feedback
                        </span>
                      ) : null}
                      {r.pending_admin_approval ? (
                        <span className="hr-probation-pill hr-probation-pill--admin">
                          Pending Admin
                        </span>
                      ) : null}
                      {r.overdue ? (
                        <span className="hr-probation-pill hr-probation-pill--overdue">
                          Overdue
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="hr-probation-meta">
                    DOJ: {formatDate(r.doj)} · Probation end: {formatDate(r.probation_end_date)}
                    {r.emp_id ? ` · ID: ${r.emp_id}` : ""}
                  </div>
                  <div className="hr-probation-meta">
                    Status: {r.status || "—"}
                  </div>
                  {r.rating && (
                    <div className="hr-probation-meta">
                      Manager rating: {r.rating}
                      {r.manager_recommendation
                        ? ` · ${RECOMMENDATION_LABELS[r.manager_recommendation] || r.manager_recommendation}`
                        : ""}
                    </div>
                  )}
                  {r.feedback && (
                    <p className="hr-probation-feedback">
                      <span className="hr-probation-feedback__label">Manager feedback</span>
                      {r.feedback}
                    </p>
                  )}
                  {r.hr_decision && (
                    <div className="hr-probation-meta">
                      Final decision: {r.hr_decision}
                      {r.extended_until ? ` · Extended until ${formatDate(r.extended_until)}` : ""}
                    </div>
                  )}
                  {r.hr_decision === "confirmed" && (
                    <button
                      type="button"
                      className="hr-probation-letter-btn"
                      onClick={() => downloadConfirmationLetter(r.admin_id)}
                    >
                      <Download size={14} /> Confirmation letter
                    </button>
                  )}

                  {r.pending_admin_approval ? (
                    <p className="hr-probation-pending-admin">
                      Sent to Admin for approval. If rejected, check Request history and submit again.
                    </p>
                  ) : null}

                  {r.awaiting_hr_decision && activeId === r.id ? (
                    <div className="hr-probation-decision-form">
                      <label>
                        Decision
                        <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                          <option value="confirmed">On role</option>
                          <option value="extended">Extend</option>
                          <option value="failed">Reject</option>
                        </select>
                      </label>
                      {decision === "extended" && (
                        <label>
                          Extend until
                          <input
                            type="date"
                            value={extendedUntil}
                            min={dayAfter(r.probation_end_date)}
                            onChange={(e) => setExtendedUntil(e.target.value)}
                            required
                          />
                        </label>
                      )}
                      <label>
                        Notes
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={3}
                          placeholder={
                            decision === "failed"
                              ? "Reason for reject (shared with Admin / exit record)"
                              : "Optional HR notes for Admin and employee mail"
                          }
                        />
                      </label>
                      <div className="hr-probation-actions">
                        <button type="button" onClick={closeDecision} disabled={submitting}>Cancel</button>
                        <button type="button" onClick={handleSubmitDecision} disabled={submitting}>
                          {submitting ? "Submitting…" : "Send to Admin for approval"}
                        </button>
                      </div>
                    </div>
                  ) : r.awaiting_hr_decision ? (
                    <button type="button" className="hr-probation-decide-btn" onClick={() => openDecision(r)}>
                      Record decision
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
