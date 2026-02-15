import React, { useState, useCallback } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import './UpdateLeave.css';

const API_BASE = '/api/HumanResource';

const EMP_TYPE_OPTIONS = ['Software Developer', 'Human Resource', 'Accounts', 'Admin'];
const CIRCLE_OPTIONS = ['NHQ', 'Delhi', 'Mumbai', 'Bangalore', 'Hyderabad'];

export const UpdateLeave = ({ onBack }) => {
  const [view, setView] = useState('search');
  const [filters, setFilters] = useState({ emp_type: 'Software Developer', circle: 'NHQ' });
  const [employees, setEmployees] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const [formValues, setFormValues] = useState({ privilege_leave_balance: '', casual_leave_balance: '', compensatory_leave_balance: '' });
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const [updateSuccess, setUpdateSuccess] = useState(false);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const handleSearch = useCallback(async () => {
    setSearchError('');
    setSearchLoading(true);
    try {
      const params = new URLSearchParams({ emp_type: filters.emp_type, circle: filters.circle });
      const res = await fetch(`${API_BASE}/employee/search?${params}`, { headers: getAuthHeaders() });
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

  const handleViewBalance = useCallback(async (emp) => {
    if (!emp.id) return;
    setSelectedEmployee(emp);
    setBalanceError('');
    setUpdateSuccess(false);
    setBalanceLoading(true);
    try {
      const res = await fetch(`${API_BASE}/leave-balance/${emp.id}`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) {
        setBalanceError(data.message || 'Failed to load leave balance');
        setBalanceLoading(false);
        return;
      }
      const lb = data.leave_balance || {};
      setBalance(data.leave_balance);
      setFormValues({
        privilege_leave_balance: String(lb.privilege_leave_balance ?? ''),
        casual_leave_balance: String(lb.casual_leave_balance ?? ''),
        compensatory_leave_balance: String(lb.compensatory_leave_balance ?? ''),
      });
      setView('edit');
    } catch {
      setBalanceError('Network error. Please try again.');
    } finally {
      setBalanceLoading(false);
    }
  }, [getAuthHeaders]);

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormValues((prev) => ({ ...prev, [name]: value }));
    setUpdateError('');
  };

  const handleUpdateSubmit = async (e) => {
    e.preventDefault();
    if (!selectedEmployee?.id) return;
    setUpdateError('');
    setUpdateSuccess(false);
    setUpdateLoading(true);
    try {
      const body = {
        privilege_leave_balance: parseFloat(formValues.privilege_leave_balance) ?? 0,
        casual_leave_balance: parseFloat(formValues.casual_leave_balance) ?? 0,
        compensatory_leave_balance: parseFloat(formValues.compensatory_leave_balance) ?? 0,
      };
      const res = await fetch(`${API_BASE}/leave-balance/${selectedEmployee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setUpdateError(data.message || 'Update failed');
        return;
      }
      setUpdateSuccess(true);
      setBalance({
        ...balance,
        privilege_leave_balance: body.privilege_leave_balance,
        casual_leave_balance: body.casual_leave_balance,
        compensatory_leave_balance: body.compensatory_leave_balance,
      });
    } catch {
      setUpdateError('Network error. Please try again.');
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleBackToList = () => {
    setView('search');
    setSelectedEmployee(null);
    setBalance(null);
    setBalanceError('');
    setUpdateError('');
    setUpdateSuccess(false);
  };

  // --- EDIT VIEW: Leave balance form ---
  if (view === 'edit') {
    return (
      <div className="leave-page-wrapper">
        <div className="leave-edit-container">
          <div className="balance-form-card">
            <h2 className="leave-form-title">Leave Balance for: {selectedEmployee?.first_name}</h2>
            <p className="leave-form-subtitle">Update leave balances</p>
            {balanceLoading && !balance && (
              <p style={{ padding: '1rem', color: '#666' }}>Loading...</p>
            )}
            {balanceError && (
              <div style={{ padding: '12px', marginBottom: '16px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px' }}>
                {balanceError}
              </div>
            )}
            {updateSuccess && (
              <div style={{ padding: '12px', marginBottom: '16px', background: '#dcfce7', color: '#166534', borderRadius: '8px' }}>
                Leave balance updated successfully.
              </div>
            )}
            {updateError && (
              <div style={{ padding: '12px', marginBottom: '16px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px' }}>
                {updateError}
              </div>
            )}
            {balance !== null && (
              <form onSubmit={handleUpdateSubmit}>
                <div className="leave-field">
                  <label>Privilege Leave Balance (PL)</label>
                  <input
                    type="number"
                    name="privilege_leave_balance"
                    min="0"
                    step="0.5"
                    value={formValues.privilege_leave_balance}
                    onChange={handleFormChange}
                  />
                </div>
                <div className="leave-field">
                  <label>Casual Leave Balance (CL)</label>
                  <input
                    type="number"
                    name="casual_leave_balance"
                    min="0"
                    step="0.5"
                    value={formValues.casual_leave_balance}
                    onChange={handleFormChange}
                  />
                </div>
                <div className="leave-field">
                  <label>Compensatory Leave Balance</label>
                  <input
                    type="number"
                    name="compensatory_leave_balance"
                    min="0"
                    step="0.5"
                    value={formValues.compensatory_leave_balance}
                    onChange={handleFormChange}
                  />
                </div>
                <div className="leave-form-footer">
                  <button type="submit" className="btn-save-update" disabled={updateLoading}>
                    {updateLoading ? 'Updating...' : 'Update'}
                  </button>
                  <button type="button" className="btn-cancel-list" onClick={handleBackToList}>
                    Back to Employee List
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- SEARCH VIEW ---
  return (
    <div className="leave-page-wrapper">
      <div className="leave-content-area">
        <button type="button" className="back-to-updates-btn" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="leave-search-filter-box">
          <div className="filter-inner-grid">
            <div className="filter-column">
              <label>Employee Type</label>
              <select
                value={filters.emp_type}
                onChange={(e) => setFilters((f) => ({ ...f, emp_type: e.target.value }))}
              >
                {EMP_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="filter-column">
              <label>Circle</label>
              <select
                value={filters.circle}
                onChange={(e) => setFilters((f) => ({ ...f, circle: e.target.value }))}
              >
                {CIRCLE_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="execute-search-btn"
              onClick={handleSearch}
              disabled={searchLoading}
            >
              <Search size={18} /> {searchLoading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {searchError && (
          <div style={{ padding: '12px', marginTop: '12px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px' }}>
            {searchError}
          </div>
        )}

        {employees.length > 0 && (
          <div className="leave-table-wrapper">
            <table className="leave-data-table">
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>First Name</th>
                  <th>Leave Balance</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id}>
                    <td>{emp.emp_id || '-'}</td>
                    <td>{emp.first_name || '-'}</td>
                    <td>
                      <button
                        type="button"
                        className="view-balance-link"
                        onClick={() => handleViewBalance(emp)}
                      >
                        View Leave Balance
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {employees.length === 0 && !searchLoading && !searchError && (
          <p style={{ marginTop: '1rem', color: '#666' }}>
            Select Employee Type and Circle, then click Search to see results.
          </p>
        )}
      </div>
    </div>
  );
};
