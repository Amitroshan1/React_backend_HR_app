import React, { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, Search, UserPlus, Users } from 'lucide-react';
import './UpdateManager.css';

const API_BASE = '/api/query';
const MASTER_OPTIONS_API = '/api/auth/master-options';

const FALLBACK_CIRCLES = ['NHQ', 'Delhi', 'Mumbai', 'Bangalore', 'Hyderabad'];
const FALLBACK_EMP_TYPES = ['Software Developer', 'Human Resource', 'Accounts', 'Admin'];

export const UpdateManager = ({ onBack, circleOptions: propCircleOptions, empTypeOptions: propEmpTypeOptions }) => {
  const [circleOptions, setCircleOptions] = useState(propCircleOptions || FALLBACK_CIRCLES);
  const [empTypeOptions, setEmpTypeOptions] = useState(propEmpTypeOptions || FALLBACK_EMP_TYPES);
  const [view, setView] = useState('landing');
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
    l1_admin_id: null, l2_admin_id: null, l3_admin_id: null,
    l1_name: '', l1_mobile: '', l1_email: '',
    l2_name: '', l2_mobile: '', l2_email: '',
    l3_name: '', l3_mobile: '', l3_email: '',
  });
  const [pickerOpenFor, setPickerOpenFor] = useState(null);
  const [pickerSearchTerm, setPickerSearchTerm] = useState('');
  const [pickerResults, setPickerResults] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const pickerContainerRef = React.useRef(null);
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
      circle: prev.circle ?? circleOptions[0] ?? '',
      emp_type: prev.emp_type ?? empTypeOptions[0] ?? '',
    }));
  }, [circleOptions, empTypeOptions]);

  const fetchPickerResults = useCallback(async (q) => {
    if (!(q && q.trim())) {
      setPickerResults([]);
      return;
    }
    setPickerLoading(true);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      const res = await fetch(`${API_BASE}/api/managers/employees?${params}`, { headers: getAuthHeaders() });
      const data = await res.json();
      setPickerResults(res.ok && data.employees ? data.employees : []);
    } catch {
      setPickerResults([]);
    } finally {
      setPickerLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!pickerOpenFor || view !== 'details') return;
    const t = setTimeout(() => fetchPickerResults(pickerSearchTerm), 300);
    return () => clearTimeout(t);
  }, [pickerOpenFor, pickerSearchTerm, view, fetchPickerResults]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerContainerRef.current && !pickerContainerRef.current.contains(e.target)) {
        setPickerOpenFor(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const openPicker = (level) => {
    setPickerOpenFor(level);
    setPickerSearchTerm('');
    setPickerResults([]);
  };

  const selectPickerEmployee = (level, emp) => {
    setForm((f) => ({
      ...f,
      [`${level}_admin_id`]: emp.id,
      [`${level}_name`]: emp.name ?? '',
      [`${level}_email`]: emp.email ?? '',
      [`${level}_mobile`]: emp.mobile ?? '',
    }));
    setPickerOpenFor(null);
    setPickerSearchTerm('');
    setPickerResults([]);
    setSubmitError('');
  };

  const clearPickerSelection = (level) => {
    setForm((f) => ({
      ...f,
      [`${level}_admin_id`]: null,
      [`${level}_name`]: '',
      [`${level}_email`]: '',
      [`${level}_mobile`]: '',
    }));
    if (pickerOpenFor === level) {
      setPickerSearchTerm('');
      setPickerResults([]);
    }
    setSubmitError('');
  };

  const displayValue = (level) => {
    const id = form[`${level}_admin_id`];
    const name = form[`${level}_name`];
    const email = form[`${level}_email`];
    if (id && (name || email)) return `${name || email} (${email || ''})`;
    return '';
  };

  const handleAssignManager = useCallback(async () => {
    if (!filters.circle || !filters.emp_type) {
      setContactError('Please select both Circle and Employee Type.');
      return;
    }
    setContactError('');
    setSubmitSuccess(false);
    setContactLoading(true);
    setSelectedEmployee(null);
    setForm((prev) => ({
      ...prev,
      circle_name: filters.circle,
      user_type: filters.emp_type,
      user_email: '',
    }));
    try {
      const params = new URLSearchParams({
        circle: filters.circle,
        emp_type: filters.emp_type,
      });
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
        circle_name: filters.circle,
        user_type: filters.emp_type,
        user_email: '',
        l1_admin_id: d?.l1_admin_id ?? d?.l1?.id ?? null,
        l2_admin_id: d?.l2_admin_id ?? d?.l2?.id ?? null,
        l3_admin_id: d?.l3_admin_id ?? d?.l3?.id ?? null,
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

  const handleSearch = useCallback(async () => {
    const hasIdentifier = (filters.identifier || '').trim();
    const hasCircleAndType = filters.circle && filters.emp_type;
    if (!hasIdentifier && !hasCircleAndType) {
      setSearchError('Enter Employee Email/ID or select both Circle and Employee Type.');
      return;
    }
    setSearchError('');
    setSearchLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.circle) params.set('circle', filters.circle);
      if (filters.emp_type) params.set('emp_type', filters.emp_type);
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
        l1_admin_id: d?.l1_admin_id ?? d?.l1?.id ?? null,
        l2_admin_id: d?.l2_admin_id ?? d?.l2?.id ?? null,
        l3_admin_id: d?.l3_admin_id ?? d?.l3?.id ?? null,
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
          l1_admin_id: form.l1_admin_id || null, l2_admin_id: form.l2_admin_id || null, l3_admin_id: form.l3_admin_id || null,
          l1_name: form.l1_admin_id ? null : (form.l1_name || null),
          l1_mobile: form.l1_admin_id ? null : (form.l1_mobile || null),
          l1_email: form.l1_admin_id ? null : (form.l1_email || null),
          l2_name: form.l2_admin_id ? null : (form.l2_name || null),
          l2_mobile: form.l2_admin_id ? null : (form.l2_mobile || null),
          l2_email: form.l2_admin_id ? null : (form.l2_email || null),
          l3_name: form.l3_admin_id ? null : (form.l3_name || null),
          l3_mobile: form.l3_admin_id ? null : (form.l3_mobile || null),
          l3_email: form.l3_admin_id ? null : (form.l3_email || null),
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

  const handleBackFromDetails = () => {
    setSelectedEmployee(null);
    setContactError('');
    setSubmitError('');
    setSubmitSuccess(false);
    setView(selectedEmployee ? 'search' : 'assign');
  };

  // --- DETAILS VIEW: Manager form (centered) ---
  if (view === 'details') {
    return (
      <div className="manager-page-container">
        <header className="manager-nav">
          <button type="button" className="btn-back-square" onClick={handleBackFromDetails}>
            <ArrowLeft size={18} /> {selectedEmployee ? 'Back to Search' : 'Back to Assign'}
          </button>
        </header>

        <div className="manager-form-wrapper">
          <div className="details-sidebar-card manager-form-centered">
            <h2 className="manager-form-title">
              Manager Contact {selectedEmployee ? `for ${selectedEmployee.name || selectedEmployee.email}` : `for ${form.circle_name} / ${form.user_type}`}
            </h2>
            <p className="manager-form-subtitle">
              {selectedEmployee ? 'Update L1 / L2 / L3 for this employee.' : 'Set default L1 / L2 / L3 managers for all employees in this circle and employee type.'}
            </p>

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

                <div className="section-divider">Assign Managers (search by name, email or ID)</div>
                <p className="manager-picker-hint">Type at least one character to search. Results are limited to 50 matches.</p>

                <div className="manager-picker-wrap" ref={pickerContainerRef}>
                  <div className="section-divider">L1 Manager (Optional)</div>
                  <div className="form-item-group manager-typeahead-group">
                    <label>L1 Manager {form.l1_admin_id && (
                      <button type="button" className="manager-typeahead-clear" onClick={() => clearPickerSelection('l1')}>Clear</button>
                    )}</label>
                    <input
                      type="text"
                      placeholder="Type name, email or employee ID to search..."
                      value={pickerOpenFor === 'l1' ? pickerSearchTerm : displayValue('l1')}
                      onFocus={() => openPicker('l1')}
                      onChange={(e) => pickerOpenFor === 'l1' && setPickerSearchTerm(e.target.value)}
                      autoComplete="off"
                      className="manager-typeahead-input"
                    />
                    {pickerOpenFor === 'l1' && (
                      <div className="manager-typeahead-dropdown">
                        {pickerLoading && <div className="manager-typeahead-item manager-typeahead-loading">Loading...</div>}
                        {!pickerLoading && !pickerSearchTerm.trim() && (
                          <div className="manager-typeahead-item manager-typeahead-empty">Type name, email or employee ID to search.</div>
                        )}
                        {!pickerLoading && pickerSearchTerm.trim() && pickerResults.length === 0 && (
                          <div className="manager-typeahead-item manager-typeahead-empty">No matches. Try different text.</div>
                        )}
                        {!pickerLoading && pickerResults.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            className="manager-typeahead-item"
                            onClick={() => selectPickerEmployee('l1', o)}
                          >
                            {o.name || o.email} ({o.email})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="section-divider highlight-blue">L2 (Manager)</div>
                  <div className="form-item-group manager-typeahead-group">
                    <label>L2 Manager {form.l2_admin_id && (
                      <button type="button" className="manager-typeahead-clear" onClick={() => clearPickerSelection('l2')}>Clear</button>
                    )}</label>
                    <input
                      type="text"
                      placeholder="Type name, email or employee ID to search..."
                      value={pickerOpenFor === 'l2' ? pickerSearchTerm : displayValue('l2')}
                      onFocus={() => openPicker('l2')}
                      onChange={(e) => pickerOpenFor === 'l2' && setPickerSearchTerm(e.target.value)}
                      autoComplete="off"
                      className="manager-typeahead-input"
                    />
                    {pickerOpenFor === 'l2' && (
                      <div className="manager-typeahead-dropdown">
                        {pickerLoading && <div className="manager-typeahead-item manager-typeahead-loading">Loading...</div>}
                        {!pickerLoading && !pickerSearchTerm.trim() && (
                          <div className="manager-typeahead-item manager-typeahead-empty">Type name, email or employee ID to search.</div>
                        )}
                        {!pickerLoading && pickerSearchTerm.trim() && pickerResults.length === 0 && (
                          <div className="manager-typeahead-item manager-typeahead-empty">No matches. Try different text.</div>
                        )}
                        {!pickerLoading && pickerResults.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            className="manager-typeahead-item"
                            onClick={() => selectPickerEmployee('l2', o)}
                          >
                            {o.name || o.email} ({o.email})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="section-divider highlight-blue">L3 (Lead)</div>
                  <div className="form-item-group manager-typeahead-group">
                    <label>L3 Manager {form.l3_admin_id && (
                      <button type="button" className="manager-typeahead-clear" onClick={() => clearPickerSelection('l3')}>Clear</button>
                    )}</label>
                    <input
                      type="text"
                      placeholder="Type name, email or employee ID to search..."
                      value={pickerOpenFor === 'l3' ? pickerSearchTerm : displayValue('l3')}
                      onFocus={() => openPicker('l3')}
                      onChange={(e) => pickerOpenFor === 'l3' && setPickerSearchTerm(e.target.value)}
                      autoComplete="off"
                      className="manager-typeahead-input"
                    />
                    {pickerOpenFor === 'l3' && (
                      <div className="manager-typeahead-dropdown">
                        {pickerLoading && <div className="manager-typeahead-item manager-typeahead-loading">Loading...</div>}
                        {!pickerLoading && !pickerSearchTerm.trim() && (
                          <div className="manager-typeahead-item manager-typeahead-empty">Type name, email or employee ID to search.</div>
                        )}
                        {!pickerLoading && pickerSearchTerm.trim() && pickerResults.length === 0 && (
                          <div className="manager-typeahead-item manager-typeahead-empty">No matches. Try different text.</div>
                        )}
                        {!pickerLoading && pickerResults.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            className="manager-typeahead-item"
                            onClick={() => selectPickerEmployee('l3', o)}
                          >
                            {o.name || o.email} ({o.email})
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
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

  // --- LANDING VIEW ---
  if (view === 'landing') {
    return (
      <div className="manager-search-overlay">
        <div className="search-manager-card manager-landing-card">
          <button type="button" className="close-btn" onClick={onBack} aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <h2>Update Manager</h2>
          <p className="manager-landing-subtitle">Choose how you want to assign or update managers.</p>

          <div className="manager-landing-options">
            <button
              type="button"
              className="manager-landing-card-btn"
              onClick={() => {
                setView('assign');
                setContactError('');
                setSubmitError('');
                setSearchError('');
                if (!filters.circle && circleOptions[0]) setFilters((f) => ({ ...f, circle: circleOptions[0] }));
                if (!filters.emp_type && empTypeOptions[0]) setFilters((f) => ({ ...f, emp_type: empTypeOptions[0] }));
              }}
            >
              <div className="manager-landing-icon-wrap assign">
                <UserPlus size={28} />
              </div>
              <h3>Assign Manager</h3>
              <p>Set L1, L2, L3 for an entire emp type + circle. All employees in that combo will use these managers by default.</p>
            </button>

            <button
              type="button"
              className="manager-landing-card-btn"
              onClick={() => {
                setView('search');
                setContactError('');
                setSubmitError('');
                setSearchError('');
              }}
            >
              <div className="manager-landing-icon-wrap search">
                <Users size={28} />
              </div>
              <h3>Search Employee</h3>
              <p>Search by email or emp type + circle, then assign managers to a specific employee.</p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- ASSIGN VIEW (emp_type + circle) ---
  if (view === 'assign') {
    return (
      <div className="manager-search-overlay">
        <div className="search-manager-card">
          <button type="button" className="close-btn" onClick={() => setView('landing')} aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <h2>Assign Manager by Emp Type + Circle</h2>
          <p className="manager-assign-subtitle">Select circle and employee type. L1, L2, L3 will apply to all employees in this combo.</p>

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

          <button
            type="button"
            className="btn-execute-search"
            onClick={handleAssignManager}
            disabled={contactLoading}
          >
            <UserPlus size={18} /> {contactLoading ? 'Loading...' : 'Assign Manager'}
          </button>

          {contactError && (
            <div className="manager-search-error">{contactError}</div>
          )}
        </div>
      </div>
    );
  }

  // --- SEARCH VIEW ---
  return (
    <div className="manager-search-overlay">
      <div className={`search-manager-card ${employees.length > 0 ? 'has-results' : ''}`}>
        <div className="manager-search-header-row">
          <button type="button" className="btn-back-text" onClick={() => setView('landing')}>
            <ArrowLeft size={16} /> Back to options
          </button>
          <button type="button" className="close-btn" onClick={onBack} aria-label="Close">
            <ArrowLeft size={20} />
          </button>
        </div>
        <h2>Search Employees</h2>

        <div className="search-field-box">
          <label>Circle</label>
          <select value={filters.circle} onChange={(e) => setFilters((f) => ({ ...f, circle: e.target.value }))}>
            <option value="">Any</option>
            {circleOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="search-field-box">
          <label>Employee Type</label>
          <select value={filters.emp_type} onChange={(e) => setFilters((f) => ({ ...f, emp_type: e.target.value }))}>
            <option value="">Any</option>
            {empTypeOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="search-field-box">
          <label>Employee Email / ID</label>
          <input
            type="text"
            placeholder="Search by email or emp_id (or use circle + type above)"
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
