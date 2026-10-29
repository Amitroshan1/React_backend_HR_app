import { useCallback, useState } from "react";
import { ArrowLeft, Laptop, RefreshCw, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { isAdminVisitActive } from "../../hooks/useAdminVisitNav";
import { useUser } from "../../components/layout/UserContext";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { formatDateDDMMYYYY } from "../../utils/dateFormat";
import "./ITOfficialEmailRequests.css";

const IT_API_BASE = "/api/it";

export default function ITAssetAssignmentRequests() {
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
  const [assets, setAssets] = useState("");
  const [remarks, setRemarks] = useState("");

  const cycleKey = user?.id ? String(user.id) : "it";

  const load = useCallback(
    async (status = filter) => {
      setLoading(true);
      setError("");
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(
          `${IT_API_BASE}/asset-assignment-requests?status=${encodeURIComponent(status)}`,
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

  const complete = async (e) => {
    e.preventDefault();
    if (!selected || submitting) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(
        `${IT_API_BASE}/asset-assignment-requests/${selected.id}/complete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ assigned_assets: assets, it_remarks: remarks }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save the assignment");
      setNotice("Marked completed and HR has been informed.");
      setSelectedId(null);
      setAssets("");
      setRemarks("");
      await load(filter);
    } catch (err) {
      setError(err.message || "Could not save the assignment");
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
            <h1><Laptop size={20} /> Asset Assignment Requests</h1>
            <p>HR raises these automatically when an Admin approves a new signup. Assign assets and mark them done.</p>
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
            ["completed", "Completed", summary.completed],
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
                    setAssets(row.assigned_assets || "");
                    setRemarks(row.it_remarks || "");
                  }}
                >
                  <strong>{row.employee_name} {row.emp_id ? `(${row.emp_id})` : ""}</strong>
                  <span>{[row.designation, row.department, row.circle].filter(Boolean).join(" · ") || "—"}</span>
                  <span className={`it-oer-pill ${row.status === "Completed" ? "is-done" : ""}`}>
                    {row.status === "Completed" ? "Assets assigned" : "Pending assignment"}
                  </span>
                  <small>Requested {formatDateDDMMYYYY(row.created_at)} by {row.requested_by_name || "HR"}</small>
                </button>
              ))
            )}
          </section>

          <section className="it-oer-panel">
            {!selected ? (
              <p className="it-oer-muted">Select a request to view employee details and record the assigned assets.</p>
            ) : (
              <>
                <h2>{selected.employee_name}</h2>
                <dl className="it-oer-details">
                  <div><dt>Employee ID</dt><dd>{selected.emp_id || "—"}</dd></div>
                  <div><dt>Official email</dt><dd>{selected.employee_email || "—"}</dd></div>
                  <div><dt>Designation</dt><dd>{selected.designation || "—"}</dd></div>
                  <div><dt>Department</dt><dd>{selected.department || "—"}</dd></div>
                  <div><dt>Circle</dt><dd>{selected.circle || "—"}</dd></div>
                  <div><dt>Date of joining</dt><dd>{selected.doj || "—"}</dd></div>
                  <div><dt>Requested by</dt><dd>{selected.requested_by_name || "HR"} ({selected.requested_by_email || "—"})</dd></div>
                </dl>
                {selected.details ? <p className="it-oer-details-text"><strong>Request:</strong><br />{selected.details}</p> : null}

                {selected.status === "Completed" ? (
                  <>
                    <p className="it-oer-alert it-oer-alert--ok" role="status">
                      Assets assigned by {selected.responded_by_name || "IT"}
                    </p>
                    <p className="it-oer-details-text"><strong>Assigned assets:</strong><br />{selected.assigned_assets}</p>
                    {selected.it_remarks ? <p className="it-oer-muted">{selected.it_remarks}</p> : null}
                  </>
                ) : (
                  <form onSubmit={complete}>
                    <label className="it-oer-field">
                      Assets assigned *
                      <textarea
                        rows={3}
                        value={assets}
                        onChange={(e) => setAssets(e.target.value)}
                        placeholder="e.g. Dell Latitude 5440 (SN 8FGH21), charger, mouse, laptop bag"
                        required
                      />
                    </label>
                    <label className="it-oer-field">
                      Remarks for HR
                      <textarea
                        rows={2}
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        placeholder="Optional note for HR"
                      />
                    </label>
                    <button type="submit" className="it-oer-primary" disabled={submitting}>
                      <Send size={15} /> {submitting ? "Saving…" : "Mark assets assigned"}
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
