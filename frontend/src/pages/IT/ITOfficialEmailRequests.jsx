import { useCallback, useState } from "react";
import { ArrowLeft, MailCheck, RefreshCw, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { isAdminVisitActive } from "../../hooks/useAdminVisitNav";
import { useUser } from "../../components/layout/UserContext";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { formatDateDDMMYYYY } from "../../utils/dateFormat";
import "./ITOfficialEmailRequests.css";

const IT_API_BASE = "/api/it";
const API_BASE = "/api";

export default function ITOfficialEmailRequests() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState({});
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [generatedEmail, setGeneratedEmail] = useState("");
  const [remarks, setRemarks] = useState("");

  const cycleKey = user?.id ? String(user.id) : "it";

  const load = useCallback(
    async (status = filter) => {
      setLoading(true);
      setError("");
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(
          `${IT_API_BASE}/official-email-requests?status=${encodeURIComponent(status)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || "Failed to load requests");
        setRequests(data.requests || []);
        setSummary(data.summary || {});
      } catch (err) {
        setError(err.message || "Failed to load requests");
        setRequests([]);
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  useRefreshOnNavigate(() => { load(filter); }, [cycleKey]);

  const selected = requests.find((row) => row.id === selectedId) || null;

  const respond = async (e) => {
    e.preventDefault();
    if (!selected || submitting) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `${IT_API_BASE}/official-email-requests/${selected.id}/respond`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ generated_email: generatedEmail, it_remarks: remarks }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save the generated email");
      setNotice("Generated email saved and shared with HR.");
      setSelectedId(null);
      setGeneratedEmail("");
      setRemarks("");
      await load(filter);
    } catch (err) {
      setError(err.message || "Could not save the generated email");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="it-oer-page">
      <div className="it-oer-shell">
        <header className="it-oer-hero">
          <div>
            <button
              type="button"
              className="it-oer-back"
              onClick={() => navigate(isAdminVisitActive() ? "/admin" : "/it")}
            >
              <ArrowLeft size={16} /> Back
            </button>
            <h1><MailCheck size={20} /> Generate email ID</h1>
            <p>Generate email IDs requested by HR and reply with the created email address.</p>
          </div>
          <button type="button" className="it-oer-refresh" onClick={() => load(filter)} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        </header>

        {error ? <p className="it-oer-alert" role="alert">{error}</p> : null}
        {notice ? <p className="it-oer-alert it-oer-alert--ok" role="status">{notice}</p> : null}

        <div className="it-oer-filters">
          {[
            ["pending", "Pending", summary.pending],
            ["all", "All", summary.all],
            ["generated", "Generated", summary.generated],
          ].map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className={filter === key ? "is-active" : ""}
              onClick={() => { setFilter(key); load(key); }}
            >
              {label}
              {typeof count === "number" && count > 0 ? <em>{count}</em> : null}
            </button>
          ))}
        </div>

        <div className="it-oer-layout">
          <section className="it-oer-panel">
            {loading ? (
              <p className="it-oer-muted">Loading requests…</p>
            ) : requests.length === 0 ? (
              <p className="it-oer-muted">No requests for this filter.</p>
            ) : (
              requests.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`it-oer-item ${selectedId === row.id ? "is-selected" : ""}`}
                  onClick={() => {
                    setSelectedId(row.id);
                    setGeneratedEmail(row.generated_email || "");
                    setRemarks(row.it_remarks || "");
                  }}
                >
                  <strong>{row.candidate_name}</strong>
                  <span>{[row.designation, row.department, row.circle].filter(Boolean).join(" · ") || "—"}</span>
                  <span className={`it-oer-pill ${row.status === "Generated" ? "is-done" : ""}`}>
                    {row.status === "Generated" ? `Generated: ${row.generated_email}` : "Pending"}
                  </span>
                  <small>Requested {formatDateDDMMYYYY(row.created_at)} by {row.requested_by_name || "HR"}</small>
                </button>
              ))
            )}
          </section>

          <section className="it-oer-panel">
            {!selected ? (
              <p className="it-oer-muted">Select a request to view details and reply with the generated email.</p>
            ) : (
              <>
                <h2>{selected.candidate_name}</h2>
                <dl className="it-oer-details">
                  <div><dt>Designation</dt><dd>{selected.designation || "—"}</dd></div>
                  <div><dt>Department</dt><dd>{selected.department || "—"}</dd></div>
                  <div><dt>Circle</dt><dd>{selected.circle || "—"}</dd></div>
                  <div><dt>Preferred prefix</dt><dd>{selected.preferred_prefix || "—"}</dd></div>
                  <div><dt>Requested by</dt><dd>{selected.requested_by_name || "HR"} ({selected.requested_by_email || "—"})</dd></div>
                </dl>
                <p className="it-oer-details-text"><strong>Details:</strong><br />{selected.details}</p>

                {selected.status === "Generated" ? (
                  <>
                    <p className="it-oer-alert it-oer-alert--ok" role="status">
                      Generated email: <strong>{selected.generated_email}</strong>
                    </p>
                    {selected.it_remarks ? <p className="it-oer-muted">{selected.it_remarks}</p> : null}
                  </>
                ) : (
                  <form onSubmit={respond}>
                    <label className="it-oer-field">
                      Generated email ID *
                      <input
                        type="email"
                        value={generatedEmail}
                        onChange={(e) => setGeneratedEmail(e.target.value)}
                        placeholder="e.g. rahul.sharma@company.com"
                        required
                      />
                    </label>
                    <label className="it-oer-field">
                      Remarks for HR
                      <textarea
                        rows={3}
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        placeholder="Optional note for HR"
                      />
                    </label>
                    <button type="submit" className="it-oer-primary" disabled={submitting}>
                      <Send size={15} /> {submitting ? "Sending…" : "Generate & reply to HR"}
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
