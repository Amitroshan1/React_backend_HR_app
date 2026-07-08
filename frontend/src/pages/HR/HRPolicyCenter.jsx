import React, { useCallback, useState } from 'react';
import { ArrowLeft, FileText, Plus, RefreshCw } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import './HRPolicyCenter.css';
import './OffboardingDashboard.css';

const HR_API_BASE = '/api/HumanResource';

export const HRPolicyCenter = ({ onBack, circleOptions = [], empTypeOptions = [] }) => {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    version: '1.0',
    circle: '',
    emp_type: '',
    content_html: '',
    effective_from: '',
    requires_acknowledgment: true,
  });

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/policies`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok && data.success) {
        setPolicies(data.policies || []);
      } else {
        setError(data.message || 'Failed to load policies');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useRefreshOnNavigate(() => {
    load();
  });

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/policies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          ...form,
          circle: form.circle || null,
          emp_type: form.emp_type || null,
          effective_from: form.effective_from || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowForm(false);
        setForm({ title: '', version: '1.0', circle: '', emp_type: '', content_html: '', effective_from: '', requires_acknowledgment: true });
        await load();
      } else {
        setError(data.message || 'Failed to create policy');
      }
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (policy) => {
    try {
      await fetch(`${HR_API_BASE}/policies/${policy.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ is_active: !policy.is_active }),
      });
      await load();
    } catch {
      setError('Failed to update policy');
    }
  };

  const uploadPolicyPdf = async (policyId, file) => {
    if (!file) return;
    setSaving(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${HR_API_BASE}/policies/${policyId}/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: form,
      });
      const data = await res.json();
      if (res.ok && data.success) await load();
      else setError(data.message || 'PDF upload failed');
    } catch {
      setError('PDF upload failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ob-dash-container">
      <div className="ob-dash-wrapper hr-updates-shell">
        <div className="hr-updates-header">
          <button type="button" className="btn-back-updates" onClick={onBack}>
            <ArrowLeft size={16} /> Back to Updates
          </button>
          <div className="hr-updates-header__title">
            <h2><FileText size={22} /> Policy Center</h2>
            <p>Publish HR policies and track employee acknowledgments.</p>
          </div>
          <div className="hr-updates-header__actions">
            <button type="button" className="hr-updates-refresh" onClick={load} disabled={loading}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button type="button" className="hr-updates-primary" onClick={() => setShowForm((v) => !v)}>
              <Plus size={16} /> New policy
            </button>
          </div>
        </div>

        {error ? <p className="hr-updates-error">{error}</p> : null}

        {showForm ? (
          <form className="policy-form" onSubmit={handleCreate}>
            <div className="policy-form-grid">
              <label>Title *<input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required /></label>
              <label>Version<input value={form.version} onChange={(e) => setForm((p) => ({ ...p, version: e.target.value }))} /></label>
              <label>Circle (optional)
                <select value={form.circle} onChange={(e) => setForm((p) => ({ ...p, circle: e.target.value }))}>
                  <option value="">All circles</option>
                  {circleOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>Department (optional)
                <select value={form.emp_type} onChange={(e) => setForm((p) => ({ ...p, emp_type: e.target.value }))}>
                  <option value="">All departments</option>
                  {empTypeOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label>Effective from<input type="date" value={form.effective_from} onChange={(e) => setForm((p) => ({ ...p, effective_from: e.target.value }))} /></label>
              <label className="policy-form-check">
                <input type="checkbox" checked={form.requires_acknowledgment} onChange={(e) => setForm((p) => ({ ...p, requires_acknowledgment: e.target.checked }))} />
                Requires employee acknowledgment
              </label>
            </div>
            <label>Policy content
              <textarea rows={6} value={form.content_html} onChange={(e) => setForm((p) => ({ ...p, content_html: e.target.value }))} placeholder="Enter policy text shown to employees…" />
            </label>
            <div className="policy-form-actions">
              <button type="button" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="hr-updates-primary" disabled={saving}>{saving ? 'Saving…' : 'Publish policy'}</button>
            </div>
          </form>
        ) : null}

        {loading ? <p className="hr-updates-loading">Loading policies…</p> : null}

        {!loading && policies.length === 0 ? (
          <p className="hr-updates-empty">No policies published yet.</p>
        ) : (
          <div className="policy-list">
            {policies.map((p) => (
              <div key={p.id} className={`policy-card${p.is_active ? '' : ' policy-card--inactive'}`}>
                <div className="policy-card__head">
                  <div>
                    <h4>{p.title} <span className="policy-version">v{p.version}</span></h4>
                    <p>{p.circle || 'All circles'} · {p.emp_type || 'All departments'}</p>
                  </div>
                  <button type="button" className="policy-toggle" onClick={() => toggleActive(p)}>
                    {p.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
                {p.content_html ? <div className="policy-card__body">{p.content_html}</div> : null}
                <div className="policy-card__meta">
                  <span>Acknowledged: {p.ack_count ?? 0}</span>
                  {p.file_path ? (
                    <a href={`/static/uploads/${p.file_path}`} target="_blank" rel="noopener noreferrer">View PDF</a>
                  ) : null}
                  <label className="policy-pdf-upload">
                    Upload PDF
                    <input type="file" accept=".pdf,application/pdf" onChange={(e) => uploadPolicyPdf(p.id, e.target.files?.[0])} />
                  </label>
                  {p.requires_acknowledgment ? <span className="policy-badge">Ack required</span> : null}
                  {!p.is_active ? <span className="policy-badge policy-badge--muted">Inactive</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HRPolicyCenter;
