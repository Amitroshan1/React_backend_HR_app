import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, UserRoundPlus, History, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useRefreshOnNavigate } from '../../../hooks/useRefreshOnNavigate';
import { useAdminVisitNav } from '../../../hooks/useAdminVisitNav';
import { formatDateDDMMYYYY } from '../../../utils/dateFormat';
import '../offboarding-ui.css';

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
  const { backLabel, goBack } = useAdminVisitNav({
    fallbackTo: '/exit-employees',
    fallbackLabel: 'Back to Exit Employees',
  });
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
  const [notice, setNotice] = useState('');
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
      `Send a rehire request for “${emp.name}” (${emp.email})?\n\n` +
        'An Admin must approve it before they become active again. ' +
        'Past exit history stays in the system for audit.'
    );
    if (!ok) return;
    setRejoiningId(emp.id);
    setError('');
    setNotice('');
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
      setNotice(data.message || 'Rehire sent for Admin approval. The employee stays exited until an Admin approves it.');
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
    <section className="obx">
        <header className="obx-head">
          <div>
            <button type="button" className="obx-back" onClick={() => goBack()}>
              <ArrowLeft size={16} />
              {backLabel}
            </button>
            <h1>Archive</h1>
            <p>Exited employees. A rehire stays here until an Admin approves it.</p>
          </div>
          <span className="obx-count">{filteredEmployees.length} of {archivedEmployees.length}</span>
        </header>
        {error ? <p className="obx-alert" role="alert">{error}</p> : null}
        {notice ? <p className="obx-notice" role="status">{notice}</p> : null}

        <div className="obx-toolbar">
          <div className="obx-filters">
              <div className="obx-field">
                <label id="archive-emp-type-label" htmlFor="archive-emp-type">Employee type</label>
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
                    <div className="obx-menu">
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

              <div className="obx-field">
                <label id="archive-circle-label" htmlFor="archive-circle">Circle</label>
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
                    <div className="obx-menu">
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

              <button type="button" className="obx-btn" onClick={resetFilters}>
                Reset
              </button>
            </div>
        </div>

        {/* Table */}
        <div className="obx-table-wrap">
          <table className="obx-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Circle</th>
                <th>Type</th>
                <th>F&amp;F</th>
                <th>Rehire</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6">Loading archived employees…</td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan="6">No archived employees match these filters.</td>
                </tr>
              ) : (
                filteredEmployees.map(emp => (
                  <tr key={emp.id}>
                    <td>
                      <strong>{emp.name}</strong>
                      <span className="obx-sub">{emp.employeeId} · {emp.email}</span>
                    </td>
                    <td>{emp.circle || '—'}</td>
                    <td>{emp.employeeType || '—'}</td>
                    <td>
                      <span className="obx-pill">{emp.fnfStatus || 'none'}</span>
                      {emp.fnf?.net_payable != null && emp.fnf.net_payable > 0 ? (
                        <span className="obx-sub">₹{Number(emp.fnf.net_payable).toLocaleString('en-IN')}</span>
                      ) : null}
                    </td>
                    <td>
                      {emp.rehirePolicy ? (
                        <>
                          <span className={`obx-pill ${emp.rehirePolicy.can_rejoin_now ? 'obx-pill--ok' : 'obx-pill--bad'}`}>
                            {emp.rehirePolicy.can_rejoin_now ? 'Eligible' : 'Blocked'}
                          </span>
                          {!emp.rehirePolicy.can_rejoin_now && emp.rehirePolicy.rehire_block_reason ? (
                            <span className="obx-sub">{emp.rehirePolicy.rehire_block_reason}</span>
                          ) : null}
                          <button type="button" className="obx-link" onClick={() => openRehirePolicyModal(emp)}>Edit policy</button>
                        </>
                      ) : '—'}
                    </td>
                    <td>
                      <div className="obx-row-actions">
                        <button
                          type="button"
                          className="obx-btn obx-btn--primary"
                          onClick={() => handleRejoin(emp)}
                          disabled={rejoiningId === emp.id || (emp.rehirePolicy && !emp.rehirePolicy.can_rejoin_now)}
                          title={
                            emp.rehirePolicy && !emp.rehirePolicy.can_rejoin_now
                              ? (emp.rehirePolicy.rehire_block_reason || 'Rejoin not allowed')
                              : 'Send a rehire request to Admin'
                          }
                        >
                          <UserRoundPlus size={14} />
                          {rejoiningId === emp.id ? 'Sending…' : 'Rehire'}
                        </button>
                        <button type="button" className="obx-btn" onClick={(e) => openExitHistory(emp, e)}>
                          <History size={14} />
                          History
                        </button>
                        <button type="button" className="obx-btn" onClick={() => handleViewDetails(emp)}>
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      {showHistoryModal && createPortal(
        <div className="obx-overlay" onClick={closeExitHistory}>
          <div className="obx-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="obx-dialog-head">
              <h2>Exit history — {historyEmployee?.name}</h2>
              <button type="button" className="obx-btn" onClick={closeExitHistory} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            {historyLoading ? (
              <p className="obx-muted">Loading exit history…</p>
            ) : historyError ? (
              <p className="obx-alert">{historyError}</p>
            ) : historyRows.length === 0 ? (
              <p className="obx-muted">No exit history records found.</p>
            ) : (
              <ul className="obx-history">
                {historyRows.map((row) => (
                  <li key={row.id}>
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
        <div className="obx-overlay" onClick={closeRehirePolicyModal}>
          <div className="obx-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="obx-dialog-head">
              <h2>Rehire policy — {rehireEditEmp.name}</h2>
              <button type="button" className="obx-btn" onClick={closeRehirePolicyModal} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <label className="obx-check-row">
              <input
                type="checkbox"
                checked={rehireForm.rehire_eligible}
                onChange={(e) => setRehireForm((f) => ({ ...f, rehire_eligible: e.target.checked }))}
              />
              Eligible for rehire
            </label>
            <div className="obx-span">
              <label htmlFor="rehire-cooldown">Cooldown until</label>
              <input
                id="rehire-cooldown"
                type="date"
                value={rehireForm.rehire_cooldown_until}
                onChange={(e) => setRehireForm((f) => ({ ...f, rehire_cooldown_until: e.target.value }))}
              />
            </div>
            <div className="obx-span">
              <label htmlFor="rehire-notes">Notes</label>
              <textarea
                id="rehire-notes"
                rows={3}
                value={rehireForm.rehire_notes}
                onChange={(e) => setRehireForm((f) => ({ ...f, rehire_notes: e.target.value }))}
                placeholder="Notes on rehire eligibility"
              />
            </div>
            <div className="obx-actions" style={{ marginTop: 14 }}>
              <button type="button" className="obx-btn" onClick={closeRehirePolicyModal}>Cancel</button>
              <button type="button" className="obx-btn obx-btn--primary" onClick={saveRehirePolicy} disabled={rehireSaving}>
                {rehireSaving ? 'Saving…' : 'Save policy'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

    </section>
  );
};

export default ArchiveEmployees;