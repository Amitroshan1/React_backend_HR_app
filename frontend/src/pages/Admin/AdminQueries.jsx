import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './AdminList.css';

const API = '/api/admin/queries';

const AdminQueries = () => {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('All');
  const [modalOpen, setModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState(null);

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

  const handleView = (queryId) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setDetailLoading(true);
    setDetailData(null);
    setModalOpen(true);
    fetch(`${API}/${queryId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success) {
          setDetailData({ query: data.query, chat_messages: data.chat_messages || [] });
        } else {
          setDetailData(null);
        }
        setDetailLoading(false);
      })
      .catch(() => {
        setDetailData(null);
        setDetailLoading(false);
      });
  };

  return (
    <div className="admin-list-container">
      <div className="admin-list-header">
        <button type="button" className="back-button" onClick={() => navigate('/admin')}>
          ← Dashboard
        </button>
        <h1>All Queries</h1>
      </div>
      <div className="admin-list-filters">
        <div className="status-buttons">
          {['All', 'New', 'Pending', 'Resolved', 'Closed'].map((s) => (
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
                <th>Department</th>
                <th>Title</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.employee_name || r.employee_email || '—'}</td>
                  <td>{r.emp_id || '—'}</td>
                  <td>{r.department || '—'}</td>
                  <td>{r.title || '—'}</td>
                  <td><span className={`status-badge ${(r.status || '').toLowerCase()}`}>{r.status || '—'}</span></td>
                  <td>
                    <button type="button" className="admin-list-view-btn" onClick={() => handleView(r.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!loading && requests.length === 0 && (
        <p className="admin-list-empty">No queries found.</p>
      )}

      {modalOpen && (
        <div className="admin-query-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="admin-query-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-query-modal-header">
              <h2>Query Details</h2>
              <button type="button" className="admin-query-modal-close" onClick={() => setModalOpen(false)}>×</button>
            </div>
            <div className="admin-query-modal-body">
              {detailLoading ? (
                <p>Loading...</p>
              ) : detailData ? (
                <>
                  <div className="admin-query-meta">
                    <p><strong>Title:</strong> {detailData.query.title || '—'}</p>
                    <p><strong>Department:</strong> {detailData.query.department || '—'}</p>
                    <p><strong>Status:</strong> <span className={`status-badge ${(detailData.query.status || '').toLowerCase()}`}>{detailData.query.status || '—'}</span></p>
                    <p><strong>Created:</strong> {detailData.query.created_at || '—'}</p>
                  </div>
                  <div className="admin-query-chat">
                    <h3>Conversation</h3>
                    {detailData.chat_messages.map((msg, idx) => (
                      <div key={idx} className={`admin-query-msg admin-query-msg-${(msg.user_type || '').toLowerCase()}`}>
                        <div className="admin-query-msg-meta">
                          {msg.by} · {msg.user_type} · {msg.created_at || '—'}
                        </div>
                        <div className="admin-query-msg-text">{msg.text}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p>Failed to load query details.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminQueries;
