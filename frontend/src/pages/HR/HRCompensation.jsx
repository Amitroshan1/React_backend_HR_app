import React, { useCallback, useState } from 'react';
import { ArrowLeft, IndianRupee, Plus, RefreshCw, Check, X } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './OffboardingDashboard.css';
import './HrUpdatesShared.css';

const HR_API_BASE = '/api/HumanResource';

export const HRCompensation = ({ onBack }) => {
  const [cycles, setCycles] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCycleForm, setShowCycleForm] = useState(false);
  const [cycleForm, setCycleForm] = useState({ name: '', fiscal_year: '', window_start: '', window_end: '' });
  const [statusFilter, setStatusFilter] = useState('pending');
  const [saving, setSaving] = useState(false);
  const [bands, setBands] = useState([]);
  const [showBandForm, setShowBandForm] = useState(false);
  const [bandForm, setBandForm] = useState({
    circle: '', emp_type: '', grade: 'General', min_annual_ctc: '', mid_annual_ctc: '', max_annual_ctc: '', notes: '',
  });
  const [meritEntries, setMeritEntries] = useState([]);
  const [showMeritForm, setShowMeritForm] = useState(false);
  const [meritForm, setMeritForm] = useState({
    circle: '', emp_type: '', rating: 'Good', increment_pct_min: '', increment_pct_max: '',
  });

  const MERIT_RATINGS = ['Excellent', 'Good', 'Average', 'Needs Improvement'];

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cycRes, propRes, bandRes, meritRes] = await Promise.all([
        fetch(`${HR_API_BASE}/compensation/cycles`, { headers: getAuthHeaders() }),
        fetch(`${HR_API_BASE}/compensation/proposals?status=${encodeURIComponent(statusFilter)}&revision_type=all`, { headers: getAuthHeaders() }),
        fetch(`${HR_API_BASE}/compensation/bands`, { headers: getAuthHeaders() }),
        fetch(`${HR_API_BASE}/compensation/merit-matrix`, { headers: getAuthHeaders() }),
      ]);
      const cycData = await cycRes.json();
      const propData = await propRes.json();
      const bandData = await bandRes.json();
      const meritData = await meritRes.json();
      if (cycRes.ok && cycData.success) setCycles(cycData.cycles || []);
      if (propRes.ok && propData.success) setProposals(propData.proposals || []);
      if (bandRes.ok && bandData.success) setBands(bandData.bands || []);
      if (meritRes.ok && meritData.success) setMeritEntries(meritData.entries || []);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, statusFilter]);

  useRefreshOnNavigate(() => { load(); });

  const createCycle = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${HR_API_BASE}/compensation/cycles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(cycleForm),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowCycleForm(false);
        setCycleForm({ name: '', fiscal_year: '', window_start: '', window_end: '' });
        await load();
      } else setError(data.message || 'Failed to create cycle');
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const approve = async (id) => {
    try {
      const res = await fetch(`${HR_API_BASE}/compensation/proposals/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ notes: 'HR approved — forward to Accounts' }),
      });
      if (res.ok) await load();
      else {
        const data = await res.json();
        setError(data.message || 'Approve failed');
      }
    } catch {
      setError('Network error');
    }
  };

  const reject = async (id) => {
    const notes = window.prompt('Rejection notes (optional):') || '';
    try {
      const res = await fetch(`${HR_API_BASE}/compensation/proposals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) await load();
    } catch {
      setError('Network error');
    }
  };

  const saveBand = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${HR_API_BASE}/compensation/bands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          ...bandForm,
          min_annual_ctc: Number(bandForm.min_annual_ctc) || 0,
          mid_annual_ctc: bandForm.mid_annual_ctc ? Number(bandForm.mid_annual_ctc) : null,
          max_annual_ctc: Number(bandForm.max_annual_ctc) || 0,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowBandForm(false);
        setBandForm({ circle: '', emp_type: '', grade: 'General', min_annual_ctc: '', mid_annual_ctc: '', max_annual_ctc: '', notes: '' });
        await load();
      } else setError(data.message || 'Failed to save band');
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const saveMerit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${HR_API_BASE}/compensation/merit-matrix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          ...meritForm,
          increment_pct_min: Number(meritForm.increment_pct_min) || 0,
          increment_pct_max: Number(meritForm.increment_pct_max) || 0,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowMeritForm(false);
        setMeritForm({ circle: '', emp_type: '', rating: 'Good', increment_pct_min: '', increment_pct_max: '' });
        await load();
      } else setError(data.message || 'Failed to save merit entry');
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  const openInAccounts = (adminId) => {
    window.open(`/account?admin_id=${adminId}&section=ctc`, '_blank', 'noopener');
  };

  return (
    <div className="ob-dash-container">
      <div className="ob-dash-wrapper hr-updates-shell">
        <div className="hr-updates-header">
          <button type="button" className="btn-back-updates" onClick={onBack}>
            <ArrowLeft size={16} /> Back to Updates
          </button>
          <div className="hr-updates-header__title">
            <h2><IndianRupee size={22} /> Compensation &amp; Increments</h2>
            <p>Increment cycles, manager proposals, and HR approval queue.</p>
          </div>
          <div className="hr-updates-header__actions">
            <button type="button" className="hr-updates-refresh" onClick={load} disabled={loading}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button type="button" className="hr-updates-primary" onClick={() => setShowCycleForm((v) => !v)}>
              <Plus size={16} /> Increment cycle
            </button>
            <button type="button" className="hr-updates-secondary" onClick={() => setShowBandForm((v) => !v)}>
              <Plus size={16} /> CTC band
            </button>
            <button type="button" className="hr-updates-secondary" onClick={() => setShowMeritForm((v) => !v)}>
              <Plus size={16} /> Merit %
            </button>
          </div>
        </div>

        {error ? <p className="hr-updates-error">{error}</p> : null}

        {showCycleForm ? (
          <form className="hr-updates-form" onSubmit={createCycle}>
            <input placeholder="Cycle name *" value={cycleForm.name} onChange={(e) => setCycleForm((f) => ({ ...f, name: e.target.value }))} required />
            <input placeholder="Fiscal year e.g. 2025-26 *" value={cycleForm.fiscal_year} onChange={(e) => setCycleForm((f) => ({ ...f, fiscal_year: e.target.value }))} required />
            <input type="date" value={cycleForm.window_start} onChange={(e) => setCycleForm((f) => ({ ...f, window_start: e.target.value }))} />
            <input type="date" value={cycleForm.window_end} onChange={(e) => setCycleForm((f) => ({ ...f, window_end: e.target.value }))} />
            <button type="submit" className="hr-updates-primary" disabled={saving}>Create cycle</button>
          </form>
        ) : null}

        {showBandForm ? (
          <form className="hr-updates-form" onSubmit={saveBand}>
            <input placeholder="Circle *" value={bandForm.circle} onChange={(e) => setBandForm((f) => ({ ...f, circle: e.target.value }))} required />
            <input placeholder="Department *" value={bandForm.emp_type} onChange={(e) => setBandForm((f) => ({ ...f, emp_type: e.target.value }))} required />
            <input placeholder="Grade / designation" value={bandForm.grade} onChange={(e) => setBandForm((f) => ({ ...f, grade: e.target.value }))} />
            <input type="number" placeholder="Min annual CTC" value={bandForm.min_annual_ctc} onChange={(e) => setBandForm((f) => ({ ...f, min_annual_ctc: e.target.value }))} required />
            <input type="number" placeholder="Mid annual CTC" value={bandForm.mid_annual_ctc} onChange={(e) => setBandForm((f) => ({ ...f, mid_annual_ctc: e.target.value }))} />
            <input type="number" placeholder="Max annual CTC" value={bandForm.max_annual_ctc} onChange={(e) => setBandForm((f) => ({ ...f, max_annual_ctc: e.target.value }))} required />
            <button type="submit" className="hr-updates-primary" disabled={saving}>Save band</button>
          </form>
        ) : null}

        {showMeritForm ? (
          <form className="hr-updates-form" onSubmit={saveMerit}>
            <input placeholder="Circle *" value={meritForm.circle} onChange={(e) => setMeritForm((f) => ({ ...f, circle: e.target.value }))} required />
            <input placeholder="Department *" value={meritForm.emp_type} onChange={(e) => setMeritForm((f) => ({ ...f, emp_type: e.target.value }))} required />
            <select value={meritForm.rating} onChange={(e) => setMeritForm((f) => ({ ...f, rating: e.target.value }))}>
              {MERIT_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input type="number" step="0.1" placeholder="Min increment %" value={meritForm.increment_pct_min} onChange={(e) => setMeritForm((f) => ({ ...f, increment_pct_min: e.target.value }))} required />
            <input type="number" step="0.1" placeholder="Max increment %" value={meritForm.increment_pct_max} onChange={(e) => setMeritForm((f) => ({ ...f, increment_pct_max: e.target.value }))} required />
            <button type="submit" className="hr-updates-primary" disabled={saving}>Save merit row</button>
          </form>
        ) : null}

        <section className="hr-comp-cycles">
          <h3>Merit matrix ({meritEntries.length})</h3>
          {meritEntries.length === 0 ? <p className="hr-updates-muted">No merit rules configured.</p> : (
            <div className="hr-inbox-table-wrap">
              <table className="hr-inbox-table">
                <thead>
                  <tr>
                    <th>Circle</th>
                    <th>Department</th>
                    <th>Rating</th>
                    <th>Min %</th>
                    <th>Max %</th>
                  </tr>
                </thead>
                <tbody>
                  {meritEntries.map((m) => (
                    <tr key={m.id}>
                      <td>{m.circle}</td>
                      <td>{m.emp_type}</td>
                      <td>{m.rating}</td>
                      <td>{m.increment_pct_min}%</td>
                      <td>{m.increment_pct_max}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="hr-comp-cycles">
          <h3>CTC bands ({bands.length})</h3>
          {bands.length === 0 ? <p className="hr-updates-muted">No bands configured.</p> : (
            <div className="hr-inbox-table-wrap">
              <table className="hr-inbox-table">
                <thead>
                  <tr>
                    <th>Circle</th>
                    <th>Department</th>
                    <th>Grade</th>
                    <th>Min</th>
                    <th>Mid</th>
                    <th>Max</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((b) => (
                    <tr key={b.id}>
                      <td>{b.circle}</td>
                      <td>{b.emp_type}</td>
                      <td>{b.grade}</td>
                      <td>₹{Number(b.min_annual_ctc).toLocaleString('en-IN')}</td>
                      <td>{b.mid_annual_ctc != null ? `₹${Number(b.mid_annual_ctc).toLocaleString('en-IN')}` : '—'}</td>
                      <td>₹{Number(b.max_annual_ctc).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="hr-comp-cycles">
          <h3>Increment cycles</h3>
          {cycles.length === 0 ? <p className="hr-updates-muted">No cycles yet.</p> : (
            <ul className="hr-ats-list">
              {cycles.map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong>
                  <span>{c.fiscal_year} • {c.status}</span>
                  <span className="hr-ats-meta">
                    {c.window_start ? formatDateDDMMYYYY(c.window_start) : '—'} – {c.window_end ? formatDateDDMMYYYY(c.window_end) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="hr-ats-filters">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="all">All</option>
            <option value="completed">Completed</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </div>

        <section>
          <h3>Salary revision proposals ({proposals.length})</h3>
          {loading ? <p>Loading…</p> : proposals.length === 0 ? (
            <p className="hr-updates-muted">No proposals in this queue.</p>
          ) : (
            <div className="hr-inbox-table-wrap">
              <table className="hr-inbox-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Type</th>
                    <th>Proposed CTC</th>
                    <th>Effective</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div>{p.employee_name || '—'}</div>
                        <div className="hr-inbox-sub">{p.emp_id}</div>
                      </td>
                      <td>{p.revision_type || 'probation'}</td>
                      <td>{p.proposed_annual_ctc != null ? `₹${Number(p.proposed_annual_ctc).toLocaleString('en-IN')}` : '—'}</td>
                      <td>{formatDateDDMMYYYY(p.effective_from, '—')}</td>
                      <td>{p.status}</td>
                      <td className="hr-ats-actions">
                        {p.status === 'pending' && p.revision_type === 'increment' ? (
                          <>
                            <button type="button" onClick={() => approve(p.id)} title="Approve"><Check size={14} /></button>
                            <button type="button" onClick={() => reject(p.id)} title="Reject"><X size={14} /></button>
                          </>
                        ) : null}
                        <button type="button" onClick={() => openInAccounts(p.admin_id)} title="Open in Accounts">Accounts</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default HRCompensation;
