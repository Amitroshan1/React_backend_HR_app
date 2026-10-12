import React, { useMemo, useState } from 'react';
import './AdminList.css';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDate } from '../../utils/dateFormat';
import { matchesListQuery } from './adminListQuery';

const API = '/api/admin/resignations';

const AdminResignations = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('All');
  const [query, setQuery] = useState('');

  useRefreshOnNavigate(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : '';
    fetch(`${API}${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        setRequests(data.success && data.requests ? data.requests : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status]);

  const visible = useMemo(
    () => requests.filter((row) => matchesListQuery(query, [
      row.employee_name,
      row.employee_email,
      row.emp_id,
      row.circle,
      row.reason,
    ])),
    [query, requests],
  );

  return (
    <div className="admin-list-container">
      <div className="admin-list-header">
        <div>
          <h1>Resignations</h1>
          <p className="admin-list-copy">Separation notices for this company.</p>
        </div>
      </div>
      <div className="admin-list-filters">
        <label className="admin-list-search">
          <span>Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, ID, circle, reason"
          />
        </label>
        <div className="status-buttons">
          {['All', 'Pending', 'Approved', 'Rejected'].map((s) => (
            <button
              key={s}
              type="button"
              className={`status-btn ${status === s ? 'active' : ''}`}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="admin-list-table-wrap">
        {loading ? (
          <p>Loading...</p>
        ) : (
          <table className="admin-list-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Emp ID</th>
                <th>Circle</th>
                <th>Resignation Date</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Applied On</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  <td>{r.employee_name || r.employee_email || '—'}</td>
                  <td>{r.emp_id || '—'}</td>
                  <td>{r.circle || '—'}</td>
                  <td>{formatDate(r.resignation_date)}</td>
                  <td className="cell-reason">{(r.reason || '—').slice(0, 80)}{(r.reason && r.reason.length > 80) ? '…' : ''}</td>
                  <td><span className={`status-badge ${(r.status || '').toLowerCase()}`}>{r.status || '—'}</span></td>
                  <td>{r.applied_on || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!loading && visible.length === 0 && (
        <p className="admin-list-empty">
          {requests.length === 0 ? 'No resignations found.' : 'No resignations match that search.'}
        </p>
      )}
    </div>
  );
};

export default AdminResignations;
