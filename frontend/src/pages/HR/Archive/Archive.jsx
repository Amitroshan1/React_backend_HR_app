import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, Calendar, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './Archive.css';

const HR_API_BASE = '/api/HumanResource';

const ArchiveEmployees = () => {
  const navigate = useNavigate();
  const [archivedEmployees, setArchivedEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Filter states
  const [employeeType, setEmployeeType] = useState('');
  const [circle, setCircle] = useState('');
  const [email, setEmail] = useState('');
  
  // Searchable dropdown states
  const [typeSearch, setTypeSearch] = useState('');
  const [circleSearch, setCircleSearch] = useState('');
  
  const [showTypeList, setShowTypeList] = useState(false);
  const [showCircleList, setShowCircleList] = useState(false);
  
  const [masterOptions, setMasterOptions] = useState({ departments: [], circles: [] });
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyRows, setHistoryRows] = useState([]);
  const [historyEmployee, setHistoryEmployee] = useState(null);
  
  // Check if email filter is active
  const isEmailFilterActive = email.trim() !== '';
  
  // Check if employeeType or circle filter is active
  const isTypeOrCircleFilterActive = employeeType !== '' || circle !== '';

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const loadArchivedEmployees = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/employee-archive`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ? `${data.message || 'Failed to load archived employees'} (${data.error})` : (data.message || 'Failed to load archived employees'));
        setArchivedEmployees([]);
        return;
      }
      const mapped = (data.employees || []).map((emp) => ({
        id: emp.admin_id,
        employeeId: emp.emp_id || '-',
        name: emp.name || '-',
        circle: emp.circle || '',
        employeeType: emp.emp_type || '',
        email: emp.email || '',
        exitDate: emp.exit_date || null,
      }));
      setArchivedEmployees(mapped);
    } catch {
      setError('Network error while loading archived employees');
      setArchivedEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadArchivedEmployees();
    window.addEventListener('employeeArchived', loadArchivedEmployees);
    return () => {
      window.removeEventListener('employeeArchived', loadArchivedEmployees);
    };
  }, [loadArchivedEmployees]);

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
        // no-op
      }
    })();
    return () => { cancelled = true; };
  }, [getAuthHeaders]);

  const filteredEmployees = useMemo(() => {
    let filtered = [...archivedEmployees];

    if (email.trim()) {
      filtered = filtered.filter(emp =>
        emp.email.toLowerCase() === email.toLowerCase().trim()
      );
    } else if (employeeType && circle) {
      filtered = filtered.filter(emp =>
        emp.employeeType === employeeType && emp.circle === circle
      );
    } else if (employeeType) {
      filtered = filtered.filter(emp => emp.employeeType === employeeType);
    } else if (circle) {
      filtered = filtered.filter(emp => emp.circle === circle);
    }

    return filtered;
  }, [archivedEmployees, employeeType, circle, email]);

  const employeeTypes = useMemo(() => {
    if (masterOptions.departments.length) return masterOptions.departments;
    return [...new Set(archivedEmployees.map((e) => e.employeeType).filter(Boolean))];
  }, [masterOptions.departments, archivedEmployees]);

  const circles = useMemo(() => {
    if (masterOptions.circles.length) return masterOptions.circles;
    return [...new Set(archivedEmployees.map((e) => e.circle).filter(Boolean))];
  }, [masterOptions.circles, archivedEmployees]);

  const handleViewDetails = (employee) => {
    if (!employee?.id) return;
    navigate(`/archive-employees/${employee.id}`);
  };

  const openExitHistory = async (employee, e) => {
    e?.stopPropagation?.();
    if (!employee?.id) return;

    setHistoryEmployee(employee);
    setShowHistoryModal(true);
    setHistoryLoading(true);
    setHistoryError('');
    setHistoryRows([]);
    try {
      const res = await fetch(`${HR_API_BASE}/employees/${employee.id}/exit-history`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setHistoryError(data.message || 'Failed to load exit history');
        return;
      }
      setHistoryRows(Array.isArray(data.history) ? data.history : []);
    } catch {
      setHistoryError('Network error while loading exit history');
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeExitHistory = () => {
    setShowHistoryModal(false);
    setHistoryLoading(false);
    setHistoryError('');
    setHistoryRows([]);
    setHistoryEmployee(null);
  };

  const resetFilters = () => {
    setEmployeeType('');
    setCircle('');
    setEmail('');
    setTypeSearch('');
    setCircleSearch('');
  };

  return (
    <div className="archive-container">
      <div className="archive-wrapper">
        {/* Header with Back Button */}
        <div className="archive-header">
          <button className="btn-back-updates" onClick={() => navigate('/exit-employees')}>
            <ArrowLeft size={20} />
            <span>Back to Exit Employees</span>
          </button>
        </div>

        {/* Title */}
        <div className="title-section">
          <h1 className="page-title">Archive Employees</h1>
          <p className="page-subtitle">View exited employees archive</p>
        </div>
        {error && (
          <p className="archive-error">{error}</p>
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
                  value={typeSearch !== '' ? typeSearch : employeeType}
                  onFocus={() => !isEmailFilterActive && setShowTypeList(true)}
                  onChange={(e) => {
                    if (!isEmailFilterActive) {
                      setTypeSearch(e.target.value);
                      if (e.target.value === '') {
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
                  value={circleSearch !== '' ? circleSearch : circle}
                  onFocus={() => !isEmailFilterActive && setShowCircleList(true)}
                  onChange={(e) => {
                    if (!isEmailFilterActive) {
                      setCircleSearch(e.target.value);
                      if (e.target.value === '') {
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

            <span className="or-text">
              <p className="or">Or</p>
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
                  }}
                />
              </div>
            </div>

            <button className="reset-button" onClick={resetFilters}>
              Reset
            </button>
          </div>

          <div className="results-count">
            Showing {filteredEmployees.length} of {archivedEmployees.length} archived employees
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
                    Loading archived employees...
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan="6" className="no-data">
                    No archived employees found
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(emp => (
                  <tr 
                    key={emp.id}
                    className="employee-row"
                  >
                    <td>
                      {emp.employeeId}
                    </td>
                    
                    <td className="employee-name">
                      {emp.name}
                    </td>

                    <td>
                      <span className="circle-badge">{emp.circle}</span>
                    </td>

                    <td>
                      <span className="type-badge">
                        {emp.employeeType}
                      </span>
                    </td>

                    <td className="employee-email">
                      {emp.email}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => handleViewDetails(emp)}
                      >
                        View details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default ArchiveEmployees;