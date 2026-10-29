import React, { useCallback, useMemo, useState } from 'react';
import {
  Bell,
  Briefcase,
  CalendarDays,
  Home,
  Lock,
  RotateCcw,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { AdminBreadcrumb, commandCenterCrumbItem } from '../../components/layout/AdminBreadcrumb';
import './AdminApprovalSettings.css';

const API = '/api/admin/approval-settings';

const GROUPS = [
  {
    id: 'people',
    title: 'People & roles',
    hint: 'Who can join, leave, return, or change role without waiting for Admin.',
    keys: ['signup', 'exit', 'rehire', 'profile_change'],
  },
  {
    id: 'leave',
    title: 'Leave & WFH',
    hint: 'Whether HR leave and work-from-home edits wait in the approval queue.',
    keys: ['leave_on_behalf', 'leave_update', 'wfh_update'],
  },
  {
    id: 'notice',
    title: 'Notifications',
    hint: 'Optional notice when HR applies a change because a switch above is off.',
    keys: ['notify_admin_on_bypass'],
  },
];

const ICONS = {
  signup: UserPlus,
  exit: UserMinus,
  rehire: RotateCcw,
  profile_change: Users,
  leave_on_behalf: CalendarDays,
  leave_update: Briefcase,
  wfh_update: Home,
  notify_admin_on_bypass: Bell,
};

const ALWAYS_LABELS = {
  general: 'General employee requests',
  leave_unlock: 'Leave unlock',
  probation: 'Probation decisions',
};

function isNotifyKey(key) {
  return key === 'notify_admin_on_bypass';
}

function ApprovalSwitch({ on, onToggle, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`aps-switch${on ? ' is-on' : ''}`}
      onClick={onToggle}
    >
      <span className="aps-switch__knob" />
    </button>
  );
}

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

  const byKey = useMemo(() => {
    const map = {};
    switches.forEach((item) => {
      map[item.key] = item;
    });
    return map;
  }, [switches]);

  const counts = useMemo(() => {
    const gateKeys = switches.filter((item) => !isNotifyKey(item.key)).map((item) => item.key);
    const adminOn = gateKeys.filter((key) => !!settings?.[key]).length;
    return { adminOn, hrNow: gateKeys.length - adminOn, total: gateKeys.length };
  }, [settings, switches]);

  const toggle = (key) => {
    setSettings((prev) => ({ ...prev, [key]: !prev?.[key] }));
    setMessage('');
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
      <div className="aps-page">
        <div className="aps-shell">
          <p className={`aps-banner${error ? ' is-error' : ''}`}>{error || 'Loading approval settings…'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="aps-page">
      <div className="aps-shell">
        <AdminBreadcrumb
          items={[commandCenterCrumbItem(), { label: 'Approval settings' }]}
        />

        <header className="aps-hero">
          <div className="aps-hero__copy">
            <p className="aps-hero__eyebrow">Company controls</p>
            <h1>Approval settings</h1>
            <p>
              Each switch decides whether HR waits for Admin. Leave a switch on to
              queue the change. Turn it off only when HR should apply it immediately.
            </p>
          </div>
          <div className="aps-stats" aria-label="Approval coverage">
            <div className="aps-stat">
              <strong>{counts.adminOn}</strong>
              <span>Need Admin</span>
            </div>
            <div className="aps-stat aps-stat--warn">
              <strong>{counts.hrNow}</strong>
              <span>HR applies now</span>
            </div>
            <div className="aps-stat aps-stat--lock">
              <strong>{alwaysRequired.length}</strong>
              <span>Always locked</span>
            </div>
          </div>
        </header>

        {error ? <p className="aps-banner is-error">{error}</p> : null}
        {message ? <p className="aps-banner is-ok">{message}</p> : null}

        <form className="aps-form" onSubmit={save}>
          {GROUPS.map((group) => {
            const items = group.keys.map((key) => byKey[key]).filter(Boolean);
            if (!items.length) return null;
            return (
              <section key={group.id} className="aps-panel">
                <div className="aps-panel__head">
                  <h2>{group.title}</h2>
                  <p>{group.hint}</p>
                </div>
                <ul className="aps-list">
                  {items.map((item) => {
                    const on = !!settings[item.key];
                    const notify = isNotifyKey(item.key);
                    const Icon = ICONS[item.key] || ShieldCheck;
                    return (
                      <li key={item.key} className={`aps-row${on ? '' : notify ? '' : ' is-open'}`}>
                        <span className="aps-row__icon" aria-hidden>
                          <Icon size={18} />
                        </span>
                        <div className="aps-row__copy">
                          <div className="aps-row__title">
                            <h3>{item.label}</h3>
                            <span className={`aps-pill${notify ? (on ? ' is-on' : ' is-off') : on ? ' is-on' : ' is-off'}`}>
                              {notify
                                ? on ? 'Email Admin' : 'No email'
                                : on ? 'Admin must approve' : 'HR applies now'}
                            </span>
                          </div>
                          <p>{item.risk}</p>
                        </div>
                        <ApprovalSwitch
                          on={on}
                          onToggle={() => toggle(item.key)}
                          label={`${item.label}: ${on ? 'on' : 'off'}`}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {alwaysRequired.length ? (
            <section className="aps-panel aps-panel--locked">
              <div className="aps-panel__head">
                <h2>Always require Admin</h2>
                <p>These cannot be switched off.</p>
              </div>
              <ul className="aps-locked">
                {alwaysRequired.map((key) => (
                  <li key={key}>
                    <Lock size={15} aria-hidden />
                    <span>{ALWAYS_LABELS[key] || key}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="aps-actions">
            <p>Saving applies to this company immediately.</p>
            <button type="submit" className="aps-save" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
