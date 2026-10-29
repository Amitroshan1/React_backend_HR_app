import { useCallback, useState } from 'react';
import { ArrowLeft, MailPlus, RefreshCw, Send, UserPlus } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './offboarding-ui.css';
import './HROfficialEmailRequests.css';

const HR_API_BASE = '/api/HumanResource';

function authHeaders(json = false) {
  const token = localStorage.getItem('token');
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

const EMPTY_FORM = {
  candidate_name: '',
  designation: '',
  department: '',
  circle: '',
  preferred_prefix: '',
  details: '',
};

export default function HROfficialEmailRequests({ onBack, onSignupWithEmail }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState({});
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (status = filter) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${HR_API_BASE}/official-email-requests?status=${encodeURIComponent(status)}`,
        { headers: authHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load requests');
      setRequests(data.requests || []);
      setSummary(data.summary || {});
    } catch (err) {
      setError(err.message || 'Failed to load requests');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useRefreshOnNavigate(() => { load(filter); });

  const setField = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${HR_API_BASE}/official-email-requests`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Could not send request to IT');
      setNotice(data.message || 'Request sent to IT department.');
      setForm(EMPTY_FORM);
      await load(filter);
    } catch (err) {
      setError(err.message || 'Could not send request to IT');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="obx">
      <header className="obx-head">
        <div>
          <button type="button" className="obx-back" onClick={onBack}>
            <ArrowLeft size={16} /> Back
          </button>
          <h1>Generate email ID</h1>
          <p>Send candidate details to IT. When IT generates the email, use Sign Up next to it to start Recruitment.</p>
        </div>
        <div className="obx-actions">
          <button type="button" className="obx-btn" onClick={() => load(filter)} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </header>

      {error ? <p className="obx-alert" role="alert">{error}</p> : null}
      {notice ? <p className="obx-alert obx-alert--ok" role="status">{notice}</p> : null}

      <form className="obx-panel oer-form" onSubmit={submit}>
        <div className="obx-panel-head">
          <h2><MailPlus size={18} /> New request to IT</h2>
        </div>
        <div className="oer-grid">
          <label className="oer-field">
            Candidate full name *
            <input name="candidate_name" value={form.candidate_name} onChange={setField} placeholder="e.g. Rahul Sharma" required />
          </label>
          <label className="oer-field">
            Designation
            <input name="designation" value={form.designation} onChange={setField} placeholder="e.g. Software Engineer" />
          </label>
          <label className="oer-field">
            Department
            <input name="department" value={form.department} onChange={setField} placeholder="e.g. Engineering" />
          </label>
          <label className="oer-field">
            Circle
            <input name="circle" value={form.circle} onChange={setField} placeholder="e.g. NHQ" />
          </label>
          <label className="oer-field">
            Preferred email prefix
            <input name="preferred_prefix" value={form.preferred_prefix} onChange={setField} placeholder="e.g. rahul.sharma" />
          </label>
        </div>
        <label className="oer-field" style={{ marginTop: 14 }}>
          Details for IT *
          <textarea
            name="details"
            rows={4}
            value={form.details}
            onChange={setField}
            placeholder="Write the details IT needs to generate the official email (min 10 characters)"
            required
          />
        </label>
        <div className="obx-actions" style={{ marginTop: 14 }}>
          <button type="submit" className="obx-btn obx-btn--primary" disabled={submitting}>
            <Send size={15} /> {submitting ? 'Sending…' : 'Send request to IT'}
          </button>
        </div>
      </form>

      <div className="obx-sep-filters" role="tablist" aria-label="Generate email ID request filters" style={{ marginTop: 18 }}>
        {[
          ['all', 'All', summary.all],
          ['pending', 'Pending IT', summary.pending],
          ['generated', 'Generated', summary.generated],
        ].map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? 'is-active' : ''}
            onClick={() => { setFilter(key); load(key); }}
          >
            {label}
            {typeof count === 'number' && count > 0 ? <em>{count}</em> : null}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="obx-loading">Loading requests…</p>
      ) : (
        <div className="obx-table-wrap">
          <table className="obx-table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Requested</th>
                <th>Status</th>
                <th>Generated email (IT response)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr><td colSpan="5" className="obx-empty">No requests for this filter.</td></tr>
              ) : requests.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.candidate_name}</strong>
                    <span className="obx-sub">
                      {[row.designation, row.department, row.circle].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </td>
                  <td>{formatDateDDMMYYYY(row.created_at)}</td>
                  <td>
                    <span className={`obx-pill ${row.status === 'Generated' ? 'obx-pill--ok' : 'obx-pill--warn'}`}>
                      {row.status === 'Generated' ? 'Generated' : 'Pending IT'}
                    </span>
                  </td>
                  <td>
                    {row.generated_email ? (
                      <>
                        <strong>{row.generated_email}</strong>
                        {row.it_remarks ? <span className="obx-sub">{row.it_remarks}</span> : null}
                        {row.responded_by_name ? (
                          <span className="obx-sub">by {row.responded_by_name} · {formatDateDDMMYYYY(row.responded_at)}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="obx-muted">Waiting for IT…</span>
                    )}
                  </td>
                  <td>
                    {row.can_signup ? (
                      <button
                        type="button"
                        className="obx-btn obx-btn--primary"
                        onClick={() => onSignupWithEmail?.(row)}
                      >
                        <UserPlus size={14} /> Sign Up
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
