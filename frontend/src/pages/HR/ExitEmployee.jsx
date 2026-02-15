import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ArrowLeft, Archive, Search, AlertCircle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import './ExitEmployee.css';

const HR_API_BASE = '/api/HumanResource';
const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();

const ExitEmployee = ({onBack}) => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Check if employee data was passed from Archive and where we came from
  const employeeFromArchive = location.state?.selectedEmployee;
  const sourceFrom = location.state?.from; // 'archive' or undefined (from HR)
  
  const wrapperRef = useRef(null);

  // close dropdowns when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) {
        setShowTypeList(false);
        setShowCircleList(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [employeeType, setEmployeeType] = useState('');
  const [circle, setCircle] = useState('');
  const [email, setEmail] = useState('');

  // Searchable dropdown states
  const [typeSearch, setTypeSearch] = useState('');
  const [circleSearch, setCircleSearch] = useState('');

  const [showTypeList, setShowTypeList] = useState(false);
  const [showCircleList, setShowCircleList] = useState(false);

  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [masterOptions, setMasterOptions] = useState({ departments: [], circles: [] });

  // Check if email filter is active
  const isEmailFilterActive = email.trim() !== '';
  
  // Check if employeeType or circle filter is active
  const isTypeOrCircleFilterActive = employeeType !== '' || circle !== '';

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const loadActiveEmployees = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/employees/active`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || 'Failed to load employees');
        setEmployees([]);
        return;
      }
      const rows = (data.employees || []).map((e) => ({
        id: e.id,
        employeeId: e.emp_id || '-',
        name: e.name || '-',
        circle: e.circle || '',
        employeeType: e.emp_type || '',
        email: e.email || '',
      }));
      setEmployees(rows);
    } catch {
      setError('Network error while loading employees');
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadActiveEmployees();
  }, [loadActiveEmployees]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${HR_API_BASE}/master/options`, {
          headers: getAuthHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data.success) {
          setMasterOptions({
            departments: data.departments || [],
            circles: data.circles || [],
          });
        }
      } catch {
        // no-op, fallback uses employee data values
      }
    })();
    return () => { cancelled = true; };
  }, [getAuthHeaders]);

  // Handle employee data passed from Archive
  useEffect(() => {
    if (employeeFromArchive) {
      setSelectedEmployee(employeeFromArchive);
      setShowConfirm(true);
    }
  }, [employeeFromArchive]);

  const filteredEmployees = useMemo(() => {
    let filtered = [...employees];
    const emailNorm = norm(email);
    const typeNorm = norm(employeeType);
    const circleNorm = norm(circle);

    if (emailNorm) {
      filtered = filtered.filter(emp =>
        norm(emp.email) === emailNorm
      );
    } else if (typeNorm && circleNorm) {
      filtered = filtered.filter(emp =>
        norm(emp.employeeType).includes(typeNorm) && norm(emp.circle).includes(circleNorm)
      );
    } else if (typeNorm) {
      filtered = filtered.filter(emp => norm(emp.employeeType).includes(typeNorm));
    } else if (circleNorm) {
      filtered = filtered.filter(emp => norm(emp.circle).includes(circleNorm));
    }

    return filtered;
  }, [employees, email, employeeType, circle]);

  const employeeTypes = useMemo(() => {
    if (masterOptions.departments.length) return masterOptions.departments;
    return [...new Set(employees.map((e) => e.employeeType).filter(Boolean))];
  }, [masterOptions.departments, employees]);

  const circles = useMemo(() => {
    if (masterOptions.circles.length) return masterOptions.circles;
    return [...new Set(employees.map((e) => e.circle).filter(Boolean))];
  }, [masterOptions.circles, employees]);

  const handleActionClick = (employee) => {
    setSelectedEmployee(employee);
    setShowConfirm(true);
  };

  const handleConfirmExit = async () => {
    if (!selectedEmployee || submitting) return;

    setSubmitting(true);
    setError('');
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch(`${HR_API_BASE}/mark-exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          employee_email: selectedEmployee.email,
          exit_type: 'Resigned',
          exit_reason: 'Exited from HR panel',
          exit_date: today,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || 'Failed to exit employee');
        return;
      }
      setEmployees((prev) => prev.filter((emp) => emp.id !== selectedEmployee.id));
      window.dispatchEvent(new Event('employeeArchived'));
    } catch {
      setError('Network error while exiting employee');
      return;
    } finally {
      setSubmitting(false);
    }

    setShowConfirm(false);
    setSelectedEmployee(null);
    setShowSuccess(true);

    setTimeout(() => setShowSuccess(false), 3000);
  };

  const handleCancelExit = () => {
    setShowConfirm(false);
    setSelectedEmployee(null);
  };

  const resetFilters = () => {
    setEmployeeType('');
    setCircle('');
    setEmail('');
    setTypeSearch('');
    setCircleSearch('');
  };

  return (
    <div className="exit-employee-container" ref={wrapperRef}>
      <div className="exit-employee-wrapper">

        {/* Header */} 

        <div className="header-section">
          <button
            className="back-button"
            aria-label="Back to Updates"
            onClick={() => {
              if (onBack) {
                // Called from Hr.jsx with onBack prop
                onBack();
              } else if (sourceFrom === 'archive') {
                // Called from Archive page — replace history so back doesn't return here
                navigate('/archive-employees', { replace: true });
              } else {
                // Always navigate to Updates to avoid landing on Archive
                // Use replace so we don't add extra history entries
                navigate('/updates', { state: { view: 'updates' }, replace: true });
              }
            }}
          >
            <ArrowLeft size={20} />
            <span>Back to Updates</span>
          </button>

          <button
            className="archive-button"
            aria-label="Open Archive"
            onClick={() => navigate('/archive-employees')}
          >
            <Archive size={20} />
            <span>Archive</span>
          </button>
        </div>

        {/* Title */}

        <div className="title-section">
          <h1 className="page-title">Exit Employees</h1>
          <p className="page-subtitle">Manage and archive exited employees</p>
        </div>
        {error && (
          <p style={{ color: '#b91c1c', marginBottom: '12px' }}>{error}</p>
        )}


        {/* Filters */} 

        <div className="filters-section">
          <div className="filter-row">

            {/* Employee Type */}
            <div className="filter-group">
              <label>Employee Type</label>

              <div className="custom-select">
                <input
                  type="text"
                  placeholder="Select or type"
                  className="filter-input"
                  // value={typeSearch || employeeType} 
                  value={typeSearch !=='' ? typeSearch : employeeType}
                  onFocus={() => !isEmailFilterActive && setShowTypeList(true)}
                  onChange={(e) => {
                    if (!isEmailFilterActive) {
                      setTypeSearch(e.target.value);
                      // setShowTypeList(true); 
                      if (e.target.value === ''){
                        setEmployeeType('');
                      }
                      setShowTypeList(true);
                    }
                  }}
                  disabled={isEmailFilterActive}
                  style={{
                    cursor: isEmailFilterActive ? 'not-allowed' : 'text',
                    backgroundColor: isEmailFilterActive ? '#f5f5f5' : 'white',
                    opacity: isEmailFilterActive ? 0.6 : 1
                  }}
                />

                {showTypeList && !isEmailFilterActive && (
                  <div className="dropdown-list">

                    <div
                      className="dropdown-item"
                      onClick={() => {
                        setEmployeeType('');
                        setTypeSearch('');
                        setShowTypeList(false);
                      }}
                    >
                      All Types
                    </div>

                    {employeeTypes
                      .filter(type =>
                        type.toLowerCase().includes(typeSearch.toLowerCase())
                      )
                      .map(type => (
                        <div
                          key={type}
                          className="dropdown-item"
                          onClick={() => {
                            setEmployeeType(type);
                            setTypeSearch('');
                            setShowTypeList(false);
                          }}
                        >
                          {type}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Circle */} 

            <div className="filter-group">
              <label>Circle</label>

              <div className="custom-select">
                <input
                  type="text"
                  placeholder="Select or type"
                  className="filter-input"
                  // value={circleSearch || circle}
                  value={circleSearch !== '' ? circleSearch : circle}
                  onFocus={() => !isEmailFilterActive && setShowCircleList(true)}
                  onChange={(e) => {
                    if (!isEmailFilterActive) {
                      setCircleSearch(e.target.value);
                      // setShowCircleList(true);
                      if(e.target.value === ''){
                        setCircle('');
                      }
                      setShowCircleList(true);
                    }
                  }}
                  disabled={isEmailFilterActive}
                  style={{
                    cursor: isEmailFilterActive ? 'not-allowed' : 'text',
                    backgroundColor: isEmailFilterActive ? '#f5f5f5' : 'white',
                    opacity: isEmailFilterActive ? 0.6 : 1
                  }}
                />

                {showCircleList && !isEmailFilterActive && (
                  <div className="dropdown-list">

                    <div
                      className="dropdown-item"
                      onClick={() => {
                        setCircle('');
                        setCircleSearch('');
                        setShowCircleList(false);
                      }}
                    >
                      All Circles
                    </div>

                    {circles
                      .filter(cir =>
                        cir.toLowerCase().includes(circleSearch.toLowerCase())
                      )
                      .map(cir => (
                        <div
                          key={cir}
                          className="dropdown-item"
                          onClick={() => {
                            setCircle(cir);
                            setCircleSearch('');
                            setShowCircleList(false);
                          }}
                        >
                          {cir}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <span className='or-text'>
              <p className='or'>
                Or
              </p>
              </span>

            {/* Email */} 

            <div className="filter-group email-filter">
              <label>Search by Email</label>

              <div className="email-input-wrapper">
                <Search className="email-icon" size={18} />

                <input
                  type="email"
                  placeholder="Enter email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="email-input"
                  disabled={isTypeOrCircleFilterActive}
                  style={{
                    cursor: isTypeOrCircleFilterActive ? 'not-allowed' : 'text',
                    backgroundColor: isTypeOrCircleFilterActive ? '#f5f5f5' : 'white',
                    opacity: isTypeOrCircleFilterActive ? 0.6 : 1,
                    // marginTop: 'px'
                  }}
                />
              </div>
            </div>

            <button className="reset-button" onClick={resetFilters}>
              Reset
            </button>
          </div>

          <div className="results-count">
            Showing {filteredEmployees.length} of {employees.length} employees
          </div>
        </div>
      
        {/* Table */} 

        <div className="table-container">
          <table className="employees-table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Circle</th>
                <th>Employee Type</th>
                <th>Email</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" className="no-data">
                    Loading employees...
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan="6" className="no-data">
                    No employees found
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(emp => (
                  <tr key={emp.id}>
                    <td>{emp.employeeId}</td>
                    <td className="employee-name">{emp.name}</td>

                    <td>
                      <span className="circle-badge">{emp.circle}</span>
                    </td>

                    <td>
                      <span className="type-badge">{emp.employeeType}</span>
                    </td>

                    <td className="employee-email">{emp.email}</td>

                    <td>
                      <button
                        className="action-button"
                        onClick={() => handleActionClick(emp)}
                        disabled={submitting}
                      >
                        Exit Employee
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */} 

      {showConfirm && (
        <div className="modal-overlay">
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">

            <div className="modal-icon">
              <AlertCircle size={48} />
            </div>

            <h2 id="confirm-modal-title" className="modal-title">Confirm Exit</h2>

            <p className="modal-message">
              Are you sure you want to exit <strong>{selectedEmployee?.name}</strong>?
            </p>

            <div className="modal-actions">
              <button
                className="modal-button cancel-button"
                onClick={handleCancelExit}
              >
                No
              </button>

              <button
                className="modal-button confirm-button"
                onClick={handleConfirmExit}
                disabled={submitting}
              >
                {submitting ? 'Please wait...' : 'Yes'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Success Toast */} 

      {showSuccess && (
        <div className="success-toast">
          ✓ Employee exited successfully and moved to archive
        </div>
      )}

    </div>
  );
};

export default ExitEmployee; 

