import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import { hasFeature } from '../../utils/planFeatures';
import './HREmployee360.css';

const HR_API_BASE = '/api/HumanResource';
const ACCOUNTS_API_BASE = '/api/accounts';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'leave', label: 'Leave' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'offboarding', label: 'Offboarding' },
  { id: 'accounts', label: 'Accounts', feature: 'hr_employee_accounts' },
];

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function LeaveTab({ employee }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${HR_API_BASE}/leave-balance/${employee.id}`, { headers: getAuthHeaders() });
        const json = await res.json();
        if (!cancelled) {
          if (res.ok && json.success) setData(json);
          else setError(json.message || 'Failed to load leave balance');
        }
      } catch {
        if (!cancelled) setError('Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id]);

  if (loading) return <p className="e360-loading">Loading leave balance…</p>;
  if (error) return <p className="e360-error">{error}</p>;
  const bal = data?.leave_balance || {};
  return (
    <div className="e360-leave-grid">
      <div className="e360-stat"><span>Privilege Leave</span><strong>{bal.privilege_leave_balance ?? '—'}</strong></div>
      <div className="e360-stat"><span>Casual Leave</span><strong>{bal.casual_leave_balance ?? '—'}</strong></div>
      <div className="e360-stat"><span>Comp Off</span><strong>{bal.compensatory_leave_balance ?? '—'}</strong></div>
    </div>
  );
}

function OffboardingTab({ employee }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${HR_API_BASE}/employees/${employee.id}/exit-checklist`, { headers: getAuthHeaders() });
        const json = await res.json();
        if (!cancelled) {
          if (res.ok && json.success) setData(json);
          else setError(json.message || 'No offboarding data');
        }
      } catch {
        if (!cancelled) setError('Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id]);

  if (loading) return <p className="e360-loading">Loading offboarding status…</p>;
  if (error) return <p className="e360-muted">{error}</p>;

  const ob = data?.offboarding || {};
  const lb = data?.leave_balance || {};
  return (
    <div className="e360-offboarding">
      <div className="e360-row"><span>Status</span><strong>{ob.status_label || ob.status || 'Not in separation'}</strong></div>
      {ob.resignation_date ? <div className="e360-row"><span>Resignation</span><strong>{formatDateDDMMYYYY(ob.resignation_date)}</strong></div> : null}
      {ob.fnf_status ? <div className="e360-row"><span>F&amp;F</span><strong>{ob.fnf_status}</strong></div> : null}
      {lb.privilege_leave_balance != null ? (
        <div className="e360-leave-snapshot">
          <p>Leave at exit: PL {lb.privilege_leave_balance} • CL {lb.casual_leave_balance} • Comp {lb.compensatory_leave_balance}</p>
        </div>
      ) : null}
      {ob.noc_summary ? (
        <div className="e360-noc-summary">
          <p>NOC: {ob.noc_summary.approved ?? 0} approved / {ob.noc_summary.total ?? 0} total</p>
        </div>
      ) : null}
    </div>
  );
}

function PayrollTab({ employee }) {
  const [ctc, setCtc] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ctcRes, revRes] = await Promise.all([
          fetch(`${ACCOUNTS_API_BASE}/ctc-breakup/${employee.id}`, { headers: getAuthHeaders() }),
          fetch(`${HR_API_BASE}/compensation/proposals?status=all&admin_id=${employee.id}`, { headers: getAuthHeaders() }),
        ]);
        const ctcJson = await ctcRes.json();
        const revJson = await revRes.json();
        if (!cancelled) {
          if (ctcRes.ok && ctcJson.success) setCtc(ctcJson.ctc_breakup);
          else setError(ctcJson.message || 'No CTC on file');
          if (revRes.ok && revJson.success) setRevisions(revJson.proposals || []);
        }
      } catch {
        if (!cancelled) setError('Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id]);

  if (loading) return <p className="e360-loading">Loading payroll summary…</p>;

  const annual = ctc?.annual_ctc_computed ?? ctc?.annual_ctc;
  const monthly = ctc?.monthly_gross_computed ?? ctc?.monthly_gross;

  return (
    <div className="e360-payroll">
      {error && !ctc ? <p className="e360-muted">{error}</p> : null}
      <div className="e360-leave-grid">
        <div className="e360-stat"><span>Annual CTC</span><strong>{annual != null ? `₹${Number(annual).toLocaleString('en-IN')}` : '—'}</strong></div>
        <div className="e360-stat"><span>Monthly gross</span><strong>{monthly != null ? `₹${Number(monthly).toLocaleString('en-IN')}` : '—'}</strong></div>
        <div className="e360-stat"><span>Basic</span><strong>{ctc?.basic != null ? `₹${Number(ctc.basic).toLocaleString('en-IN')}` : '—'}</strong></div>
        <div className="e360-stat"><span>HRA</span><strong>{ctc?.hra != null ? `₹${Number(ctc.hra).toLocaleString('en-IN')}` : '—'}</strong></div>
      </div>

      {revisions.length > 0 ? (
        <div className="e360-revisions">
          <h4>Salary revisions</h4>
          <ul>
            {revisions.map((r) => (
              <li key={r.id}>
                <span>{r.revision_type || 'revision'}</span>
                <span>{r.status}</span>
                {r.proposed_annual_ctc != null ? <span>₹{Number(r.proposed_annual_ctc).toLocaleString('en-IN')}</span> : null}
                {r.effective_from ? <span>from {formatDateDDMMYYYY(r.effective_from)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="e360-muted">No salary revision requests on record.</p>
      )}

      <button
        type="button"
        className="e360-accounts-link"
        onClick={() => window.open(`/account?admin_id=${employee.id}&section=ctc`, '_blank', 'noopener')}
      >
        Open full CTC in Accounts
      </button>
    </div>
  );
}

function AccountsSummaryTab({ employee }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${ACCOUNTS_API_BASE}/employee-accounts-profile?admin_id=${encodeURIComponent(employee.id)}`,
          { headers: getAuthHeaders() }
        );
        const json = await res.json();
        if (!cancelled) {
          if (res.ok && json.success) setData(json.profile || {});
          else setError(json.message || 'No accounts profile');
        }
      } catch {
        if (!cancelled) setError('Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id]);

  if (loading) return <p className="e360-loading">Loading accounts summary…</p>;
  if (error) return <p className="e360-muted">{error}</p>;

  const fields = [
    ['Designation', data.designation],
    ['Location', data.location],
    ['PAN', data.pan],
    ['UAN', data.uan],
    ['PF Account', data.pf_account_number],
    ['Tax Regime', data.tax_regime],
    ['Bank Details', data.bank_details],
  ];
  return (
    <div className="e360-accounts">
      {fields.map(([label, val]) => (
        <div key={label} className="e360-row">
          <span>{label}</span>
          <strong>{val || '—'}</strong>
        </div>
      ))}
      <p className="e360-muted e360-hint">Read-only summary. Use Accounts module for full payroll edits.</p>
    </div>
  );
}

export const HREmployee360 = ({
  employee,
  initialTab = 'profile',
  onBack,
  ProfileView,
  AttendanceView,
  AccountsView,
}) => {
  const visibleTabs = TABS.filter((t) => !t.feature || hasFeature(t.feature));
  const [activeTab, setActiveTab] = useState(
    visibleTabs.some((t) => t.id === initialTab) ? initialTab : 'profile'
  );

  useEffect(() => {
    if (visibleTabs.some((t) => t.id === initialTab)) {
      setActiveTab(initialTab);
    }
  }, [initialTab, employee?.id, visibleTabs]);

  const noopBack = () => {};

  return (
    <div className="e360-page">
      <button type="button" className="btn-back-updates" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Search
      </button>

      <div className="e360-header">
        <div>
          <h2>{employee.name}</h2>
          <p>{employee.emp_id ? `${employee.emp_id} • ` : ''}{employee.email} • {employee.circle} ({employee.type})</p>
        </div>
      </div>

      <div className="e360-tabs" role="tablist">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`e360-tab${activeTab === tab.id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="e360-panel">
        {activeTab === 'profile' && ProfileView ? (
          <ProfileView employee={employee} onBack={noopBack} embedded />
        ) : null}
        {activeTab === 'attendance' && AttendanceView ? (
          <AttendanceView employee={employee} onBack={noopBack} embedded />
        ) : null}
        {activeTab === 'leave' ? <LeaveTab employee={employee} /> : null}
        {activeTab === 'payroll' ? <PayrollTab employee={employee} /> : null}
        {activeTab === 'offboarding' ? <OffboardingTab employee={employee} /> : null}
        {activeTab === 'accounts' && AccountsView ? (
          <AccountsView employee={employee} onBack={noopBack} embedded />
        ) : null}
        {activeTab === 'accounts' && !AccountsView && hasFeature('hr_employee_accounts') ? (
          <AccountsSummaryTab employee={employee} />
        ) : null}
      </div>
    </div>
  );
};

export default HREmployee360;
