import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Calendar, LogOut, TrendingDown, FileText, Download, AlertTriangle, Archive } from 'lucide-react';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './offboarding-ui.css';

const HR_API_BASE = '/api/HumanResource';

const statusPill = (status) => {
  const map = {
    initiated: 'obx-pill--info',
    notice: 'obx-pill--warn',
    clearance: 'obx-pill--bad',
    ready: 'obx-pill--ok',
  };
  return map[status] || '';
};

function Kpi({ label, value, hint, icon: Icon, tone = 'ok' }) {
  return (
    <article className="obx-kpi">
      <div>
        <span className="obx-kpi-label">{label}</span>
        <span className="obx-kpi-value">{value}</span>
        <span className="obx-kpi-hint">{hint}</span>
      </div>
      <span className={`obx-kpi-icon obx-kpi-icon--${tone}`}>
        <Icon size={18} />
      </span>
    </article>
  );
}

const OffboardingDashboard = ({ onBack, onOpenExitEmployee }) => {
  const navigate = useNavigate();
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

  const exitTypes = (analytics.by_exit_type || []).slice(0, 5);
  const maxExits = Math.max(analytics.total_exits || 1, 1);

  return (
    <section className="obx">
      <header className="obx-head">
        <div>
          <button type="button" className="obx-back" onClick={onBack}>
            <ArrowLeft size={16} />
            Back
          </button>
          <h1>Offboarding</h1>
          <p>Separation pipeline, last working day, login grace, and attrition.</p>
        </div>
        <div className="obx-actions">
          <button type="button" className="obx-btn" onClick={() => navigate('/archive-employees')}>
            <Archive size={16} />
            Archive
          </button>
          {typeof onOpenExitEmployee === 'function' ? (
            <button type="button" className="obx-btn obx-btn--primary" onClick={onOpenExitEmployee}>
              <LogOut size={16} />
              Exit employee
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p className="obx-alert" role="alert">{error}</p> : null}

      {loading ? (
        <p className="obx-loading">Loading offboarding…</p>
      ) : data ? (
        <>
          <div className="obx-kpis">
            <Kpi label="In pipeline" value={summary.in_pipeline || 0} hint="Active separations" icon={Users} tone="info" />
            <Kpi label="LWD this week" value={summary.lwd_this_week_count || 0} hint="Last working days" icon={Calendar} />
            <Kpi label="Login grace" value={summary.login_grace_count || 0} hint="Exited, still signed in" icon={LogOut} tone="warn" />
            <Kpi label="Exits" value={summary.exits_last_12_months || 0} hint="Last 12 months" icon={TrendingDown} />
            <Kpi
              label="NOC overdue"
              value={summary.noc_sla_overdue_count || 0}
              hint="Past the SLA window"
              icon={AlertTriangle}
              tone={(summary.noc_sla_overdue_count || 0) > 0 ? 'bad' : 'ok'}
            />
          </div>

          {(data.sla?.noc_overdue || []).length > 0 ? (
            <section className="obx-panel">
              <div className="obx-panel-head">
                <h2>NOC alerts</h2>
                <span className="obx-muted">{data.sla?.noc_pending_days_threshold}+ days pending</span>
              </div>
              <ul className="obx-people">
                {data.sla.noc_overdue.map((row) => (
                  <li key={row.noc_id} className="obx-person">
                    <div>
                      <strong>{row.employee_name}</strong>
                      <span>{row.department_key}</span>
                    </div>
                    <em>{row.days_pending} days</em>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="obx-split">
            <section className="obx-panel">
              <div className="obx-panel-head"><h2>Status</h2></div>
              <ul className="obx-breakdown">
                <li><span><i className="obx-dot obx-dot--info" />Submitted</span><strong>{summary.initiated || 0}</strong></li>
                <li><span><i className="obx-dot obx-dot--warn" />Notice</span><strong>{summary.notice || 0}</strong></li>
                <li><span><i className="obx-dot obx-dot--bad" />NOC</span><strong>{summary.clearance || 0}</strong></li>
                <li><span><i className="obx-dot obx-dot--ok" />Ready</span><strong>{summary.ready || 0}</strong></li>
              </ul>
            </section>
            <section className="obx-panel">
              <div className="obx-panel-head">
                <h2>Attrition</h2>
                <div className="obx-actions">
                  <button type="button" className="obx-btn" onClick={() => exportAnalytics('csv')}><Download size={14} />CSV</button>
                  <button type="button" className="obx-btn" onClick={() => exportAnalytics('pdf')}><Download size={14} />PDF</button>
                </div>
              </div>
              <p className="obx-muted">
                Average notice shortfall {analytics.avg_notice_shortfall_days || 0} days · {analytics.employees_with_notice_shortfall || 0} people
              </p>
              {exitTypes.length === 0 ? (
                <p className="obx-empty">No exits in this period.</p>
              ) : exitTypes.map((row) => (
                <div key={row.exit_type} className="obx-bar">
                  <span>{row.exit_type}</span>
                  <div className="obx-bar-track">
                    <div className="obx-bar-fill" style={{ width: `${Math.min(100, (row.count / maxExits) * 100)}%` }} />
                  </div>
                  <strong>{row.count}</strong>
                </div>
              ))}
            </section>
          </div>

          <section className="obx-panel">
            <div className="obx-panel-head"><h2>Separation pipeline</h2></div>
            <div className="obx-table-wrap">
              <table className="obx-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Circle</th>
                    <th>Status</th>
                    <th>NOC</th>
                    <th>F&amp;F</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.pipeline || []).length === 0 ? (
                    <tr><td colSpan="5" className="obx-empty">No employees in the pipeline.</td></tr>
                  ) : data.pipeline.map((row) => (
                    <tr key={row.admin_id}>
                      <td>
                        <strong>{row.name}</strong>
                        <span className="obx-sub">{row.emp_id} · {row.email}</span>
                      </td>
                      <td>{row.circle || '—'}</td>
                      <td><span className={`obx-pill ${statusPill(row.status)}`}>{row.status_label}</span></td>
                      <td>{row.noc_summary?.total > 0 ? `${row.noc_summary.cleared}/${row.noc_summary.total}` : '—'}</td>
                      <td><span className="obx-pill">{row.fnf_status || 'none'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="obx-split">
            <section className="obx-panel">
              <div className="obx-panel-head"><h2>Last working day this week</h2></div>
              <ul className="obx-people">
                {(data.lwd_this_week || []).length === 0 ? (
                  <li className="obx-empty">Nothing scheduled this week.</li>
                ) : data.lwd_this_week.map((row) => (
                  <li key={`lwd-${row.admin_id}`} className="obx-person">
                    <div>
                      <strong>{row.name}</strong>
                      <span>{formatDateDDMMYYYY(row.last_working_day)}</span>
                    </div>
                    {row.is_exited ? <em>Exited</em> : null}
                  </li>
                ))}
              </ul>
            </section>
            <section className="obx-panel">
              <div className="obx-panel-head"><h2>Login still open</h2></div>
              <ul className="obx-people">
                {(data.login_grace || []).length === 0 ? (
                  <li className="obx-empty">No one is in a login grace period.</li>
                ) : data.login_grace.map((row) => (
                  <li key={`grace-${row.admin_id}`} className="obx-person">
                    <div>
                      <strong>{row.name}</strong>
                      <span>Until {formatDateDDMMYYYY(row.login_until)} · F&amp;F {row.fnf_status}</span>
                      <span className="obx-row-actions">
                        <button type="button" className="obx-link" onClick={() => downloadRelievingLetter(row.admin_id, row.emp_id)}>
                          <FileText size={14} /> Relieving letter
                        </button>
                        <button type="button" className="obx-link" onClick={() => downloadExperienceLetter(row.admin_id, row.emp_id)}>
                          <FileText size={14} /> Experience letter
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
};

export default OffboardingDashboard;
