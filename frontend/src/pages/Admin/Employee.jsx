import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { UserAvatar } from '../../components/UserAvatar';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import './Employee.css';

const MASTER_OPTIONS_API = '/api/auth/master-options';
const ADMIN_EMPLOYEES_API = '/api/admin/employees';
const FALLBACK_EMP_TYPES = ['Engineer', 'HR', 'Accountant'];
const FALLBACK_CIRCLES = ['North', 'South', 'East', 'West'];

const Employee = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [employeeTypeOptions, setEmployeeTypeOptions] = useState(['All', ...FALLBACK_EMP_TYPES]);
  const [circleOptions, setCircleOptions] = useState(['All', ...FALLBACK_CIRCLES]);
  const [employeeType, setEmployeeType] = useState('All');
  const [circle, setCircle] = useState('All');
  const [employees, setEmployees] = useState([]);
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
    if (location.state) {
      if (location.state.employeeType) setEmployeeType(location.state.employeeType);
      if (location.state.circle) setCircle(location.state.circle);
    }
  }, [location.state]);

  const loadEmployees = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    const params = new URLSearchParams();
    if (circle && circle !== 'All') params.set('circle', circle);
    if (employeeType && employeeType !== 'All') params.set('emp_type', employeeType);
    const url = `${ADMIN_EMPLOYEES_API}${params.toString() ? `?${params.toString()}` : ''}`;
    setLoading(true);
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success && Array.isArray(data.employees)) {
          setEmployees(data.employees);
        } else {
          setEmployees([]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [circle, employeeType]);

  useRefreshOnNavigate(loadEmployees, [circle, employeeType]);

  const handleViewDetails = (empId) => {
    navigate(`/employee/${empId}`);
  };

  const typeActive = employeeType !== 'All';
  const circleActive = circle !== 'All';

  return (
    <div className="employee-container">
      <div className="employee-toolbar" role="search" aria-label="Filter employees">
        <div className="employee-toolbar__filters">
          <label className={`employee-chip${typeActive ? ' employee-chip--active' : ''}`}>
            <span className="employee-chip__key">Type</span>
            <select
              id="employee-type-filter"
              value={employeeType}
              onChange={(e) => setEmployeeType(e.target.value)}
              className="employee-chip__select"
              aria-label="Filter by employee type"
            >
              {employeeTypeOptions.map((t) => (
                <option key={t} value={t}>{t === 'All' ? 'All types' : t}</option>
              ))}
            </select>
          </label>

          <label className={`employee-chip${circleActive ? ' employee-chip--active' : ''}`}>
            <span className="employee-chip__key">Circle</span>
            <select
              id="employee-circle-filter"
              value={circle}
              onChange={(e) => setCircle(e.target.value)}
              className="employee-chip__select"
              aria-label="Filter by circle"
            >
              {circleOptions.map((c) => (
                <option key={c} value={c}>{c === 'All' ? 'All circles' : c}</option>
              ))}
            </select>
          </label>

          {(typeActive || circleActive) ? (
            <button
              type="button"
              className="employee-toolbar__clear"
              onClick={() => {
                setEmployeeType('All');
                setCircle('All');
              }}
            >
              Clear
            </button>
          ) : null}
        </div>

        {!loading ? (
          <p className="employee-toolbar__count">
            {employees.length} employee{employees.length === 1 ? '' : 's'}
          </p>
        ) : null}
      </div>

      <div className="employee-grid">
        {loading ? (
          <div className="no-employees">
            <p>Loading employees…</p>
          </div>
        ) : (
          employees.map((employee) => (
            <article key={employee.id} className="employee-card">
              <UserAvatar
                user={employee}
                name={employee.name}
                alt={employee.name}
                className="employee-card__avatar"
              />
              <div className="employee-card__body">
                <h3 className="employee-card__name" title={employee.name}>
                  {employee.name}
                </h3>
                <p className="employee-card__id">{employee.emp_id || employee.id}</p>
                <p className="employee-card__meta">
                  <span>{employee.designation || employee.emp_type || '—'}</span>
                  <span className="employee-card__dot" aria-hidden="true">·</span>
                  <span>{employee.circle || '—'}</span>
                </p>
                <button
                  type="button"
                  className="employee-card__btn"
                  onClick={() => handleViewDetails(employee.id)}
                >
                  View
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      {!loading && employees.length === 0 ? (
        <div className="no-employees">
          <p>No employees found matching the selected filters.</p>
        </div>
      ) : null}
    </div>
  );
};

export default Employee;