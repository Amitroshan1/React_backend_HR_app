import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiInfo } from 'react-icons/fi';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDate } from '../../utils/dateFormat';
import './CompOffLedger.css';

const API_BASE_URL = '/api/leave';

const TABS = [
  { key: 'active', label: 'Active credits' },
  { key: 'applied', label: 'Applied' },
  { key: 'history', label: 'Usage history' },
  { key: 'expired', label: 'Expired' },
];

const STATUS_LABELS = {
  available: 'Available',
  expiring_soon: 'Expiring soon',
  partially_used: 'Partially used',
  used: 'Used',
  expired: 'Expired',
};

function formatDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function daysLeftLabel(daysRemaining, status) {
  if (status === 'expired') return 'Expired';
  if (status === 'used') return '—';
  if (daysRemaining == null) return '—';
  if (daysRemaining < 0) return 'Expired';
  if (daysRemaining === 0) return 'Expires today';
  if (daysRemaining === 1) return '1 day left';
  return `${daysRemaining} days left`;
}

function formatConsumed(slices) {
  if (!Array.isArray(slices) || !slices.length) return '—';
  return slices
    .map((s) => `${formatDays(s.days)} from ${formatDate(s.gain_date)} (exp. ${formatDate(s.expiry_date)})`)
    .join('; ');
}

function formatWillUse(row) {
  const text = formatConsumed(row?.will_use);
  if (text !== '—') return text;
  if (row?.warning) return row.warning;
  if (Number(row?.shortfall) > 0) {
    return `No matching Comp Off credit (short by ${formatDays(row.shortfall)} day(s))`;
  }
  return 'No matching Comp Off credit found';
}

export const CompOffLedger = ({
  employeeId = null,
  employeeLabel = '',
  onBack = null,
  embedded = false,
} = {}) => {
  const navigate = useNavigate();
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('active');

  const isHrView = employeeId != null;

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
      return;
    }
    navigate('/leaves');
  };

  const loadLedger = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const url = isHrView
        ? `/api/HumanResource/employees/${employeeId}/compoff/ledger`
        : `${API_BASE_URL}/compoff/ledger`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to load Comp Off details');
      }
      setLedger(data.ledger || null);
    } catch (e) {
      setLedger(null);
      setError(e.message || 'Failed to load Comp Off details');
    } finally {
      setLoading(false);
    }
  }, [employeeId, isHrView]);

  useRefreshOnNavigate(loadLedger);

  const activeCredits = useMemo(() => {
    const rows = ledger?.credits || [];
    return rows.filter((c) => ['available', 'expiring_soon', 'partially_used'].includes(c.status));
  }, [ledger]);

  const usedCredits = useMemo(() => {
    const rows = ledger?.credits || [];
    return rows.filter((c) => c.status === 'used');
  }, [ledger]);

  const expiredCredits = useMemo(() => {
    const rows = ledger?.credits || [];
    return rows.filter((c) => c.status === 'expired');
  }, [ledger]);

  const pendingApps = ledger?.pending_applications || [];
  const usageHistory = ledger?.usage_history || [];

  const tabCounts = useMemo(
    () => ({
      active: activeCredits.length,
      applied: pendingApps.length,
      history: usageHistory.length,
      expired: expiredCredits.length,
    }),
    [activeCredits.length, pendingApps.length, usageHistory.length, expiredCredits.length]
  );

  const renderActivePanel = () => {
    if (activeCredits.length === 0) {
      return <p className="compoff-muted">No active Comp Off credits right now.</p>;
    }
    return (
      <div className="compoff-table-wrap">
        <table className="compoff-table">
          <thead>
            <tr>
              <th>Earned on</th>
              <th>Expires on</th>
              <th>Time left</th>
              <th>Available</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {activeCredits.map((c) => (
              <tr key={c.id}>
                <td>{formatDate(c.gain_date)}</td>
                <td>{formatDate(c.expiry_date)}</td>
                <td>{daysLeftLabel(c.days_remaining, c.status)}</td>
                <td>{formatDays(c.available)}</td>
                <td>
                  <span className={`compoff-badge compoff-badge--${c.status}`}>
                    {STATUS_LABELS[c.status] || c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderAppliedPanel = () => {
    if (pendingApps.length === 0) {
      return <p className="compoff-muted">No pending Comp Off applications.</p>;
    }
    return (
      <>
        <div className="compoff-table-wrap">
          <table className="compoff-table">
            <thead>
              <tr>
                <th>Leave dates</th>
                <th>Days</th>
                <th>Status</th>
                <th>Will use (after approval)</th>
              </tr>
            </thead>
            <tbody>
              {pendingApps.map((row) => {
                const willUseText = formatWillUse(row);
                const hasWarning = Boolean(row.warning) || row.approval_ok === false;
                return (
                  <tr key={row.leave_id}>
                    <td>
                      {formatDate(row.start_date)}
                      {row.end_date !== row.start_date ? ` – ${formatDate(row.end_date)}` : ''}
                    </td>
                    <td>{formatDays(row.days)}</td>
                    <td>
                      <span className="compoff-badge compoff-badge--applied">Applied</span>
                    </td>
                    <td className="compoff-cell-wrap">
                      <span
                        className={hasWarning ? 'compoff-will-use compoff-will-use--warn' : 'compoff-will-use'}
                        title={willUseText}
                      >
                        {willUseText}
                      </span>
                      {row.warning && formatConsumed(row.will_use) !== '—' ? (
                        <span className="compoff-will-use-note">{row.warning}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="compoff-note">
          Applied requests do not reduce your available balance until they are approved.
        </p>
      </>
    );
  };

  const renderHistoryPanel = () => {
    if (usageHistory.length === 0 && usedCredits.length === 0) {
      return <p className="compoff-muted">No approved Comp Off usage yet.</p>;
    }
    return (
      <>
        {usageHistory.length > 0 ? (
          <div className="compoff-table-wrap">
            <table className="compoff-table">
              <thead>
                <tr>
                  <th>Leave dates</th>
                  <th>Days</th>
                  <th>Status</th>
                  <th>Credit used</th>
                </tr>
              </thead>
              <tbody>
                {usageHistory.map((row) => (
                  <tr key={row.leave_id}>
                    <td>
                      {formatDate(row.start_date)}
                      {row.end_date !== row.start_date ? ` – ${formatDate(row.end_date)}` : ''}
                    </td>
                    <td>{formatDays(row.days)}</td>
                    <td>
                      <span className="compoff-badge compoff-badge--approved">Approved</span>
                    </td>
                    <td className="compoff-cell-wrap" title={formatConsumed(row.consumed_from)}>
                      {formatConsumed(row.consumed_from)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="compoff-muted">No approved leave usage recorded yet.</p>
        )}
        {usedCredits.length > 0 ? (
          <>
            <h3 className="compoff-panel-subtitle">Fully used credits</h3>
            <div className="compoff-table-wrap">
              <table className="compoff-table">
                <thead>
                  <tr>
                    <th>Earned on</th>
                    <th>Expires on</th>
                    <th>Used</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {usedCredits.map((c) => (
                    <tr key={c.id}>
                      <td>{formatDate(c.gain_date)}</td>
                      <td>{formatDate(c.expiry_date)}</td>
                      <td>{formatDays(c.used)}</td>
                      <td>
                        <span className="compoff-badge compoff-badge--used">Used</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </>
    );
  };

  const renderExpiredPanel = () => {
    if (expiredCredits.length === 0) {
      return <p className="compoff-muted">No expired Comp Off credits.</p>;
    }
    return (
      <div className="compoff-table-wrap">
        <table className="compoff-table">
          <thead>
            <tr>
              <th>Earned on</th>
              <th>Expired on</th>
              <th>Lost (unused)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {expiredCredits.map((c) => {
              const lost = Math.max(0, 1 - Number(c.used || 0));
              return (
                <tr key={c.id}>
                  <td>{formatDate(c.gain_date)}</td>
                  <td>{formatDate(c.expiry_date)}</td>
                  <td>{formatDays(lost)}</td>
                  <td>
                    <span className="compoff-badge compoff-badge--expired">Expired</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderPanel = () => {
    switch (activeTab) {
      case 'applied':
        return renderAppliedPanel();
      case 'history':
        return renderHistoryPanel();
      case 'expired':
        return renderExpiredPanel();
      case 'active':
      default:
        return renderActivePanel();
    }
  };

  const activeLabel = TABS.find((t) => t.key === activeTab)?.label || 'Details';

  return (
    <div className={`compoff-ledger-page${embedded ? ' compoff-ledger-page--embedded' : ''}`}>
      <button type="button" className="compoff-back-btn" onClick={handleBack}>
        <FiArrowLeft size={16} /> {isHrView ? 'Back to Leave' : 'Back to Leaves'}
      </button>

      <header className="compoff-ledger-header">
        <h1>Compensatory Leave (Comp Off)</h1>
        <p>
          {isHrView && employeeLabel
            ? `Comp Off ledger for ${employeeLabel}. `
            : ''}
          Each credit is earned for Sunday work and stays valid for 30 days. Credits are used
          oldest-first when a Comp Off leave is approved.
        </p>
      </header>

      {loading ? <p className="compoff-muted">Loading Comp Off details…</p> : null}
      {error ? <p className="compoff-error">{error}</p> : null}

      {!loading && !error && ledger ? (
        <>
          <section className="compoff-summary-grid" aria-label="Comp Off summary">
            <article className="compoff-summary-card">
              <span className="compoff-summary-label">Available now</span>
              <strong className="compoff-summary-value">{formatDays(ledger.available)}</strong>
            </article>
            <article className="compoff-summary-card compoff-summary-card--warn">
              <span className="compoff-summary-label">Expiring within 7 days</span>
              <strong className="compoff-summary-value">{formatDays(ledger.expiring_soon)}</strong>
            </article>
            <article className="compoff-summary-card">
              <span className="compoff-summary-label">Pending applications</span>
              <strong className="compoff-summary-value">{ledger.pending_count ?? 0}</strong>
            </article>
            <article className="compoff-summary-card">
              <span className="compoff-summary-label">Expired credits</span>
              <strong className="compoff-summary-value">{expiredCredits.length}</strong>
            </article>
          </section>

          {ledger.next_credit_to_use ? (
            <p className="compoff-next-hint">
              <FiInfo size={16} aria-hidden /> Next credit to use:{' '}
              <strong>earned {formatDate(ledger.next_credit_to_use.gain_date)}</strong>
              {' · '}expires {formatDate(ledger.next_credit_to_use.expiry_date)}
            </p>
          ) : null}

          <div className="compoff-rules">
            <h2>How Comp Off works</h2>
            <ul>
              <li>Earned when you work on Sundays (monthly cap applies).</li>
              <li>Each credit is valid for {ledger.rules?.validity_days ?? 30} days from the earned date.</li>
              <li>When you apply Comp Off, status shows as Applied — balance is not reduced yet.</li>
              <li>On approval, the oldest-expiring credit is used first (max {ledger.rules?.max_per_application ?? 2} days per request).</li>
              <li>In a month, only {ledger.rules?.max_applications_per_month ?? 2} Comp Off applications are allowed.</li>
            </ul>
          </div>

          <div className="compoff-tabs-wrap" role="tablist" aria-label="Comp Off sections">
            {TABS.map((tab) => {
              const count = tabCounts[tab.key] ?? 0;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`compoff-tab${isActive ? ' active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                  <span
                    className={`compoff-tab-badge${count > 0 ? ' has-pending' : ''}`}
                    aria-label={`${count} items`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <section className="compoff-section" role="tabpanel" aria-label={activeLabel}>
            <h2 className="compoff-panel-title">{activeLabel}</h2>
            {renderPanel()}
          </section>
        </>
      ) : null}
    </div>
  );
};

export default CompOffLedger;
