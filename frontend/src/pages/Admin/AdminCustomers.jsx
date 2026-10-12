import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { useLocation, useNavigate } from 'react-router-dom';
import './AdminCustomers.css';
import { formatDate } from '../../utils/dateFormat';
import { matchesListQuery } from './adminListQuery';

const API_ACCESS = '/api/admin/deployment-guide/access';
const API_CUSTOMERS = '/api/admin/customers';

const PLAN_BADGE_CLASS = {
  basic: 'cust-plan--basic',
  essential: 'cust-plan--essential',
  enterprise: 'cust-plan--enterprise',
};

// Company mailboxes used for that company's HRMS emails (blank = none; tenant 1 falls back to .env).
const MAILBOX_FIELDS = [
  { key: 'mailbox_hr', label: 'HR mailbox', placeholder: 'hr@acme.com' },
  { key: 'mailbox_accounts', label: 'Accounts mailbox', placeholder: 'accounts@acme.com' },
  { key: 'mailbox_it', label: 'IT mailbox', placeholder: 'it@acme.com' },
  { key: 'mailbox_admin', label: 'Admin mailbox', placeholder: 'admin@acme.com' },
];

const emptyMailboxes = () =>
  Object.fromEntries(MAILBOX_FIELDS.map((f) => [f.key, '']));

function MailboxInputs({ form, setForm }) {
  return (
    <fieldset className="cust-fieldset">
      <legend>Company mailboxes</legend>
      <p className="cust-fieldset__hint">
        Optional. HRMS emails for this company go to (or CC) these addresses.
      </p>
      <div className="cust-fieldset__grid">
        {MAILBOX_FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            <input
              type="email"
              value={form[f.key] || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function slugifyLocal(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

export default function AdminCustomers() {
  const navigate = useNavigate();
  const location = useLocation();
  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [companyQuery, setCompanyQuery] = useState('');

  const [showEdit, setShowEdit] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(null);
  const [showProvision, setShowProvision] = useState(null);
  const [provisionResult, setProvisionResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [siloProvisionLegacy, setSiloProvisionLegacy] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState(
    'Shared-DB SaaS — register company (creates tenant row)'
  );

  const [editForm, setEditForm] = useState(null);
  const editRequestRef = useRef(null);
  const [upgradePlan, setUpgradePlan] = useState('');
  const [provisionOpts, setProvisionOpts] = useState({
    create_database: true,
    create_schema: true,
    seed_admin: true,
    create_uploads: true,
    mark_active: false,
    dry_run: false,
    admin_email: '',
    admin_name: '',
  });

  const token = () => localStorage.getItem('token');
  const headers = () => ({
    Authorization: `Bearer ${token()}`,
    'Content-Type': 'application/json',
  });

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const accessRes = await fetch(API_ACCESS, { headers: headers() });
      const accessData = await accessRes.json().catch(() => ({}));
      if (!accessRes.ok || !accessData.can_view_deployment_guide) {
        navigate('/admin', { replace: true });
        return;
      }
      const res = await fetch(API_CUSTOMERS, { headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to load customers');
      }
      setCustomers(data.customers || []);
      setPlans(data.plans || []);
      setStatuses(data.statuses || []);
      setCounts(data.counts || {});
      setSiloProvisionLegacy(!!data.silo_provision_legacy);
      if (data.phase_label) setPhaseLabel(data.phase_label);
    } catch (err) {
      setError(err.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useRefreshOnNavigate(() => {
    loadCustomers();
  });

  useEffect(() => {
    if (location.search.includes('register=1')) {
      navigate('/admin/customers/register', { replace: true });
      return;
    }
    const notice = location.state?.message;
    if (!notice) return;
    setMessage(notice);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);

  const stats = useMemo(() => {
    return {
      total: customers.length,
      provisioning: counts.provisioning ?? customers.filter((c) => c.status === 'provisioning').length,
      active: counts.active ?? customers.filter((c) => c.status === 'active').length,
      suspended: counts.suspended ?? customers.filter((c) => c.status === 'suspended').length,
    };
  }, [customers, counts]);

  const visibleCustomers = useMemo(
    () => customers.filter((row) => matchesListQuery(companyQuery, [
      row.company_name,
      row.slug,
      row.contact_email,
      row.plan_label,
      row.status_label,
    ])),
    [companyQuery, customers],
  );

  const openRegister = () => navigate('/admin/customers/register');

  const openEdit = async (customer) => {
    editRequestRef.current = customer.id;
    setShowEdit(customer);
    setEditForm({
      ...emptyMailboxes(),
      company_name: customer.company_name || '',
      slug: customer.slug || '',
      contact_email: customer.contact_email || '',
      go_live_date: (customer.go_live_date || '').slice(0, 10),
      notes: customer.notes || '',
      status: customer.status || 'active',
    });
    setError('');
    try {
      const res = await fetch(`${API_CUSTOMERS}/${customer.id}`, { headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || editRequestRef.current !== customer.id) {
        return;
      }
      const detail = data.customer || {};
      const tenant = data.tenant || {};
      const mailboxes = tenant.mailboxes || emptyMailboxes();
      setShowEdit({ ...customer, ...detail });
      setEditForm({
        ...emptyMailboxes(),
        company_name: detail.company_name || customer.company_name || '',
        slug: detail.slug || customer.slug || '',
        contact_email:
          detail.contact_email || tenant.contact_email || customer.contact_email || '',
        go_live_date: (detail.go_live_date || customer.go_live_date || '').slice(0, 10),
        notes: detail.notes || tenant.notes || customer.notes || '',
        status: detail.status || customer.status || 'active',
        mailbox_hr: mailboxes.mailbox_hr || '',
        mailbox_accounts: mailboxes.mailbox_accounts || '',
        mailbox_it: mailboxes.mailbox_it || '',
        mailbox_admin: mailboxes.mailbox_admin || '',
      });
    } catch {
      // Keep list-row values; mailboxes may stay empty until retry.
    }
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    if (!showEdit || !editForm) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_CUSTOMERS}/${showEdit.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify(editForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Update failed');
      }
      setShowEdit(null);
      setEditForm(null);
      setMessage(`Updated ${data.customer?.company_name}`);
      await loadCustomers();
    } catch (err) {
      setError(err.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const patchStatus = async (customer, status) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_CUSTOMERS}/${customer.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Status update failed');
      }
      setMessage(`${data.customer?.company_name} → ${data.customer?.status_label}`);
      await loadCustomers();
    } catch (err) {
      setError(err.message || 'Status update failed');
    } finally {
      setSaving(false);
    }
  };

  const openUpgrade = (customer) => {
    const opts = customer.can_upgrade_to || [];
    if (!opts.length) return;
    setShowUpgrade(customer);
    setUpgradePlan(opts[0]?.id || '');
    setError('');
  };

  const downloadTextFile = (filename, content) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'customer.env';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openProvision = (customer) => {
    setShowProvision(customer);
    setProvisionResult(null);
    setProvisionOpts({
      create_database: true,
      create_schema: true,
      seed_admin: true,
      create_uploads: true,
      mark_active: false,
      dry_run: false,
      admin_email: customer.contact_email || '',
      admin_name: '',
    });
    setError('');
  };

  const downloadEnvOnly = async (customer) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_CUSTOMERS}/${customer.id}/env-template`, {
        headers: headers(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to generate .env');
      }
      downloadTextFile(data.env_filename || `${customer.slug || 'customer'}.env`, data.env_file || '');
      setMessage(`Downloaded .env for ${customer.company_name}`);
    } catch (err) {
      setError(err.message || 'Failed to generate .env');
    } finally {
      setSaving(false);
    }
  };

  const submitProvision = async (e) => {
    e.preventDefault();
    if (!showProvision) return;
    if (provisionOpts.seed_admin && !String(provisionOpts.admin_email || '').trim()) {
      setError('Admin email is required to seed the company Super Admin');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        create_database: !!provisionOpts.create_database,
        create_schema: !!provisionOpts.create_schema,
        seed_admin: !!provisionOpts.seed_admin,
        create_uploads: !!provisionOpts.create_uploads,
        mark_active: !!provisionOpts.mark_active,
        admin_email: provisionOpts.admin_email || undefined,
        admin_name: provisionOpts.admin_name || undefined,
      };
      if (provisionOpts.dry_run) body.dry_run = true;
      const res = await fetch(`${API_CUSTOMERS}/${showProvision.id}/provision`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Provisioning failed');
      }
      setProvisionResult(data);
      setMessage(
        data.dry_run
          ? `Dry-run complete for ${data.customer?.company_name}`
          : `Provisioned ${data.customer?.company_name}`
      );
      await loadCustomers();
    } catch (err) {
      setError(err.message || 'Provisioning failed');
    } finally {
      setSaving(false);
    }
  };

  const submitUpgrade = async (e) => {
    e.preventDefault();
    if (!showUpgrade || !upgradePlan) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_CUSTOMERS}/${showUpgrade.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ plan: upgradePlan }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Upgrade failed');
      }
      setShowUpgrade(null);
      setMessage(
        `${data.customer?.company_name} upgraded to ${data.customer?.plan_label}`
      );
      await loadCustomers();
    } catch (err) {
      setError(err.message || 'Upgrade failed');
    } finally {
      setSaving(false);
    }
  };

  const canGo = (customer, status) =>
    (customer.allowed_next_statuses || []).some((s) => s.id === status);

  return (
    <div className="cust-page">
      <div className="cust-shell">
        <header className="cust-hero">
          <div className="cust-hero__main">
            <h1>Customer registry</h1>
            <p>{phaseLabel}</p>
            <div className="cust-hero__meta">
              <button
                type="button"
                className="cust-link-btn"
                onClick={() => navigate('/admin/deployment-guide')}
              >
                Deployment checklist →
              </button>
            </div>
          </div>
          <div className="cust-hero__aside">
            <span className="cust-hero__badge">Super Admin</span>
            <button type="button" className="cust-add-btn" onClick={openRegister}>
              + Register company
            </button>
          </div>
        </header>

        {!loading && customers.length > 0 && (
          <div className="cust-stats cust-stats--4">
            <div className="cust-stat">
              <span className="cust-stat__label">Companies</span>
              <strong>{stats.total}</strong>
            </div>
            <div className="cust-stat">
              <span className="cust-stat__label">Provisioning</span>
              <strong>{stats.provisioning}</strong>
            </div>
            <div className="cust-stat">
              <span className="cust-stat__label">Active</span>
              <strong>{stats.active}</strong>
            </div>
            <div className="cust-stat">
              <span className="cust-stat__label">Suspended</span>
              <strong>{stats.suspended}</strong>
            </div>
          </div>
        )}

        {message && <p className="cust-message">{message}</p>}
        {error && !showUpgrade && !showEdit && !showProvision && (
          <p className="cust-error" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="cust-panel">
            <p className="cust-panel__empty">Loading registry…</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="cust-empty">
            <span className="cust-empty__icon" aria-hidden>🏗️</span>
            <h2>No companies registered</h2>
            <p>
              Register a company and choose Basic / Essential / Enterprise.
              This creates a tenant row in the shared database (no separate MySQL DB).
            </p>
            <button
              type="button"
              className="cust-add-btn cust-add-btn--inline"
              onClick={openRegister}
            >
              Register your first company
            </button>
          </div>
        ) : (
          <div className="cust-panel">
            <div className="cust-toolbar">
              <label className="cust-search">
                <span>Search</span>
                <input
                  value={companyQuery}
                  onChange={(event) => setCompanyQuery(event.target.value)}
                  placeholder="Company, slug, contact, plan"
                />
              </label>
            </div>
            <div className="cust-table-wrap">
              <table className="cust-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Plan</th>
                    <th>Contact</th>
                    <th>Go-live</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCustomers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="cust-panel__empty">No companies match that search.</td>
                    </tr>
                  )}
                  {visibleCustomers.map((c) => (
                    <tr key={c.id}>
                      <td className="cust-table__name">
                        <div>{c.company_name}</div>
                        {c.slug ? (
                          <div className="cust-mono cust-slug">{c.slug}</div>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`cust-plan ${PLAN_BADGE_CLASS[c.plan] || ''}`}
                        >
                          {c.plan_label}
                        </span>
                      </td>
                      <td className="cust-table__contact">
                        {c.contact_email || '—'}
                      </td>
                      <td>{formatDate(c.go_live_date)}</td>
                      <td>
                        <span className={`cust-status cust-status--${c.status}`}>
                          {c.status_label || c.status}
                        </span>
                      </td>
                      <td className="cust-table__actions">
                        <button
                          type="button"
                          className="cust-action-btn"
                          onClick={() => openEdit(c)}
                          disabled={saving}
                        >
                          Edit
                        </button>
                        {siloProvisionLegacy && c.status !== 'cancelled' && (
                          <button
                            type="button"
                            className="cust-action-btn cust-action-btn--provision"
                            onClick={() => openProvision(c)}
                            disabled={saving}
                          >
                            Provision
                          </button>
                        )}
                        {siloProvisionLegacy && (
                          <button
                            type="button"
                            className="cust-action-btn"
                            onClick={() => downloadEnvOnly(c)}
                            disabled={saving}
                            title="Download .env template (legacy silo)"
                          >
                            .env
                          </button>
                        )}
                        {canGo(c, 'active') && (
                          <button
                            type="button"
                            className="cust-action-btn cust-action-btn--ok"
                            onClick={() => patchStatus(c, 'active')}
                            disabled={saving}
                          >
                            Activate
                          </button>
                        )}
                        {canGo(c, 'suspended') && (
                          <button
                            type="button"
                            className="cust-action-btn cust-action-btn--warn"
                            onClick={() => patchStatus(c, 'suspended')}
                            disabled={saving}
                          >
                            Suspend
                          </button>
                        )}
                        {c.can_upgrade_to?.length > 0 ? (
                          <button
                            type="button"
                            className="cust-upgrade-btn"
                            onClick={() => openUpgrade(c)}
                            disabled={saving}
                          >
                            Upgrade
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>


      {showEdit && editForm && (
        <div className="cust-modal-backdrop" role="presentation">
          <div
            className="cust-modal cust-modal--register"
            role="dialog"
            aria-labelledby="cust-edit-title"
          >
            <header className="cust-modal__header">
              <div>
                <p className="cust-modal__eyebrow">Shared-DB SaaS</p>
                <h2 id="cust-edit-title">Edit company</h2>
              </div>
              <button
                type="button"
                className="cust-modal__close"
                onClick={() => {
                  setShowEdit(null);
                  setEditForm(null);
                }}
                disabled={saving}
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <form onSubmit={submitEdit} className="cust-form cust-form--register">
              <section className="cust-form-section">
                <h3 className="cust-form-section__title">Company</h3>
                <div className="cust-form-section__grid">
                  <label className="cust-field cust-field--full">
                    Company name *
                    <input
                      value={editForm.company_name}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, company_name: e.target.value }))
                      }
                      required
                    />
                  </label>
                  <label className="cust-field">
                    Slug
                    <input
                      value={editForm.slug}
                      onChange={(e) =>
                        setEditForm((f) => ({
                          ...f,
                          slug: slugifyLocal(e.target.value),
                        }))
                      }
                    />
                  </label>
                  <label className="cust-field">
                    Status
                    <select
                      value={editForm.status}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, status: e.target.value }))
                      }
                    >
                      <option value={showEdit.status}>
                        {showEdit.status_label || showEdit.status}
                      </option>
                      {(showEdit.allowed_next_statuses || []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="cust-field">
                    Contact email
                    <input
                      type="email"
                      value={editForm.contact_email}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, contact_email: e.target.value }))
                      }
                    />
                  </label>
                  <label className="cust-field">
                    Go-live date
                    <input
                      type="date"
                      value={editForm.go_live_date || ''}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, go_live_date: e.target.value }))
                      }
                    />
                  </label>
                </div>
              </section>

              <MailboxInputs form={editForm} setForm={setEditForm} />

              <label className="cust-field cust-field--full">
                Notes
                <textarea
                  rows={2}
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </label>
              {error && <p className="cust-error">{error}</p>}
              <div className="cust-modal-actions">
                <button
                  type="button"
                  className="cust-btn cust-btn--ghost"
                  onClick={() => {
                    setShowEdit(null);
                    setEditForm(null);
                  }}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cust-btn cust-btn--primary"
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showUpgrade && (
        <div className="cust-modal-backdrop" role="presentation">
          <div className="cust-modal cust-modal--compact" role="dialog" aria-labelledby="cust-upgrade-title">
            <h2 id="cust-upgrade-title">Upgrade plan</h2>
            <p className="cust-upgrade-lead">
              <strong>{showUpgrade.company_name}</strong> is on{' '}
              <span
                className={`cust-plan ${PLAN_BADGE_CLASS[showUpgrade.plan] || ''}`}
              >
                {showUpgrade.plan_label}
              </span>
            </p>
            <form onSubmit={submitUpgrade} className="cust-form cust-form--single">
              <label>
                New plan
                <select
                  value={upgradePlan}
                  onChange={(e) => setUpgradePlan(e.target.value)}
                >
                  {showUpgrade.can_upgrade_to.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {error && <p className="cust-error">{error}</p>}
              <div className="cust-modal-actions">
                <button
                  type="button"
                  className="cust-btn cust-btn--ghost"
                  onClick={() => setShowUpgrade(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cust-btn cust-btn--primary"
                  disabled={saving}
                >
                  {saving ? 'Upgrading…' : 'Confirm upgrade'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showProvision && !provisionResult && (
        <div className="cust-modal-backdrop" role="presentation">
          <div className="cust-modal" role="dialog" aria-labelledby="cust-prov-title">
            <h2 id="cust-prov-title">Provision company</h2>
            <p className="cust-modal-lead">
              Phase 2 for <strong>{showProvision.company_name}</strong>
              {showProvision.database_name
                ? ` → DB \`${showProvision.database_name}\``
                : ''}
              . Live MySQL create needs <code>PROVISION_MYSQL_*</code> on the
              vendor master; otherwise this runs as a dry-run.
            </p>
            <form onSubmit={submitProvision} className="cust-form">
              <label className="cust-check">
                <input
                  type="checkbox"
                  checked={provisionOpts.create_database}
                  onChange={(e) =>
                    setProvisionOpts((o) => ({
                      ...o,
                      create_database: e.target.checked,
                    }))
                  }
                />
                Create database
              </label>
              <label className="cust-check">
                <input
                  type="checkbox"
                  checked={provisionOpts.create_schema}
                  onChange={(e) =>
                    setProvisionOpts((o) => ({
                      ...o,
                      create_schema: e.target.checked,
                    }))
                  }
                />
                Apply HRMS schema
              </label>
              <label className="cust-check">
                <input
                  type="checkbox"
                  checked={provisionOpts.seed_admin}
                  onChange={(e) =>
                    setProvisionOpts((o) => ({
                      ...o,
                      seed_admin: e.target.checked,
                    }))
                  }
                />
                Seed company Super Admin
              </label>
              <label className="cust-check">
                <input
                  type="checkbox"
                  checked={provisionOpts.create_uploads}
                  onChange={(e) =>
                    setProvisionOpts((o) => ({
                      ...o,
                      create_uploads: e.target.checked,
                    }))
                  }
                />
                Create uploads folder
              </label>
              <label className="cust-check">
                <input
                  type="checkbox"
                  checked={provisionOpts.mark_active}
                  onChange={(e) =>
                    setProvisionOpts((o) => ({
                      ...o,
                      mark_active: e.target.checked,
                    }))
                  }
                />
                Mark Active when done (live only)
              </label>
              <label className="cust-check">
                <input
                  type="checkbox"
                  checked={provisionOpts.dry_run}
                  onChange={(e) =>
                    setProvisionOpts((o) => ({
                      ...o,
                      dry_run: e.target.checked,
                    }))
                  }
                />
                Force dry-run (no MySQL writes)
              </label>
              {provisionOpts.seed_admin && (
                <>
                  <label>
                    Admin email *
                    <input
                      type="email"
                      required
                      value={provisionOpts.admin_email}
                      onChange={(e) =>
                        setProvisionOpts((o) => ({
                          ...o,
                          admin_email: e.target.value,
                        }))
                      }
                      placeholder="admin@acme.com"
                    />
                  </label>
                  <label>
                    Admin display name
                    <input
                      value={provisionOpts.admin_name}
                      onChange={(e) =>
                        setProvisionOpts((o) => ({
                          ...o,
                          admin_name: e.target.value,
                        }))
                      }
                      placeholder="Acme Admin"
                    />
                  </label>
                </>
              )}
              {error && <p className="cust-error">{error}</p>}
              <div className="cust-modal-actions">
                <button
                  type="button"
                  className="cust-btn cust-btn--ghost"
                  onClick={() => setShowProvision(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cust-btn cust-btn--primary"
                  disabled={saving}
                >
                  {saving ? 'Provisioning…' : 'Run provision'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showProvision && provisionResult && (
        <div className="cust-modal-backdrop" role="presentation">
          <div className="cust-modal cust-modal--wide" role="dialog" aria-labelledby="cust-prov-result">
            <h2 id="cust-prov-result">
              {provisionResult.dry_run ? 'Dry-run result' : 'Provision result'}
            </h2>
            <p className="cust-modal-lead">{provisionResult.message}</p>
            <ul className="cust-steps">
              {(provisionResult.steps || []).map((s) => (
                <li key={s.id} className={s.ok ? 'cust-steps__ok' : 'cust-steps__bad'}>
                  <strong>{s.id}</strong>
                  {s.dry_run ? ' (dry-run) — ' : ' — '}
                  {s.message}
                </li>
              ))}
            </ul>
            {provisionResult.seed_admin?.password && (
              <div className="cust-seed-box">
                <p>
                  <strong>Seed Super Admin</strong> (copy now — shown once)
                </p>
                <p className="cust-mono">
                  {provisionResult.seed_admin.email} / {provisionResult.seed_admin.password}
                </p>
              </div>
            )}
            <ol className="cust-next">
              {(provisionResult.next_steps || []).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ol>
            <div className="cust-modal-actions">
              <button
                type="button"
                className="cust-btn cust-btn--ghost"
                onClick={() => {
                  setShowProvision(null);
                  setProvisionResult(null);
                }}
              >
                Close
              </button>
              {provisionResult.env_file && (
                <button
                  type="button"
                  className="cust-btn cust-btn--primary"
                  onClick={() =>
                    downloadTextFile(
                      provisionResult.env_filename || 'customer.env',
                      provisionResult.env_file
                    )
                  }
                >
                  Download .env
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
