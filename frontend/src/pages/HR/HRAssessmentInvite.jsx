import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

const HR_API_BASE = "/api/HumanResource";

const getAuthHeaders = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const STATUS_STYLES = {
  invited: { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe", label: "Invited" },
  started: { bg: "#fffbeb", fg: "#b45309", border: "#fde68a", label: "In Progress" },
  submitted: { bg: "#f0fdf4", fg: "#15803d", border: "#bbf7d0", label: "Submitted" },
  evaluated: { bg: "#f5f3ff", fg: "#6d28d9", border: "#ddd6fe", label: "Evaluated" },
};

export function HRAssessmentInvite({ onBack, empTypeOptions = [] }) {
  const [form, setForm] = useState({ full_name: "", email: "", department: empTypeOptions[0] || "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [marks, setMarks] = useState({});
  const [evaluating, setEvaluating] = useState(false);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${HR_API_BASE}/assessment/invites`, { headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to load invites");
      setRows(data.invites || []);
    } catch (e) {
      setError(e.message || "Failed to load invites");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      const res = await fetch(`${HR_API_BASE}/assessment/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to send invite");
      setMessage("Assessment invite sent successfully.");
      setForm((p) => ({ ...p, full_name: "", email: "" }));
      await fetchRows();
    } catch (e2) {
      setError(e2.message || "Failed to send invite");
    } finally {
      setSubmitting(false);
    }
  };

  const openSubmission = async (id) => {
    setError("");
    try {
      const res = await fetch(`${HR_API_BASE}/assessment/invites/${id}`, { headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to load submission");
      const invite = data.invite || null;
      setSelected(invite);
      const existing = invite?.manual_marks || {};
      setMarks(existing);
    } catch (e) {
      setError(e.message || "Failed to load submission");
    }
  };

  const handleEvaluate = async () => {
    if (!selected?.id) return;
    setEvaluating(true);
    setError("");
    try {
      const res = await fetch(`${HR_API_BASE}/assessment/invites/${selected.id}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ marks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to evaluate");
      await openSubmission(selected.id);
      await fetchRows();
      setMessage("Evaluation saved.");
    } catch (e) {
      setError(e.message || "Failed to evaluate");
    } finally {
      setEvaluating(false);
    }
  };

  const sec2ObjectiveQs = useMemo(() => Array.from({ length: 8 }, (_, i) => i + 26), []);
  const sec2ManualQs = useMemo(() => Array.from({ length: 29 }, (_, i) => i + 34), []);
  const sec1Qs = useMemo(() => Array.from({ length: 25 }, (_, i) => i + 1), []);
  const sec3Qs = useMemo(() => Array.from({ length: 25 }, (_, i) => i + 63), []);
  const manualDraftTotal = useMemo(
    () =>
      sec2ManualQs.reduce((sum, q) => {
        const raw = marks[String(q)];
        const num = Number(raw);
        return sum + (Number.isFinite(num) ? Math.max(0, num) : 0);
      }, 0),
    [marks, sec2ManualQs]
  );
  const objectiveMax = sec1Qs.length + sec2ObjectiveQs.length + sec3Qs.length;
  const overallMax = objectiveMax + sec2ManualQs.length;

  const renderObjectiveSection = (questionNumbers, title) => (
    <div style={{ marginTop: 14 }}>
      <h4 style={{ margin: "0 0 8px" }}>{title}</h4>
      <div style={{ maxHeight: 190, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
        {questionNumbers.map((q) => {
          const b = (selected?.auto_breakdown || {})[String(q)] || {};
          const given = b.given == null ? "-" : String(b.given);
          const expected = b.expected == null ? "-" : String(b.expected);
          const correct = !!b.correct;
          return (
            <div
              key={q}
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr 1fr 90px",
                gap: 8,
                alignItems: "center",
                padding: "6px 4px",
                borderBottom: "1px solid #f1f5f9",
              }}
            >
              <strong>Q{q}</strong>
              <span>Given: {given}</span>
              <span>Expected: {expected}</span>
              <span style={{ color: correct ? "#15803d" : "#b91c1c", fontWeight: 700 }}>
                {correct ? "Correct" : "Wrong"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderStatusBadge = (statusValue) => {
    const key = String(statusValue || "").toLowerCase();
    const style = STATUS_STYLES[key] || {
      bg: "#f8fafc",
      fg: "#334155",
      border: "#cbd5e1",
      label: statusValue || "Unknown",
    };
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "3px 10px",
          borderRadius: 9999,
          fontWeight: 700,
          fontSize: 12,
          border: `1px solid ${style.border}`,
          background: style.bg,
          color: style.fg,
          textTransform: "uppercase",
          letterSpacing: "0.02em",
        }}
      >
        {style.label}
      </span>
    );
  };

  return (
    <div className="hr-main-container" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <button className="btn-back-updates" onClick={onBack}><ArrowLeft size={16} /> Back to Updates</button>
      <h2 style={{ marginTop: 8 }}>Assessment Invite</h2>
      <p style={{ color: "#64748b" }}>Send 24-hour test links and evaluate submissions.</p>

      <form onSubmit={handleSend} style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(160px, 1fr))", gap: 10, background: "#fff", padding: 12, borderRadius: 10, border: "1px solid #e5e7eb" }}>
        <input
          placeholder="Candidate Name"
          value={form.full_name}
          onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
          required
        />
        <select
          value={form.department}
          onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
          required
        >
          <option value="">Select Department</option>
          {empTypeOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input
          type="email"
          placeholder="Candidate Email"
          value={form.email}
          onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
          required
        />
        <button className="btn-create-account" disabled={submitting}>{submitting ? "Sending..." : "Send Link"}</button>
      </form>

      {message && <div className="lau-success" style={{ marginTop: 10 }}>{message}</div>}
      {error && <div className="lau-error" style={{ marginTop: 10 }}>{error}</div>}

      <div style={{ marginTop: 16, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "auto" }}>
        <table className="results-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Department</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>Total</th>
              <th>Avg %</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.full_name}</td>
                <td>{r.candidate_email}</td>
                <td>{r.department}</td>
                <td>{renderStatusBadge(r.status)}</td>
                <td>{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "-"}</td>
                <td>{r.total_score ?? "-"}</td>
                <td>{r.avg_score ?? "-"}</td>
                <td>
                  <button
                    type="button"
                    className="lau-edit-btn"
                    onClick={() => openSubmission(r.id)}
                    disabled={r.status !== "submitted"}
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", padding: 16 }}>No invites found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="lau-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="lau-modal" style={{ maxWidth: 980 }} onClick={(e) => e.stopPropagation()}>
            <h3>Evaluate: {selected.full_name} ({selected.candidate_email})</h3>
            <p>
              Status: {selected.status} | Submitted:{" "}
              {selected.submitted_at ? new Date(selected.submitted_at).toLocaleString() : "-"}
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(140px, 1fr))",
                gap: 10,
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 10,
                marginBottom: 10,
              }}
            >
              <div><strong>Objective Score</strong><br />{selected.auto_score ?? 0} / {objectiveMax}</div>
              <div><strong>Manual Score (draft)</strong><br />{manualDraftTotal.toFixed(2)} / {sec2ManualQs.length}</div>
              <div><strong>Current Total</strong><br />{selected.total_score ?? 0} / {overallMax}</div>
              <div><strong>Current Avg %</strong><br />{selected.avg_score ?? 0}%</div>
            </div>

            {renderObjectiveSection(sec1Qs, "Section 1 (Q1-Q25) Auto Analysis")}
            {renderObjectiveSection(sec2ObjectiveQs, "Section 2A (Q26-Q33) Auto Analysis")}
            {renderObjectiveSection(sec3Qs, "Section 3 (Q63-Q87) Auto Analysis")}

            <h4 style={{ marginTop: 16, marginBottom: 8 }}>Section 2B (Q34-Q62) Manual Marks</h4>
            <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
              {sec2ManualQs.map((q) => (
                <div key={q} style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Q{q}</div>
                    <textarea rows={2} value={String((selected.answers || {})[String(q)] || "")} readOnly />
                  </div>
                  <div>
                    <label>Marks</label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={marks[String(q)] ?? ""}
                      onChange={(e) => setMarks((p) => ({ ...p, [String(q)]: e.target.value }))}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="lau-modal-actions">
              <button className="lau-cancel" onClick={() => setSelected(null)}>Close</button>
              <button className="lau-save" disabled={evaluating} onClick={handleEvaluate}>
                {evaluating ? "Saving..." : "Submit Evaluation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

