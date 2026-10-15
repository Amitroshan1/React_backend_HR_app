import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './AdminList.css';

const STATUSES = ['Pending', 'Approved', 'Rejected', 'All'];

function when(value) {
  if (!value) return '—';
  const date = formatDateDDMMYYYY(value);
  return date || value.slice(0, 16).replace('T', ' ');
}

export default function EmployeeChangeRequests({
  mode = 'admin',
  onBack,
  title,
  description,
  backLabel,
}) {
  const navigate = useNavigate();
  const detailRef = useRef(null);
  const isAdmin = mode === 'admin';
  const api = isAdmin
    ? '/api/admin/employee-change-requests'
    : '/api/HumanResource/employee-change-requests';
  const [status, setStatus] = useState(isAdmin ? 'Pending' : 'All');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const query = status && status !== 'All' ? `?status=${encodeURIComponent(status.toLowerCase())}` : '';
    fetch(`${api}${query}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        setRows(data.success && Array.isArray(data.requests) ? data.requests : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useRefreshOnNavigate(load, [status, api]);

  const selected = rows.find((row) => row.id === selectedId) || null;

  const goBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    navigate(isAdmin ? '/admin/requests' : -1);
  };

  const openDetails = (id) => {
    setSelectedId(id);
    setMessage('');
    window.setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const decide = async (decision) => {
    if (!selected) return;
    const token = localStorage.getItem('token');
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`${api}/${selected.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ decision, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setMessage(data.message || 'Could not save the decision.');
        return;
      }
      setNote('');
      setMessage(data.request?.email_message || 'Decision saved. HR has been emailed when a mailbox is configured.');
      load();
    } catch {
      setMessage('Network error while saving the decision.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-list-container">
      <button type="button" className="admin-master-back" onClick={goBack}>
        <ArrowLeft size={16} />
        {backLabel || (isAdmin ? 'Back to Request & Approval' : 'Back')}
      </button>
      <div className="admin-list-header">
        <div>
          <h1>{title || (isAdmin ? 'Requests for approval' : 'Change request history')}</h1>
          <p className="admin-list-copy">
            {description || (isAdmin
              ? 'Written HR requests, new signups, exits, rehires, leave and WFH changes by HR, and changes to department, circle, designation, and employment status.'
              : 'Written requests, signups, exits, rehires, leave and WFH changes, and profile changes, including who decided them.')}
          </p>
        </div>
      </div>
      <div className="admin-list-filters">
        <div className="status-buttons">
          {STATUSES.map((item) => (
            <button
              key={item}
              type="button"
              className={`status-btn ${status === item ? 'active' : ''}`}
              onClick={() => { setStatus(item); setSelectedId(null); }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      {message ? <p className="admin-list-copy">{message}</p> : null}
      <div className="admin-list-table-wrap">
        {loading ? (
          <p>Loading...</p>
        ) : rows.length === 0 ? (
          <p>No requests in this view.</p>
        ) : (
          <table className="admin-list-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th>Changes</th>
                <th>Requested by</th>
                <th>Status</th>
                <th>Decided by</th>
                <th>When</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={row.id === selectedId ? 'admin-list-row-active' : ''}
                >
                  <td>
                    <strong>{row.employee_name || '—'}</strong>
                    <div>{row.emp_id || row.employee_email}</div>
                  </td>
                  <td>{row.request_label || 'Profile change'}</td>
                  <td>{(row.fields || []).map((field) => field.label).join(', ') || '—'}</td>
                  <td>{row.requested_by_name || row.requested_by_email || '—'}</td>
                  <td>{row.status}</td>
                  <td>{row.decided_by_name || '—'}</td>
                  <td>{when(row.decided_at || row.created_at)}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-list-view-btn"
                      onClick={() => openDetails(row.id)}
                    >
                      View details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {selected ? (
        <section className="admin-change-detail" ref={detailRef}>
          <h2>{selected.employee_name || 'Employee'}</h2>
          <p>
            Requested by {selected.requested_by_name || 'HR'}
            {selected.requested_by_email ? ` (${selected.requested_by_email})` : ''}
            {' · '}
            {when(selected.created_at)}
            {selected.decided_by_name ? ` · ${selected.status} by ${selected.decided_by_name}` : ''}
          </p>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Current</th>
                <th>Requested</th>
              </tr>
            </thead>
            <tbody>
              {(selected.fields || []).map((field) => (
                <tr key={field.field}>
                  <td>
                    {field.label}
                    {field.effective_from ? ` · effective ${field.effective_from}` : ''}
                    {field.notes ? ` · ${field.notes}` : ''}
                  </td>
                  <td>{field.from}</td>
                  <td>{field.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected.decision_note ? <p>Note: {selected.decision_note}</p> : null}
          {isAdmin && selected.status === 'pending' ? (
            <div className="admin-change-actions">
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional note for HR"
                maxLength={500}
              />
              <button type="button" className="approve" disabled={busy} onClick={() => decide('approve')}>
                Approve
              </button>
              <button type="button" className="reject" disabled={busy} onClick={() => decide('reject')}>
                Reject
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
