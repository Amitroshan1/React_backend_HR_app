import React, { useCallback, useState } from 'react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { mailboxFieldsForPlan } from './mailboxPlan';
import './AdminMailboxes.css';

export default function AdminMailboxes() {
  const token = () => localStorage.getItem('token');
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState({ default_days: 30, by_circle: {} });
  const [circles, setCircles] = useState([]);
  const [circleCounts, setCircleCounts] = useState({});
  const [allowed, setAllowed] = useState([]);
  const [plan, setPlan] = useState('essential');
  const [company, setCompany] = useState('');
  const [envFallback, setEnvFallback] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [circleName, setCircleName] = useState('');
  const [circleDays, setCircleDays] = useState('90');

  const load = useCallback(async () => {
    setError('');
    const headers = { Authorization: `Bearer ${token()}` };
    const [mailRes, noticeRes] = await Promise.all([
      fetch('/api/admin/mailboxes', { headers }),
      fetch('/api/admin/notice-settings', { headers }),
    ]);
    const mailData = await mailRes.json().catch(() => ({}));
    const noticeData = await noticeRes.json().catch(() => ({}));
    if (!mailRes.ok) {
      setError(mailData.message || 'Could not load company settings');
      return;
    }
    setCompany(mailData.company || '');
    setPlan(mailData.plan || 'essential');
    setEnvFallback(!!mailData.uses_env_fallback);
    setAllowed(mailData.allowed || []);
    setForm(mailData.mailboxes || {});
    if (noticeRes.ok) {
      setNotice(noticeData.notice || { default_days: 30, by_circle: {} });
      setCircles(noticeData.circles || []);
      setCircleCounts(noticeData.circle_counts || {});
    }
  }, []);

  useRefreshOnNavigate(load);

  const fields = mailboxFieldsForPlan(plan).filter((field) => !allowed.length || allowed.includes(field.key));

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const headers = {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
      };
      const mailBody = {};
      fields.forEach((field) => {
        mailBody[field.key] = form?.[field.key] || '';
      });
      const mailRes = await fetch('/api/admin/mailboxes', {
        method: 'PUT',
        headers,
        body: JSON.stringify(mailBody),
      });
      const mailData = await mailRes.json().catch(() => ({}));
      if (!mailRes.ok) {
        setError(mailData.message || 'Could not save mailboxes');
        return;
      }
      const noticePayload = withPendingCircle(notice);
      const noticeRes = await fetch('/api/admin/notice-settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ by_circle: noticePayload.by_circle }),
      });
      const noticeData = await noticeRes.json().catch(() => ({}));
      if (!noticeRes.ok) {
        setError(noticeData.message || 'Could not save notice period');
        return;
      }
      setForm(mailData.mailboxes || form);
      setNotice(noticeData.notice || noticePayload);
      setCircleCounts(noticeData.circle_counts || {});
      setCircleName('');
      setMessage('Company settings saved. Circle notice days apply to everyone in that circle.');
    } finally {
      setSaving(false);
    }
  };

  const withPendingCircle = (current) => {
    const name = (circleName || '').trim();
    const days = Number(circleDays);
    const byCircle = { ...(current.by_circle || {}) };
    if (name && Number.isFinite(days) && days >= 1) {
      byCircle[name] = Math.min(365, Math.round(days));
    }
    return { ...current, by_circle: byCircle };
  };

  const countForCircle = (name) => {
    const raw = String(name || '').trim();
    const key = raw.toLowerCase();
    const n = Number(circleCounts[raw] ?? circleCounts[key] ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const persistCircles = async (byCircle) => {
    const headers = {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    };
    const noticeRes = await fetch('/api/admin/notice-settings', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ by_circle: byCircle }),
    });
    const noticeData = await noticeRes.json().catch(() => ({}));
    if (!noticeRes.ok) {
      throw new Error(noticeData.message || 'Could not save circle notice days');
    }
    setNotice(noticeData.notice || { ...notice, by_circle: byCircle });
    setCircleCounts(noticeData.circle_counts || {});
    return noticeData;
  };

  const addCircle = async () => {
    const name = (circleName || '').trim();
    const days = Number(circleDays);
    if (!name || !Number.isFinite(days) || days < 1) {
      setError('Select a circle and enter notice days');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const next = { ...(notice.by_circle || {}), [name]: Math.min(365, Math.round(days)) };
      await persistCircles(next);
      setCircleName('');
      setMessage(`Notice period of ${Math.round(days)} days now applies to everyone in ${name}.`);
    } catch (err) {
      setError(err.message || 'Could not apply circle notice days');
    } finally {
      setSaving(false);
    }
  };

  const removeCircle = async (name) => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const next = { ...(notice.by_circle || {}) };
      delete next[name];
      await persistCircles(next);
      setMessage(`Removed circle rule for ${name}. Those employees use the default notice period.`);
    } catch (err) {
      setError(err.message || 'Could not remove circle notice days');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mbox-page">
      <div className="mbox-shell">
        <header className="mbox-hero">
          <div>
            <p className="mbox-hero__eyebrow">Company settings</p>
            <h1>Mailboxes and notice period</h1>
            <p>
              {company ? <><strong>{company}</strong> — </> : null}
              Department inboxes and notice days for this company.
              {envFallback
                ? ' Fields show the current .env address until you save. Saved addresses override .env for this owner company and all department mail uses these inboxes.'
                : ' All department mail uses these inboxes. Blank inboxes skip that department CC.'}
            </p>
          </div>
        </header>

        <form className="mbox-panel" onSubmit={save}>
          {error && <p className="mbox-alert mbox-alert--error">{error}</p>}
          {message && <p className="mbox-alert mbox-alert--ok">{message}</p>}

          <div className="mbox-panel__head">
            <h2>Department inboxes</h2>
            <p>Only departments on this plan are shown.</p>
          </div>

          {!form ? (
            <p className="mbox-loading">Loading…</p>
          ) : (
            <div className="mbox-grid">
              {fields.map((field) => (
                <label key={field.key} className={`mbox-field mbox-field--${field.accent}`}>
                  <span className="mbox-field__label">{field.label}</span>
                  <span className="mbox-field__hint">{field.hint}</span>
                  <input
                    type="email"
                    value={form[field.key] || ''}
                    placeholder={field.placeholder}
                    onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}

          <div className="mbox-panel__head" style={{ marginTop: 28 }}>
            <h2>Notice period</h2>
            <p>Select a circle and days to apply that notice period to every employee in the circle.</p>
          </div>

          <p className="mbox-notice-info">
            Company default is <strong>30 days</strong> for employees who do not have a circle rule.
          </p>

          <div className="mbox-notice-add">
            <select value={circleName} onChange={(e) => setCircleName(e.target.value)}>
              <option value="">Circle</option>
              {circles.map((name) => <option key={name} value={name}>{name}</option>)}
              {!circles.includes('NHQ') ? <option value="NHQ">NHQ</option> : null}
            </select>
            <input type="number" min="1" max="365" value={circleDays} onChange={(e) => setCircleDays(e.target.value)} />
            <button type="button" onClick={addCircle} disabled={saving}>Apply to circle</button>
          </div>

          <ul className="mbox-notice-list">
            {Object.entries(notice.by_circle || {}).map(([name, days]) => (
              <li key={name}>
                <strong>{name}</strong>
                <span>{days} days · {countForCircle(name)} employee{countForCircle(name) === 1 ? '' : 's'}</span>
                <button type="button" onClick={() => removeCircle(name)} disabled={saving}>Remove</button>
              </li>
            ))}
          </ul>

          <div className="mbox-actions">
            <button type="submit" className="mbox-btn mbox-btn--primary" disabled={!form || saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
