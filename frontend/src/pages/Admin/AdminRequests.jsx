import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, MapPin } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import './AdminDashboard.css';

export default function AdminRequests() {
  const navigate = useNavigate();
  const [pendingCount, setPendingCount] = useState(0);

  const loadPending = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch('/api/admin/employee-change-requests?status=pending', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        const count = data.success ? Number(data.count ?? data.requests?.length ?? 0) : 0;
        setPendingCount(Number.isFinite(count) ? count : 0);
      })
      .catch(() => setPendingCount(0));
  }, []);

  useRefreshOnNavigate(loadPending);

  return (
    <section className="admin-dash">
      <button type="button" className="admin-dash__back" onClick={() => navigate('/admin')}>
        <ArrowLeft size={16} />
        Back to Dashboard
      </button>
      <header className="admin-dash__page-head">
        <h1>Request & Approval</h1>
        <p>Choose a setup area to manage.</p>
      </header>
      <div className="admin-dash__shortcuts">
        <button type="button" className="admin-dash__shortcut" onClick={() => navigate('/admin/departments')}>
          <span className="admin-dash__shortcut-icon" aria-hidden>
            <MapPin size={22} />
          </span>
          <span className="admin-dash__shortcut-text">
            <strong>Departments & circles</strong>
            <span>Add departments and circles Types</span>
          </span>
        </button>
        <button type="button" className="admin-dash__shortcut" onClick={() => navigate('/admin/employee-changes')}>
          <span className="admin-dash__shortcut-icon" aria-hidden>
            <ClipboardCheck size={22} />
          </span>
          <span className="admin-dash__shortcut-text">
            <strong>Requests for approval</strong>
            <span>Review written HR requests, new signups, exits, rehires, and profile changes</span>
          </span>
          {pendingCount > 0 ? (
            <span className="admin-dash__notify" aria-label={`${pendingCount} pending requests`}>
              {pendingCount}
            </span>
          ) : null}
        </button>
      </div>
    </section>
  );
}
