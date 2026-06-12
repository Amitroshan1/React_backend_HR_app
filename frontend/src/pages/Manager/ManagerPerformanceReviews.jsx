import { useMemo, useState } from "react";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import {
  fetchManagerPerformanceQueue,
  submitManagerPerformanceReview,
} from "./api";
import "./ManagerPerformanceReviews.css";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";

const RATING_OPTIONS = ["Excellent", "Good", "Average", "Needs Improvement"];

const formatDateTime = (value) => formatDateTimeDDMMYYYY(value, "-");

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function matchesPerformanceFilters(item, monthFilter, statusFilter) {
  const monthVal = String(monthFilter || "").trim();
  const statusVal = String(statusFilter || "All").trim();
  if (monthVal && String(item?.month || "").trim() !== monthVal) return false;
  if (statusVal !== "All" && String(item?.status || "").toLowerCase() !== statusVal.toLowerCase()) {
    return false;
  }
  return true;
}

export const ManagerPerformanceReviews = () => {
  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("All");
  const [appliedMonth, setAppliedMonth] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("All");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [items, setItems] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [rating, setRating] = useState("Good");
  const [comments, setComments] = useState("");

  const filteredItems = useMemo(
    () => items.filter((item) => matchesPerformanceFilters(item, appliedMonth, appliedStatus)),
    [items, appliedMonth, appliedStatus]
  );

  const pendingCount = useMemo(
    () =>
      filteredItems.filter((item) => String(item.status || "").toLowerCase() !== "reviewed").length,
    [filteredItems]
  );

  const loadQueue = async (monthFilter = appliedMonth, statusFilter = appliedStatus) => {
    setLoading(true);
    setError("");
    try {
      const rows = await fetchManagerPerformanceQueue({
        month: monthFilter,
        status: statusFilter,
      });
      setItems(rows);
    } catch (err) {
      setItems([]);
      setError(err.message || "Failed to load queue");
    } finally {
      setLoading(false);
    }
  };

  useRefreshOnNavigate(() => {
    loadQueue("", "All");
  });

  const handleApplyFilters = async () => {
    setAppliedMonth(month);
    setAppliedStatus(status);
    await loadQueue(month, status);
  };

  const openReview = (item) => {
    setActiveItem(item);
    setRating(item?.review?.rating || "Good");
    setComments(item?.review?.comments || "");
    setSuccess("");
    setError("");
  };

  const closeReview = () => {
    setActiveItem(null);
    setRating("Good");
    setComments("");
  };

  const handleSubmitReview = async () => {
    if (!activeItem?.id) return;
    setSavingId(activeItem.id);
    setError("");
    setSuccess("");
    try {
      await submitManagerPerformanceReview(activeItem.id, {
        rating,
        comments,
      });
      setSuccess("Review saved successfully.");
      closeReview();
      await loadQueue();
    } catch (err) {
      setError(err.message || "Failed to submit review");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="mpr-page">
      <div className="mpr-header">
        <div>
          <h2>Performance Review Queue</h2>
          <p>Review team monthly self-assessments and submit manager feedback.</p>
        </div>
        <div className="mpr-meta">
          <span>Total: {filteredItems.length}</span>
          <span>Pending: {pendingCount}</span>
        </div>
      </div>

      <div className="mpr-filters">
        <div className="mpr-filter">
          <label htmlFor="mpr-month">Month</label>
          <input
            id="mpr-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder={thisMonth()}
          />
        </div>
        <div className="mpr-filter">
          <label htmlFor="mpr-status">Status</label>
          <select id="mpr-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="All">All</option>
            <option value="Submitted">Submitted</option>
            <option value="Reviewed">Reviewed</option>
          </select>
        </div>
        <button
          type="button"
          className="mpr-btn"
          onClick={handleApplyFilters}
          disabled={loading}
        >
          {loading ? "Loading..." : "Apply"}
        </button>
      </div>

      {error && <p className="mpr-msg error">{error}</p>}
      {success && <p className="mpr-msg success">{success}</p>}

      <div className="mpr-table-wrap">
        <table className="mpr-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Emp ID</th>
              <th>Month</th>
              <th>Status</th>
              <th>Submitted At</th>
              <th>Manager Rating</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7" className="mpr-empty">
                  Loading queue...
                </td>
              </tr>
            ) : filteredItems.length === 0 ? (
              <tr>
                <td colSpan="7" className="mpr-empty">
                  No performance submissions found.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.employee_name || "-"}</td>
                  <td>{item.emp_id || "-"}</td>
                  <td>{item.month || "-"}</td>
                  <td>{item.status || "-"}</td>
                  <td>{formatDateTime(item.submitted_at)}</td>
                  <td>{item.review?.rating || "-"}</td>
                  <td>
                    <button className="mpr-link-btn" onClick={() => openReview(item)}>
                      {item.review ? "Update Review" : "Review"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {activeItem && (
        <div className="mpr-modal-backdrop" onClick={closeReview}>
          <div className="mpr-modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              Review: {activeItem.employee_name} ({activeItem.month})
            </h3>

            <div className="mpr-modal-section">
              <p className="mpr-label">Achievements</p>
              <p className="mpr-value">{activeItem.achievements || "-"}</p>
            </div>
            <div className="mpr-modal-section">
              <p className="mpr-label">Challenges</p>
              <p className="mpr-value">{activeItem.challenges || "-"}</p>
            </div>
            <div className="mpr-modal-section">
              <p className="mpr-label">Goals Next Month</p>
              <p className="mpr-value">{activeItem.goals_next_month || "-"}</p>
            </div>
            <div className="mpr-modal-section">
              <p className="mpr-label">Suggestions</p>
              <p className="mpr-value">{activeItem.suggestion_improvement || "-"}</p>
            </div>

            <div className="mpr-form-row">
              <label htmlFor="mpr-rating">Rating</label>
              <select id="mpr-rating" value={rating} onChange={(e) => setRating(e.target.value)}>
                {RATING_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div className="mpr-form-row">
              <label htmlFor="mpr-comments">Comments</label>
              <textarea
                id="mpr-comments"
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={4}
                placeholder="Manager comments"
              />
            </div>

            <div className="mpr-modal-actions">
              <button className="mpr-btn secondary" onClick={closeReview}>
                Cancel
              </button>
              <button
                className="mpr-btn"
                onClick={handleSubmitReview}
                disabled={savingId === activeItem.id}
              >
                {savingId === activeItem.id ? "Saving..." : "Save Review"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
