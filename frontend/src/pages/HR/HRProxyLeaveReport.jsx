import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { formatDate, formatDateTimeDDMMYYYY } from '../../utils/dateFormat';
import './HRProxyLeaveReport.css';

const API_BASE = '/api/HumanResource';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export function HRProxyLeaveReport({ onBack, empTypeOptions = [], circleOptions = [] }) {
  const [filters, setFilters] = useState({ emp_type: '', circle: '', from_date: '', to_date: '' });
  const [summary, setSummary] = useState({ total: 0, approved: 0, pending: 0 });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filters.emp_type) params.set('emp_type', filters.emp_type);
      if (filters.circle) params.set('circle', filters.circle);
      if (filters.from_date) params.set('from_date', filters.from_date);
      if (filters.to_date) params.set('to_date', filters.to_date);
      const res = await fetch(`${API_BASE}/leave-updation/proxy-report?${params}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load report');
      setSummary(data.summary || { total: 0, approved: 0, pending: 0 });
      setRows(data.rows || []);
    } catch (err) {
      setRows([]);
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [filters.emp_type, filters.circle, filters.from_date, filters.to_date]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  return (
    <div className="hr-proxy-page">
      <button type="button" className="hr-proxy-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Updates
      </button>
      <div className="hr-proxy-header">
        <h2>Proxy Leave Report</h2>
        <p>Leaves applied on behalf of employees by HR or managers.</p>
      </div>

      <div className="hr-proxy-filters">
        <label>From<input type="date" value={filters.from_date} onChange={(e) => setFilters((p) => ({ ...p, from_date: e.target.value }))} /></label>
        <label>To<input type="date" value={filters.to_date} onChange={(e) => setFilters((p) => ({ ...p, to_date: e.target.value }))} /></label>
        <label>
          Type
          <select value={filters.emp_type} onChange={(e) => setFilters((p) => ({ ...p, emp_type: e.target.value }))}>
            <option value="">All</option>
            {empTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Circle
          <select value={filters.circle} onChange={(e) => setFilters((p) => ({ ...p, circle: e.target.value }))}>
            <option value="">All</option>
            {circleOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button type="button" onClick={fetchReport} disabled={loading}>Run report</button>
      </div>

      <div className="hr-proxy-stats">
        <span>Total: {summary.total}</span>
        <span>Approved: {summary.approved}</span>
        <span>Pending: {summary.pending}</span>
      </div>

      {error ? <p className="hr-proxy-error">{error}</p> : null}
      {loading ? <p>Loading…</p> : rows.length === 0 ? (
        <p className="hr-proxy-muted">No proxy leave records found.</p>
      ) : (
        <div className="hr-proxy-table-wrap">
          <table className="hr-proxy-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Applied by</th>
                <th>Leave</th>
                <th>Period</th>
                <th>Status</th>
                <th>Paid</th>
                <th>LWP</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.row_key || row.id}>
                  <td>{row.employee_name || '—'}<br /><small>{row.emp_id}</small></td>
                  <td>{row.applied_by_name || row.applied_by_email || '—'}</td>
                  <td>{row.leave_type}</td>
                  <td>{formatDate(row.start_date)} – {formatDate(row.end_date)}</td>
                  <td>{row.status}</td>
                  <td>{row.deducted_days ?? '—'}</td>
                  <td>{row.extra_days ?? '—'}</td>
                  <td>{formatDateTimeDDMMYYYY(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
