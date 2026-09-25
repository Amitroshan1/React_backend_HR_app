import React, { useCallback, useMemo, useState } from 'react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { useNavigate } from 'react-router-dom';
import './AdminCustomers.css';
import { formatDate } from '../../utils/dateFormat';

const API_ACCESS = '/api/admin/deployment-guide/access';
const API_CUSTOMERS = '/api/admin/customers';

const PLAN_BADGE_CLASS = {
  basic: 'cust-plan--basic',
  essential: 'cust-plan--essential',
  enterprise: 'cust-plan--enterprise',
};

const emptyAddForm = () => ({
  company_name: '',
  slug: '',
  plan: 'essential',
  status: 'active',
  app_url: '',
  database_name: '',
  contact_email: '',
  go_live_date: '',
  notes: '',
});

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

function suggestDb(name, slug) {
  const base = (slug || slugifyLocal(name) || 'company').slice(0, 48);
  return `hrms_${base}`.slice(0, 64);
}

export default function AdminCustomers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [showEdit, setShowEdit] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(null);
  const [showProvision, setShowProvision] = useState(null);
  const [provisionResult, setProvisionResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dbAuto, setDbAuto] = useState(true);
  const [siloProvisionLegacy, setSiloProvisionLegacy] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState(
    'Shared-DB SaaS — register company (creates tenant row)'
  );

  const [addForm, setAddForm] = useState(emptyAddForm);
  const [editForm, setEditForm] = useState(null);
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

  const stats = useMemo(() => {
    return {
      total: customers.length,
      provisioning: counts.provisioning ?? customers.filter((c) => c.status === 'provisioning').length,
      active: counts.active ?? customers.filter((c) => c.status === 'active').length,
      suspended: counts.suspended ?? customers.filter((c) => c.status === 'suspended').length,
    };
  }, [customers, counts]);

  const openAdd = () => {
    setAddForm(emptyAddForm());
    setDbAuto(true);
    setShowAdd(true);
    setMessage('');
    setError('');
  };

  const onAddCompanyName = (value) => {
    setAddForm((f) => {
      const slug = slugifyLocal(value);
      const next = { ...f, company_name: value, slug };
      if (dbAuto) next.database_name = suggestDb(value, slug);
      return next;
    });
  };

  const submitAdd = async (e) => {
    e.preventDefault();
    if (!addForm.company_name.trim()) {
      setError('Company name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(API_CUSTOMERS, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(addForm),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to register company');
      }
      setShowAdd(false);
      const tid = data.tenant?.id;
      setMessage(
        `Registered ${data.customer?.company_name || 'company'} (${data.customer?.plan_label})` +
          (tid ? ` — tenant #${tid}` : '')
      );
      await loadCustomers();
    } catch (err) {
      setError(err.message || 'Failed to register company');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (customer) => {
    setShowEdit(customer);
    setEditForm({
      company_name: customer.company_name || '',
      slug: customer.slug || '',
      app_url: customer.app_url || '',
      database_name: customer.database_name || '',
      contact_email: customer.contact_email || '',
      go_live_date: customer.go_live_date || '',
      notes: customer.notes || '',
      status: customer.status || 'provisioning',
    });
    setError('');
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
            <button type="button" className="cust-add-btn" onClick={openAdd}>
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
        {error && !showAdd && !showUpgrade && !showEdit && !showProvision && (
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
              onClick={openAdd}
            >
              Register your first company
            </button>
          </div>
        ) : (
          <div className="cust-panel">
            <div className="cust-table-wrap">
              <table className="cust-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Plan</th>
                    <th>URL</th>
                    <th>Database</th>
                    <th>Go-live</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
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
                      <td>
                        {c.app_url ? (
                          <a href={c.app_url} target="_blank" rel="noreferrer">
                            {c.app_url.replace(/^https?:\/\//, '')}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="cust-mono">{c.database_name || '—'}</td>
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

      {showAdd && (
        <div className="cust-modal-backdrop" role="presentation">
          <div className="cust-modal" role="dialog" aria-labelledby="cust-add-title">
            <h2 id="cust-add-title">Register company</h2>
            <p className="cust-modal-lead">
              Creates a <strong>tenant</strong> in the shared HRMS database
              (same app URL for all companies). Default status is Active.
            </p>
            <form onSubmit={submitAdd} className="cust-form">
              <label>
                Company name *
                <input
                  value={addForm.company_name}
                  onChange={(e) => onAddCompanyName(e.target.value)}
                  required
                  placeholder="Acme Corp"
                />
              </label>
              <label>
                Slug
                <input
                  value={addForm.slug}
                  onChange={(e) => {
                    const slug = slugifyLocal(e.target.value);
                    setAddForm((f) => ({
                      ...f,
                      slug,
                      database_name: dbAuto ? suggestDb(f.company_name, slug) : f.database_name,
                    }));
                  }}
                  placeholder="acme_corp"
                />
              </label>
              <label>
                Subscription plan *
                <select
                  value={addForm.plan}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, plan: e.target.value }))
                  }
                >
                  {(plans.length
                    ? plans
                    : [
                        { id: 'basic', label: 'Basic' },
                        { id: 'essential', label: 'Essential' },
                        { id: 'enterprise', label: 'Enterprise' },
                      ]
                  ).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Initial status
                <select
                  value={addForm.status}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, status: e.target.value }))
                  }
                >
                  {(statuses.length
                    ? statuses
                    : [
                        { id: 'provisioning', label: 'Provisioning' },
                        { id: 'active', label: 'Active' },
                      ]
                  )
                    .filter((s) =>
                      ['provisioning', 'active'].includes(s.id)
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Login URL
                <input
                  type="url"
                  value={addForm.app_url}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, app_url: e.target.value }))
                  }
                  placeholder="https://hr.acme.com"
                />
              </label>
              <label>
                Database name
                <input
                  value={addForm.database_name}
                  onChange={(e) => {
                    setDbAuto(false);
                    setAddForm((f) => ({ ...f, database_name: e.target.value }));
                  }}
                  placeholder="hrms_acme_corp"
                />
              </label>
              <label>
                Contact email
                <input
                  type="email"
                  value={addForm.contact_email}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, contact_email: e.target.value }))
                  }
                />
              </label>
              <label>
                Go-live date
                <input
                  type="date"
                  value={addForm.go_live_date}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, go_live_date: e.target.value }))
                  }
                />
              </label>
              <label>
                Notes
                <textarea
                  rows={2}
                  value={addForm.notes}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, notes: e.target.value }))
                  }
                />
              </label>
              {error && <p className="cust-error">{error}</p>}
              <div className="cust-modal-actions">
                <button
                  type="button"
                  className="cust-btn cust-btn--ghost"
                  onClick={() => setShowAdd(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cust-btn cust-btn--primary"
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Register company'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEdit && editForm && (
        <div className="cust-modal-backdrop" role="presentation">
          <div className="cust-modal" role="dialog" aria-labelledby="cust-edit-title">
            <h2 id="cust-edit-title">Edit company</h2>
            <form onSubmit={submitEdit} className="cust-form">
              <label>
                Company name *
                <input
                  value={editForm.company_name}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, company_name: e.target.value }))
                  }
                  required
                />
              </label>
              <label>
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
              <label>
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
              <label>
                Login URL
                <input
                  type="url"
                  value={editForm.app_url}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, app_url: e.target.value }))
                  }
                />
              </label>
              <label>
                Database name
                <input
                  value={editForm.database_name}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, database_name: e.target.value }))
                  }
                />
              </label>
              <label>
                Contact email
                <input
                  type="email"
                  value={editForm.contact_email}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, contact_email: e.target.value }))
                  }
                />
              </label>
              <label>
                Go-live date
                <input
                  type="date"
                  value={editForm.go_live_date || ''}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, go_live_date: e.target.value }))
                  }
                />
              </label>
              <label>
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
