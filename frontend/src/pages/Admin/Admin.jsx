import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { markAdminDepartmentVisit } from './AdminLayout';
import { ADMIN_HUB_SECTIONS, ADMIN_FEATURED_WORKFORCE, ADMIN_FEATURED_QUERIES, ADMIN_FEATURED_PLATFORM } from './adminHubConfig';
import './Admin.css';

const ADMIN_DASHBOARD_API = '/api/admin/dashboard';

const EMPTY_STATS = {
  total_employees: 0,
  company_total_employees: 0,
  active_today: 0,
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

function HubModuleCard({ module, stats, onNavigate, loading = false, footer, compact = false }) {
  const total = module.statKey != null ? stats[module.statKey] : null;
  const badge = module.badgeKey != null ? stats[module.badgeKey] : null;
  const showBadge = typeof badge === 'number' && badge > 0;

  return (
    <button
      type="button"
      className={`admin-hub-card admin-hub-card--${module.accent || 'slate'}${compact ? ' admin-hub-card--compact' : ''}`}
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
        {!compact && (
          <span className="admin-hub-card__desc">{module.description}</span>
        )}
        {footer || (total != null && (
          <span className="admin-hub-card__stat">
            {loading ? '…' : (typeof total === 'number' ? total.toLocaleString() : total)} total
          </span>
        ))}
      </span>
      <span className="admin-hub-card__arrow" aria-hidden>→</span>
    </button>
  );
}

const Admin = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [canViewDeploymentGuide, setCanViewDeploymentGuide] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(ADMIN_DASHBOARD_API, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success) {
          setCanViewDeploymentGuide(Boolean(data.can_view_deployment_guide));
          setStats({
            ...EMPTY_STATS,
            total_employees: data.total_employees ?? 0,
            company_total_employees: data.company_total_employees ?? data.total_employees ?? 0,
            active_today: data.active_today ?? 0,
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
  }, []);

  const handleModuleClick = useCallback(
    (route) => {
      if (!route.startsWith('/admin')) {
        markAdminDepartmentVisit();
      }
      navigate(route);
    },
    [navigate],
  );

  const sections = useMemo(() => [...ADMIN_HUB_SECTIONS], []);

  const workforceFooter = (
    <span className="admin-hub-card__stats-row">
      <span className="admin-hub-card__stat">
        {loading ? '…' : stats.company_total_employees.toLocaleString()} in company
      </span>
      <span className="admin-hub-card__stat admin-hub-card__stat--active">
        {loading ? '…' : stats.active_today.toLocaleString()} active today
      </span>
    </span>
  );

  return (
    <div className="admin-hub">
      <div className="admin-hub-shell">
        <div
          className={`admin-hub-featured${
            canViewDeploymentGuide ? ' admin-hub-featured--four' : ' admin-hub-featured--two'
          }`}
        >
          <HubModuleCard
            module={ADMIN_FEATURED_WORKFORCE}
            stats={stats}
            loading={loading}
            footer={workforceFooter}
            compact
            onNavigate={handleModuleClick}
          />
          <HubModuleCard
            module={ADMIN_FEATURED_QUERIES}
            stats={stats}
            loading={loading}
            compact
            onNavigate={handleModuleClick}
          />
          {canViewDeploymentGuide &&
            ADMIN_FEATURED_PLATFORM.map((mod) => (
              <HubModuleCard
                key={mod.id}
                module={mod}
                stats={stats}
                loading={loading}
                compact
                onNavigate={handleModuleClick}
              />
            ))}
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
    </div>
  );
};

export default Admin;
