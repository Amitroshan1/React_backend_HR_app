import React, { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Plus, RefreshCw } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import './OffboardingDashboard.css';
import './HrUpdatesShared.css';

const HR_API_BASE = '/api/HumanResource';

function defaultFiscalYear() {
  const d = new Date();
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

export const HRWorkforcePlan = ({ onBack, circleOptions = [], empTypeOptions = [] }) => {
  const [fiscalYear, setFiscalYear] = useState(defaultFiscalYear);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [budgetForm, setBudgetForm] = useState({ circle: '', emp_type: '', budgeted_count: 0, notes: '' });
  const [saving, setSaving] = useState(false);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/workforce-plan?fiscal_year=${encodeURIComponent(fiscalYear)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) setPlan(data);
      else setError(data.message || 'Failed to load workforce plan');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, fiscalYear]);

  useRefreshOnNavigate(() => { load(); });

  const summary = plan?.summary || {};
  const rows = plan?.rows || [];

  const varianceClass = useMemo(() => ({
    over: 'hr-wf-variance--over',
    under: 'hr-wf-variance--under',
  }), []);

  const saveBudget = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`${HR_API_BASE}/workforce-plan/budgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ ...budgetForm, fiscal_year: fiscalYear, budgeted_count: Number(budgetForm.budgeted_count) || 0 }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowBudgetForm(false);
        setBudgetForm({ circle: '', emp_type: '', budgeted_count: 0, notes: '' });
        await load();
      } else setError(data.message || 'Failed to save budget');
    } catch {
      setError('Network error');
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
            <h2><BarChart3 size={22} /> Workforce Planning</h2>
            <p>Headcount budget vs actual by circle and department.</p>
          </div>
          <div className="hr-updates-header__actions">
            <input
              className="hr-wf-fy-input"
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
              placeholder="FY 2025-26"
            />
            <button type="button" className="hr-updates-refresh" onClick={load} disabled={loading}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button type="button" className="hr-updates-primary" onClick={() => setShowBudgetForm((v) => !v)}>
              <Plus size={16} /> Set budget
            </button>
          </div>
        </div>

        {error ? <p className="hr-updates-error">{error}</p> : null}

        {showBudgetForm ? (
          <form className="hr-updates-form" onSubmit={saveBudget}>
            <select value={budgetForm.circle} onChange={(e) => setBudgetForm((f) => ({ ...f, circle: e.target.value }))} required>
              <option value="">Circle *</option>
              {circleOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={budgetForm.emp_type} onChange={(e) => setBudgetForm((f) => ({ ...f, emp_type: e.target.value }))} required>
              <option value="">Department *</option>
              {empTypeOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input type="number" min={0} placeholder="Budgeted headcount" value={budgetForm.budgeted_count} onChange={(e) => setBudgetForm((f) => ({ ...f, budgeted_count: e.target.value }))} required />
            <input placeholder="Notes" value={budgetForm.notes} onChange={(e) => setBudgetForm((f) => ({ ...f, notes: e.target.value }))} />
            <button type="submit" className="hr-updates-primary" disabled={saving}>Save budget</button>
          </form>
        ) : null}

        <div className="hr-wf-summary">
          <div className="hr-wf-stat"><span>Budgeted</span><strong>{summary.total_budgeted ?? 0}</strong></div>
          <div className="hr-wf-stat"><span>Actual</span><strong>{summary.total_actual ?? 0}</strong></div>
          <div className="hr-wf-stat"><span>Open roles</span><strong>{summary.total_open_roles ?? 0}</strong></div>
          <div className="hr-wf-stat"><span>Variance</span><strong>{summary.total_variance ?? 0}</strong></div>
        </div>

        {loading ? <p>Loading plan…</p> : (
          <div className="hr-inbox-table-wrap">
            <table className="hr-inbox-table">
              <thead>
                <tr>
                  <th>Circle</th>
                  <th>Department</th>
                  <th>Budget</th>
                  <th>Actual</th>
                  <th>Open reqs</th>
                  <th>Variance</th>
                  <th>Gap to budget</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.circle}-${r.emp_type}`}>
                    <td>{r.circle}</td>
                    <td>{r.emp_type}</td>
                    <td>{r.budgeted}</td>
                    <td>{r.actual}</td>
                    <td>{r.open_requisitions}</td>
                    <td className={r.variance > 0 ? varianceClass.over : r.variance < 0 ? varianceClass.under : ''}>{r.variance}</td>
                    <td>{r.gap_to_budget}</td>
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

export default HRWorkforcePlan;
