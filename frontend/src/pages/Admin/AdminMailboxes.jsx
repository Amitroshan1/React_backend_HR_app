import React, { useCallback, useState } from 'react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import './AdminMailboxes.css';

const API = '/api/admin/mailboxes';

const FIELDS = [
  {
    key: 'mailbox_hr',
    label: 'HR mailbox',
    hint: 'Leave, HR workflows, HR CCs',
    placeholder: 'hr@company.com',
    accent: 'rose',
  },
  {
    key: 'mailbox_accounts',
    label: 'Accounts mailbox',
    hint: 'Claims, payroll, finance notices',
    placeholder: 'accounts@company.com',
    accent: 'teal',
  },
  {
    key: 'mailbox_it',
    label: 'IT mailbox',
    hint: 'Tickets, inventory, IT CCs',
    placeholder: 'it@company.com',
    accent: 'indigo',
  },
  {
    key: 'mailbox_admin',
    label: 'Admin mailbox',
    hint: 'Admin / administration notices',
    placeholder: 'admin@company.com',
    accent: 'blue',
  },
];

export default function AdminMailboxes() {
  const token = () => localStorage.getItem('token');
  const [form, setForm] = useState(null);
  const [company, setCompany] = useState('');
  const [envFallback, setEnvFallback] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    const res = await fetch(API, { headers: { Authorization: `Bearer ${token()}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.message || 'Could not load mailboxes');
      return;
    }
    setCompany(data.company || '');
    setEnvFallback(!!data.uses_env_fallback);
    setForm(data.mailboxes || {});
  }, []);

  useRefreshOnNavigate(load);

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
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || 'Could not save mailboxes');
        return;
      }
      setForm(data.mailboxes || form);
      setMessage('Mailboxes saved');
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
            <h1>Company mailboxes</h1>
            <p>
              {company ? (
                <>
                  <strong>{company}</strong>
                  {' — '}
                </>
              ) : null}
              HRMS department emails for this company go to these addresses.
              {envFallback
                ? ' Leave blank to use the server default.'
                : ' Leave blank to skip CC for that department.'}
            </p>
          </div>
        </header>

        <form className="mbox-panel" onSubmit={save}>
          <div className="mbox-panel__head">
            <h2>Department inboxes</h2>
            <p>Used when the app CCs HR, Accounts, IT, or Admin.</p>
          </div>

          {error && <p className="mbox-alert mbox-alert--error">{error}</p>}
          {message && <p className="mbox-alert mbox-alert--ok">{message}</p>}

          {!form ? (
            <p className="mbox-loading">Loading mailboxes…</p>
          ) : (
            <div className="mbox-grid">
              {FIELDS.map((field) => (
                <label
                  key={field.key}
                  className={`mbox-field mbox-field--${field.accent}`}
                >
                  <span className="mbox-field__label">{field.label}</span>
                  <span className="mbox-field__hint">{field.hint}</span>
                  <input
                    type="email"
                    value={form[field.key] || ''}
                    placeholder={field.placeholder}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
          )}

          <div className="mbox-actions">
            <button
              type="submit"
              className="mbox-btn mbox-btn--primary"
              disabled={!form || saving}
            >
              {saving ? 'Saving…' : 'Save mailboxes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
