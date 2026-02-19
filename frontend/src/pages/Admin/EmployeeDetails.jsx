import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './EmployeeDetails.css';

const ADMIN_EMPLOYEE_DETAIL_API = '/api/admin/employees';

const defaultPhoto = 'https://ui-avatars.com/api/?name=Employee&background=random';

const EmployeeDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('Leaves');
  const [activeStatus, setActiveStatus] = useState('All');
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!id || !token) {
      setLoading(false);
      setError(true);
      return;
    }
    fetch(`${ADMIN_EMPLOYEE_DETAIL_API}/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success && data.employee) {
          setEmployee(data.employee);
        } else {
          setError(true);
        }
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="employee-details-container">
        <div className="not-found">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="employee-details-container">
        <div className="not-found">
          <h2>Employee not found</h2>
          <button onClick={() => navigate('/employees')}>Back to Employees</button>
        </div>
      </div>
    );
  }

  const handleBackToEmployees = () => {
    navigate('/employees');
  };

  // Get data based on active section
  const getActiveData = () => {
    let data = [];
    switch (activeSection) {
      case 'Leaves':
        data = employee.leaves || [];
        break;
      case 'Punches':
        data = employee.punches || [];
        break;
      case 'Payslips':
        data = employee.payslips || [];
        break;
      case 'Assets':
        data = employee.assets || [];
        break;
      case 'Claims':
        data = employee.claims || [];
        break;
      case 'Queries':
        data = employee.queries || [];
        break;
      case 'Resignation':
        data = employee.resignations || [];
        break;
      default:
        data = [];
    }

    if (activeStatus !== 'All') {
      data = data.filter(item => (item.status || '').toLowerCase() === activeStatus.toLowerCase());
    }

    return data;
  };

  const activeData = getActiveData();

  return (
    <div className="employee-details-container">
      <div className="details-header">
        <button className="back-button" onClick={handleBackToEmployees}>
          ← Back to Employees
        </button>
        <h1>Employee Details</h1>
      </div>

      {/* Profile Card */}
      <div className="profile-card">
        <div className="profile-left">
          <img src={employee.photo || defaultPhoto} alt={employee.name} className="profile-photo" />
          <h2>{employee.name}</h2>
        </div>
        <div className="profile-right">
          <div className="info-row">
            <span className="info-icon">🆔</span>
            <div className="info-content">
              <span className="info-value">{employee.emp_id || employee.id}</span>
            </div>
          </div>
          <div className="info-row">
            <span className="info-icon">✉️</span>
            <div className="info-content">
              {/* <span className="info-label">Email:</span> */}
              <span className="info-value">{employee.email}</span>
            </div>
          </div>
          <div className="info-row">
            <span className="info-icon">💼</span>
            <div className="info-content">
              {/* <span className="info-label">Designation:</span> */}
              <span className="info-value">{employee.designation}</span>
            </div>
          </div>
          <div className="info-row">
            <span className="info-icon">📱</span>
            <div className="info-content">
              {/* <span className="info-label">Phone:</span> */}
              <span className="info-value">{employee.phone}</span>
            </div>
          </div>
          <div className="info-row">
            <span className="info-icon">⚧</span>
            <div className="info-content">
              {/* <span className="info-label">Gender:</span> */}
              <span className="info-value">{employee.gender}</span>
            </div>
          </div>
          <div className="info-row">
            <span className="info-icon">🎂</span>
            <div className="info-content">
              {/* <span className="info-label">Date of Birth:</span> */}
              <span className="info-value">{employee.dob}</span>
            </div>
          </div>
          <div className="info-row">
            <span className="info-icon">🏠</span>
            <div className="info-content">
              {/* <span className="info-label">Address:</span> */}
              <span className="info-value">{employee.address}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section Buttons */}
      <div className="section-buttons">
        {['Leaves', 'Punches', 'Payslips', 'Assets', 'Claims', 'Queries', 'Resignation'].map(section => (
          <button
            key={section}
            className={`section-btn ${activeSection === section ? 'active' : ''}`}
            onClick={() => setActiveSection(section)}
          >
            {section}
          </button>
        ))}
      </div>

      {/* Status Buttons */}
      <div className="status-buttons">
        {['All', 'Pending', 'Approved', 'Rejected'].map(status => (
          <button
            key={status}
            className={`status-btn ${activeStatus === status ? 'active' : ''}`}
            onClick={() => setActiveStatus(status)}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Data Table */}
      <div className="data-table-container">
        {activeData.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Status</th>
                <th>Start Date</th>
                <th>End Date</th>
              </tr>
            </thead>
            <tbody>
              {activeData.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.type || '—'}</td>
                  <td>
                    <span className={`status-badge ${(item.status || '').toLowerCase()}`}>
                      {item.status || '—'}
                    </span>
                  </td>
                  <td>{item.startDate || '—'}</td>
                  <td>{item.endDate || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="no-data">
            <p>No {activeSection.toLowerCase()} records found for {activeStatus === 'All' ? 'any status' : activeStatus + ' status'}.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmployeeDetails;