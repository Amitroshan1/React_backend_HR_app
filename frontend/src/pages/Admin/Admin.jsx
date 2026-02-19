import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './Admin.css';

const MASTER_OPTIONS_API = '/api/auth/master-options';
const ADMIN_DASHBOARD_API = '/api/admin/dashboard';
const FALLBACK_EMP_TYPES = ['Engineer', 'HR', 'Accountant'];
const FALLBACK_CIRCLES = ['North', 'South', 'East', 'West'];

const Admin = () => {
  const navigate = useNavigate();
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
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
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
          setStats({
            total_employees: data.total_employees ?? 0,
            total_leaves: data.total_leaves ?? 0,
            total_queries: data.total_queries ?? 0,
            total_claims: data.total_claims ?? 0,
            total_resignations: data.total_resignations ?? 0,
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

  return (
    <div className="admin-container">
      {/* Filters Section */}
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

      {/* Statistics Cards */}
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
      </div>
    </div>
  );
};

export default Admin;