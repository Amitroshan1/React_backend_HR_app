import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './AdminList.css';

const API = '/api/admin/claims';

const AdminClaims = () => {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('All');

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    const params = status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : '';
    fetch(`${API}${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        setRequests(data.success && data.requests ? data.requests : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status]);

  return (
    <div className="admin-list-container">
      <div className="admin-list-header">
        <button type="button" className="back-button" onClick={() => navigate('/admin')}>
          ← Dashboard
        </button>
        <h1>All Expense Claims</h1>
      </div>
      <div className="admin-list-filters">
        <div className="status-buttons">
          {['All', 'Pending', 'Approved', 'Rejected', 'Partially Approved'].map((s) => (
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
                <th>Project</th>
                <th>From</th>
                <th>To</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.employee_name || r.employee_email || '—'}</td>
                  <td>{r.emp_id || '—'}</td>
                  <td>{r.circle || '—'}</td>
                  <td>{r.project_name || '—'}</td>
                  <td>{r.travel_from_date || '—'}</td>
                  <td>{r.travel_to_date || '—'}</td>
                  <td><span className={`status-badge ${(r.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{r.status || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!loading && requests.length === 0 && (
        <p className="admin-list-empty">No claims found.</p>
      )}
    </div>
  );
};

export default AdminClaims;
