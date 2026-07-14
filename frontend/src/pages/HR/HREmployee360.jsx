import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, User, Package } from 'lucide-react';
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
const E360_TABS = ['profile', 'attendance', 'leave', 'offboarding', 'assets', 'accounts'];

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'leave', label: 'Leave' },
  { id: 'offboarding', label: 'Offboarding' },
  { id: 'assets', label: 'Assets' },
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

function defaultCompOffExpiryIso() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const BALANCE_LEAVE_TYPES = [
  { value: 'privilege', label: 'Privilege Leave (PL)', key: 'privilege_leave_balance' },
  { value: 'casual', label: 'Casual Leave (CL)', key: 'casual_leave_balance' },
  { value: 'compensatory', label: 'Compensatory Leave (Comp Off)', key: 'compensatory_leave_balance' },
];

function LeaveTab({ employee }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [showCompOffLedger, setShowCompOffLedger] = useState(false);
  const [showBalanceEdit, setShowBalanceEdit] = useState(false);
  const [balanceLeaveType, setBalanceLeaveType] = useState('privilege');
  const [balanceNewValue, setBalanceNewValue] = useState('');
  const [compOffExpiry, setCompOffExpiry] = useState(defaultCompOffExpiryIso());
  const [balanceSaving, setBalanceSaving] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const [balanceSuccess, setBalanceSuccess] = useState('');

  const syncBalanceEditorFromData = useCallback((leaveBalance) => {
    const lb = leaveBalance || {};
    const typeMeta = BALANCE_LEAVE_TYPES.find((t) => t.value === balanceLeaveType) || BALANCE_LEAVE_TYPES[0];
    setBalanceNewValue(String(lb[typeMeta.key] ?? '0'));
  }, [balanceLeaveType]);

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

      if (balRes.ok && balJson.success) {
        setData(balJson);
        const lb = balJson.leave_balance || {};
        const typeMeta = BALANCE_LEAVE_TYPES.find((t) => t.value === 'privilege');
        setBalanceNewValue(String(lb[typeMeta.key] ?? '0'));
      } else setError(balJson.message || 'Failed to load leave balance');

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
    setShowBalanceEdit(false);
    setBalanceLeaveType('privilege');
    setCompOffExpiry(defaultCompOffExpiryIso());
    setBalanceError('');
    setBalanceSuccess('');
  }, [employee?.id]);

  useEffect(() => {
    if (data?.leave_balance) syncBalanceEditorFromData(data.leave_balance);
  }, [balanceLeaveType, data?.leave_balance, syncBalanceEditorFromData]);

  const handleBalanceUpdate = async (e) => {
    e.preventDefault();
    setBalanceError('');
    setBalanceSuccess('');
    const typeMeta = BALANCE_LEAVE_TYPES.find((t) => t.value === balanceLeaveType);
    if (!typeMeta) return;

    const newVal = parseFloat(balanceNewValue);
    if (!Number.isFinite(newVal) || newVal < 0) {
      setBalanceError('Enter a valid balance (0 or more).');
      return;
    }

    const current = parseFloat(data?.leave_balance?.[typeMeta.key] ?? 0) || 0;
    const body = {};
    body[typeMeta.key] = newVal;

    if (balanceLeaveType === 'compensatory' && newVal > current + 1e-9) {
      if (!compOffExpiry) {
        setBalanceError('Select an expiry date for Comp Off credits being added.');
        return;
      }
      body.compensatory_leave_expiry = compOffExpiry;
    }

    setBalanceSaving(true);
    try {
      const res = await fetch(`${HR_API_BASE}/leave-balance/${employee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setBalanceError(json.message || 'Update failed');
        return;
      }
      const updated = json.leave_balance || {};
      setData((prev) => ({
        ...(prev || {}),
        leave_balance: { ...(prev?.leave_balance || {}), ...updated },
      }));
      setBalanceNewValue(String(updated[typeMeta.key] ?? newVal));
      setBalanceSuccess(`${typeMeta.label} updated successfully.`);
      if (balanceLeaveType === 'compensatory') {
        setCompOffExpiry(defaultCompOffExpiryIso());
      }
    } catch {
      setBalanceError('Network error. Please try again.');
    } finally {
      setBalanceSaving(false);
    }
  };

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
  const employeeLabel =
    employee.name || employee.first_name || employee.emp_id || `ID ${employee.id}`;
  const selectedTypeMeta = BALANCE_LEAVE_TYPES.find((t) => t.value === balanceLeaveType);
  const currentSelected = parseFloat(bal[selectedTypeMeta?.key] ?? 0) || 0;
  const newValNum = parseFloat(balanceNewValue);
  const isAddingCompOff =
    balanceLeaveType === 'compensatory' &&
    Number.isFinite(newValNum) &&
    newValNum > currentSelected + 1e-9;

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

      <section className="e360-leave-balance-edit" aria-label="Update leave balance">
        <div className="e360-leave-balance-edit__head">
          <div>
            <h3>Leave Balance for: {employeeLabel}</h3>
            <p className="e360-muted">Select a leave type below to update its balance</p>
          </div>
          <button
            type="button"
            className="e360-leave-balance-edit__toggle"
            onClick={() => {
              setShowBalanceEdit((v) => !v);
              setBalanceError('');
              setBalanceSuccess('');
              if (!showBalanceEdit) {
                syncBalanceEditorFromData(bal);
                setCompOffExpiry(defaultCompOffExpiryIso());
              }
            }}
          >
            {showBalanceEdit ? 'Hide' : 'Update balance'}
          </button>
        </div>

        {showBalanceEdit ? (
          <form className="e360-leave-balance-edit__form" onSubmit={handleBalanceUpdate}>
            {balanceSuccess ? <p className="e360-leave-balance-edit__success">{balanceSuccess}</p> : null}
            {balanceError ? <p className="e360-error">{balanceError}</p> : null}

            <div className="e360-leave-balance-edit__fields">
              <label>
                Leave type
                <select
                  value={balanceLeaveType}
                  onChange={(e) => {
                    setBalanceLeaveType(e.target.value);
                    setBalanceError('');
                    setBalanceSuccess('');
                  }}
                >
                  {BALANCE_LEAVE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>

              <label>
                New balance
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={balanceNewValue}
                  onChange={(e) => {
                    setBalanceNewValue(e.target.value);
                    setBalanceError('');
                    setBalanceSuccess('');
                  }}
                  required
                />
              </label>

              {balanceLeaveType === 'compensatory' ? (
                <label>
                  Comp Off expiry date
                  <input
                    type="date"
                    value={compOffExpiry}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => {
                      setCompOffExpiry(e.target.value);
                      setBalanceError('');
                      setBalanceSuccess('');
                    }}
                    required={isAddingCompOff}
                  />
                  <span className="e360-leave-balance-edit__hint">
                    {isAddingCompOff
                      ? 'Required when adding Comp Off — applies to newly credited day(s).'
                      : 'Used only when increasing Comp Off balance.'}
                  </span>
                </label>
              ) : null}
            </div>

            <p className="e360-leave-balance-edit__current">
              Current {selectedTypeMeta?.label}: <strong>{bal[selectedTypeMeta?.key] ?? '—'}</strong>
            </p>

            <div className="e360-leave-balance-edit__actions">
              <button type="submit" className="e360-leave-balance-edit__submit" disabled={balanceSaving}>
                {balanceSaving ? 'Updating…' : 'Update'}
              </button>
              <button
                type="button"
                className="e360-leave-balance-edit__cancel"
                onClick={() => {
                  setShowBalanceEdit(false);
                  setBalanceError('');
                  setBalanceSuccess('');
                  syncBalanceEditorFromData(bal);
                  setCompOffExpiry(defaultCompOffExpiryIso());
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

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

function assetImageUrl(path) {
  if (!path) return null;
  const clean = String(path).replace(/^\/+/, '');
  return `/static/uploads/${clean}`;
}

function AssetsTab({ employee }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${HR_API_BASE}/employee/${employee.id}/assets`, {
          headers: getAuthHeaders(),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && json.success) {
          setAssets(json.assets || []);
        } else {
          setAssets([]);
          setError(json.message || 'Failed to load assigned assets');
        }
      } catch {
        if (!cancelled) {
          setAssets([]);
          setError('Network error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id]);

  if (loading) return <p className="e360-loading">Loading assigned assets…</p>;
  if (error) return <p className="e360-muted">{error}</p>;

  const activeCount = assets.filter((a) => !a.return_date).length;

  return (
    <div className="e360-assets">
      <div className="e360-assets__head">
        <div>
          <h3>Assigned assets</h3>
          <p className="e360-muted">
            {assets.length === 0
              ? 'No company assets are recorded for this employee.'
              : `${activeCount} active • ${assets.length} total assigned`}
          </p>
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="e360-assets__empty">
          <Package size={28} aria-hidden />
          <p>No assets assigned yet.</p>
        </div>
      ) : (
        <div className="e360-assets__grid">
          {assets.map((asset) => {
            const isReturned = Boolean(asset.return_date);
            const images = Array.isArray(asset.images) ? asset.images.filter(Boolean) : [];
            return (
              <article key={asset.id} className="e360-asset-card">
                <div className="e360-asset-card__head">
                  <div className="e360-asset-card__icon" aria-hidden>
                    <Package size={18} />
                  </div>
                  <div className="e360-asset-card__title-wrap">
                    <h4>{asset.name || 'Asset'}</h4>
                    {asset.description ? <p>{asset.description}</p> : null}
                  </div>
                  <span className={`e360-asset-status${isReturned ? ' e360-asset-status--returned' : ''}`}>
                    {isReturned ? 'Returned' : 'Active'}
                  </span>
                </div>

                <div className="e360-asset-card__meta">
                  <div className="e360-row">
                    <span>Issued</span>
                    <strong>{formatDateDDMMYYYY(asset.issue_date, '—')}</strong>
                  </div>
                  <div className="e360-row">
                    <span>Return date</span>
                    <strong>{formatDateDDMMYYYY(asset.return_date, '—')}</strong>
                  </div>
                  {asset.remark ? (
                    <div className="e360-asset-card__remark">
                      <span>Remark</span>
                      <p>{asset.remark}</p>
                    </div>
                  ) : null}
                </div>

                {images.length > 0 ? (
                  <div className="e360-asset-card__images">
                    {images.map((img, idx) => {
                      const src = assetImageUrl(img);
                      if (!src) return null;
                      return (
                        <a
                          key={`${asset.id}-${idx}`}
                          href={src}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="e360-asset-card__thumb"
                        >
                          <img src={src} alt={`${asset.name || 'Asset'} ${idx + 1}`} />
                        </a>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <p className="e360-muted e360-hint">Read-only view of assets assigned to this employee.</p>
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
      <p className="e360-muted e360-hint">Read-only summary for HR. Payroll edits are handled in Accounts.</p>
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
        {activeTab === 'assets' ? <AssetsTab employee={employee} /> : null}
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
