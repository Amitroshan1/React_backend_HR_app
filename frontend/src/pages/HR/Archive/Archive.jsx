import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, UserRoundPlus, History, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useRefreshOnNavigate } from '../../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../../utils/dateFormat';
import './Archive.css';

const HR_API_BASE = '/api/HumanResource';
const ALL_TYPES_LABEL = 'All Types';
const ALL_CIRCLES_LABEL = 'All Circles';

const mergeFilterOptions = (masterList, records, pickValue) => {
  const values = [
    ...(masterList || []),
    ...records.map(pickValue).filter(Boolean),
  ];
  return [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
};

const ArchiveEmployees = () => {
  const navigate = useNavigate();
  const [archivedEmployees, setArchivedEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Filter states
  const [employeeType, setEmployeeType] = useState('');
  const [circle, setCircle] = useState('');
  
  // Searchable dropdown states
  const [typeSearch, setTypeSearch] = useState('');
  const [circleSearch, setCircleSearch] = useState('');
  
  const [showTypeList, setShowTypeList] = useState(false);
  const [showCircleList, setShowCircleList] = useState(false);
  
  const [masterOptions, setMasterOptions] = useState({ departments: [], circles: [] });
  const [rejoiningId, setRejoiningId] = useState(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyRows, setHistoryRows] = useState([]);
  const [historyEmployee, setHistoryEmployee] = useState(null);
  const [showRehireModal, setShowRehireModal] = useState(false);
  const [rehireEditEmp, setRehireEditEmp] = useState(null);
  const [rehireForm, setRehireForm] = useState({
    rehire_eligible: true,
    rehire_cooldown_until: '',
    rehire_notes: '',
  });
  const [rehireSaving, setRehireSaving] = useState(false);

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
        exitType: emp.exit_type || null,
        fnfStatus: emp.fnf_status || 'none',
        fnf: emp.fnf || null,
        rehirePolicy: emp.rehire_policy || null,
      }));
      setArchivedEmployees(mapped);
    } catch {
      setError('Network error while loading archived employees');
      setArchivedEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useRefreshOnNavigate(() => {
    loadArchivedEmployees();
  });

  useEffect(() => {
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

    if (employeeType && circle) {
      filtered = filtered.filter(emp =>
        emp.employeeType === employeeType && emp.circle === circle
      );
    } else if (employeeType) {
      filtered = filtered.filter(emp => emp.employeeType === employeeType);
    } else if (circle) {
      filtered = filtered.filter(emp => emp.circle === circle);
    }

    return filtered;
  }, [archivedEmployees, employeeType, circle]);

  const employeeTypes = useMemo(() => {
    return mergeFilterOptions(
      masterOptions.departments,
      archivedEmployees,
      (e) => e.employeeType,
    );
  }, [masterOptions.departments, archivedEmployees]);

  const circles = useMemo(() => {
    return mergeFilterOptions(
      masterOptions.circles,
      archivedEmployees,
      (e) => e.circle,
    );
  }, [masterOptions.circles, archivedEmployees]);

  const handleViewDetails = (employee) => {
    if (!employee?.id) return;
    navigate(`/archive-employees/${employee.id}`);
  };

  const handleRejoin = async (emp) => {
    if (!emp?.id) return;
    if (emp.rehirePolicy && !emp.rehirePolicy.can_rejoin_now) {
      setError(emp.rehirePolicy.rehire_block_reason || 'Rejoin is not allowed for this employee');
      return;
    }
    const ok = window.confirm(
      `Rejoin “${emp.name}” (${emp.email})?\n\n` +
        'They will be restored as an active employee with the same profile and records. ' +
        'Past exit history stays in the system for audit.'
    );
    if (!ok) return;
    setRejoiningId(emp.id);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/archive/employee/${emp.id}/rejoin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || data.msg || 'Could not restore employee');
        return;
      }
      await loadArchivedEmployees();
      window.dispatchEvent(new Event('employeeRejoined'));
    } catch {
      setError('Network error while restoring employee');
    } finally {
      setRejoiningId(null);
    }
  };

  const openRehirePolicyModal = (emp) => {
    if (!emp?.id) return;
    const policy = emp.rehirePolicy || {};
    setRehireEditEmp(emp);
    setRehireForm({
      rehire_eligible: policy.rehire_eligible !== false,
      rehire_cooldown_until: policy.rehire_cooldown_until
        ? String(policy.rehire_cooldown_until).slice(0, 10)
        : '',
      rehire_notes: policy.rehire_notes || '',
    });
    setShowRehireModal(true);
  };

  const closeRehirePolicyModal = () => {
    setShowRehireModal(false);
    setRehireEditEmp(null);
    setRehireSaving(false);
  };

  const saveRehirePolicy = async () => {
    if (!rehireEditEmp?.id) return;
    setRehireSaving(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/archive/employee/${rehireEditEmp.id}/rehire-policy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          rehire_eligible: rehireForm.rehire_eligible,
          rehire_cooldown_until: rehireForm.rehire_cooldown_until || null,
          rehire_notes: rehireForm.rehire_notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || 'Could not update rehire policy');
        return;
      }
      closeRehirePolicyModal();
      await loadArchivedEmployees();
    } catch {
      setError('Network error while updating rehire policy');
    } finally {
      setRehireSaving(false);
    }
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
    setTypeSearch('');
    setCircleSearch('');
    setShowTypeList(false);
    setShowCircleList(false);
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
          <div className="title-section__copy">
            <h1 className="page-title">Archive Employees</h1>
            <p className="page-subtitle">View exited employees and manage rehire or rejoin actions.</p>
          </div>
          <div className="title-section__meta">
            <span className="results-count">
              Showing <strong>{filteredEmployees.length}</strong> of {archivedEmployees.length} archived
            </span>
          </div>
        </div>
        {error && (
          <p className="archive-error" role="alert">{error}</p>
        )}

        {/* Filters */}
        <div className="archive-filters-panel">
          <div className="archive-filters-panel__toolbar">
            <div className="archive-filters-panel__search">
              <div className="archive-filters-panel__field">
                <span className="archive-filters-panel__label" id="archive-emp-type-label">Employee type</span>
                <div className="custom-select">
                  <input
                    id="archive-emp-type"
                    type="text"
                    placeholder="Select or type"
                    className="filter-input"
                    aria-labelledby="archive-emp-type-label"
                    value={typeSearch !== '' ? typeSearch : (employeeType || ALL_TYPES_LABEL)}
                    onFocus={(e) => {
                      setShowTypeList(true);
                      if (!employeeType && typeSearch === '') {
                        requestAnimationFrame(() => e.target.select());
                      }
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTypeSearch(val);
                      if (val === '' || val === ALL_TYPES_LABEL) {
                        setEmployeeType('');
                      }
                      setShowTypeList(true);
                    }}
                  />

                  {showTypeList && (
                    <div className="dropdown-list">
                      <div
                        className={`dropdown-item${!employeeType ? ' dropdown-item-selected' : ''}`}
                        onClick={() => {
                          setEmployeeType('');
                          setTypeSearch('');
                          setShowTypeList(false);
                        }}
                      >
                        {ALL_TYPES_LABEL}
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

              <div className="archive-filters-panel__field">
                <span className="archive-filters-panel__label" id="archive-circle-label">Circle</span>
                <div className="custom-select">
                  <input
                    id="archive-circle"
                    type="text"
                    placeholder="Select or type"
                    className="filter-input"
                    aria-labelledby="archive-circle-label"
                    value={circleSearch !== '' ? circleSearch : (circle || ALL_CIRCLES_LABEL)}
                    onFocus={(e) => {
                      setShowCircleList(true);
                      if (!circle && circleSearch === '') {
                        requestAnimationFrame(() => e.target.select());
                      }
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCircleSearch(val);
                      if (val === '' || val === ALL_CIRCLES_LABEL) {
                        setCircle('');
                      }
                      setShowCircleList(true);
                    }}
                  />

                  {showCircleList && (
                    <div className="dropdown-list">
                      <div
                        className={`dropdown-item${!circle ? ' dropdown-item-selected' : ''}`}
                        onClick={() => {
                          setCircle('');
                          setCircleSearch('');
                          setShowCircleList(false);
                        }}
                      >
                        {ALL_CIRCLES_LABEL}
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

              <button type="button" className="archive-filters-panel__reset-btn" onClick={resetFilters}>
                Reset
              </button>
            </div>
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
                <th>F&amp;F</th>
                <th>Rehire policy</th>
                <th>Rejoin</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" className="no-data">
                    Loading archived employees...
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan="9" className="no-data">
                    No archived employees found
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(emp => (
                  <tr 
                    key={emp.id}
                    className="employee-row"
                  >
                    <td className="archive-cell archive-cell--id">
                      <span className="archive-emp-id">{emp.employeeId}</span>
                    </td>
                    
                    <td className="archive-cell archive-cell--name">
                      <span className="employee-name">{emp.name}</span>
                    </td>

                    <td className="archive-cell">
                      <span className="circle-badge">{emp.circle || '—'}</span>
                    </td>

                    <td className="archive-cell">
                      <span className="type-badge">{emp.employeeType || '—'}</span>
                    </td>

                    <td className="archive-cell archive-cell--email">
                      <span className="employee-email">{emp.email}</span>
                    </td>
                    <td className="archive-cell">
                      <div className="archive-fnf-cell">
                        <span className={`archive-fnf-badge archive-fnf-badge--${(emp.fnfStatus || 'none').replace(/\s+/g, '-')}`}>
                          {emp.fnfStatus || 'none'}
                        </span>
                        {emp.fnf?.net_payable != null && emp.fnf.net_payable > 0 ? (
                          <small className="archive-fnf-net">₹{Number(emp.fnf.net_payable).toLocaleString('en-IN')}</small>
                        ) : null}
                      </div>
                    </td>
                    <td className="archive-cell">
                      {emp.rehirePolicy ? (
                        <div className="archive-rehire-cell">
                          <span className={`archive-rehire-badge ${emp.rehirePolicy.can_rejoin_now ? 'archive-rehire-badge--ok' : 'archive-rehire-badge--blocked'}`}>
                            {emp.rehirePolicy.can_rejoin_now ? 'Eligible' : 'Blocked'}
                          </span>
                          {!emp.rehirePolicy.can_rejoin_now && emp.rehirePolicy.rehire_block_reason && (
                            <small className="archive-rehire-reason">{emp.rehirePolicy.rehire_block_reason}</small>
                          )}
                          <button
                            type="button"
                            className="archive-rehire-edit"
                            onClick={() => openRehirePolicyModal(emp)}
                          >
                            Edit policy
                          </button>
                        </div>
                      ) : (
                        <span className="archive-cell-empty">—</span>
                      )}
                    </td>
                    <td className="archive-cell archive-cell--rejoin">
                      <button
                        type="button"
                        className="archive-rejoin-btn"
                        onClick={() => handleRejoin(emp)}
                        disabled={rejoiningId === emp.id || (emp.rehirePolicy && !emp.rehirePolicy.can_rejoin_now)}
                        title={
                          emp.rehirePolicy && !emp.rehirePolicy.can_rejoin_now
                            ? (emp.rehirePolicy.rehire_block_reason || 'Rejoin not allowed')
                            : 'Restore as active employee (same profile data)'
                        }
                      >
                        <UserRoundPlus size={15} aria-hidden />
                        {rejoiningId === emp.id ? 'Restoring…' : 'Rejoin'}
                      </button>
                    </td>
                    <td className="archive-cell archive-cell--actions">
                      <div className="archive-action-cell">
                        <button
                          type="button"
                          className="action-button archive-history-btn"
                          onClick={(e) => openExitHistory(emp, e)}
                        >
                          <History size={14} aria-hidden />
                          History
                        </button>
                        <button
                          type="button"
                          className="action-button archive-details-btn"
                          onClick={() => handleViewDetails(emp)}
                        >
                          View details
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showHistoryModal && createPortal(
        <div className="archive-modal-overlay" onClick={closeExitHistory}>
          <div className="archive-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="archive-modal__header">
              <h2>Exit history — {historyEmployee?.name}</h2>
              <button type="button" className="archive-modal__close" onClick={closeExitHistory} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {historyLoading ? (
              <p className="archive-modal__muted">Loading exit history…</p>
            ) : historyError ? (
              <p className="archive-error">{historyError}</p>
            ) : historyRows.length === 0 ? (
              <p className="archive-modal__muted">No exit history records found.</p>
            ) : (
              <ul className="archive-history-list">
                {historyRows.map((row) => (
                  <li key={row.id} className="archive-history-item">
                    <div>
                      <strong>{row.exit_type || 'Exit'}</strong>
                      <span>LWD: {formatDateDDMMYYYY(row.last_working_day || row.exit_date)}</span>
                      {row.notice_shortfall_days > 0 && (
                        <span>Notice shortfall: {row.notice_shortfall_days} day(s)</span>
                      )}
                      {row.exit_reason && <p>{row.exit_reason}</p>}
                    </div>
                    <small>{row.created_by || '—'} · {formatDateDDMMYYYY(row.created_at)}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>,
        document.body
      )}

      {showRehireModal && rehireEditEmp && createPortal(
        <div className="archive-modal-overlay" onClick={closeRehirePolicyModal}>
          <div className="archive-modal archive-modal--form" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="archive-modal__header">
              <h2>Rehire policy — {rehireEditEmp.name}</h2>
              <button type="button" className="archive-modal__close" onClick={closeRehirePolicyModal} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <label className="archive-modal__check">
              <input
                type="checkbox"
                checked={rehireForm.rehire_eligible}
                onChange={(e) => setRehireForm((f) => ({ ...f, rehire_eligible: e.target.checked }))}
              />
              Eligible for rehire
            </label>
            <label className="archive-modal__label">Rehire cooldown until (optional)</label>
            <input
              type="date"
              className="archive-modal__input"
              value={rehireForm.rehire_cooldown_until}
              onChange={(e) => setRehireForm((f) => ({ ...f, rehire_cooldown_until: e.target.value }))}
            />
            <label className="archive-modal__label">Notes</label>
            <textarea
              className="archive-modal__textarea"
              rows={3}
              value={rehireForm.rehire_notes}
              onChange={(e) => setRehireForm((f) => ({ ...f, rehire_notes: e.target.value }))}
              placeholder="HR notes on rehire eligibility"
            />
            <div className="archive-modal__actions">
              <button type="button" className="action-button" onClick={closeRehirePolicyModal}>Cancel</button>
              <button type="button" className="archive-rejoin-btn" onClick={saveRehirePolicy} disabled={rehireSaving}>
                {rehireSaving ? 'Saving…' : 'Save policy'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};

export default ArchiveEmployees;