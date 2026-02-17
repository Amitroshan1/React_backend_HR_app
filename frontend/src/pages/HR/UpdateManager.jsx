import React, { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import './UpdateManager.css';

const API_BASE = '/api/query';
const MASTER_OPTIONS_API = '/api/auth/master-options';

const FALLBACK_CIRCLES = ['NHQ', 'Delhi', 'Mumbai', 'Bangalore', 'Hyderabad'];
const FALLBACK_EMP_TYPES = ['Software Developer', 'Human Resource', 'Accounts', 'Admin'];

export const UpdateManager = ({ onBack, circleOptions: propCircleOptions, empTypeOptions: propEmpTypeOptions }) => {
  const [circleOptions, setCircleOptions] = useState(propCircleOptions || FALLBACK_CIRCLES);
  const [empTypeOptions, setEmpTypeOptions] = useState(propEmpTypeOptions || FALLBACK_EMP_TYPES);
  const [view, setView] = useState('search');
  const [filters, setFilters] = useState({
    circle: (propCircleOptions && propCircleOptions[0]) || FALLBACK_CIRCLES[0],
    emp_type: (propEmpTypeOptions && propEmpTypeOptions[0]) || FALLBACK_EMP_TYPES[0],
    identifier: ''
  });
  const [employees, setEmployees] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [form, setForm] = useState({
    circle_name: '',
    user_type: '',
    user_email: '',
    l1_name: '', l1_mobile: '', l1_email: '',
    l2_name: '', l2_mobile: '', l2_email: '',
    l3_name: '', l3_mobile: '', l3_email: '',
  });
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    if (propCircleOptions?.length) {
      setCircleOptions(propCircleOptions);
      return;
    }
    if (!propCircleOptions) {
      fetch(MASTER_OPTIONS_API, { headers: getAuthHeaders() })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => { if (data.success && data.circles?.length) setCircleOptions(data.circles); });
    }
  }, [propCircleOptions, getAuthHeaders]);
  useEffect(() => {
    if (propEmpTypeOptions?.length) {
      setEmpTypeOptions(propEmpTypeOptions);
      return;
    }
    if (!propEmpTypeOptions) {
      fetch(MASTER_OPTIONS_API, { headers: getAuthHeaders() })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => { if (data.success && data.departments?.length) setEmpTypeOptions(data.departments); });
    }
  }, [propEmpTypeOptions, getAuthHeaders]);
  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      circle: prev.circle || circleOptions[0] || '',
      emp_type: prev.emp_type || empTypeOptions[0] || '',
    }));
  }, [circleOptions, empTypeOptions]);

  const handleSearch = useCallback(async () => {
    setSearchError('');
    setSearchLoading(true);
    try {
      const params = new URLSearchParams({
        circle: filters.circle,
        emp_type: filters.emp_type,
      });
      if (filters.identifier?.trim()) params.set('identifier', filters.identifier.trim());
      const res = await fetch(`${API_BASE}/api/managers/search?${params}`, { headers: getAuthHeaders() });
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
  }, [filters.circle, filters.emp_type, filters.identifier, getAuthHeaders]);

  const handleEditManager = useCallback(async (emp) => {
    setSelectedEmployee(emp);
    setContactError('');
    setSubmitSuccess(false);
    setContactLoading(true);
    setForm((prev) => ({
      ...prev,
      circle_name: emp.circle || filters.circle,
      user_type: emp.emp_type || filters.emp_type,
      user_email: emp.email || '',
    }));
    try {
      const params = new URLSearchParams({
        circle: emp.circle || filters.circle,
        emp_type: emp.emp_type || filters.emp_type,
      });
      if (emp.email) params.set('user_email', emp.email);
      const res = await fetch(`${API_BASE}/api/managers/contact?${params}`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) {
        setContactError(data.message || 'Failed to load manager contact');
        setContactLoading(false);
        return;
      }
      const d = data.data;
      setForm((prev) => ({
        ...prev,
        circle_name: emp.circle || filters.circle,
        user_type: emp.emp_type || filters.emp_type,
        user_email: emp.email || '',
        l1_name: d?.l1?.name ?? '', l1_mobile: d?.l1?.mobile ?? '', l1_email: d?.l1?.email ?? '',
        l2_name: d?.l2?.name ?? '', l2_mobile: d?.l2?.mobile ?? '', l2_email: d?.l2?.email ?? '',
        l3_name: d?.l3?.name ?? '', l3_mobile: d?.l3?.mobile ?? '', l3_email: d?.l3?.email ?? '',
      }));
      setView('details');
    } catch {
      setContactError('Network error. Please try again.');
    } finally {
      setContactLoading(false);
    }
  }, [filters.circle, filters.emp_type, getAuthHeaders]);

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setSubmitError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    setSubmitSuccess(false);
    setSubmitLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/managers/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          circle_name: form.circle_name,
          user_type: form.user_type,
          user_email: form.user_email || null,
          l1_name: form.l1_name || null, l1_mobile: form.l1_mobile || null, l1_email: form.l1_email || null,
          l2_name: form.l2_name || null, l2_mobile: form.l2_mobile || null, l2_email: form.l2_email || null,
          l3_name: form.l3_name || null, l3_mobile: form.l3_mobile || null, l3_email: form.l3_email || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.message || 'Failed to save');
        return;
      }
      setSubmitSuccess(true);
    } catch {
      setSubmitError('Network error. Please try again.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleBackToSearch = () => {
    setView('search');
    setSelectedEmployee(null);
    setContactError('');
    setSubmitError('');
    setSubmitSuccess(false);
  };

  // --- DETAILS VIEW: Manager form (centered) ---
  if (view === 'details') {
    return (
      <div className="manager-page-container">
        <header className="manager-nav">
          <button type="button" className="btn-back-square" onClick={handleBackToSearch}>
            <ArrowLeft size={18} /> Back to Search
          </button>
        </header>

        <div className="manager-form-wrapper">
          <div className="details-sidebar-card manager-form-centered">
            <h2 className="manager-form-title">
              Manager Contact {selectedEmployee ? `for ${selectedEmployee.name || selectedEmployee.email}` : ''}
            </h2>
            <p className="manager-form-subtitle">Update L1 / L2 / L3 contact information for this circle and employee type.</p>

            {contactLoading && (
              <p className="manager-loading">Loading...</p>
            )}
            {contactError && (
              <div className="manager-error-msg">{contactError}</div>
            )}
            {submitSuccess && (
              <div className="manager-success-msg">Manager contact saved successfully.</div>
            )}
            {submitError && (
              <div className="manager-error-msg">{submitError}</div>
            )}

            {!contactLoading && (
              <form className="sidebar-form" onSubmit={handleSubmit}>
                <div className="form-item-group">
                  <label>Circle</label>
                  <input type="text" value={form.circle_name} readOnly className="read-only-input" />
                </div>
                <div className="form-item-group">
                  <label>Department / Employee Type</label>
                  <input type="text" value={form.user_type} readOnly className="read-only-input" />
                </div>
                {form.user_email && (
                  <div className="form-item-group">
                    <label>Employee Email (optional)</label>
                    <input type="text" value={form.user_email} readOnly className="read-only-input" />
                  </div>
                )}

                <div className="section-divider">L1 Contact Information (Optional)</div>
                <div className="form-item-group">
                  <label>L1 Name</label>
                  <input type="text" name="l1_name" placeholder="L1 Name" value={form.l1_name} onChange={handleFormChange} />
                </div>
                <div className="form-item-group">
                  <label>L1 Mobile</label>
                  <input type="text" name="l1_mobile" placeholder="L1 Mobile" value={form.l1_mobile} onChange={handleFormChange} />
                </div>
                <div className="form-item-group">
                  <label>L1 Email</label>
                  <input type="email" name="l1_email" placeholder="L1 Email" value={form.l1_email} onChange={handleFormChange} />
                </div>

                <div className="section-divider highlight-blue">L2 (Manager) Contact Information</div>
                <div className="form-item-group">
                  <label>L2 Name</label>
                  <input type="text" name="l2_name" placeholder="L2 Name" value={form.l2_name} onChange={handleFormChange} />
                </div>
                <div className="form-item-group">
                  <label>L2 Mobile</label>
                  <input type="text" name="l2_mobile" placeholder="L2 Mobile" value={form.l2_mobile} onChange={handleFormChange} />
                </div>
                <div className="form-item-group">
                  <label>L2 Email</label>
                  <input type="email" name="l2_email" placeholder="L2 Email" value={form.l2_email} onChange={handleFormChange} />
                </div>

                <div className="section-divider highlight-blue">L3 (Lead) Contact Information</div>
                <div className="form-item-group">
                  <label>L3 Name</label>
                  <input type="text" name="l3_name" placeholder="L3 Name" value={form.l3_name} onChange={handleFormChange} />
                </div>
                <div className="form-item-group">
                  <label>L3 Mobile</label>
                  <input type="text" name="l3_mobile" placeholder="L3 Mobile" value={form.l3_mobile} onChange={handleFormChange} />
                </div>
                <div className="form-item-group">
                  <label>L3 Email</label>
                  <input type="email" name="l3_email" placeholder="L3 Email" value={form.l3_email} onChange={handleFormChange} />
                </div>

                <button type="submit" className="btn-manager-submit" disabled={submitLoading}>
                  {submitLoading ? 'Saving...' : 'Submit'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- SEARCH VIEW ---
  return (
    <div className="manager-search-overlay">
      <div className={`search-manager-card ${employees.length > 0 ? 'has-results' : ''}`}>
        <button type="button" className="close-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <h2>Search Employees</h2>

        <div className="search-field-box">
          <label>Circle</label>
          <select value={filters.circle} onChange={(e) => setFilters((f) => ({ ...f, circle: e.target.value }))}>
            {circleOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="search-field-box">
          <label>Employee Type</label>
          <select value={filters.emp_type} onChange={(e) => setFilters((f) => ({ ...f, emp_type: e.target.value }))}>
            {empTypeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="search-field-box">
          <label>Employee Email / ID (optional)</label>
          <input
            type="text"
            placeholder="Leave blank for all in circle/type"
            value={filters.identifier}
            onChange={(e) => setFilters((f) => ({ ...f, identifier: e.target.value }))}
          />
        </div>

        <button type="button" className="btn-execute-search" onClick={handleSearch} disabled={searchLoading}>
          <Search size={18} /> {searchLoading ? 'Searching...' : 'Search'}
        </button>

        {searchError && (
          <div className="manager-search-error">{searchError}</div>
        )}

        {employees.length > 0 && (
          <div className="manager-results-table-wrap">
            <p className="manager-results-title">Select an employee to edit manager contact</p>
            <table className="manager-results-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id}>
                    <td>{emp.name || '-'}</td>
                    <td>{emp.email || '-'}</td>
                    <td>
                      <button
                        type="button"
                        className="view-balance-link"
                        onClick={() => handleEditManager(emp)}
                        disabled={contactLoading}
                      >
                        Edit Manager
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
