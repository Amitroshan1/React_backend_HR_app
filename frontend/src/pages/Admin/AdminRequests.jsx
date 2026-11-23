import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, MapPin, UserCheck } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { markAdminDepartmentVisit } from './adminVisit';
import { useUser } from '../../components/layout/UserContext';
import './AdminDashboard.css';
import { getAccessToken, hasSignedInHint } from "../../utils/authSession";

export default function AdminRequests() {
  const navigate = useNavigate();
  const { userData } = useUser();
  const showManagerPanel = userData?.user?.has_manager_access === true;
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingManager, setPendingManager] = useState(0);

  const loadPending = useCallback(() => {
    const token = getAccessToken();
    if (!token && !hasSignedInHint()) return;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch('/api/admin/employee-change-requests?status=pending', {
      headers,
      credentials: 'include',
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        const count = data.success ? Number(data.count ?? data.requests?.length ?? 0) : 0;
        setPendingCount(Number.isFinite(count) ? count : 0);
      })
      .catch(() => setPendingCount(0));
    fetch('/api/manager/pending-counts', { headers, credentials: 'include' })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        const counts = data.success ? (data.counts || {}) : {};
        const total = Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0);
        setPendingManager(Number.isFinite(total) ? total : 0);
      })
      .catch(() => setPendingManager(0));
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
            <span>Review written HR requests, new signups, exits, rehires, leave and WFH changes by HR, and profile changes</span>
          </span>
          {pendingCount > 0 ? (
            <span className="admin-dash__notify" aria-label={`${pendingCount} pending requests`}>
              {pendingCount}
            </span>
          ) : null}
        </button>
        {showManagerPanel ? (
          <button
            type="button"
            className="admin-dash__shortcut"
            onClick={() => {
              markAdminDepartmentVisit();
              navigate('/manager');
            }}
          >
            <span className="admin-dash__shortcut-icon" aria-hidden>
              <UserCheck size={22} />
            </span>
            <span className="admin-dash__shortcut-text">
              <strong>Manager Panel</strong>
              <span>Approve or reject team leave, WFH, claims, and other requests for people you manage as L1, L2, or L3</span>
            </span>
            {pendingManager > 0 ? (
              <span className="admin-dash__notify" aria-label={`${pendingManager} pending manager requests`}>
                {pendingManager}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>
    </section>
  );
}
