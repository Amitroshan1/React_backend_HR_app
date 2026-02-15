import React, { useState, useCallback } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import './UpdateSignUp.css';

const API_BASE = '/api/HumanResource';

const EMP_TYPE_OPTIONS = ['Software Developer', 'Human Resource', 'Accounts', 'Admin'];
const CIRCLE_OPTIONS = ['NHQ', 'Delhi', 'Mumbai', 'Bangalore', 'Hyderabad'];

export const UpdateSignUp = ({ onBack, onOpenSignupForEmployee, empTypeOptions = EMP_TYPE_OPTIONS, circleOptions = CIRCLE_OPTIONS }) => {
  const [filters, setFilters] = useState({
    emp_type: empTypeOptions[0] || EMP_TYPE_OPTIONS[0],
    circle: circleOptions[0] || CIRCLE_OPTIONS[0],
  });
  const [employees, setEmployees] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [detailLoadingEmail, setDetailLoadingEmail] = useState(null); // email of row being loaded
  const [detailError, setDetailError] = useState('');

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const handleSearch = useCallback(async () => {
    setSearchError('');
    setSearchLoading(true);
    try {
      const params = new URLSearchParams({
        emp_type: filters.emp_type,
        circle: filters.circle,
      });
      const res = await fetch(`${API_BASE}/employee/search?${params}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.message || 'Search failed');
        setEmployees([]);
        return;
      }
      setEmployees(data.employees || []);
    } catch {
      setSearchError('Network error. Please try again.');
      setEmployees([]);
    } finally {
      setSearchLoading(false);
    }
  }, [filters.emp_type, filters.circle, getAuthHeaders]);

  React.useEffect(() => {
    setFilters((prev) => ({
      emp_type: prev.emp_type || empTypeOptions[0] || '',
      circle: prev.circle || circleOptions[0] || '',
    }));
  }, [empTypeOptions, circleOptions]);

  const handleViewDetails = useCallback(async (emp) => {
    setDetailError('');
    setDetailLoadingEmail(emp.email);
    try {
      const res = await fetch(`${API_BASE}/employee/by-email/${encodeURIComponent(emp.email)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setDetailError(data.message || 'Failed to load employee');
        setDetailLoadingEmail(null);
        return;
      }
      const e = data.employee;
      if (onOpenSignupForEmployee) {
        onOpenSignupForEmployee({
          user_name: e.user_name || '',
          first_name: e.first_name || '',
          email: e.email || '',
          emp_id: e.emp_id || '',
          mobile: e.mobile || '',
          doj: e.doj || '',
          circle: e.circle || '',
          emp_type: e.emp_type || '',
        });
      }
    } catch {
      setDetailError('Network error. Please try again.');
    } finally {
      setDetailLoadingEmail(null);
    }
  }, [getAuthHeaders, onOpenSignupForEmployee]);

  // --- SEARCH VIEW ---
  return (
    <div className="update-signup-page">
      <div className="content-container">
        <button type="button" className="btn-back-nav" onClick={onBack}>
          <ArrowLeft size={18} /> Back to Updates
        </button>

        <div className="search-filter-card">
          <h3>Search Employee</h3>
          <p>Select filters to find employees</p>
          <div className="filter-row">
            <div className="filter-group">
              <label>Employee Type</label>
              <select
                value={filters.emp_type}
                onChange={(e) => setFilters((f) => ({ ...f, emp_type: e.target.value }))}
              >
                {empTypeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="filter-group">
              <label>Circle</label>
              <select
                value={filters.circle}
                onChange={(e) => setFilters((f) => ({ ...f, circle: e.target.value }))}
              >
                {circleOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-search-blue"
              onClick={handleSearch}
              disabled={searchLoading}
            >
              <Search size={18} /> {searchLoading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {(searchError || detailError) && (
          <div style={{ padding: '12px', marginTop: '12px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px' }}>
            {searchError || detailError}
          </div>
        )}

        {employees.length > 0 && (
          <div className="results-card">
            <div className="results-header">
              <h3>Search Results</h3>
              <p>{filters.emp_type} employees in {filters.circle}</p>
            </div>
            <div className="table-wrapper">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Employee ID</th>
                    <th>First Name</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <tr key={emp.email}>
                      <td>{emp.emp_id || '-'}</td>
                      <td>{emp.first_name || '-'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-view-details"
                          onClick={() => handleViewDetails(emp)}
                          disabled={detailLoadingEmail !== null}
                        >
                          {detailLoadingEmail === emp.email ? 'Opening...' : 'View Details'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {employees.length === 0 && !searchLoading && searchError === '' && (
          <p style={{ marginTop: '1rem', color: '#666' }}>
            Select Employee Type and Circle, then click Search to see results.
          </p>
        )}
      </div>
    </div>
  );
};
