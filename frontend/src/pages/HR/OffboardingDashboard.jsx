import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Users, Calendar, LogOut, TrendingDown, FileText, Download, AlertTriangle, BarChart3 } from 'lucide-react';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './OffboardingDashboard.css';

const HR_API_BASE = '/api/HumanResource';

const statusClass = (status) => {
  const map = {
    initiated: 'ob-dash-status--initiated',
    notice: 'ob-dash-status--notice',
    clearance: 'ob-dash-status--clearance',
    ready: 'ob-dash-status--ready',
  };
  return map[status] || 'ob-dash-status--none';
};

const OffboardingDashboard = ({ onBack }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/offboarding/dashboard`, {
        headers: getAuthHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.message || 'Failed to load offboarding dashboard');
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError('Network error while loading dashboard');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const downloadRelievingLetter = async (adminId, empId) => {
    try {
      const res = await fetch(`${HR_API_BASE}/employees/${adminId}/relieving-letter/pdf`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || 'Could not download relieving letter');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relieving-letter-${empId || adminId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Download failed');
    }
  };

  const downloadExperienceLetter = async (adminId, empId) => {
    try {
      const res = await fetch(`${HR_API_BASE}/employees/${adminId}/experience-letter/pdf`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || 'Could not download experience letter');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `experience-letter-${empId || adminId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Download failed');
    }
  };

  const exportAnalytics = async (format) => {
    try {
      const res = await fetch(`${HR_API_BASE}/offboarding/analytics/export?format=${format}&months=12`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || `Could not export ${format.toUpperCase()}`);
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `offboarding-analytics-12m.${format === 'pdf' ? 'pdf' : 'csv'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Export failed');
    }
  };

  const summary = data?.summary || {};
  const analytics = data?.analytics || {};

  return (
    <div className="ob-dash-container">
      <div className="ob-dash-wrapper">
        <div className="ob-dash-header">
          <button type="button" className="ob-dash-back" onClick={onBack}>
            <ArrowLeft size={18} />
            <span>Back</span>
          </button>
          <div className="ob-dash-header-text">
            <h1 className="ob-dash-title">Offboarding Dashboard</h1>
            <p className="ob-dash-subtitle">Pipeline, LWD schedule, login grace, and attrition analytics</p>
          </div>
        </div>

        {error && <p className="ob-dash-error" role="alert">{error}</p>}

        {loading ? (
          <div className="ob-dash-loading">
            <div className="ob-dash-loading-spinner" aria-hidden />
            <span>Loading dashboard…</span>
          </div>
        ) : data && (
          <div className="ob-dash-body">
            <div className="ob-dash-cards">
              <div className="ob-dash-card ob-dash-card--pipeline">
                <div className="ob-dash-card__icon">
                  <Users size={22} strokeWidth={2.25} />
                </div>
                <div className="ob-dash-card__body">
                  <span className="ob-dash-card__value">{summary.in_pipeline || 0}</span>
                  <span className="ob-dash-card__label">In separation pipeline</span>
                </div>
              </div>
              <div className="ob-dash-card ob-dash-card--lwd">
                <div className="ob-dash-card__icon">
                  <Calendar size={22} strokeWidth={2.25} />
                </div>
                <div className="ob-dash-card__body">
                  <span className="ob-dash-card__value">{summary.lwd_this_week_count || 0}</span>
                  <span className="ob-dash-card__label">LWD this week</span>
                </div>
              </div>
              <div className="ob-dash-card ob-dash-card--grace">
                <div className="ob-dash-card__icon">
                  <LogOut size={22} strokeWidth={2.25} />
                </div>
                <div className="ob-dash-card__body">
                  <span className="ob-dash-card__value">{summary.login_grace_count || 0}</span>
                  <span className="ob-dash-card__label">Login grace (exited)</span>
                </div>
              </div>
              <div className="ob-dash-card ob-dash-card--exits">
                <div className="ob-dash-card__icon">
                  <TrendingDown size={22} strokeWidth={2.25} />
                </div>
                <div className="ob-dash-card__body">
                  <span className="ob-dash-card__value">{summary.exits_last_12_months || 0}</span>
                  <span className="ob-dash-card__label">Exits (12 months)</span>
                </div>
              </div>
              <div className={`ob-dash-card ob-dash-card--sla${(summary.noc_sla_overdue_count || 0) > 0 ? ' ob-dash-card--alert' : ''}`}>
                <div className="ob-dash-card__icon">
                  <AlertTriangle size={22} strokeWidth={2.25} />
                </div>
                <div className="ob-dash-card__body">
                  <span className="ob-dash-card__value">{summary.noc_sla_overdue_count || 0}</span>
                  <span className="ob-dash-card__label">NOC SLA overdue</span>
                </div>
              </div>
            </div>

            {(data.sla?.noc_overdue || []).length > 0 && (
              <section className="ob-dash-panel ob-dash-panel--full ob-dash-sla-panel">
                <h2>NOC SLA alerts ({data.sla?.noc_pending_days_threshold}+ days pending)</h2>
                <ul className="ob-dash-sla-list">
                  {data.sla.noc_overdue.map((row) => (
                    <li key={row.noc_id}>
                      <strong>{row.employee_name}</strong>
                      <span>{row.department_key} · {row.days_pending} days pending</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="ob-dash-grid">
              <section className="ob-dash-panel">
                <h2>Status breakdown</h2>
                <ul className="ob-dash-breakdown">
                  <li>
                    <span><i className="ob-dash-status-dot ob-dash-status-dot--initiated" aria-hidden />Submitted</span>
                    <strong>{summary.initiated || 0}</strong>
                  </li>
                  <li>
                    <span><i className="ob-dash-status-dot ob-dash-status-dot--notice" aria-hidden />Notice period</span>
                    <strong>{summary.notice || 0}</strong>
                  </li>
                  <li>
                    <span><i className="ob-dash-status-dot ob-dash-status-dot--clearance" aria-hidden />NOC clearance</span>
                    <strong>{summary.clearance || 0}</strong>
                  </li>
                  <li>
                    <span><i className="ob-dash-status-dot ob-dash-status-dot--ready" aria-hidden />Ready to exit</span>
                    <strong>{summary.ready || 0}</strong>
                  </li>
                </ul>
              </section>

              <section className="ob-dash-panel">
                <div className="ob-dash-panel-head">
                  <h2>Attrition analytics</h2>
                  <div className="ob-dash-export-actions">
                    <button type="button" className="ob-dash-export-btn" onClick={() => exportAnalytics('csv')}>
                      <Download size={14} />
                      CSV
                    </button>
                    <button type="button" className="ob-dash-export-btn" onClick={() => exportAnalytics('pdf')}>
                      <Download size={14} />
                      PDF
                    </button>
                  </div>
                </div>
                <p className="ob-dash-muted">
                  Avg notice shortfall: {analytics.avg_notice_shortfall_days || 0} days
                  {' · '}
                  {analytics.employees_with_notice_shortfall || 0} with shortfall
                </p>
                <div className="ob-dash-analytics-bars">
                  {(analytics.by_exit_type || []).length === 0 ? (
                    <div className="ob-dash-analytics-empty">
                      <BarChart3 size={28} strokeWidth={1.5} />
                      <span>No exit data for the selected period</span>
                    </div>
                  ) : (
                    (analytics.by_exit_type || []).slice(0, 5).map((row) => (
                      <div key={row.exit_type} className="ob-dash-bar-row">
                        <span>{row.exit_type}</span>
                        <div className="ob-dash-bar-track">
                          <div
                            className="ob-dash-bar-fill"
                            style={{
                              width: `${Math.min(100, (row.count / Math.max(analytics.total_exits || 1, 1)) * 100)}%`,
                            }}
                          />
                        </div>
                        <strong>{row.count}</strong>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>

            <section className="ob-dash-panel ob-dash-panel--full">
              <h2>Active separation pipeline</h2>
              <div className="ob-dash-table-wrap">
                <table className="ob-dash-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Circle</th>
                      <th>Status</th>
                      <th>NOC</th>
                      <th>F&F</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.pipeline || []).length === 0 ? (
                      <tr><td colSpan="5" className="ob-dash-empty">No employees in offboarding pipeline</td></tr>
                    ) : (
                      data.pipeline.map((row) => (
                        <tr key={row.admin_id}>
                          <td>
                            <div className="ob-dash-emp-cell">
                              <strong>{row.name}</strong>
                              <span>{row.emp_id} · {row.email}</span>
                            </div>
                          </td>
                          <td>{row.circle || '—'}</td>
                          <td>
                            <span className={`ob-dash-status ${statusClass(row.status)}`}>
                              {row.status_label}
                            </span>
                          </td>
                          <td>
                            {row.noc_summary?.total > 0
                              ? `${row.noc_summary.cleared}/${row.noc_summary.total}`
                              : '—'}
                          </td>
                          <td>{row.fnf_status || 'none'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="ob-dash-grid">
              <section className="ob-dash-panel">
                <h2>LWD this week</h2>
                <ul className="ob-dash-list">
                  {(data.lwd_this_week || []).length === 0 ? (
                    <li className="ob-dash-empty">No LWD scheduled this week</li>
                  ) : (
                    data.lwd_this_week.map((row) => (
                      <li key={`lwd-${row.admin_id}`}>
                        <strong>{row.name}</strong>
                        <span>{formatDateDDMMYYYY(row.last_working_day)}</span>
                        {row.is_exited && <em>Exited</em>}
                      </li>
                    ))
                  )}
                </ul>
              </section>

              <section className="ob-dash-panel">
                <h2>Login grace (exited, access until LWD)</h2>
                <ul className="ob-dash-list">
                  {(data.login_grace || []).length === 0 ? (
                    <li className="ob-dash-empty">No employees in login grace period</li>
                  ) : (
                    data.login_grace.map((row) => (
                      <li key={`grace-${row.admin_id}`} className="ob-dash-list-item--actions">
                        <div>
                          <strong>{row.name}</strong>
                          <span>Until {formatDateDDMMYYYY(row.login_until)} · F&F: {row.fnf_status}</span>
                        </div>
                        <div className="ob-dash-grace-actions">
                          <button
                            type="button"
                            className="ob-dash-link-btn"
                            onClick={() => downloadRelievingLetter(row.admin_id, row.emp_id)}
                          >
                            <FileText size={14} />
                            Relieving letter
                          </button>
                          <button
                            type="button"
                            className="ob-dash-link-btn"
                            onClick={() => downloadExperienceLetter(row.admin_id, row.emp_id)}
                          >
                            <FileText size={14} />
                            Experience letter
                          </button>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OffboardingDashboard;
