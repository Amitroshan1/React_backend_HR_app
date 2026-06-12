import React, { useCallback, useState } from 'react';
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

export default function AdminCustomers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(null);
  const [saving, setSaving] = useState(false);

  const [addForm, setAddForm] = useState({
    company_name: '',
    plan: 'essential',
    app_url: '',
    database_name: '',
    contact_email: '',
    go_live_date: '',
    notes: '',
  });

  const [upgradePlan, setUpgradePlan] = useState('');

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
    } catch (err) {
      setError(err.message || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useRefreshOnNavigate(() => {
    loadCustomers();
  });

  const openAdd = () => {
    setAddForm({
      company_name: '',
      plan: 'essential',
      app_url: '',
      database_name: '',
      contact_email: '',
      go_live_date: '',
      notes: '',
    });
    setShowAdd(true);
    setMessage('');
    setError('');
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
        throw new Error(data.message || 'Failed to add customer');
      }
      setShowAdd(false);
      setMessage(`Added ${data.customer?.company_name || 'customer'}`);
      await loadCustomers();
      if (window.confirm('Open deployment checklist for this customer?')) {
        navigate('/admin/deployment-guide', {
          state: {
            customerName: data.customer?.company_name,
            customerPlan: data.customer?.plan,
            customerUrl: data.customer?.app_url,
            customerDb: data.customer?.database_name,
          },
        });
      }
    } catch (err) {
      setError(err.message || 'Failed to add customer');
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

  return (
    <div className="cust-page">
      <header className="cust-header">
        <div>
          <button
            type="button"
            className="cust-back"
            onClick={() => navigate('/admin')}
          >
            ← Admin Management
          </button>
          <h1>Customer deployments</h1>
          <p className="cust-sub">
            Companies on separate server &amp; database — plan and upgrades
          </p>
        </div>
        <button type="button" className="cust-add-btn" onClick={openAdd}>
          + Add new customer
        </button>
      </header>

      {message && <p className="cust-message">{message}</p>}
      {error && !showAdd && !showUpgrade && (
        <p className="cust-error" role="alert">
          {error}
        </p>
      )}

      <div className="cust-toolbar">
        <button
          type="button"
          className="cust-link-btn"
          onClick={() => navigate('/admin/deployment-guide')}
        >
          Deployment checklist
        </button>
      </div>

      {loading ? (
        <p className="cust-muted">Loading customers…</p>
      ) : customers.length === 0 ? (
        <div className="cust-empty">
          <p>No customers yet.</p>
          <button
            type="button"
            className="cust-add-btn cust-add-btn--inline"
            onClick={openAdd}
          >
            Add your first customer
          </button>
        </div>
      ) : (
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
                  <td className="cust-table__name">{c.company_name}</td>
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
                  <td>{c.database_name || '—'}</td>
                  <td>{formatDate(c.go_live_date)}</td>
                  <td>
                    <span className={`cust-status cust-status--${c.status}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="cust-table__actions">
                    {c.can_upgrade_to?.length > 0 ? (
                      <button
                        type="button"
                        className="cust-upgrade-btn"
                        onClick={() => openUpgrade(c)}
                      >
                        Upgrade
                      </button>
                    ) : (
                      <span className="cust-muted">Max plan</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <div className="cust-modal-backdrop" role="presentation">
          <div className="cust-modal" role="dialog" aria-labelledby="cust-add-title">
            <h2 id="cust-add-title">Add new customer</h2>
            <form onSubmit={submitAdd} className="cust-form">
              <label>
                Company name *
                <input
                  value={addForm.company_name}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, company_name: e.target.value }))
                  }
                  required
                  placeholder="Acme Corp"
                />
              </label>
              <label>
                Plan *
                <select
                  value={addForm.plan}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, plan: e.target.value }))
                  }
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
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
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, database_name: e.target.value }))
                  }
                  placeholder="hrms_acme"
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
                  {saving ? 'Saving…' : 'Add customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showUpgrade && (
        <div className="cust-modal-backdrop" role="presentation">
          <div className="cust-modal" role="dialog" aria-labelledby="cust-upgrade-title">
            <h2 id="cust-upgrade-title">Upgrade plan</h2>
            <p className="cust-upgrade-lead">
              <strong>{showUpgrade.company_name}</strong> is on{' '}
              <span
                className={`cust-plan ${PLAN_BADGE_CLASS[showUpgrade.plan] || ''}`}
              >
                {showUpgrade.plan_label}
              </span>
            </p>
            <form onSubmit={submitUpgrade} className="cust-form">
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
    </div>
  );
}
