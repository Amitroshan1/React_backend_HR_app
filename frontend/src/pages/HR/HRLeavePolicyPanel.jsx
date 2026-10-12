import React, { useCallback, useEffect, useState } from 'react';
import { HR_LEAVE_API_BASE, getHrAuthHeaders } from './HRApplyLeaveOnBehalf';

const DAY_FIELDS = [
  { key: 'max_hr_backdate_days', label: 'HR backdate limit (days)' },
  { key: 'max_regularization_backdate_days', label: 'Regularization backdate limit (days)' },
];

const CHECK_FIELDS = [
  { key: 'block_on_payroll_locked', label: 'Block leave changes in payroll-locked months' },
  { key: 'manager_on_behalf_allowed', label: 'Managers may apply leave on behalf of their team' },
  { key: 'contract_leave_accrual_default', label: 'Contract employees accrue leave by default' },
];

const EDITABLE_KEYS = [...DAY_FIELDS, ...CHECK_FIELDS].map((f) => f.key);

function pickEditable(settings) {
  return Object.fromEntries(EDITABLE_KEYS.map((key) => [key, settings?.[key]]));
}

export function HRLeavePolicyPanel({ onSaved }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${HR_LEAVE_API_BASE}/leave-updation/policy`, { headers: getHrAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load leave policy');
      const values = pickEditable(data.settings);
      setSaved(values);
      setDraft(values);
    } catch (err) {
      setError(err.message || 'Failed to load leave policy');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    if (!draft) return;
    for (const f of DAY_FIELDS) {
      const n = Number(draft[f.key]);
      if (!Number.isInteger(n) || n < 0) {
        setError(`${f.label} must be a whole number of days`);
        return;
      }
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const body = { ...draft };
      DAY_FIELDS.forEach((f) => { body[f.key] = Number(draft[f.key]); });
      const res = await fetch(`${HR_LEAVE_API_BASE}/leave-updation/policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getHrAuthHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to save leave policy');
      const values = pickEditable(data.settings);
      setSaved(values);
      setDraft(values);
      setMessage('Leave policy saved for your company.');
      if (onSaved) onSaved(data.policy);
    } catch (err) {
      setError(err.message || 'Failed to save leave policy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lau-on-behalf-panel lau-policy-panel">
      <div className="lau-policy-panel__head">
        <div>
          <h3>Company leave policy</h3>
          <p className="lau-on-behalf-panel__hint">
            {saved
              ? `HR can backdate up to ${saved.max_hr_backdate_days} days; regularization up to ${saved.max_regularization_backdate_days} days. `
              : ''}
            These rules apply to your company only.
          </p>
        </div>
        <button
          type="button"
          className="lau-on-behalf-panel__find-btn"
          onClick={() => {
            setOpen((v) => !v);
            setDraft(saved);
            setError('');
            setMessage('');
          }}
          disabled={!saved}
        >
          {open ? 'Close' : 'Edit policy'}
        </button>
      </div>

      {error && !open ? <div className="lau-on-behalf-panel__inline-error">{error}</div> : null}

      {open && draft ? (
        <div className="lau-policy-panel__body">
          <div className="lau-policy-panel__grid">
            {DAY_FIELDS.map((f) => (
              <label key={f.key} className="lau-on-behalf-panel__field">
                <span className="lau-on-behalf-panel__label">{f.label}</span>
                <input
                  type="number"
                  min={0}
                  max={3650}
                  step={1}
                  value={draft[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  disabled={saving}
                />
              </label>
            ))}
          </div>
          <div className="lau-policy-panel__checks">
            {CHECK_FIELDS.map((f) => (
              <label key={f.key} className="lau-policy-panel__check">
                <input
                  type="checkbox"
                  checked={!!draft[f.key]}
                  onChange={(e) => set(f.key, e.target.checked)}
                  disabled={saving}
                />
                <span>{f.label}</span>
              </label>
            ))}
          </div>
          {error ? <div className="lau-on-behalf-panel__inline-error">{error}</div> : null}
          {message ? <div className="lau-policy-panel__success">{message}</div> : null}
          <div className="lau-policy-panel__actions">
            <button
              type="button"
              className="lau-on-behalf-panel__find-btn"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save leave policy'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default HRLeavePolicyPanel;
