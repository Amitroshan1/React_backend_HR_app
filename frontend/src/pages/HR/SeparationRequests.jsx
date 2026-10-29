import { useCallback, useState } from 'react';
import { ArrowLeft, RefreshCw, Eye } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './offboarding-ui.css';

const HR_API_BASE = '/api/HumanResource';

const FILTERS = [
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'all', label: 'All' },
  { value: 'pending_manager', label: 'Pending manager' },
  { value: 'manager_approved', label: 'Manager approved' },
  { value: 'noc_pending', label: 'NOC pending' },
  { value: 'ready_for_admin', label: 'Ready for Admin' },
  { value: 'pending_admin', label: 'Pending Admin' },
  { value: 'manager_rejected', label: 'Manager rejected' },
  { value: 'exited', label: 'Exited' },
  { value: 'revoked', label: 'Revoked' },
];

const BUCKET_LABELS = {
  pending_manager: 'Pending manager',
  noc_pending: 'NOC pending',
  ready_for_admin: 'Ready for Admin',
  pending_admin: 'Pending Admin',
  manager_rejected: 'Manager rejected',
  exited: 'Exited',
  revoked: 'Revoked',
};

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function bucketPillClass(bucket) {
  if (bucket === 'ready_for_admin') return 'obx-pill--ok';
  if (bucket === 'pending_admin' || bucket === 'pending_manager') return 'obx-pill--warn';
  if (bucket === 'noc_pending') return 'obx-pill--bad';
  if (bucket === 'exited') return 'obx-pill--info';
  if (bucket === 'manager_rejected' || bucket === 'revoked') return 'obx-pill--bad';
  return '';
}

/**
 * HR list of separation requests with filters.
 * onOpenDetail(resignationId) opens the detail page.
 */
export default function SeparationRequests({ onBack, onOpenDetail, embedded = false }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [filter, setFilter] = useState('needs_attention');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (status = filter) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${HR_API_BASE}/separations?status=${encodeURIComponent(status)}`,
        { headers: authHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(
          data.message ||
            (res.status === 404
              ? 'Separations API not found — restart the backend server.'
              : `Failed to load separations (${res.status || 'network'})`)
        );
      }
      setRows(data.separations || []);
      setSummary(data.summary || {});
    } catch (err) {
      setError(err.message || 'Failed to load separations');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useRefreshOnNavigate(() => {
    load(filter);
  });

  const handleFilter = async (value) => {
    setFilter(value);
    await load(value);
  };

  return (
    <section className={embedded ? 'obx-sep-embed' : 'obx'}>
      {!embedded ? (
        <header className="obx-head">
          <div>
            <button type="button" className="obx-back" onClick={onBack}>
              <ArrowLeft size={16} />
              Back
            </button>
            <h1>Separation requests</h1>
            <p>Review resignations, NOC clearances, and submit ready exits to Admin.</p>
          </div>
          <div className="obx-actions">
            <button type="button" className="obx-btn" onClick={() => load(filter)} disabled={loading}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </header>
      ) : (
        <div className="obx-sep-embed-toolbar">
          <button type="button" className="obx-btn" onClick={() => load(filter)} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      )}

      <div className="obx-sep-summary">
        <span>Attention: {summary.needs_attention ?? 0}</span>
        <span>Ready for Admin: {summary.ready_for_admin ?? 0}</span>
        <span>NOC pending: {summary.noc_pending ?? 0}</span>
        <span>Pending manager: {summary.pending_manager ?? 0}</span>
      </div>

      <div className="obx-sep-filters" role="tablist" aria-label="Separation filters">
        {FILTERS.map((f) => {
          const count = summary[f.value];
          return (
            <button
              key={f.value}
              type="button"
              className={filter === f.value ? 'is-active' : ''}
              onClick={() => handleFilter(f.value)}
            >
              {f.label}
              {typeof count === 'number' && count > 0 ? (
                <em className={f.value === 'needs_attention' || f.value === 'ready_for_admin' ? 'is-hot' : ''}>
                  {count}
                </em>
              ) : null}
            </button>
          );
        })}
      </div>

      {error ? <p className="obx-alert" role="alert">{error}</p> : null}

      {loading ? (
        <p className="obx-loading">Loading separations…</p>
      ) : (
        <div className="obx-table-wrap">
          <table className="obx-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Resignation date</th>
                <th>Manager</th>
                <th>NOC</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan="6" className="obx-empty">
                    No separation requests for this filter.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.resignation_id}>
                    <td>
                      <strong>{row.employee_name}</strong>
                      <span className="obx-sub">
                        {row.emp_id || '—'} · {row.employee_email || '—'}
                      </span>
                    </td>
                    <td>{formatDateDDMMYYYY(row.resignation_date)}</td>
                    <td>{row.manager_status || '—'}</td>
                    <td>
                      {row.noc_applied === false
                        ? 'Not applied'
                        : row.noc_total > 0
                          ? `${row.noc_uploaded}/${row.noc_total}`
                          : '—'}
                    </td>
                    <td>
                      <span className={`obx-pill ${bucketPillClass(row.bucket)}`}>
                        {BUCKET_LABELS[row.bucket] || row.bucket}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="obx-btn obx-btn--primary"
                        onClick={() => onOpenDetail?.(row.resignation_id)}
                      >
                        <Eye size={14} /> View details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
