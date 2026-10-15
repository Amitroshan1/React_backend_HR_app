import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarClock, History, Lock, ShieldCheck, Users } from 'lucide-react';
import { HR_LEAVE_API_BASE, getHrAuthHeaders } from './HRApplyLeaveOnBehalf';

const DAY_FIELDS = [
  { key: 'max_hr_backdate_days', label: 'HR backdate limit', hint: 'How far back HR may apply leave for an employee.' },
  { key: 'max_regularization_backdate_days', label: 'Regularization backdate limit', hint: 'How far back attendance can be regularized.' },
];

const CHECK_FIELDS = [
  { key: 'block_on_payroll_locked', label: 'Block leave changes in payroll-locked months', hint: 'Stops edits once payroll for that month is paid or locked.' },
  { key: 'manager_on_behalf_allowed', label: 'Managers may apply leave on behalf of their team', hint: 'Lets reporting managers file leave for their direct team.' },
  { key: 'contract_leave_accrual_default', label: 'Contract employees accrue leave by default', hint: 'New contract employees start earning leave automatically.' },
];

const EDITABLE_KEYS = [...DAY_FIELDS, ...CHECK_FIELDS].map((f) => f.key);

function pickEditable(settings) {
  return Object.fromEntries(EDITABLE_KEYS.map((key) => [key, settings?.[key]]));
}

function buildRules(saved) {
  if (!saved) return [];
  return [
    { key: 'hr', icon: <CalendarClock size={16} />, label: 'HR backdate', value: `${saved.max_hr_backdate_days} days` },
    { key: 'reg', icon: <History size={16} />, label: 'Regularization', value: `${saved.max_regularization_backdate_days} days` },
    {
      key: 'lock',
      icon: <Lock size={16} />,
      label: 'Payroll lock',
      value: saved.block_on_payroll_locked ? 'Blocks changes' : 'Off',
      on: !!saved.block_on_payroll_locked,
    },
    {
      key: 'mgr',
      icon: <Users size={16} />,
      label: 'Manager on behalf',
      value: saved.manager_on_behalf_allowed ? 'Allowed' : 'Not allowed',
      on: !!saved.manager_on_behalf_allowed,
    },
  ];
}

function usePolicy() {
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${HR_LEAVE_API_BASE}/leave-updation/policy`, { headers: getHrAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load leave policy');
      setSaved(pickEditable(data.settings));
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load leave policy');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { saved, setSaved, error, setError };
}

export function HRLeavePolicyCard({ onEdit }) {
  return (
    <section className="lx-action">
      <div className="lx-action-top">
        <span className="lp-icon"><ShieldCheck size={20} /></span>
        <div className="lx-action-copy">
          <h3>Company leave policy</h3>
          <p>Backdating and approval rules for leave. These apply to your company only.</p>
        </div>
      </div>
      <div className="lx-action-foot">
        <button type="button" className="lp-btn" onClick={onEdit}>
          Edit policy <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

export function HRLeavePolicyPanel({ onCancel, onSaved }) {
  const { saved, setSaved, error, setError } = usePolicy();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);

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
      if (onSaved) onSaved('Leave policy saved for your company.');
    } catch (err) {
      setError(err.message || 'Failed to save leave policy');
    } finally {
      setSaving(false);
    }
  };

  const dirty = !!saved && !!draft && EDITABLE_KEYS.some((key) => String(draft[key]) !== String(saved[key]));

  return (
    <section className="lp-card">
      <div className="lp-head">
        <span className="lp-icon"><ShieldCheck size={20} /></span>
        <div className="lp-copy">
          <h3>Edit company leave policy</h3>
          <p>Changes apply to your company only and take effect straight away.</p>
        </div>
      </div>

      <div className="lp-section-title lp-current-title">Current policy</div>
      <div className="lp-rules lp-current">
        {saved
          ? buildRules(saved).map((rule) => (
              <div key={rule.key} className={`lp-rule${rule.on === false ? ' is-off' : ''}`}>
                <span className="lp-rule-icon">{rule.icon}</span>
                <span className="lp-rule-text">
                  <span>{rule.label}</span>
                  <strong>{rule.value}</strong>
                </span>
              </div>
            ))
          : [0, 1, 2, 3].map((key) => <div key={key} className="lp-rule is-loading" />)}
      </div>

      {!draft ? null : (
        <div className="lp-body is-page">
          <div className="lp-section-title">Backdating limits</div>
          <div className="lp-days">
            {DAY_FIELDS.map((f) => (
              <label key={f.key} className="lp-field">
                <span>{f.label}</span>
                <div className="lp-input">
                  <input
                    type="number"
                    min={0}
                    max={3650}
                    step={1}
                    value={draft[f.key] ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    disabled={saving}
                  />
                  <em>days</em>
                </div>
                <small>{f.hint}</small>
              </label>
            ))}
          </div>

          <div className="lp-section-title">Rules</div>
          <div className="lp-toggles">
            {CHECK_FIELDS.map((f) => (
              <label key={f.key} className="lp-toggle">
                <span className="lp-toggle-text">
                  <span>{f.label}</span>
                  <small>{f.hint}</small>
                </span>
                <input
                  type="checkbox"
                  checked={!!draft[f.key]}
                  onChange={(e) => set(f.key, e.target.checked)}
                  disabled={saving}
                />
                <span className="lp-switch" aria-hidden />
              </label>
            ))}
          </div>
        </div>
      )}

      {error ? <div className="lp-alert is-error">{error}</div> : null}

      <div className="lp-actions is-page">
        <button type="button" className="lp-btn is-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="lp-btn" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save leave policy'}
        </button>
      </div>
    </section>
  );
}

export default HRLeavePolicyPanel;
