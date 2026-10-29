import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Building2,
  ClipboardCheck,
  PauseCircle,
} from 'lucide-react';
import { markAdminDepartmentVisit } from './adminVisit';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './AdminDashboard.css';

const ADMIN_DASHBOARD_API = '/api/admin/dashboard';
const CUSTOMERS_API = '/api/admin/customers';

function statusTone(status) {
  const key = String(status || '').toLowerCase();
  if (key === 'active') return 'ok';
  if (key === 'suspended' || key === 'cancelled') return 'bad';
  if (key === 'provisioning') return 'info';
  return 'mute';
}

function Kpi({ loading, label, value, hint, icon, tone, onOpen, badge = 0 }) {
  if (loading) return <div className="admin-dash__kpi admin-dash__kpi--skeleton" aria-hidden />;
  const body = (
    <>
      <div>
        <span className="admin-dash__kpi-label">{label}</span>
        {value != null && value !== '' ? <strong className="admin-dash__kpi-value">{value}</strong> : null}
        {hint ? <span className="admin-dash__kpi-hint">{hint}</span> : null}
      </div>
      <span className={`admin-dash__kpi-icon${tone ? ` admin-dash__kpi-icon--${tone}` : ''}`} aria-hidden>
        {icon}
        {badge > 0 ? (
          <span className="admin-dash__kpi-badge" aria-label={`${badge} pending requests`}>{badge}</span>
        ) : null}
      </span>
    </>
  );
  if (!onOpen) {
    return <article className="admin-dash__kpi admin-dash__kpi--static">{body}</article>;
  }
  return (
    <button type="button" className="admin-dash__kpi" onClick={onOpen}>
      {body}
    </button>
  );
}

function Panel({ title, description, linkLabel, onOpen, children }) {
  return (
    <section className="admin-dash__panel">
      <header className="admin-dash__panel-head">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {onOpen && linkLabel ? (
          <button type="button" onClick={onOpen}>{linkLabel}</button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

const Admin = () => {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [customerCounts, setCustomerCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [canViewCompanies, setCanViewCompanies] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);

  const loadDashboard = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      setFailed(true);
      return;
    }
    setLoading(true);
    setFailed(false);
    const headers = { Authorization: `Bearer ${token}` };
    fetch(ADMIN_DASHBOARD_API, { headers })
      .then((res) => res.json().catch(() => ({})).then((data) => ({ ok: res.ok, data })))
      .then(async ({ ok, data }) => {
        if (!ok || !data.success) {
          setFailed(true);
          setLoading(false);
          return;
        }
        // Keep compatibility with already-running API instances during rollout.
        const platform = Boolean(data.can_manage_customers ?? data.can_view_deployment_guide);
        setCanViewCompanies(platform);
        try {
          const pendingRes = await fetch('/api/admin/employee-change-requests?status=pending', { headers });
          const pendingData = await pendingRes.json().catch(() => ({}));
          const count = pendingRes.ok && pendingData.success
            ? Number(pendingData.count ?? pendingData.requests?.length ?? 0)
            : 0;
          setPendingRequests(Number.isFinite(count) ? count : 0);
        } catch {
          setPendingRequests(0);
        }
        if (!platform) {
          setCustomers([]);
          setCustomerCounts(null);
          setLoading(false);
          return;
        }
        try {
          const custRes = await fetch(CUSTOMERS_API, { headers });
          const custData = await custRes.json().catch(() => ({}));
          if (custRes.ok && custData.success) {
            setCustomers(custData.customers || []);
            setCustomerCounts(custData.counts || {});
          } else {
            setCustomers([]);
            setCustomerCounts(null);
          }
        } catch {
          setCustomers([]);
          setCustomerCounts(null);
        }
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  }, []);

  useRefreshOnNavigate(loadDashboard);

  const open = useCallback((route) => {
    if (!route.startsWith('/admin')) markAdminDepartmentVisit();
    navigate(route);
  }, [navigate]);

  const recentCompanies = useMemo(() => (
    [...customers]
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 5)
  ), [customers]);

  const planMix = useMemo(() => {
    const tally = { basic: 0, essential: 0, enterprise: 0 };
    customers.forEach((row) => {
      const key = String(row.plan || '').toLowerCase();
      if (key in tally) tally[key] += 1;
    });
    const max = Math.max(1, ...Object.values(tally));
    return [
      { id: 'basic', label: 'Basic', count: tally.basic, width: (tally.basic / max) * 100 },
      { id: 'essential', label: 'Essential', count: tally.essential, width: (tally.essential / max) * 100 },
      { id: 'enterprise', label: 'Enterprise', count: tally.enterprise, width: (tally.enterprise / max) * 100 },
    ];
  }, [customers]);

  const companyTotal = customers.length;
  const activeCompanies = customerCounts?.active ?? customers.filter((row) => row.status === 'active').length;
  const suspendedCompanies = customerCounts?.suspended ?? customers.filter((row) => row.status === 'suspended').length;
  const provisioningCompanies = customerCounts?.provisioning ?? customers.filter((row) => row.status === 'provisioning').length;

  if (!loading && failed) {
    return (
      <section className="admin-dash">
        <div className="admin-dash__panel admin-dash__error">
          <h2>Dashboard data is unavailable</h2>
          <p>Company counts could not be loaded.</p>
          <button type="button" className="admin-dash__retry" onClick={loadDashboard}>Try again</button>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-dash">
      <h1 className="admin-dash__sr">Dashboard</h1>
      <div className={`admin-dash__kpis${loading || canViewCompanies ? '' : ' admin-dash__kpis--single'}`}>
        {loading || canViewCompanies ? (
          <>
            <Kpi
              loading={loading}
              label="Companies"
              value={companyTotal.toLocaleString()}
              hint={provisioningCompanies ? `${provisioningCompanies.toLocaleString()} still provisioning` : 'Registered in the shared database'}
              icon={<Building2 size={20} />}
              onOpen={() => open('/admin/customers')}
            />
            <Kpi
              loading={loading}
              label="Active companies"
              value={activeCompanies.toLocaleString()}
              hint="Open for sign-in"
              icon={<Activity size={20} />}
              tone="ok"
            />
            <Kpi
              loading={loading}
              label="Suspended companies"
              value={suspendedCompanies.toLocaleString()}
              hint="Sign-in paused"
              icon={<PauseCircle size={20} />}
              tone="bad"
            />
          </>
        ) : null}
        <Kpi
          loading={loading}
          label="Request & Approval"
          value={pendingRequests.toLocaleString()}
          hint={pendingRequests === 1 ? '1 request waiting for approval' : `${pendingRequests.toLocaleString()} requests waiting for approval`}
          icon={<ClipboardCheck size={20} />}
          tone="info"
          onOpen={() => open('/admin/requests')}
          badge={pendingRequests}
        />
      </div>

      <div className="admin-dash__grid">
        {canViewCompanies ? (
          <Panel
            title="Recent companies"
            description="Newest registrations in the shared database."
            linkLabel="View all"
            onOpen={() => open('/admin/customers')}
          >
            {loading ? null : recentCompanies.length === 0 ? (
              <p className="admin-dash__empty">No companies have been registered.</p>
            ) : (
              <div className="admin-dash__table-wrap">
                <table className="admin-dash__table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Registered</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentCompanies.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <button type="button" className="linkish" onClick={() => open('/admin/customers')}>
                            {row.company_name || '—'}
                          </button>
                        </td>
                        <td>{formatDateDDMMYYYY(row.created_at)}</td>
                        <td>
                          <span className={`admin-dash__status admin-dash__status--${statusTone(row.status)}`}>
                            {row.status_label || row.status || '—'}
                          </span>
                        </td>
                        <td>
                          <button type="button" className="linkish" onClick={() => open('/admin/customers')}>Open</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        ) : null}

        {canViewCompanies ? (
          <Panel title="Companies by plan" description="How registered companies are split across plans.">
            <div className="admin-dash__bars">
              {planMix.map((plan) => (
                <div key={plan.id} className="admin-dash__bar-row">
                  <span>{plan.label}</span>
                  <span className="admin-dash__bar-track">
                    <span className="admin-dash__bar-fill" style={{ width: `${plan.width}%` }} />
                  </span>
                  <strong>{plan.count}</strong>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}
      </div>
    </section>
  );
};

export default Admin;
