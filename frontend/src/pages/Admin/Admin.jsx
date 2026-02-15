import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Admin.css';
import { employeesData } from './Data';

const Admin = () => {
  const navigate = useNavigate();
  const [employeeType, setEmployeeType] = useState('All');
  const [circle, setCircle] = useState('All');

  // Filter employees based on selected filters
  const getFilteredEmployees = () => {
    return employeesData.filter(emp => {
      const typeMatch = employeeType === 'All' || emp.designation === employeeType;
      const circleMatch = circle === 'All' || emp.circle === circle;
      return typeMatch && circleMatch;
    });
  };

  const filteredEmployees = getFilteredEmployees();

  // Calculate statistics from filtered employees
  const getTotalLeaves = () => {
    return filteredEmployees.reduce((total, emp) => total + emp.leaves.length, 0);
  };

  const getTotalQueries = () => {
    return filteredEmployees.reduce((total, emp) => total + emp.queries.length, 0);
  };

  const getTotalClaims = () => {
    return filteredEmployees.reduce((total, emp) => total + emp.claims.length, 0);
  };

  const getTotalResignations = () => {
    return filteredEmployees.reduce((total, emp) => total + emp.resignations.length, 0);
  };

  const handleEmployeesClick = () => {
    navigate('/employees', { state: { employeeType, circle } });
  };

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>Admin Dashboard</h1>
      </div>

      {/* Filters Section */}
      <div className="filters-section">
        <div className="filter-group">
          <label>Employee Type:</label>
          <select 
            value={employeeType} 
            onChange={(e) => setEmployeeType(e.target.value)}
            className="filter-selectt"
          >
            <option value="All">All</option>
            <option value="Engineer">Engineer</option>
            <option value="HR">HR</option>
            <option value="Accountant">Accountant</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Circle:</label>
          <select 
            value={circle} 
            onChange={(e) => setCircle(e.target.value)}
            className="filter-selectt"
          >
            <option value="All">All</option>
            <option value="North">North</option>
            <option value="South">South</option>
            <option value="East">East</option>
            <option value="West">West</option>
          </select>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="cards-grid">
        <div className="stat-card employees-card" onClick={handleEmployeesClick}>
          <div className="card-icon">👥</div>
          <div className="card-content">
            <h3>Total Employees</h3>
            <p className="card-number">{filteredEmployees.length}</p>
          </div>
        </div>

        <div className="stat-card leaves-card">
          <div className="card-icon">📅</div>
          <div className="card-content">
            <h3>Total Leaves</h3>
            <p className="card-number">{getTotalLeaves()}</p>
          </div>
        </div>

        <div className="stat-card queries-card">
          <div className="card-icon">📥</div>
          <div className="card-content">
            <h3>Queries</h3>
            <p className="card-number">{getTotalQueries()}</p>
          </div>
        </div>

        <div className="stat-card claims-card">
          <div className="card-icon">💰</div>
          <div className="card-content">
            <h3>Claims</h3>
            <p className="card-number">{getTotalClaims()}</p>
          </div>
        </div>

        <div className="stat-card resignation-card">
          <div className="card-icon">📝</div>
          <div className="card-content">
            <h3>Resignations</h3>
            <p className="card-number">{getTotalResignations()}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Admin;