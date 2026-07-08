import React, { useState, useCallback } from 'react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { ArrowLeft, UserCheck, RefreshCw, ExternalLink } from 'lucide-react';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './ConfirmationRequest.css';
import './HrUpdatesShared.css';

const HR_API_BASE = '/api/HumanResource';

export const ConfirmationRequest = ({ onBack, onNavigate }) => {
  const [reviews, setReviews] = useState([]);
  const [summary, setSummary] = useState({});
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
      const res = await fetch(`${HR_API_BASE}/probation-reviews?status=awaiting_hr`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setReviews(data.reviews || []);
        setSummary(data.summary || {});
      } else {
        setError(data.message || 'Failed to load confirmation queue');
        setReviews([]);
      }
    } catch {
      setError('Network error. Please try again.');
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useRefreshOnNavigate(() => {
    fetchRequests();
  });

  return (
    <div className="conf-request-wrapper">
      <div className="conf-request-container">
        <button type="button" className="btn-back-tab" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="conf-request-card">
          <div className="conf-request-header">
            <h3>
              <UserCheck size={20} /> Probation Confirmation Queue
            </h3>
            <button
              className="btn-refresh"
              onClick={fetchRequests}
              disabled={loading}
            >
              <RefreshCw size={18} /> Refresh
            </button>
          </div>

          <p className="conf-subtext" style={{ marginBottom: 16 }}>
            Employees with manager feedback awaiting HR confirmation decision.
            {summary.awaiting_hr != null ? ` (${summary.awaiting_hr} pending)` : ''}
            {' '}
            <button
              type="button"
              className="conf-open-reviews"
              onClick={() => typeof onNavigate === 'function' && onNavigate('probation_reviews')}
            >
              <ExternalLink size={14} /> Open full Probation Reviews
            </button>
          </p>

          {loading ? (
            <p className="conf-loading">Loading...</p>
          ) : error ? (
            <p className="conf-error">{error}</p>
          ) : reviews.length === 0 ? (
            <div className="empty-state-container">
              <p>No probation decisions pending HR action.</p>
              <p className="conf-subtext">Use Probation Reviews for the full queue.</p>
            </div>
          ) : (
            <div className="conf-table-section">
              <table className="conf-request-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Employee ID</th>
                    <th>Circle</th>
                    <th>Probation ends</th>
                    <th>Manager rating</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.id}>
                      <td>{r.employee_name || 'N/A'}</td>
                      <td>{r.emp_id || 'N/A'}</td>
                      <td>{r.circle || 'N/A'}</td>
                      <td>{formatDateDDMMYYYY(r.probation_end_date, 'N/A')}</td>
                      <td>{r.rating != null ? r.rating : '—'}</td>
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
