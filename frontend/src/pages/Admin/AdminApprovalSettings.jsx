import React, { useCallback, useState } from 'react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import './AdminMailboxes.css';

const API = '/api/admin/approval-settings';

export default function AdminApprovalSettings() {
  const token = () => localStorage.getItem('token');
  const [settings, setSettings] = useState(null);
  const [switches, setSwitches] = useState([]);
  const [alwaysRequired, setAlwaysRequired] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    const res = await fetch(API, { headers: { Authorization: `Bearer ${token()}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message || 'Could not load approval settings');
      return;
    }
    setSettings(data.settings || {});
    setSwitches(data.switches || []);
    setAlwaysRequired(data.always_required || []);
  }, []);

  useRefreshOnNavigate(load);

  const toggle = (key) => {
    setSettings((prev) => ({ ...prev, [key]: !prev?.[key] }));
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch(API, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ settings }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || 'Could not save approval settings');
        return;
      }
      setSettings(data.settings || settings);
      setSwitches(data.switches || switches);
      setMessage('Approval settings saved');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div className="mbox-page">
        <div className="mbox-shell">
          <p className="mbox-status">{error || 'Loading…'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mbox-page">
      <div className="mbox-shell">
        <header className="mbox-hero">
          <div>
            <p className="mbox-hero__eyebrow">Company settings</p>
            <h1>Approval settings</h1>
            <p>
              When a switch is on, HR must wait for Admin approval. Turning signup or exit off
              lets HR apply those changes immediately — use with care.
            </p>
          </div>
        </header>

        {error ? <p className="mbox-status mbox-status--err">{error}</p> : null}
        {message ? <p className="mbox-status mbox-status--ok">{message}</p> : null}

        <form className="mbox-form" onSubmit={save}>
          {switches.map((item) => (
            <label key={item.key} className="mbox-field" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={!!settings[item.key]}
                onChange={() => toggle(item.key)}
                style={{ marginTop: '0.35rem' }}
              />
              <span>
                <strong>{item.label}</strong>
                <span className="mbox-field__hint" style={{ display: 'block' }}>{item.risk}</span>
              </span>
            </label>
          ))}

          {alwaysRequired.length ? (
            <p className="mbox-field__hint">
              Always require Admin: {alwaysRequired.join(', ')} (cannot be switched off).
            </p>
          ) : null}

          <div className="mbox-actions">
            <button type="submit" className="mbox-btn" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
