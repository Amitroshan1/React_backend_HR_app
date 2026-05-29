import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../components/layout/UserContext';
import { ManagerProfileCard } from '../Manager/comps/ManagerProfileCard/ManagerProfileCard';
import { canAccessItPanel } from '../../utils/planFeatures';
import './Admin.css';

const MASTER_OPTIONS_API = '/api/auth/master-options';
const ADMIN_DASHBOARD_API = '/api/admin/dashboard';
const FALLBACK_EMP_TYPES = ['Engineer', 'HR', 'Accountant'];
const FALLBACK_CIRCLES = ['North', 'South', 'East', 'West'];

const Admin = () => {
  const navigate = useNavigate();
  const { userData, loadingUser, photoVersion } = useUser();
  const [employeeTypeOptions, setEmployeeTypeOptions] = useState(['All', ...FALLBACK_EMP_TYPES]);
  const [circleOptions, setCircleOptions] = useState(['All', ...FALLBACK_CIRCLES]);
  const [employeeType, setEmployeeType] = useState('All');
  const [circle, setCircle] = useState('All');
  const [stats, setStats] = useState({
    total_employees: 0,
    total_leaves: 0,
    total_queries: 0,
    total_claims: 0,
    total_resignations: 0,
    total_inventory_assets: null,
  });
  const [loading, setLoading] = useState(true);
  const [canViewDeploymentGuide, setCanViewDeploymentGuide] = useState(false);
  const [itInventoryAccess, setItInventoryAccess] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetch('/api/admin/deployment-guide/access', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          if (data.success) setCanViewDeploymentGuide(Boolean(data.can_view_deployment_guide));
        });

      fetch(MASTER_OPTIONS_API, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          if (data.success) {
            if (data.departments?.length) setEmployeeTypeOptions(['All', ...data.departments]);
            if (data.circles?.length) setCircleOptions(['All', ...data.circles]);
          }
        });
    }
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
          setItInventoryAccess(Boolean(data.it_inventory_access));
          setStats({
            total_employees: data.total_employees ?? 0,
            total_leaves: data.total_leaves ?? 0,
            total_queries: data.total_queries ?? 0,
            total_claims: data.total_claims ?? 0,
            total_resignations: data.total_resignations ?? 0,
            total_inventory_assets: data.total_inventory_assets ?? null,
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [circle, employeeType]);

  const handleEmployeesClick = () => {
    navigate('/employees', { state: { employeeType, circle } });
  };
  const handleLeavesClick = () => navigate('/admin/leaves');
  const handleQueriesClick = () => navigate('/admin/queries');
  const handleClaimsClick = () => navigate('/admin/claims');
  const handleResignationsClick = () => navigate('/admin/resignations');
  const handleItInventoryClick = () => navigate('/it/inventory');

  const showItInventoryCard = useMemo(() => {
    const user = userData?.user || {};
    return itInventoryAccess || canAccessItPanel(user);
  }, [userData, itInventoryAccess]);

  const adminProfile = useMemo(() => {
    const user = userData?.user || {};
    const employee = userData?.employee || {};
    let photoUrl = user.photo_url || null;
    if (photoUrl && photoVersion) {
      const sep = photoUrl.includes('?') ? '&' : '?';
      photoUrl = `${photoUrl}${sep}v=${photoVersion}`;
    }
    return {
      name: user.name || user.first_name || user.user_name || 'Admin',
      email: user.email || '',
      mobile: user.mobile || employee.mobile || '',
      designation: user.department || user.emp_type || employee.designation || 'Admin',
      photo_url: photoUrl,
    };
  }, [userData, photoVersion]);

  return (
    <div className="admin-container">
      <div className="admin-top-row">
        <div className="admin-top-row__profile">
          <ManagerProfileCard
            profile={adminProfile}
            loading={loadingUser}
            showScope={false}
          />
        </div>
        {canViewDeploymentGuide && (
          <div className="admin-top-row__deploy">
            <button
              type="button"
              className="admin-deploy-card"
              onClick={() => navigate('/admin/customers')}
            >
              <span className="admin-deploy-card__icon" aria-hidden>
                🚀
              </span>
              <span className="admin-deploy-card__body">
                <strong>New customer deployment</strong>
                <span>Separate server &amp; database per company</span>
                <span className="admin-deploy-card__cta">Manage customers →</span>
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="filters-section">
        <div className="filter-group">
          <label>Employee Type:</label>
          <select
            value={employeeType}
            onChange={(e) => setEmployeeType(e.target.value)}
            className="filter-selectt"
          >
            {employeeTypeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Circle:</label>
          <select
            value={circle}
            onChange={(e) => setCircle(e.target.value)}
            className="filter-selectt"
          >
            {circleOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="cards-grid">
        <div className="stat-card employees-card" onClick={handleEmployeesClick}>
          <div className="card-icon">👥</div>
          <div className="card-content">
            <h3>Total Employees</h3>
            <p className="card-number">{loading ? '...' : stats.total_employees}</p>
          </div>
        </div>

        <div className="stat-card leaves-card" onClick={handleLeavesClick}>
          <div className="card-icon">📅</div>
          <div className="card-content">
            <h3>Total Leaves</h3>
            <p className="card-number">{loading ? '...' : stats.total_leaves}</p>
          </div>
        </div>

        <div className="stat-card queries-card" onClick={handleQueriesClick}>
          <div className="card-icon">📥</div>
          <div className="card-content">
            <h3>Queries</h3>
            <p className="card-number">{loading ? '...' : stats.total_queries}</p>
          </div>
        </div>

        <div className="stat-card claims-card" onClick={handleClaimsClick}>
          <div className="card-icon">💰</div>
          <div className="card-content">
            <h3>Claims</h3>
            <p className="card-number">{loading ? '...' : stats.total_claims}</p>
          </div>
        </div>

        <div className="stat-card resignation-card" onClick={handleResignationsClick}>
          <div className="card-icon">📝</div>
          <div className="card-content">
            <h3>Resignations</h3>
            <p className="card-number">{loading ? '...' : stats.total_resignations}</p>
          </div>
        </div>

        {showItInventoryCard && (
          <div className="stat-card inventory-card" onClick={handleItInventoryClick}>
            <div className="card-icon">📦</div>
            <div className="card-content">
              <h3>IT / Inventory</h3>
              <p className="card-number">
                {loading ? '...' : (stats.total_inventory_assets ?? '—')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Admin;
