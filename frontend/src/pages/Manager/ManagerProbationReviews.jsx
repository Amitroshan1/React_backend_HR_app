import { useEffect, useState } from "react";
import { fetchProbationReviewsDue, submitProbationReview } from "./api";
import "./ManagerProbationReviews.css";

const RATING_OPTIONS = ["Excellent", "Good", "Average", "Needs Improvement"];

export const ManagerProbationReviews = () => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [rating, setRating] = useState("Good");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const list = await fetchProbationReviewsDue();
      setReviews(list);
    } catch (err) {
      setError(err.message || "Failed to load probation reviews");
      setReviews([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openForm = (r) => {
    setActiveId(r.id);
    setRating("Good");
    setFeedback("");
    setSuccess("");
    setError("");
  };

  const closeForm = () => {
    setActiveId(null);
    setRating("Good");
    setFeedback("");
  };

  const handleSubmit = async () => {
    if (!activeId) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await submitProbationReview(activeId, { rating, feedback });
      setSuccess("Review submitted. HR has been notified.");
      closeForm();
      await load();
    } catch (err) {
      setError(err.message || "Failed to submit review");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="manager-probation-reviews">
        <p className="manager-probation-loading">Loading probation reviews…</p>
      </div>
    );
  }

  return (
    <div className="manager-probation-reviews">
      <h3 className="manager-probation-title">Probation Reviews Due (6-month)</h3>
      <p className="manager-probation-desc">
        Employees below are due for probation review. Submit your feedback so HR can be notified.
      </p>
      {error && <p className="manager-probation-error">{error}</p>}
      {success && <p className="manager-probation-success">{success}</p>}

      {reviews.length === 0 ? (
        <p className="manager-probation-empty">No probation reviews pending.</p>
      ) : (
        <div className="manager-probation-list">
          {reviews.map((r) => (
            <div key={r.id} className="manager-probation-card">
              <div className="manager-probation-card-head">
                <span className="manager-probation-name">{r.employee_name}</span>
                <span className="manager-probation-email">{r.employee_email}</span>
              </div>
              <div className="manager-probation-meta">
                DOJ: {r.doj || "—"} · Probation end: {r.probation_end_date || "—"}
              </div>
              {activeId === r.id ? (
                <div className="manager-probation-form">
                  <label>
                    Rating
                    <select value={rating} onChange={(e) => setRating(e.target.value)}>
                      {RATING_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
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
              ) : (
                <button
                  type="button"
                  className="manager-probation-submit-btn"
                  onClick={() => openForm(r)}
                >
                  Submit review
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
