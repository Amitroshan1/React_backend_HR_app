import React, { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, Inbox, RefreshCw } from 'lucide-react';
import './ConfirmationRequest.css';

const HR_API_BASE = '/api/HumanResource';

export const ConfirmationRequest = ({ onBack }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/confirmation-requests`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRequests(data.requests || []);
      } else {
        setError(data.message || 'Failed to load confirmation requests');
        setRequests([]);
      }
    } catch {
      setError('Network error. Please try again.');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  return (
    <div className="conf-request-wrapper">
      <div className="conf-request-container">
        <button className="btn-back-tab" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="conf-request-card">
          <div className="conf-request-header">
            <h3>
              <span className="building-emoji">🏢</span> HR Employee Confirmation Requests
            </h3>
            <button
              className="btn-refresh"
              onClick={fetchRequests}
              disabled={loading}
            >
              <RefreshCw size={18} /> Refresh
            </button>
          </div>

          {loading ? (
            <p className="conf-loading">Loading...</p>
          ) : error ? (
            <p className="conf-error">{error}</p>
          ) : requests.length === 0 ? (
            <div className="empty-state-container">
              <p>No HR confirmation requests found.</p>
              <p className="conf-subtext">Employees who joined in the last 6 months will appear here.</p>
            </div>
          ) : (
            <div className="conf-table-section">
              <table className="conf-request-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Employee ID</th>
                    <th>Email</th>
                    <th>DOJ</th>
                    <th>Circle</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name || 'N/A'}</td>
                      <td>{r.emp_id || 'N/A'}</td>
                      <td>{r.email || 'N/A'}</td>
                      <td>{r.doj || 'N/A'}</td>
                      <td>{r.circle || 'N/A'}</td>
                      <td>{r.emp_type || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
