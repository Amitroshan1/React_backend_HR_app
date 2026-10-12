import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import './AdminCustomers.css';

const API_ACCESS = '/api/admin/deployment-guide/access';
const API_CUSTOMERS = '/api/admin/customers';

const MAILBOX_FIELDS = [
  { key: 'mailbox_hr', label: 'HR mailbox', placeholder: 'hr@acme.com' },
  { key: 'mailbox_accounts', label: 'Accounts mailbox', placeholder: 'accounts@acme.com' },
  { key: 'mailbox_it', label: 'IT mailbox', placeholder: 'it@acme.com' },
  { key: 'mailbox_admin', label: 'Admin mailbox', placeholder: 'admin@acme.com' },
];

const FALLBACK_PLANS = [
  { id: 'basic', label: 'Basic' },
  { id: 'essential', label: 'Essential' },
  { id: 'enterprise', label: 'Enterprise' },
];

const FALLBACK_STATUSES = [
  { id: 'provisioning', label: 'Provisioning' },
  { id: 'active', label: 'Active' },
];

const emptyMailboxes = () =>
  Object.fromEntries(MAILBOX_FIELDS.map((field) => [field.key, '']));

const emptyForm = () => ({
  ...emptyMailboxes(),
  company_name: '',
  slug: '',
  plan: 'essential',
  status: 'active',
  contact_email: '',
  go_live_date: '',
  notes: '',
  admin_email: '',
  admin_name: '',
  admin_mobile: '',
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

export default function AdminRegisterCompany() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState(emptyForm);
  const [plans, setPlans] = useState(FALLBACK_PLANS);
  const [statuses, setStatuses] = useState(FALLBACK_STATUSES);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  const token = () => localStorage.getItem('token');
  const headers = () => ({
    Authorization: `Bearer ${token()}`,
    'Content-Type': 'application/json',
  });

  const loadMeta = useCallback(async () => {
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
      if (res.ok && data.success) {
        if (data.plans?.length) setPlans(data.plans);
        if (data.statuses?.length) setStatuses(data.statuses);
      }
    } catch (err) {
      setError(err.message || 'Could not load registration options');
    } finally {
      setReady(true);
    }
  }, [navigate]);

  useRefreshOnNavigate(loadMeta);

  useEffect(() => {
    const prefill = location.state;
    if (!prefill) return;
    setForm((current) => ({
      ...current,
      company_name: prefill.company_name || current.company_name,
      plan: prefill.plan || current.plan,
      slug: prefill.slug ? slugifyLocal(prefill.slug) : current.slug,
      admin_email: prefill.admin_email || current.admin_email,
    }));
  }, [location.state]);

  const onCompanyName = (value) => {
    setForm((current) => ({
      ...current,
      company_name: value,
      slug: slugifyLocal(value),
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.company_name.trim()) {
      setError('Company name is required');
      return;
    }
    if (!form.admin_email.trim()) {
      setError('First admin email is required so the company can sign in');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        company_name: form.company_name.trim(),
        slug: form.slug.trim() || undefined,
        plan: form.plan,
        status: form.status || 'active',
        contact_email: form.contact_email.trim() || undefined,
        go_live_date: form.go_live_date || undefined,
        notes: form.notes.trim() || undefined,
        admin_email: form.admin_email.trim(),
        admin_name: form.admin_name.trim() || undefined,
        admin_mobile: form.admin_mobile.trim() || undefined,
        mailbox_hr: form.mailbox_hr.trim() || undefined,
        mailbox_accounts: form.mailbox_accounts.trim() || undefined,
        mailbox_it: form.mailbox_it.trim() || undefined,
        mailbox_admin: form.mailbox_admin.trim() || undefined,
      };
      const res = await fetch(API_CUSTOMERS, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to register company');
      }
      const tid = data.tenant?.id;
      const firstAdmin = data.tenant_admin;
      const message =
        `Registered ${data.customer?.company_name || 'company'} (${data.customer?.plan_label})` +
        (tid ? ` — tenant #${tid}` : '') +
        (firstAdmin ? ` — admin ${firstAdmin.email} (${firstAdmin.emp_id}) can log in with OTP` : '');
      navigate('/admin/customers', { state: { message } });
    } catch (err) {
      setError(err.message || 'Failed to register company');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cust-page cust-register-page">
      <div className="cust-shell">
        <header className="cust-hero">
          <div className="cust-hero__main">
            <h1>Register company</h1>
            <p>
              Creates a tenant in the shared database. Everyone uses the same app URL.
              Isolation is by tenant after login.
            </p>
          </div>
        </header>

        {!ready ? (
          <p className="cust-panel__empty">Loading form…</p>
        ) : (
          <form onSubmit={submit} className="cust-form cust-form--page">
            <section className="cust-form-section">
              <h3 className="cust-form-section__title">Company</h3>
              <div className="cust-form-section__grid">
                <label className="cust-field cust-field--full">
                  Company name *
                  <input
                    value={form.company_name}
                    onChange={(event) => onCompanyName(event.target.value)}
                    required
                    placeholder="Acme Corp"
                    autoFocus
                  />
                </label>
                <label className="cust-field">
                  Slug
                  <input
                    value={form.slug}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        slug: slugifyLocal(event.target.value),
                      }))
                    }
                    placeholder="acme_corp"
                  />
                  <span className="cust-field__hint">Short id used internally</span>
                </label>
                <label className="cust-field">
                  Subscription plan *
                  <select
                    value={form.plan}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, plan: event.target.value }))
                    }
                  >
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>{plan.label}</option>
                    ))}
                  </select>
                </label>
                <label className="cust-field">
                  Initial status
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, status: event.target.value }))
                    }
                  >
                    {statuses
                      .filter((status) => ['provisioning', 'active'].includes(status.id))
                      .map((status) => (
                        <option key={status.id} value={status.id}>{status.label}</option>
                      ))}
                  </select>
                </label>
                <label className="cust-field">
                  Contact email
                  <input
                    type="email"
                    value={form.contact_email}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, contact_email: event.target.value }))
                    }
                    placeholder="ops@acme.com"
                  />
                </label>
                <label className="cust-field">
                  Go-live date
                  <input
                    type="date"
                    value={form.go_live_date}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, go_live_date: event.target.value }))
                    }
                  />
                </label>
              </div>
            </section>

            <section className="cust-form-section cust-form-section--accent">
              <h3 className="cust-form-section__title">First company admin *</h3>
              <p className="cust-form-section__hint">
                Seeds the Super Admin for this tenant. They sign in on the same login page with OTP.
              </p>
              <div className="cust-form-section__grid">
                <label className="cust-field cust-field--full">
                  Admin email *
                  <input
                    type="email"
                    value={form.admin_email}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, admin_email: event.target.value }))
                    }
                    required
                    placeholder="admin@acme.com"
                  />
                </label>
                <label className="cust-field">
                  Admin name
                  <input
                    value={form.admin_name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, admin_name: event.target.value }))
                    }
                    placeholder="Acme Admin"
                  />
                </label>
                <label className="cust-field">
                  Admin mobile
                  <input
                    type="tel"
                    value={form.admin_mobile}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, admin_mobile: event.target.value }))
                    }
                    placeholder="9876543210"
                  />
                </label>
              </div>
            </section>

            <fieldset className="cust-fieldset">
              <legend>Company mailboxes</legend>
              <p className="cust-fieldset__hint">
                Optional. HRMS emails for this company go to (or CC) these addresses.
              </p>
              <div className="cust-fieldset__grid">
                {MAILBOX_FIELDS.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <input
                      type="email"
                      value={form[field.key] || ''}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                      placeholder={field.placeholder}
                    />
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="cust-field cust-field--full">
              Notes
              <textarea
                rows={3}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="Internal notes for platform ops"
              />
            </label>

            {error ? <p className="cust-error">{error}</p> : null}
            <div className="cust-modal-actions">
              <button
                type="button"
                className="cust-btn cust-btn--ghost"
                onClick={() => navigate('/admin/customers')}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="cust-btn cust-btn--primary" disabled={saving}>
                {saving ? 'Creating tenant…' : 'Create tenant'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
