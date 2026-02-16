import { useEffect, useMemo, useState } from "react";
import "./EmployeePerformance.css";

const API_BASE = "/api/performance";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function currentMonthValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export const EmployeePerformance = () => {
  const [month, setMonth] = useState(currentMonthValue());
  const [achievements, setAchievements] = useState("");
  const [challenges, setChallenges] = useState("");
  const [goalsNextMonth, setGoalsNextMonth] = useState("");
  const [suggestionImprovement, setSuggestionImprovement] = useState("");
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const sortedHistory = useMemo(
    () =>
      [...history].sort((a, b) => {
        const aDate = new Date(a.submitted_at || 0).getTime();
        const bDate = new Date(b.submitted_at || 0).getTime();
        return bDate - aDate;
      }),
    [history]
  );

  const loadHistory = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/my`, {
        method: "GET",
        headers: {
          ...authHeaders(),
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to load performance history");
      }
      setHistory(Array.isArray(result.items) ? result.items : []);
    } catch (err) {
      setHistory([]);
      setError(err.message || "Failed to load performance history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!month.trim() || !achievements.trim()) {
      setError("Month and achievements are required.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/self`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          month: month.trim(),
          achievements: achievements.trim(),
          challenges: challenges.trim(),
          goals_next_month: goalsNextMonth.trim(),
          suggestion_improvement: suggestionImprovement.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to submit performance");
      }
      setSuccess("Performance submitted successfully.");
      setAchievements("");
      setChallenges("");
      setGoalsNextMonth("");
      setSuggestionImprovement("");
      await loadHistory();
    } catch (err) {
      setError(err.message || "Failed to submit performance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="performance-page">
      <div className="performance-card">
        <h2 className="performance-title">Self Performance Review</h2>
        <p className="performance-subtitle">
          Submit your monthly achievements and track manager review status.
        </p>

        <form className="performance-form" onSubmit={handleSubmit}>
          <div className="performance-field">
            <label htmlFor="performance-month">Month</label>
            <input
              id="performance-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              required
            />
          </div>

          <div className="performance-field">
            <label htmlFor="performance-achievements">Achievements</label>
            <textarea
              id="performance-achievements"
              value={achievements}
              onChange={(e) => setAchievements(e.target.value)}
              rows={4}
              placeholder="Write key achievements for this month"
              required
            />
          </div>

          <div className="performance-grid-2">
            <div className="performance-field">
              <label htmlFor="performance-challenges">Challenges</label>
              <textarea
                id="performance-challenges"
                value={challenges}
                onChange={(e) => setChallenges(e.target.value)}
                rows={3}
                placeholder="Mention blockers or challenges"
              />
            </div>
            <div className="performance-field">
              <label htmlFor="performance-goals">Goals Next Month</label>
              <textarea
                id="performance-goals"
                value={goalsNextMonth}
                onChange={(e) => setGoalsNextMonth(e.target.value)}
                rows={3}
                placeholder="Set target goals for next month"
              />
            </div>
          </div>

          <div className="performance-field">
            <label htmlFor="performance-suggestions">Suggestions for Improvement</label>
            <textarea
              id="performance-suggestions"
              value={suggestionImprovement}
              onChange={(e) => setSuggestionImprovement(e.target.value)}
              rows={3}
              placeholder="Share process/team improvement suggestions"
            />
          </div>

          {error && <p className="performance-msg error">{error}</p>}
          {success && <p className="performance-msg success">{success}</p>}

          <button type="submit" className="performance-submit-btn" disabled={saving}>
            {saving ? "Submitting..." : "Submit Review"}
          </button>
        </form>
      </div>

      <div className="performance-card">
        <h3 className="performance-history-title">My Performance History</h3>
        {loading ? (
          <p className="performance-empty">Loading history...</p>
        ) : sortedHistory.length === 0 ? (
          <p className="performance-empty">No submissions yet.</p>
        ) : (
          <div className="performance-table-wrap">
            <table className="performance-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Status</th>
                  <th>Submitted At</th>
                  <th>Manager Rating</th>
                  <th>Manager Comments</th>
                </tr>
              </thead>
              <tbody>
                {sortedHistory.map((item) => (
                  <tr key={item.id}>
                    <td>{item.month || "-"}</td>
                    <td>{item.status || "-"}</td>
                    <td>{formatDateTime(item.submitted_at)}</td>
                    <td>{item.review?.rating || "-"}</td>
                    <td>{item.review?.comments || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
