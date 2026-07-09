import React, { useCallback, useEffect, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import './HRApplyLeaveOnBehalf.css';

export const HR_LEAVE_API_BASE = '/api/HumanResource';

export const LEAVE_TYPES_ON_BEHALF = [
  'Privilege Leave',
  'Casual Leave',
  'Half Day Leave',
  'Compensatory Leave',
  'Optional Leave',
];

export const LEAVE_STATUS_OPTIONS = [
  { value: '', label: 'Auto (Approved if backdated)' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Rejected', label: 'Rejected' },
];

export function getHrAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const EMPTY_FORM = {
  leave_type: 'Casual Leave',
  start_date: '',
  end_date: '',
  reason: '',
  status: '',
};

export function HRApplyLeaveOnBehalf({
  adminId,
  employeeLabel = '',
  onSuccess,
  embedded = false,
  defaultOpen = false,
}) {
  const [policy, setPolicy] = useState(null);
  const [showForm, setShowForm] = useState(defaultOpen);
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    let cancelled = false;
    fetch(`${HR_LEAVE_API_BASE}/leave-updation/policy`, { headers: getHrAuthHeaders() })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (!cancelled && data.success) setPolicy(data.policy || null);
      });
    return () => { cancelled = true; };
  }, []);

  const resetForm = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormError('');
    setPreview(null);
    setPreviewError('');
  }, []);

  const handleFormChange = (field, value) => {
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

  useEffect(() => {
    if (!adminId || !form.start_date || !form.end_date || !form.leave_type) {
      setPreview(null);
      setPreviewError('');
      return undefined;
    }
    if (form.end_date < form.start_date) return undefined;

    const timer = setTimeout(async () => {
      setPreviewing(true);
      setPreviewError('');
      try {
        const res = await fetch(`${HR_LEAVE_API_BASE}/leave-updation/requests/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getHrAuthHeaders() },
          body: JSON.stringify({
            admin_id: adminId,
            leave_type: form.leave_type,
            start_date: form.start_date,
            end_date: form.end_date,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          setPreview(null);
          setPreviewError(json.message || 'Could not preview leave impact');
          return;
        }
        setPreview(json.preview || null);
      } catch {
        setPreview(null);
        setPreviewError('Preview unavailable');
      } finally {
        setPreviewing(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [adminId, form.leave_type, form.start_date, form.end_date]);

  const handleApplyOnBehalf = async (e) => {
    e.preventDefault();
    if (!adminId) {
      setFormError('Select an employee first.');
      return;
    }
    setFormError('');
    setFormSuccess('');

    const reason = form.reason.trim();
    if (!form.start_date || !form.end_date) {
      setFormError('Start and end dates are required.');
      return;
    }
    if (form.end_date < form.start_date) {
      setFormError('End date cannot be before start date.');
      return;
    }
    if (reason.length < 10) {
      setFormError('Reason must be at least 10 characters.');
      return;
    }
    if (previewError) {
      setFormError(previewError);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        admin_id: adminId,
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date: form.end_date,
        reason,
      };
      if (form.status) payload.status = form.status;

      const res = await fetch(`${HR_LEAVE_API_BASE}/leave-updation/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHrAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to apply leave on behalf');
      }

      setFormSuccess(json.message || 'Leave applied successfully.');
      resetForm();
      setShowForm(false);
      window.dispatchEvent(new CustomEvent('leaveDataUpdated'));
      if (onSuccess) await onSuccess(json);
    } catch (err) {
      setFormError(err.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const policyHint = policy
    ? `Backdate limit: ${policy.max_hr_backdate_days} days${
        policy.block_on_payroll_locked ? ' • Blocked when payroll is paid/locked' : ''
      }`
    : null;

  return (
    <section
      className={`hr-leave-on-behalf ${embedded ? 'hr-leave-on-behalf--embedded' : ''}`}
      aria-label="Apply leave on behalf"
    >
      <div className="hr-leave-on-behalf__head">
        <div>
          <h3>Apply leave on behalf{employeeLabel ? ` — ${employeeLabel}` : ''}</h3>
          <p className="hr-leave-on-behalf__hint">
            HR can apply backdated leave. Backdated requests default to Approved.
            {policyHint ? ` ${policyHint}.` : ''}
          </p>
        </div>
        <button
          type="button"
          className="hr-leave-on-behalf__toggle"
          onClick={() => {
            setShowForm((v) => !v);
            setFormError('');
          }}
          disabled={!adminId}
        >
          <CalendarPlus size={16} aria-hidden />
          {showForm ? 'Hide form' : 'Apply leave'}
        </button>
      </div>

      {!adminId ? (
        <p className="hr-leave-on-behalf__muted">Select an employee to apply leave on their behalf.</p>
      ) : null}

      {formSuccess && !showForm ? (
        <p className="hr-leave-on-behalf__success" role="status">{formSuccess}</p>
      ) : null}

      {showForm && adminId ? (
        <form className="hr-leave-on-behalf__form" onSubmit={handleApplyOnBehalf}>
          <div className="hr-leave-on-behalf__grid">
            <label>
              Leave type
              <select
                value={form.leave_type}
                onChange={(e) => handleFormChange('leave_type', e.target.value)}
                required
              >
                {LEAVE_TYPES_ON_BEHALF.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={form.status}
                onChange={(e) => handleFormChange('status', e.target.value)}
              >
                {LEAVE_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value || 'auto'} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label>
              From
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => handleFormChange('start_date', e.target.value)}
                required
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => handleFormChange('end_date', e.target.value)}
                min={form.start_date || undefined}
                disabled={form.leave_type === 'Half Day Leave'}
                required
              />
            </label>
          </div>

          {(preview || previewing || previewError) && (
            <div className={`hr-leave-on-behalf__preview ${previewError ? 'hr-leave-on-behalf__preview--error' : ''}`}>
              {previewing ? (
                <span>Calculating impact…</span>
              ) : previewError ? (
                <span>{previewError}</span>
              ) : preview ? (
                <>
                  <strong>Preview:</strong>
                  {' '}
                  Paid days {preview.deducted_days ?? '—'}
                  {' • '}
                  LWP {preview.extra_days ?? '—'}
                  {' • '}
                  Suggested status: {preview.suggested_status || '—'}
                  {preview.is_backdated ? ' (backdated)' : ''}
                </>
              ) : null}
            </div>
          )}

          <label className="hr-leave-on-behalf__reason">
            Reason
            <textarea
              value={form.reason}
              onChange={(e) => handleFormChange('reason', e.target.value)}
              placeholder="Why HR is applying this leave (min 10 characters)"
              rows={3}
              required
              minLength={10}
            />
          </label>
          {formError ? <p className="hr-leave-on-behalf__error">{formError}</p> : null}
          <div className="hr-leave-on-behalf__actions">
            <button type="button" className="hr-leave-on-behalf__cancel" onClick={() => { setShowForm(false); resetForm(); }}>
              Cancel
            </button>
            <button type="submit" className="hr-leave-on-behalf__submit" disabled={submitting || previewing || !!previewError}>
              {submitting ? 'Applying…' : 'Apply leave on behalf'}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
