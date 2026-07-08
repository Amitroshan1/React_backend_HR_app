import React, { useCallback, useState } from 'react';
import { ArrowLeft, Inbox, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './HRInbox.css';

const HR_API_BASE = '/api/HumanResource';

const TYPE_LABELS = {
  probation: 'Probation',
  noc: 'NOC',
  exit: 'Separation',
  leave: 'Leave / WFH',
  salary_revision: 'Salary revision',
};

const INBOX_FILTERS = [
  { summaryKey: 'probation', filter: 'probation', label: 'Probation', chipClass: 'probation' },
  { summaryKey: 'noc_pending', filter: 'noc', label: 'NOC', chipClass: 'noc' },
  { summaryKey: 'exit_pipeline', filter: 'exit', label: 'Separations', chipClass: 'exit' },
  { summaryKey: 'leave_pending', filter: 'leave', label: 'Leave', chipClass: 'leave' },
  { summaryKey: 'salary_revision', filter: 'salary_revision', label: 'Salary rev.', chipClass: 'salary_revision' },
];

export const HRInbox = ({ onBack, onNavigate }) => {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/inbox`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok && data.success) {
        setItems(data.items || []);
        setSummary(data.summary || {});
      } else {
        setError(data.message || 'Failed to load inbox');
        setItems([]);
      }
    } catch {
      setError('Network error. Please try again.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useRefreshOnNavigate(() => {
    fetchInbox();
  });

  const filtered = filter === 'all' ? items : items.filter((i) => i.type === filter);

  const handleOpen = (item) => {
    if (typeof onNavigate !== 'function' || !item.deep_link_view) return;
    if (item.deep_link_view === 'employee_360' && item.admin_id) {
      onNavigate('employee_360', {
        employee: {
          id: item.admin_id,
          name: item.employee_name || 'Employee',
          emp_id: item.emp_id || '',
          email: item.employee_email || '',
          circle: item.circle || '',
          type: item.emp_type || '',
        },
        tab: item.deep_link_employee_tab || 'profile',
      });
      return;
    }
    onNavigate(item.deep_link_view, item.deep_link_filters ? { leaveContext: item.deep_link_filters } : undefined);
  };

  const handleOpenEmployee360 = (item) => {
    if (!item.admin_id || typeof onNavigate !== 'function') return;
    onNavigate('employee_360', {
      employee: {
        id: item.admin_id,
        name: item.employee_name || 'Employee',
        emp_id: item.emp_id || '',
        email: item.employee_email || '',
        circle: item.circle || '',
        type: item.emp_type || '',
      },
      tab: item.deep_link_employee_tab || 'profile',
    });
  };

  return (
    <div className="hr-inbox-page">
      <button type="button" className="btn-back-updates" onClick={onBack}>
        <ArrowLeft size={16} /> Back
      </button>

      <header className="hr-inbox-hero">
        <div>
          <p className="hr-inbox-hero__eyebrow"><Inbox size={14} aria-hidden /> Unified queue</p>
          <h2>HR Inbox</h2>
          <p>Pending probation decisions, NOC clearances, separations, leave, and salary revisions.</p>
        </div>
        <div className="hr-inbox-hero__actions">
          <span className="hr-inbox-total-pill">
            <strong>{summary.total ?? 0}</strong> open items
          </span>
          <button type="button" className="hr-inbox-refresh" onClick={fetchInbox} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </header>

      <div className="hr-inbox-filters-panel">
        <p className="hr-inbox-filters-label">Filter by category</p>
        <div className="hr-inbox-summary">
          {INBOX_FILTERS.map(({ summaryKey, filter: filterKey, label, chipClass }) => (
            <button
              key={summaryKey}
              type="button"
              className={`hr-inbox-chip hr-inbox-chip--${chipClass}${filter === filterKey ? ' is-active' : ''}`}
              onClick={() => setFilter((prev) => (prev === filterKey ? 'all' : filterKey))}
            >
              <span className="hr-inbox-chip__count">{summary[summaryKey] ?? 0}</span>
              <span className="hr-inbox-chip__label">{label}</span>
            </button>
          ))}
          <button
            type="button"
            className={`hr-inbox-chip hr-inbox-chip--total${filter === 'all' ? ' is-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            <span className="hr-inbox-chip__count">{summary.total ?? 0}</span>
            <span className="hr-inbox-chip__label">All items</span>
          </button>
        </div>
      </div>

      <div className="hr-inbox-content">
      {loading ? <p className="hr-inbox-loading">Loading inbox…</p> : null}
      {error ? <p className="hr-inbox-error"><AlertCircle size={18} /> {error}</p> : null}

      {!loading && !error && filtered.length === 0 ? (
        <div className="hr-inbox-empty">
          <div className="hr-inbox-empty__icon">
            <CheckCircle2 size={36} strokeWidth={1.75} />
          </div>
          <h3>All caught up</h3>
          <p>
            {filter === 'all'
              ? 'No pending HR actions right now. New items will appear here as employees submit requests.'
              : 'No pending items in this category. Try another filter or check back later.'}
          </p>
        </div>
      ) : null}

      {!loading && filtered.length > 0 ? (
        <div className="hr-inbox-table-wrap">
          <table className="hr-inbox-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Employee</th>
                <th>Details</th>
                <th>Due</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className={item.priority === 'high' ? 'hr-inbox-row--high' : ''}>
                  <td><span className={`hr-inbox-type hr-inbox-type--${item.type}`}>{TYPE_LABELS[item.type] || item.type}</span></td>
                  <td>
                    <div className="hr-inbox-emp">{item.employee_name || '—'}</div>
                    <div className="hr-inbox-emp-meta">{item.emp_id || ''}</div>
                  </td>
                  <td>
                    <div>{item.title}</div>
                    <div className="hr-inbox-sub">{item.subtitle}</div>
                  </td>
                  <td>{formatDateDDMMYYYY(item.due_at, '—')}</td>
                  <td>
                    <div className="hr-inbox-actions">
                      <button type="button" className="hr-inbox-open-btn" onClick={() => handleOpen(item)}>
                        Open
                      </button>
                      {item.admin_id && item.deep_link_view !== 'employee_360' ? (
                        <button type="button" className="hr-inbox-360-btn" onClick={() => handleOpenEmployee360(item)}>
                          360°
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      </div>
    </div>
  );
};

export default HRInbox;
