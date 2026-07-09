import React, { useEffect, useState } from 'react';
import { LEAVE_TYPES_ON_BEHALF } from '../HR/HRApplyLeaveOnBehalf';
import './ManagerTeamLeaveApply.css';

const API_BASE = '/api/manager';

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function ManagerTeamLeaveApply() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    admin_id: '',
    leave_type: 'Casual Leave',
    start_date: '',
    end_date: '',
    reason: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/team-members`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) setMembers(data.members || []);
      } catch {
        setError('Failed to load team members');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const todayStr = new Date().toISOString().slice(0, 10);

  const onChange = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'leave_type' && value === 'Half Day Leave' && prev.start_date) {
        next.end_date = prev.start_date;
      }
      if (field === 'start_date' && prev.leave_type === 'Half Day Leave') {
        next.end_date = value;
      }
      return next;
    });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!form.admin_id) {
      setError('Select a team member.');
      return;
    }
    if (form.reason.trim().length < 10) {
      setError('Reason must be at least 10 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/leave-requests/on-behalf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          admin_id: Number(form.admin_id),
          leave_type: form.leave_type,
          start_date: form.start_date,
          end_date: form.end_date,
          reason: form.reason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to apply leave');
      setSuccess(data.message || 'Leave applied for team member.');
      setForm({ admin_id: '', leave_type: 'Casual Leave', start_date: '', end_date: '', reason: '' });
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p>Loading team…</p>;

  return (
    <div className="mgr-team-leave">
      <h3>Apply leave for team member</h3>
      <p className="mgr-team-leave__hint">Future dates only. Leave will be created as Pending for approval.</p>
      <form className="mgr-team-leave__form" onSubmit={onSubmit}>
        <label>
          Team member
          <select value={form.admin_id} onChange={(e) => onChange('admin_id', e.target.value)} required>
            <option value="">Select member</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.role || m.circle})</option>
            ))}
          </select>
        </label>
        <label>
          Leave type
          <select value={form.leave_type} onChange={(e) => onChange('leave_type', e.target.value)}>
            {LEAVE_TYPES_ON_BEHALF.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          From
          <input type="date" min={todayStr} value={form.start_date} onChange={(e) => onChange('start_date', e.target.value)} required />
        </label>
        <label>
          To
          <input type="date" min={form.start_date || todayStr} value={form.end_date} disabled={form.leave_type === 'Half Day Leave'} onChange={(e) => onChange('end_date', e.target.value)} required />
        </label>
        <label className="mgr-team-leave__reason">
          Reason
          <textarea value={form.reason} onChange={(e) => onChange('reason', e.target.value)} rows={3} minLength={10} required />
        </label>
        {error ? <p className="mgr-team-leave__error">{error}</p> : null}
        {success ? <p className="mgr-team-leave__success">{success}</p> : null}
        <button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Apply leave on behalf'}</button>
      </form>
    </div>
  );
}
