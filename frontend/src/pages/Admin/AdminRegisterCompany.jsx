import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import './AdminCustomers.css';
import CountryField from './CountryField';
import { canManageCustomerRegistry } from './customerRegistryAccess';
import { getAccessToken } from "../../utils/authSession";

const API_CUSTOMERS = '/api/admin/customers';

const FALLBACK_PLANS = [
  { id: 'basic', label: 'Basic' },
  { id: 'essential', label: 'Essential' },
  { id: 'enterprise', label: 'Enterprise' },
];

const FALLBACK_STATUSES = [
  { id: 'provisioning', label: 'Provisioning' },
  { id: 'active', label: 'Active' },
];

const emptyForm = () => ({
  company_name: '',
  slug: '',
  plan: 'essential',
  status: 'active',
  country: '',
  go_live_date: '',
  notes: '',
  admin_email: '',
  admin_name: '',
  admin_mobile: '',
  send_kyb_invite: true,
  kyb_different_inbox: false,
  kyb_email: '',
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

  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    const access = getAccessToken();
    if (access) h.Authorization = `Bearer ${access}`;
    return h;
  };

  const loadMeta = useCallback(async () => {
    setError('');
    try {
      if (!await canManageCustomerRegistry(headers())) {
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
    const adminEmail = form.admin_email.trim().toLowerCase();
    if (!adminEmail || !adminEmail.includes('@')) {
      setError('First admin email is required so the company can sign in');
      return;
    }
    const kybRecipient = form.send_kyb_invite && form.kyb_different_inbox
      ? form.kyb_email.trim().toLowerCase()
      : adminEmail;
    if (form.send_kyb_invite && (!kybRecipient || !kybRecipient.includes('@'))) {
      setError('Enter the inbox that should receive the verification link.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        company_name: form.company_name.trim(),
        slug: form.slug.trim() || undefined,
        plan: form.plan,
        status: form.send_kyb_invite ? 'provisioning' : (form.status || 'active'),
        send_kyb_invite: Boolean(form.send_kyb_invite),
        skip_kyb: !form.send_kyb_invite,
        kyb_email: form.send_kyb_invite ? kybRecipient : undefined,
        contact_email: adminEmail,
        country: form.country.trim(),
        go_live_date: form.go_live_date || undefined,
        notes: form.notes.trim() || undefined,
        admin_email: adminEmail,
        admin_name: form.admin_name.trim() || undefined,
        admin_mobile: form.admin_mobile.trim() || undefined,
      };
      const res = await fetch(API_CUSTOMERS, {
        method: 'POST',
        credentials: 'include',
        headers: headers(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to register company');
      }
      const tid = data.tenant?.id;
      const firstAdmin = data.tenant_admin;
      const kyb = data.kyb;
      const message =
        `Registered ${data.customer?.company_name || 'company'} (${data.customer?.plan_label})` +
        (tid ? ` — tenant #${tid}` : '') +
        (firstAdmin && !form.send_kyb_invite ? ` — admin ${firstAdmin.email} (${firstAdmin.emp_id}) can log in with OTP` : '') +
        (kyb?.email_sent ? ` — verification link emailed to ${kyb.email}` : '') +
        (kyb && !kyb.email_sent
          ? ` — email was not sent${kyb.email_error ? ` (${kyb.email_error})` : ''}${kyb.invite_url ? `. Copy this link: ${kyb.invite_url}` : ''}`
          : '');
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
                {!form.send_kyb_invite ? (
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
                ) : null}
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
                <CountryField
                  value={form.country}
                  required
                  onChange={(country) => setForm((current) => ({ ...current, country }))}
                />
              </div>
            </section>

            <section className="cust-form-section cust-form-section--accent">
              <h3 className="cust-form-section__title">First company admin *</h3>
              <p className="cust-form-section__hint">
                This address is used for login, company contact, and the KYB link unless you send KYB to a different inbox.
                They sign in on the same login page with OTP. They cannot use Super Admin.
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
                    placeholder="person@company.com"
                  />
                </label>
                <label className="cust-field">
                  Admin name
                  <input
                    value={form.admin_name}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, admin_name: event.target.value }))
                    }
                    placeholder="Full name"
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

            <section className="cust-form-section">
              <h3 className="cust-form-section__title">Company verification (KYB)</h3>
              <p className="cust-form-section__hint">
                Customer gets a private link to confirm company name, contact, country, legal details, and
                upload incorporation / GST / PAN proofs. Plan and slug stay as you set them. The company
                stays in provisioning until you approve after they submit.
              </p>
              <label className="cust-field cust-field--full">
                <input
                  type="checkbox"
                  checked={form.send_kyb_invite}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      send_kyb_invite: event.target.checked,
                      kyb_different_inbox: event.target.checked ? current.kyb_different_inbox : false,
                    }))
                  }
                />
                {' '}Send onboarding / document link
              </label>
              {form.send_kyb_invite ? (
                <>
                  <p className="cust-field__hint">
                    The link is emailed to {form.admin_email.trim() || 'the admin email'} unless you choose a different inbox.
                  </p>
                  <label className="cust-field cust-field--full">
                    <input
                      type="checkbox"
                      checked={form.kyb_different_inbox}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          kyb_different_inbox: event.target.checked,
                        }))
                      }
                    />
                    {' '}Send KYB to a different inbox
                  </label>
                  {form.kyb_different_inbox ? (
                    <label className="cust-field cust-field--full">
                      KYB recipient email
                      <input
                        type="email"
                        value={form.kyb_email}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, kyb_email: event.target.value }))
                        }
                        placeholder="person@company.com"
                        required
                      />
                    </label>
                  ) : null}
                </>
              ) : (
                <p className="cust-field__hint">Skip only for internal/demo companies you already know.</p>
              )}
            </section>

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
