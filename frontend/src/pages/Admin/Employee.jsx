import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './Employee.css';
import { employeesData } from './Data';

const MASTER_OPTIONS_API = '/api/auth/master-options';
const FALLBACK_EMP_TYPES = ['Engineer', 'HR', 'Accountant'];
const FALLBACK_CIRCLES = ['North', 'South', 'East', 'West'];

const Employee = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [employeeTypeOptions, setEmployeeTypeOptions] = useState(['All', ...FALLBACK_EMP_TYPES]);
  const [circleOptions, setCircleOptions] = useState(['All', ...FALLBACK_CIRCLES]);
  const [employeeType, setEmployeeType] = useState('All');
  const [circle, setCircle] = useState('All');

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

  // Get filters from navigation state if available
  useEffect(() => {
    if (location.state) {
      if (location.state.employeeType) setEmployeeType(location.state.employeeType);
      if (location.state.circle) setCircle(location.state.circle);
    }
  }, [location.state]);

  // Filter employees based on selected filters
  const getFilteredEmployees = () => {
    return employeesData.filter(emp => {
      const typeMatch = employeeType === 'All' || emp.designation === employeeType;
      const circleMatch = circle === 'All' || emp.circle === circle;
      return typeMatch && circleMatch;
    });
  };

  const filteredEmployees = getFilteredEmployees();

  const handleViewDetails = (empId) => {
    navigate(`/employee/${empId}`);
  };

  const handleBackToDashboard = () => {
    navigate('/admin');
  };

  return (
    <div className="employee-container">
      <div className="employee-header">
        <button className="back-button" onClick={handleBackToDashboard}>
          ← Back to Dashboard
        </button>
        <h1>Employee List</h1>
      </div>

      {/* Filters Section */}
      <div className="filters-section">
        <div className="filter-group">
          <label>Employee Type:</label>
          <select 
            value={employeeType} 
            onChange={(e) => setEmployeeType(e.target.value)}
            className="filterr-select"
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
            className="filterr-select"
          >
            {circleOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Employee Cards */}
      <div className="employee-grid">
        {filteredEmployees.map((employee) => (
          <div key={employee.id} className="employee-card">
            <div className="employee-photo">
              <img src={employee.photo} alt={employee.name} />
            </div>
            <div className="employee-info">
              <h3>{employee.name}</h3>
              <p className="employee-id">
                <span className="info-icon">🆔</span>
                {employee.id}
              </p>
              <p className="employee-designation">
                <span className="info-icon">💼</span>
                {employee.designation}
              </p>
              <p className="employee-circle">
                <span className="info-icon">📍</span>
                {employee.circle}
              </p>
              <button 
                className="view-details-btn"
                onClick={() => handleViewDetails(employee.id)}
              >
                View Details
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredEmployees.length === 0 && (
        <div className="no-employees">
          <p>No employees found matching the selected filters.</p>
        </div>
      )}
    </div>
  );
};

export default Employee;