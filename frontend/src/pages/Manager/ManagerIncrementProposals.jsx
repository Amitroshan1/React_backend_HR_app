import { useCallback, useState } from "react";
import { fetchTeamMembers, fetchCompensationBandHint, submitIncrementProposal } from "./api";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import "./ManagerIncrementProposals.css";

export const ManagerIncrementProposals = () => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [proposedCtc, setProposedCtc] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [managerNotes, setManagerNotes] = useState("");
  const [bandHint, setBandHint] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchTeamMembers();
      setMembers(data.members || []);
    } catch (err) {
      setError(err.message || "Failed to load team");
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useRefreshOnNavigate(() => {
    load();
  });

  const openForm = async (member) => {
    setActiveId(member.id);
    setProposedCtc("");
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setManagerNotes("");
    setBandHint(null);
    setSuccess("");
    setError("");
    try {
      const hint = await fetchCompensationBandHint(member.id);
      setBandHint(hint);
    } catch {
      setBandHint(null);
    }
  };

  const closeForm = () => {
    setActiveId(null);
    setProposedCtc("");
    setManagerNotes("");
    setBandHint(null);
  };

  const handleSubmit = async () => {
    if (!activeId || !proposedCtc) {
      setError("Proposed annual CTC is required.");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await submitIncrementProposal({
        admin_id: activeId,
        proposed_annual_ctc: Number(proposedCtc),
        effective_from: effectiveFrom || undefined,
        manager_notes: managerNotes || undefined,
      });
      setSuccess("Increment proposal submitted. HR has been notified.");
      closeForm();
      await load();
    } catch (err) {
      setError(err.message || "Failed to submit proposal");
    } finally {
      setSubmitting(false);
    }
  };

  const band = bandHint?.band;
  const merit = bandHint?.merit_suggestion;

  return (
    <div className="manager-increment-panel">
      <div className="manager-increment-header">
        <h3>Annual increment proposals</h3>
        <p>Propose revised CTC for your direct reports. HR will review before Accounts updates payroll.</p>
      </div>

      {error ? <p className="manager-increment-error">{error}</p> : null}
      {success ? <p className="manager-increment-success">{success}</p> : null}
      {loading ? <p className="manager-increment-loading">Loading team…</p> : null}

      {!loading && members.length === 0 ? (
        <p className="manager-increment-empty">No direct reports found.</p>
      ) : null}

      <div className="manager-increment-list">
        {members.map((m) => (
          <div key={m.id} className="manager-increment-card">
            <div className="manager-increment-card__main">
              <div>
                <strong>{m.name}</strong>
                <span className="manager-increment-meta">{m.role} · {m.circle}</span>
              </div>
              <button type="button" onClick={() => openForm(m)} disabled={activeId === m.id}>
                Propose increment
              </button>
            </div>

            {activeId === m.id ? (
              <div className="manager-increment-form">
                {band ? (
                  <p className="manager-increment-band">
                    Band ({band.grade}): ₹{Number(band.min_annual_ctc).toLocaleString("en-IN")}
                    {band.mid_annual_ctc != null ? ` – ₹${Number(band.mid_annual_ctc).toLocaleString("en-IN")}` : ""}
                    {" – "}₹{Number(band.max_annual_ctc).toLocaleString("en-IN")}
                  </p>
                ) : (
                  <p className="manager-increment-band manager-increment-band--muted">No compensation band configured for this role.</p>
                )}
                {merit ? (
                  <p className="manager-increment-band">
                    Merit guide ({bandHint?.performance_rating || merit.rating}): {merit.increment_pct_min}%–{merit.increment_pct_max}%
                    {' → '}₹{Number(merit.suggested_min_ctc).toLocaleString('en-IN')}–₹{Number(merit.suggested_max_ctc).toLocaleString('en-IN')}
                  </p>
                ) : null}
                <label>
                  Proposed annual CTC (₹) *
                  <input
                    type="number"
                    min={0}
                    value={proposedCtc}
                    onChange={(e) => setProposedCtc(e.target.value)}
                  />
                </label>
                <label>
                  Effective from
                  <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </label>
                <label>
                  Notes for HR
                  <textarea rows={3} value={managerNotes} onChange={(e) => setManagerNotes(e.target.value)} />
                </label>
                <div className="manager-increment-form__actions">
                  <button type="button" onClick={closeForm}>Cancel</button>
                  <button type="button" className="primary" onClick={handleSubmit} disabled={submitting}>
                    {submitting ? "Submitting…" : "Submit proposal"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ManagerIncrementProposals;
