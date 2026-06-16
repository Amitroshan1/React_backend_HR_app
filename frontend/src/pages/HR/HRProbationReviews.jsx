import { useCallback, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { formatDate } from "../../utils/dateFormat";
import "./HRProbationReviews.css";

const API_BASE = "/api/probation";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "awaiting_hr", label: "Awaiting HR decision" },
  { value: "pending_manager", label: "Pending manager" },
  { value: "overdue", label: "Overdue" },
  { value: "closed", label: "Closed" },
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

export const HRProbationReviews = ({ onBack }) => {
  const [reviews, setReviews] = useState([]);
  const [summary, setSummary] = useState({});
  const [statusFilter, setStatusFilter] = useState("awaiting_hr");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [decision, setDecision] = useState("confirmed");
  const [extensionMonths, setExtensionMonths] = useState("3");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (filter = statusFilter) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      const res = await fetch(`${API_BASE}/hr/reviews?${params.toString()}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
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
    setDecision("confirmed");
    setExtensionMonths("3");
    setNotes("");
    setSuccess("");
    setError("");
  };

  const closeDecision = () => {
    setActiveId(null);
    setNotes("");
  };

  const handleSubmitDecision = async () => {
    if (!activeId) return;
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
        payload.extension_months = Number(extensionMonths);
      }
      const res = await fetch(`${API_BASE}/hr/decision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to record decision");
      }
      setSuccess(data.message || "Decision recorded.");
      closeDecision();
      await load(statusFilter);
    } catch (err) {
      setError(err.message || "Failed to record decision");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="hr-probation-wrapper">
      <button type="button" className="hr-probation-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Updates
      </button>

      <div className="hr-probation-card">
        <div className="hr-probation-header">
          <div>
            <h3>Probation Reviews</h3>
            <p>Review manager feedback and record confirmation, extension, or failure.</p>
          </div>
          <button type="button" className="hr-probation-refresh" onClick={() => load(statusFilter)} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <div className="hr-probation-summary">
          <span>Awaiting HR: {summary.awaiting_hr ?? 0}</span>
          <span>Pending manager: {summary.pending_manager ?? 0}</span>
          <span>Overdue: {summary.overdue ?? 0}</span>
        </div>

        <div className="hr-probation-filters">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={statusFilter === f.value ? "active" : ""}
              onClick={() => handleFilterChange(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && <p className="hr-probation-error">{error}</p>}
        {success && <p className="hr-probation-success">{success}</p>}

        {loading ? (
          <p className="hr-probation-loading">Loading…</p>
        ) : reviews.length === 0 ? (
          <p className="hr-probation-empty">No probation reviews found for this filter.</p>
        ) : (
          <div className="hr-probation-list">
            {reviews.map((r) => (
              <div key={r.id} className={`hr-probation-item ${r.overdue ? "overdue" : ""}`}>
                <div className="hr-probation-item-head">
                  <strong>{r.employee_name}</strong>
                  <span>{r.employee_email}</span>
                </div>
                <div className="hr-probation-meta">
                  DOJ: {formatDate(r.doj)} · Probation end: {formatDate(r.probation_end_date)}
                  {r.emp_id ? ` · ID: ${r.emp_id}` : ""}
                </div>
                <div className="hr-probation-meta">
                  Status: {r.status || "—"}
                  {r.overdue ? " · Overdue" : ""}
                </div>
                {r.rating && (
                  <div className="hr-probation-meta">
                    Manager rating: {r.rating}
                    {r.manager_recommendation
                      ? ` · ${RECOMMENDATION_LABELS[r.manager_recommendation] || r.manager_recommendation}`
                      : ""}
                  </div>
                )}
                {r.feedback && <p className="hr-probation-feedback">{r.feedback}</p>}
                {r.hr_decision && (
                  <div className="hr-probation-meta">
                    HR decision: {r.hr_decision}
                    {r.extended_until ? ` · Extended until ${formatDate(r.extended_until)}` : ""}
                  </div>
                )}

                {r.awaiting_hr_decision && activeId === r.id ? (
                  <div className="hr-probation-decision-form">
                    <label>
                      Decision
                      <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                        <option value="confirmed">Confirm employee</option>
                        <option value="extended">Extend probation</option>
                        <option value="failed">Mark as failed</option>
                      </select>
                    </label>
                    {decision === "extended" && (
                      <label>
                        Extension (months)
                        <select value={extensionMonths} onChange={(e) => setExtensionMonths(e.target.value)}>
                          <option value="1">1 month</option>
                          <option value="2">2 months</option>
                          <option value="3">3 months</option>
                          <option value="6">6 months</option>
                        </select>
                      </label>
                    )}
                    <label>
                      Notes
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        placeholder="Optional HR notes"
                      />
                    </label>
                    <div className="hr-probation-actions">
                      <button type="button" onClick={closeDecision} disabled={submitting}>Cancel</button>
                      <button type="button" onClick={handleSubmitDecision} disabled={submitting}>
                        {submitting ? "Saving…" : "Record decision"}
                      </button>
                    </div>
                  </div>
                ) : r.awaiting_hr_decision ? (
                  <button type="button" className="hr-probation-decide-btn" onClick={() => openDecision(r)}>
                    Record HR decision
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
