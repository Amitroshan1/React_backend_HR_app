import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Briefcase, Plus, RefreshCw, Send, UserPlus, FileDown, Mail, CheckCircle, Circle } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './OffboardingDashboard.css';
import './HrUpdatesShared.css';
import './HRATS.css';

const HR_API_BASE = '/api/HumanResource';

const STAGES = ['sourced', 'screening', 'assessment', 'interview', 'offer', 'hired', 'rejected'];

export const HRATS = ({ onBack, onConvertToSignup, circleOptions = [], empTypeOptions = [] }) => {
  const [requisitions, setRequisitions] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedReqId, setSelectedReqId] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [showReqForm, setShowReqForm] = useState(false);
  const [showCandForm, setShowCandForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reqForm, setReqForm] = useState({ title: '', circle: '', emp_type: '', headcount: 1, description: '' });
  const [candForm, setCandForm] = useState({ full_name: '', email: '', mobile: '', requisition_id: '', notes: '' });
  const [offerForm, setOfferForm] = useState({ candidate_id: '', annual_ctc: '', joining_date: '', notes: '' });
  const [hireProgress, setHireProgress] = useState(null);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const loadHireProgress = useCallback(async (candidateId) => {
    if (!candidateId) {
      setHireProgress(null);
      return;
    }
    try {
      const res = await fetch(`${HR_API_BASE}/ats/candidates/${candidateId}/hire-progress`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) setHireProgress(data);
      else setHireProgress(null);
    } catch {
      setHireProgress(null);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (offerForm.candidate_id) {
      loadHireProgress(Number(offerForm.candidate_id));
    } else {
      setHireProgress(null);
    }
  }, [offerForm.candidate_id, loadHireProgress, candidates]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (selectedReqId) params.set('requisition_id', selectedReqId);
      if (stageFilter !== 'all') params.set('stage', stageFilter);
      const [reqRes, candRes] = await Promise.all([
        fetch(`${HR_API_BASE}/ats/requisitions`, { headers: getAuthHeaders() }),
        fetch(`${HR_API_BASE}/ats/candidates?${params}`, { headers: getAuthHeaders() }),
      ]);
      const reqData = await reqRes.json();
      const candData = await candRes.json();
      if (reqRes.ok && reqData.success) setRequisitions(reqData.requisitions || []);
      if (candRes.ok && candData.success) setCandidates(candData.candidates || []);
      if (!reqRes.ok && !candRes.ok) setError('Failed to load ATS data');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, selectedReqId, stageFilter]);

  useRefreshOnNavigate(() => { load(); });

  const createRequisition = async (e) => {
    e.preventDefault();
    if (!reqForm.title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${HR_API_BASE}/ats/requisitions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(reqForm),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowReqForm(false);
        setReqForm({ title: '', circle: '', emp_type: '', headcount: 1, description: '' });
        await load();
      } else setError(data.message || 'Failed to create requisition');
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const createCandidate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${HR_API_BASE}/ats/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          ...candForm,
          requisition_id: candForm.requisition_id ? Number(candForm.requisition_id) : null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowCandForm(false);
        setCandForm({ full_name: '', email: '', mobile: '', requisition_id: '', notes: '' });
        await load();
      } else setError(data.message || 'Failed to add candidate');
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const sendAssessment = async (candidateId) => {
    try {
      const res = await fetch(`${HR_API_BASE}/ats/candidates/${candidateId}/assessment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(`Assessment sent. Link: ${data.link || 'check email'}`);
        await load();
      } else setError(data.message || 'Failed to send assessment');
    } catch {
      setError('Network error');
    }
  };

  const saveOffer = async (e) => {
    e.preventDefault();
    if (!offerForm.candidate_id) return;
    setSaving(true);
    try {
      const res = await fetch(`${HR_API_BASE}/ats/candidates/${offerForm.candidate_id}/offer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          annual_ctc: offerForm.annual_ctc ? Number(offerForm.annual_ctc) : null,
          joining_date: offerForm.joining_date || null,
          notes: offerForm.notes || null,
          status: 'draft',
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await load();
        loadHireProgress(Number(offerForm.candidate_id));
      } else setError(data.message || 'Failed to save offer');
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const downloadOfferLetter = async (candidateId) => {
    try {
      const res = await fetch(`${HR_API_BASE}/ats/candidates/${candidateId}/offer-letter/pdf`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Offer letter not available');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `offer-letter-${candidateId}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('Failed to download offer letter');
    }
  };

  const sendOfferEmail = async (candidateId) => {
    try {
      const res = await fetch(`${HR_API_BASE}/ats/candidates/${candidateId}/offer/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert('Offer email sent to candidate.');
        await load();
        if (offerForm.candidate_id) loadHireProgress(Number(offerForm.candidate_id));
      } else setError(data.message || 'Failed to send offer email');
    } catch {
      setError('Network error');
    }
  };

  const convertToSignup = async (candidateId) => {
    try {
      const res = await fetch(`${HR_API_BASE}/ats/candidates/${candidateId}/signup-payload`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success && typeof onConvertToSignup === 'function') {
        onConvertToSignup(data.signup || {}, data.offer_annual_ctc, data.candidate_id);
        if (data.band_hint && !data.band_hint.within_band && data.band_hint.band_message) {
          setError(data.band_hint.band_message);
        }
      } else setError(data.message || 'Failed to prepare signup');
    } catch {
      setError('Network error');
    }
  };

  const updateStage = async (candidateId, stage) => {
    try {
      await fetch(`${HR_API_BASE}/ats/candidates/${candidateId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ stage }),
      });
      await load();
    } catch {
      setError('Failed to update stage');
    }
  };

  const hireSteps = hireProgress?.steps || {};
  const pipelineSteps = [
    { key: 'offer_saved', label: 'Offer drafted' },
    { key: 'offer_sent', label: 'Offer emailed' },
    { key: 'offer_accepted', label: 'Candidate accepted' },
    { key: 'onboarded', label: 'Employee onboarded' },
    { key: 'draft_ctc', label: 'Draft CTC in Accounts' },
  ];

  return (
    <div className="ob-dash-container hr-ats-page">
      <div className="ob-dash-wrapper hr-updates-shell hr-ats-shell">
        <button type="button" className="btn-back-updates hr-ats-back" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <header className="hr-ats-hero">
          <div className="hr-ats-hero__main">
            <h2><Briefcase size={22} /> Recruitment (ATS)</h2>
            <p>Job requisitions, candidate pipeline, assessments, and offers.</p>
          </div>
          <div className="hr-ats-hero__actions">
            <button type="button" className="hr-ats-btn hr-ats-btn--ghost" onClick={load} disabled={loading}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button type="button" className="hr-ats-btn hr-ats-btn--primary" onClick={() => setShowReqForm((v) => !v)}>
              <Plus size={16} /> Requisition
            </button>
            <button type="button" className="hr-ats-btn hr-ats-btn--secondary" onClick={() => setShowCandForm((v) => !v)}>
              <Plus size={16} /> Candidate
            </button>
          </div>
        </header>

        <div className="hr-ats-body">
        {error ? <p className="hr-updates-error hr-ats-error">{error}</p> : null}

        {showReqForm ? (
          <form className="hr-updates-form" onSubmit={createRequisition}>
            <input placeholder="Job title *" value={reqForm.title} onChange={(e) => setReqForm((f) => ({ ...f, title: e.target.value }))} required />
            <select value={reqForm.circle} onChange={(e) => setReqForm((f) => ({ ...f, circle: e.target.value }))}>
              <option value="">Circle</option>
              {circleOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={reqForm.emp_type} onChange={(e) => setReqForm((f) => ({ ...f, emp_type: e.target.value }))}>
              <option value="">Department</option>
              {empTypeOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input type="number" min={1} placeholder="Headcount" value={reqForm.headcount} onChange={(e) => setReqForm((f) => ({ ...f, headcount: e.target.value }))} />
            <textarea placeholder="Description" value={reqForm.description} onChange={(e) => setReqForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
            <button type="submit" className="hr-updates-primary" disabled={saving}>Save requisition</button>
          </form>
        ) : null}

        {showCandForm ? (
          <form className="hr-updates-form" onSubmit={createCandidate}>
            <input placeholder="Full name *" value={candForm.full_name} onChange={(e) => setCandForm((f) => ({ ...f, full_name: e.target.value }))} required />
            <input type="email" placeholder="Email *" value={candForm.email} onChange={(e) => setCandForm((f) => ({ ...f, email: e.target.value }))} required />
            <input placeholder="Mobile" value={candForm.mobile} onChange={(e) => setCandForm((f) => ({ ...f, mobile: e.target.value }))} />
            <select value={candForm.requisition_id} onChange={(e) => setCandForm((f) => ({ ...f, requisition_id: e.target.value }))}>
              <option value="">Requisition (optional)</option>
              {requisitions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <button type="submit" className="hr-updates-primary" disabled={saving}>Add candidate</button>
          </form>
        ) : null}

        <div className="hr-ats-filters">
          <label className="hr-ats-filter">
            <span>Requisition</span>
            <select value={selectedReqId} onChange={(e) => setSelectedReqId(e.target.value)}>
              <option value="">All requisitions</option>
              {requisitions.map((r) => <option key={r.id} value={r.id}>{r.title} ({r.status})</option>)}
            </select>
          </label>
          <label className="hr-ats-filter">
            <span>Stage</span>
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
              <option value="all">All stages</option>
              {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <div className="hr-ats-grid">
          <section className="hr-ats-panel">
            <h3>Open requisitions ({requisitions.filter((r) => r.status === 'open').length})</h3>
            {loading ? <p>Loading…</p> : (
              <ul className="hr-ats-list">
                {requisitions.map((r) => (
                  <li key={r.id}>
                    <strong>{r.title}</strong>
                    <span>{r.circle || '—'} • {r.emp_type || '—'} • HC {r.headcount}</span>
                    <span className="hr-ats-meta">{r.candidate_count} candidates • {r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="hr-ats-panel hr-ats-panel--pipeline">
            <h3>Candidate pipeline</h3>
            {loading ? <p>Loading…</p> : candidates.length === 0 ? <p className="hr-updates-muted">No candidates yet.</p> : (
              <div className="hr-inbox-table-wrap">
                <table className="hr-inbox-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Stage</th>
                      <th>Requisition</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div>{c.full_name}</div>
                          <div className="hr-inbox-sub">{c.email}</div>
                        </td>
                        <td>
                          <select value={c.stage} onChange={(e) => updateStage(c.id, e.target.value)}>
                            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td>{c.requisition_title || '—'}</td>
                        <td className="hr-ats-actions">
                          <button type="button" onClick={() => sendAssessment(c.id)} title="Send assessment"><Send size={14} /></button>
                          <button type="button" onClick={() => setOfferForm((f) => ({ ...f, candidate_id: String(c.id), annual_ctc: c.offer?.annual_ctc || '', joining_date: c.offer?.joining_date || '' }))} title="Offer">₹</button>
                          {c.offer ? (
                            <>
                              <button type="button" onClick={() => downloadOfferLetter(c.id)} title="Download offer letter"><FileDown size={14} /></button>
                              <button type="button" onClick={() => sendOfferEmail(c.id)} title="Email offer letter"><Mail size={14} /></button>
                            </>
                          ) : null}
                          <button type="button" className="hr-ats-action-btn hr-ats-action-btn--signup" onClick={() => convertToSignup(c.id)} title="Sign Up">
                            <UserPlus size={14} /> Sign Up
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {offerForm.candidate_id ? (
          <form className="hr-updates-form hr-ats-offer" onSubmit={saveOffer}>
            <h4>Offer for candidate #{offerForm.candidate_id}</h4>
            <input type="number" placeholder="Annual CTC" value={offerForm.annual_ctc} onChange={(e) => setOfferForm((f) => ({ ...f, annual_ctc: e.target.value }))} />
            <input type="date" value={offerForm.joining_date} onChange={(e) => setOfferForm((f) => ({ ...f, joining_date: e.target.value }))} />
            <textarea placeholder="Notes" value={offerForm.notes} onChange={(e) => setOfferForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            <div className="hr-ats-offer-actions">
              <button type="submit" className="hr-updates-primary" disabled={saving}>Save offer</button>
              <button type="button" className="hr-updates-secondary" onClick={() => sendOfferEmail(Number(offerForm.candidate_id))}>Email offer</button>
              <button type="button" className="hr-updates-secondary" onClick={() => convertToSignup(Number(offerForm.candidate_id))}>
                <UserPlus size={14} /> Sign Up
              </button>
            </div>
          </form>
        ) : null}

        {offerForm.candidate_id && hireProgress ? (
          <section className="hr-hire-pipeline">
            <h4>Hire pipeline — candidate #{offerForm.candidate_id}</h4>
            <ol className="hr-hire-pipeline-steps">
              {pipelineSteps.map((step) => {
                const done = Boolean(hireSteps[step.key]);
                return (
                  <li key={step.key} className={done ? 'is-done' : ''}>
                    {done ? <CheckCircle size={16} /> : <Circle size={16} />}
                    <span>{step.label}</span>
                  </li>
                );
              })}
            </ol>
            {hireProgress.offer?.accepted_at ? (
              <p className="hr-updates-muted">
                Accepted {formatDateDDMMYYYY(hireProgress.offer.accepted_at)}
                {hireProgress.offer.accepted_by_name ? ` by ${hireProgress.offer.accepted_by_name}` : ''}
              </p>
            ) : null}
            {hireProgress.admin_id ? (
              <p className="hr-updates-muted">Linked employee ID: {hireProgress.admin_id}</p>
            ) : null}
          </section>
        ) : null}
        </div>
      </div>
    </div>
  );
};

export default HRATS;
