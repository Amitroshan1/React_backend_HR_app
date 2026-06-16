import { useCallback, useState } from "react";
import { fetchManagerProbationReviews, submitProbationReview } from "./api";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import "./ManagerProbationReviews.css";
import { formatDate, formatDateTimeDDMMYYYY } from "../../utils/dateFormat";

const RATING_OPTIONS = ["Excellent", "Good", "Average", "Needs Improvement"];
const RECOMMENDATION_OPTIONS = [
  { value: "confirm", label: "Recommend confirmation" },
  { value: "extend", label: "Recommend extension" },
  { value: "not_recommend", label: "Do not recommend" },
];

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "submitted", label: "Submitted" },
];

const RECOMMENDATION_LABELS = {
  confirm: "Recommend confirmation",
  extend: "Recommend extension",
  not_recommend: "Do not recommend",
};

const HR_DECISION_LABELS = {
  confirmed: "Confirmed",
  extended: "Extended",
  failed: "Not cleared",
};

function formatDateTime(value) {
  return formatDateTimeDDMMYYYY(value, "-");
}

function isPendingReview(review) {
  return !review?.reviewed_at;
}

export const ManagerProbationReviews = () => {
  const [reviews, setReviews] = useState([]);
  const [summary, setSummary] = useState({});
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [rating, setRating] = useState("Good");
  const [managerRecommendation, setManagerRecommendation] = useState("confirm");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (filter = statusFilter) => {
    setLoading(true);
    setError("");
    try {
      const { reviews: list, summary: stats } = await fetchManagerProbationReviews({ status: filter });
      setReviews(list);
      setSummary(stats);
    } catch (err) {
      setError(err.message || "Failed to load probation reviews");
      setReviews([]);
      setSummary({});
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useRefreshOnNavigate(() => {
    load("all");
    setStatusFilter("all");
  });

  const handleFilterChange = async (nextFilter) => {
    setStatusFilter(nextFilter);
    setActiveId(null);
    setSuccess("");
    await load(nextFilter);
  };

  const openForm = (r) => {
    setActiveId(r.id);
    setRating("Good");
    setManagerRecommendation("confirm");
    setFeedback("");
    setSuccess("");
    setError("");
  };

  const closeForm = () => {
    setActiveId(null);
    setRating("Good");
    setManagerRecommendation("confirm");
    setFeedback("");
  };

  const handleSubmit = async () => {
    if (!activeId) return;
    if (!rating) {
      setError("Rating is required.");
      return;
    }
    if (!managerRecommendation) {
      setError("Recommendation is required.");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await submitProbationReview(activeId, {
        rating,
        manager_recommendation: managerRecommendation,
        feedback,
      });
      setSuccess("Review submitted. HR has been notified.");
      closeForm();
      await load(statusFilter);
    } catch (err) {
      setError(err.message || "Failed to submit review");
    } finally {
      setSubmitting(false);
    }
  };

  const emptyMessage =
    statusFilter === "pending"
      ? "No probation reviews pending your action."
      : statusFilter === "submitted"
        ? "No submitted probation reviews."
        : "No probation reviews found.";

  return (
    <div className="manager-probation-reviews">
      <div className="manager-probation-header">
        <div>
          <h3 className="manager-probation-title">Probation Reviews</h3>
          <p className="manager-probation-desc">
            Submit probation feedback for your team and track submissions awaiting HR.
          </p>
        </div>
        <div className="manager-probation-meta-counts">
          <span>Pending: {summary.pending ?? 0}</span>
          <span>Submitted: {summary.submitted ?? 0}</span>
        </div>
      </div>

      <div className="manager-probation-filters">
        {STATUS_FILTERS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={statusFilter === opt.value ? "active" : ""}
            onClick={() => handleFilterChange(opt.value)}
            disabled={loading}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error && <p className="manager-probation-error">{error}</p>}
      {success && <p className="manager-probation-success">{success}</p>}

      {loading ? (
        <p className="manager-probation-loading">Loading probation reviews…</p>
      ) : reviews.length === 0 ? (
        <p className="manager-probation-empty">{emptyMessage}</p>
      ) : (
        <div className="manager-probation-list">
          {reviews.map((r) => {
            const pending = isPendingReview(r);
            return (
              <div
                key={r.id}
                className={`manager-probation-card ${pending ? "" : "manager-probation-card--submitted"}`}
              >
                <div className="manager-probation-card-head">
                  <span className="manager-probation-name">{r.employee_name}</span>
                  <span className="manager-probation-email">{r.employee_email}</span>
                  <span
                    className={`manager-probation-status-badge ${
                      pending
                        ? "pending"
                        : r.awaiting_hr_decision
                          ? "awaiting"
                          : r.hr_decision === "failed"
                            ? "failed"
                            : "closed"
                    }`}
                  >
                    {r.status_label || (pending ? "Pending manager review" : "Submitted")}
                  </span>
                </div>
                <div className="manager-probation-meta">
                  DOJ: {formatDate(r.doj)} · Probation end: {formatDate(r.probation_end_date)}
                  {r.overdue && pending ? " · Overdue" : ""}
                </div>

                {!pending && (
                  <div className="manager-probation-submitted-details">
                    <p>
                      <strong>Rating:</strong> {r.rating || "—"}
                    </p>
                    <p>
                      <strong>Recommendation:</strong>{" "}
                      {RECOMMENDATION_LABELS[r.manager_recommendation] || r.manager_recommendation || "—"}
                    </p>
                    {r.feedback ? (
                      <p>
                        <strong>Feedback:</strong> {r.feedback}
                      </p>
                    ) : null}
                    <p>
                      <strong>Submitted:</strong> {formatDateTime(r.reviewed_at)}
                    </p>
                    {r.hr_decision ? (
                      <p>
                        <strong>HR decision:</strong> {HR_DECISION_LABELS[r.hr_decision] || r.hr_decision}
                        {r.hr_decided_at ? ` (${formatDateTime(r.hr_decided_at)})` : ""}
                      </p>
                    ) : r.awaiting_hr_decision ? (
                      <p className="manager-probation-awaiting-hr">Awaiting HR decision</p>
                    ) : null}
                    {r.extended_until ? (
                      <p>
                        <strong>Extended until:</strong> {formatDate(r.extended_until)}
                      </p>
                    ) : null}
                  </div>
                )}

                {pending && activeId === r.id ? (
                  <div className="manager-probation-form">
                    <label>
                      Rating *
                      <select value={rating} onChange={(e) => setRating(e.target.value)} required>
                        {RATING_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Recommendation *
                      <select
                        value={managerRecommendation}
                        onChange={(e) => setManagerRecommendation(e.target.value)}
                        required
                      >
                        {RECOMMENDATION_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Feedback
                      <textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        rows={4}
                        placeholder="Optional feedback for HR"
                      />
                    </label>
                    <div className="manager-probation-actions">
                      <button type="button" onClick={closeForm} disabled={submitting}>
                        Cancel
                      </button>
                      <button type="button" onClick={handleSubmit} disabled={submitting}>
                        {submitting ? "Submitting…" : "Submit review"}
                      </button>
                    </div>
                  </div>
                ) : pending ? (
                  <button
                    type="button"
                    className="manager-probation-submit-btn"
                    onClick={() => openForm(r)}
                  >
                    Submit review
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
