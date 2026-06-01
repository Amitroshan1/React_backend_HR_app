import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { markAdminDepartmentVisit } from './AdminLayout';
import { ADMIN_HUB_SECTIONS, ADMIN_PLATFORM_SECTION } from './adminHubConfig';
import './Admin.css';

const MASTER_OPTIONS_API = '/api/auth/master-options';
const ADMIN_DASHBOARD_API = '/api/admin/dashboard';
const FALLBACK_EMP_TYPES = ['Engineer', 'HR', 'Accountant'];
const FALLBACK_CIRCLES = ['North', 'South', 'East', 'West'];

const EMPTY_STATS = {
  total_employees: 0,
  total_leaves: 0,
  total_queries: 0,
  total_claims: 0,
  total_resignations: 0,
  pending_leaves: 0,
  pending_queries: 0,
  pending_claims: 0,
  total_inventory_assets: 0,
  open_tickets: 0,
  pending_return_requests: 0,
};

function HubModuleCard({ module, stats, onNavigate }) {
  const total = module.statKey != null ? stats[module.statKey] : null;
  const badge = module.badgeKey != null ? stats[module.badgeKey] : null;
  const showBadge = typeof badge === 'number' && badge > 0;

  return (
    <button
      type="button"
      className={`admin-hub-card admin-hub-card--${module.accent || 'slate'}`}
      onClick={() => onNavigate(module.route, module)}
    >
      <span className="admin-hub-card__icon" aria-hidden>{module.icon}</span>
      <span className="admin-hub-card__body">
        <span className="admin-hub-card__title-row">
          <strong>{module.title}</strong>
          {showBadge && (
            <span className="admin-hub-card__badge">{badge > 99 ? '99+' : badge} pending</span>
          )}
        </span>
        <span className="admin-hub-card__desc">{module.description}</span>
        {total != null && (
          <span className="admin-hub-card__stat">
            {typeof total === 'number' ? total.toLocaleString() : total} total
          </span>
        )}
      </span>
      <span className="admin-hub-card__arrow" aria-hidden>→</span>
    </button>
  );
}

const Admin = () => {
  const navigate = useNavigate();
  const [employeeTypeOptions, setEmployeeTypeOptions] = useState(['All', ...FALLBACK_EMP_TYPES]);
  const [circleOptions, setCircleOptions] = useState(['All', ...FALLBACK_CIRCLES]);
  const [employeeType, setEmployeeType] = useState('All');
  const [circle, setCircle] = useState('All');
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [canViewDeploymentGuide, setCanViewDeploymentGuide] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(MASTER_OPTIONS_API, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success) {
          if (data.departments?.length) setEmployeeTypeOptions(['All', ...data.departments]);
          if (data.circles?.length) setCircleOptions(['All', ...data.circles]);
        }
      });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    const params = new URLSearchParams();
    if (circle && circle !== 'All') params.set('circle', circle);
    if (employeeType && employeeType !== 'All') params.set('emp_type', employeeType);
    const url = `${ADMIN_DASHBOARD_API}${params.toString() ? `?${params.toString()}` : ''}`;
    setLoading(true);
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success) {
          setCanViewDeploymentGuide(Boolean(data.can_view_deployment_guide));
          setStats({
            ...EMPTY_STATS,
            total_employees: data.total_employees ?? 0,
            total_leaves: data.total_leaves ?? 0,
            total_queries: data.total_queries ?? 0,
            total_claims: data.total_claims ?? 0,
            total_resignations: data.total_resignations ?? 0,
            pending_leaves: data.pending_leaves ?? 0,
            pending_queries: data.pending_queries ?? 0,
            pending_claims: data.pending_claims ?? 0,
            total_inventory_assets: data.total_inventory_assets ?? 0,
            open_tickets: data.open_tickets ?? 0,
            pending_return_requests: data.pending_return_requests ?? 0,
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [circle, employeeType]);

  const handleModuleClick = useCallback(
    (route, module) => {
      if (!route.startsWith('/admin')) {
        markAdminDepartmentVisit();
      }
      if (module?.id === 'employees') {
        navigate(route, { state: { employeeType, circle } });
        return;
      }
      navigate(route);
    },
    [navigate, employeeType, circle],
  );

  const sections = useMemo(() => {
    const list = [...ADMIN_HUB_SECTIONS];
    if (canViewDeploymentGuide) list.push(ADMIN_PLATFORM_SECTION);
    return list;
  }, [canViewDeploymentGuide]);

  const attentionTotal =
    stats.pending_leaves +
    stats.pending_queries +
    stats.pending_claims +
    stats.open_tickets +
    stats.pending_return_requests;

  return (
    <div className="admin-hub">
      <div className="admin-hub-kpis">
        <div className="admin-hub-kpi admin-hub-kpi--warn">
          <span className="admin-hub-kpi__label">Needs attention</span>
          <strong>{loading ? '…' : attentionTotal}</strong>
          <span className="admin-hub-kpi__hint">Pending leaves, claims, queries, IT</span>
        </div>
        <div className="admin-hub-kpi">
          <span className="admin-hub-kpi__label">Employees (filtered)</span>
          <strong>{loading ? '…' : stats.total_employees}</strong>
        </div>
        <div className="admin-hub-kpi">
          <span className="admin-hub-kpi__label">IT asset units</span>
          <strong>{loading ? '…' : stats.total_inventory_assets}</strong>
        </div>
        <div className="admin-hub-kpi">
          <span className="admin-hub-kpi__label">Open IT tickets</span>
          <strong>{loading ? '…' : stats.open_tickets}</strong>
        </div>
      </div>

      <div className="admin-hub-scope">
        <label>
          Employee type
          <select
            value={employeeType}
            onChange={(e) => setEmployeeType(e.target.value)}
            className="admin-hub-select"
          >
            {employeeTypeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Circle
          <select
            value={circle}
            onChange={(e) => setCircle(e.target.value)}
            className="admin-hub-select"
          >
            {circleOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      {sections.map((section) => (
        <section key={section.id} className="admin-hub-section">
          <div className="admin-hub-section__head">
            <h2>{section.title}</h2>
            {section.subtitle && <p>{section.subtitle}</p>}
          </div>
          <div className="admin-hub-grid">
            {section.modules.map((mod) => (
              <HubModuleCard
                key={mod.id}
                module={mod}
                stats={stats}
                onNavigate={handleModuleClick}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default Admin;
