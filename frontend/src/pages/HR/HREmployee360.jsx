import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, User } from 'lucide-react';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import { hasFeature } from '../../utils/planFeatures';
import { usePersistedView } from '../../hooks/usePersistedView';
import { scrollAppToTop } from '../../utils/scrollToTop';
import { HRApplyLeaveOnBehalf } from './HRApplyLeaveOnBehalf';
import { CompOffLedger } from '../Leaves/CompOffLedger';
import './HREmployee360.css';
import '../Leaves/CompOffLedger.css';

const HR_API_BASE = '/api/HumanResource';
const ACCOUNTS_API_BASE = '/api/accounts';
const E360_TAB_STORAGE_KEY = 'hr_employee_360_tab';
const E360_TABS = ['profile', 'attendance', 'leave', 'offboarding', 'accounts'];

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'leave', label: 'Leave' },
  { id: 'offboarding', label: 'Offboarding' },
  { id: 'accounts', label: 'Accounts', feature: 'hr_employee_accounts' },
];

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function leaveStatusClass(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'approved') return 'e360-leave-status--approved';
  if (s === 'rejected') return 'e360-leave-status--rejected';
  if (s === 'pending') return 'e360-leave-status--pending';
  return '';
}

function LeaveTab({ employee }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [showCompOffLedger, setShowCompOffLedger] = useState(false);

  const loadLeaveData = useCallback(async () => {
    setLoading(true);
    setHistoryLoading(true);
    setError('');
    setHistoryError('');
    try {
      const [balRes, histRes] = await Promise.all([
        fetch(`${HR_API_BASE}/leave-balance/${employee.id}`, { headers: getAuthHeaders() }),
        fetch(
          `${HR_API_BASE}/leave-updation/requests?admin_id=${employee.id}&request_type=all&status=all`,
          { headers: getAuthHeaders() }
        ),
      ]);
      const balJson = await balRes.json().catch(() => ({}));
      const histJson = await histRes.json().catch(() => ({}));

      if (balRes.ok && balJson.success) setData(balJson);
      else setError(balJson.message || 'Failed to load leave balance');

      if (histRes.ok && histJson.success) setHistory(histJson.requests || []);
      else {
        setHistory([]);
        setHistoryError(histJson.message || 'Failed to load leave history');
      }
    } catch {
      setError('Network error');
      setHistoryError('Network error');
    } finally {
      setLoading(false);
      setHistoryLoading(false);
    }
  }, [employee.id]);

  useEffect(() => {
    loadLeaveData();
  }, [loadLeaveData]);

  useEffect(() => {
    setShowCompOffLedger(false);
  }, [employee?.id]);

  if (showCompOffLedger) {
    const employeeLabel =
      employee.name || employee.first_name || employee.emp_id || employee.email || `ID ${employee.id}`;
    return (
      <CompOffLedger
        employeeId={employee.id}
        employeeLabel={employeeLabel}
        embedded
        onBack={() => setShowCompOffLedger(false)}
      />
    );
  }

  if (loading) return <p className="e360-loading">Loading leave balance…</p>;
  if (error) return <p className="e360-error">{error}</p>;
  const bal = data?.leave_balance || {};
  const employeeLabel = employee.first_name || employee.emp_id || `ID ${employee.id}`;
  return (
    <div className="e360-leave">
      <div className="e360-leave-grid">
        <div className="e360-stat"><span>Privilege Leave</span><strong>{bal.privilege_leave_balance ?? '—'}</strong></div>
        <div className="e360-stat"><span>Casual Leave</span><strong>{bal.casual_leave_balance ?? '—'}</strong></div>
        <button
          type="button"
          className="e360-stat e360-stat--clickable"
          onClick={() => setShowCompOffLedger(true)}
          aria-label="Open Comp Off details"
        >
          <span>Comp Off</span>
          <strong>{bal.compensatory_leave_balance ?? '—'}</strong>
          <em className="e360-stat__hint">Tap for details</em>
        </button>
      </div>

      <HRApplyLeaveOnBehalf
        adminId={employee.id}
        employeeLabel={employeeLabel}
        onSuccess={loadLeaveData}
      />

      <section className="e360-leave-history" aria-label="Leave history">
        <div className="e360-leave-history__head">
          <h3>Leave history</h3>
          {!historyLoading && history.length > 0 ? (
            <span className="e360-leave-history__count">{history.length} request{history.length === 1 ? '' : 's'}</span>
          ) : null}
        </div>

        {historyLoading ? (
          <p className="e360-loading">Loading leave history…</p>
        ) : historyError ? (
          <p className="e360-error">{historyError}</p>
        ) : history.length === 0 ? (
          <p className="e360-muted">No leave or WFH requests found for this employee.</p>
        ) : (
          <div className="e360-leave-table-wrap">
            <table className="e360-leave-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Days</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.row_key || `${row.request_type}-${row.id}`}>
                    <td>
                      <span className="e360-leave-type">
                        {row.leave_type || (row.request_type === 'wfh' ? 'Work From Home' : 'Leave')}
                      </span>
                    </td>
                    <td>{formatDateDDMMYYYY(row.start_date, '—')}</td>
                    <td>{formatDateDDMMYYYY(row.end_date, '—')}</td>
                    <td>
                      {row.deducted_days != null && row.deducted_days !== ''
                        ? row.deducted_days
                        : '—'}
                    </td>
                    <td>
                      <span className={`e360-leave-status ${leaveStatusClass(row.status)}`}>
                        {row.status || '—'}
                      </span>
                    </td>
                    <td className="e360-leave-reason" title={row.reason || ''}>
                      {row.reason?.trim() ? row.reason : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
  onTabChange,
  ProfileView,
  AttendanceView,
  AccountsView,
}) => {
  const visibleTabs = useMemo(
    () => TABS.filter((t) => !t.feature || hasFeature(t.feature)),
    []
  );
  const visibleIds = useMemo(() => visibleTabs.map((t) => t.id), [visibleTabs]);
  const defaultTab = visibleIds.includes(initialTab) ? initialTab : 'profile';

  const [activeTab, setActiveTab] = usePersistedView({
    storageKey: E360_TAB_STORAGE_KEY,
    defaultView: defaultTab,
    validViews: E360_TABS,
    searchParamName: 'tab',
  });

  const prevEmployeeIdRef = useRef(null);

  // When switching to a different employee, open the requested tab; otherwise keep URL/storage tab on refresh
  useEffect(() => {
    if (!employee?.id) return;
    const prevId = prevEmployeeIdRef.current;
    const switchedEmployee = prevId != null && prevId !== employee.id;
    prevEmployeeIdRef.current = employee.id;

    if (switchedEmployee && visibleIds.includes(initialTab)) {
      setActiveTab(initialTab);
      return;
    }
    if (!visibleIds.includes(activeTab)) {
      setActiveTab(visibleIds[0] || 'profile');
    }
  }, [employee?.id, initialTab, visibleIds, activeTab, setActiveTab]);

  useEffect(() => {
    if (typeof onTabChange === 'function' && activeTab) {
      onTabChange(activeTab);
    }
  }, [activeTab, onTabChange]);

  useEffect(() => {
    scrollAppToTop();
    const raf = requestAnimationFrame(() => scrollAppToTop());
    const t = window.setTimeout(() => scrollAppToTop(), 50);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [employee?.id]);

  const noopBack = () => {};

  return (
    <div className="e360-page">
      <button type="button" className="e360-back" onClick={onBack}>
        <ArrowLeft size={16} strokeWidth={2.25} aria-hidden />
        <span>Back to Search</span>
      </button>

      <header className="e360-hero">
        <div className="e360-hero__avatar" aria-hidden>
          <User size={28} strokeWidth={2} />
        </div>
        <div className="e360-hero__main">
          <h1>{employee.name}</h1>
          <p>
            {employee.emp_id ? <span className="e360-hero__id">{employee.emp_id}</span> : null}
            {employee.email}
            <span className="e360-hero__sep">•</span>
            {employee.circle} ({employee.type})
          </p>
        </div>
      </header>

      <div className="e360-tabs" role="tablist" aria-label="Employee sections">
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
