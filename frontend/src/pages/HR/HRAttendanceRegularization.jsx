import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { formatDate, formatDateTimeDDMMYYYY } from '../../utils/dateFormat';
import './HRAttendanceRegularization.css';

const API_BASE = '/api/HumanResource';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export function HRAttendanceRegularization({ onBack, empTypeOptions = [], circleOptions = [] }) {
  const [filters, setFilters] = useState({ emp_type: '', circle: '', status: 'Pending' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [actingId, setActingId] = useState(null);
  const [comment, setComment] = useState('');

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status.toLowerCase());
      if (filters.emp_type) params.set('emp_type', filters.emp_type);
      if (filters.circle) params.set('circle', filters.circle);
      const res = await fetch(`${API_BASE}/leave-updation/regularizations?${params}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load');
      setRows(data.requests || []);
    } catch (err) {
      setRows([]);
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.emp_type, filters.circle]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleAction = async (id, action) => {
    setActingId(id);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`${API_BASE}/leave-updation/regularizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ action, hr_comment: comment }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Action failed');
      setSuccess(data.message || 'Updated');
      setComment('');
      await fetchRows();
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="hr-reg-page">
      <button type="button" className="hr-reg-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Updates
      </button>
      <div className="hr-reg-header">
        <h2>Attendance Regularization</h2>
        <p>Review employee requests to convert past absences into approved leave.</p>
      </div>

      <div className="hr-reg-filters">
        <label>
          Status
          <select value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Employee Type
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
        <button type="button" onClick={fetchRows} disabled={loading}>Refresh</button>
      </div>

      {error ? <p className="hr-reg-error">{error}</p> : null}
      {success ? <p className="hr-reg-success">{success}</p> : null}

      <label className="hr-reg-comment">
        HR comment (optional, used on approve/reject)
        <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment for employee" />
      </label>

      {loading ? <p>Loading…</p> : rows.length === 0 ? (
        <p className="hr-reg-muted">No regularization requests found.</p>
      ) : (
        <div className="hr-reg-table-wrap">
          <table className="hr-reg-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Period</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>{row.employee_name || '—'}</div>
                    <small>{row.emp_id || row.admin_id}</small>
                  </td>
                  <td>{row.leave_type}</td>
                  <td>{formatDate(row.start_date)} – {formatDate(row.end_date)}</td>
                  <td className="hr-reg-reason" title={row.reason}>{row.reason}</td>
                  <td>{row.status}</td>
                  <td>{formatDateTimeDDMMYYYY(row.created_at)}</td>
                  <td>
                    {row.status === 'Pending' ? (
                      <div className="hr-reg-actions">
                        <button type="button" disabled={actingId === row.id} onClick={() => handleAction(row.id, 'approve')}>Approve</button>
                        <button type="button" className="reject" disabled={actingId === row.id} onClick={() => handleAction(row.id, 'reject')}>Reject</button>
                      </div>
                    ) : (
                      <span className="hr-reg-muted">{row.hr_comment || '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
