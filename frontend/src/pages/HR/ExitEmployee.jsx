import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Archive, AlertCircle, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './ExitEmployee.css';

const HR_API_BASE = '/api/HumanResource';
const ALL_TYPES_LABEL = 'All Types';
const ALL_CIRCLES_LABEL = 'All Circles';
const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
const EXIT_TYPES_DEFAULT = ['Resigned', 'Terminated', 'Absconded', 'Retirement', 'End of Contract'];

const statusBadgeClass = (status) => {
  const map = {
    initiated: 'exit-status--initiated',
    notice: 'exit-status--notice',
    clearance: 'exit-status--clearance',
    ready: 'exit-status--ready',
    exited: 'exit-status--exited',
    fnf_settled: 'exit-status--fnf',
  };
  return map[status] || 'exit-status--none';
};

const ExitEmployee = ({onBack}) => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Check if employee data was passed from Archive and where we came from
  const employeeFromArchive = location.state?.selectedEmployee;
  const sourceFrom = location.state?.from; // 'archive' or undefined (from HR)
  
  const wrapperRef = useRef(null);
  const typeSelectRef = useRef(null);
  const circleSelectRef = useRef(null);

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [employeeType, setEmployeeType] = useState('');
  const [circle, setCircle] = useState('');

  // Searchable dropdown states
  const [typeSearch, setTypeSearch] = useState('');
  const [circleSearch, setCircleSearch] = useState('');

  const [showTypeList, setShowTypeList] = useState(false);
  const [showCircleList, setShowCircleList] = useState(false);

  const closeFilterDropdowns = useCallback(() => {
    setShowTypeList(false);
    setShowCircleList(false);
  }, []);

  // Close each dropdown when clicking outside it (not only outside the whole page).
  useEffect(() => {
    const handler = (e) => {
      if (typeSelectRef.current && !typeSelectRef.current.contains(e.target)) {
        setShowTypeList(false);
      }
      if (circleSelectRef.current && !circleSelectRef.current.contains(e.target)) {
        setShowCircleList(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeFilterDropdowns();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeFilterDropdowns]);

  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [masterOptions, setMasterOptions] = useState({ departments: [], circles: [] });
  const [exitDate, setExitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lastWorkingDay, setLastWorkingDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [resignationDate, setResignationDate] = useState('');
  const [exitType, setExitType] = useState('Resigned');
  const [noticeShortfallDays, setNoticeShortfallDays] = useState(0);
  const [exitTypes, setExitTypes] = useState(EXIT_TYPES_DEFAULT);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [offboardingPreview, setOffboardingPreview] = useState(null);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [exitInterview, setExitInterview] = useState(null);
  const [hrInterviewCompleted, setHrInterviewCompleted] = useState(false);
  const [hrInterviewDate, setHrInterviewDate] = useState('');
  const [hrInterviewNotes, setHrInterviewNotes] = useState('');
  const [hrInterviewSaving, setHrInterviewSaving] = useState(false);
  const [forceOverride, setForceOverride] = useState(false);
  const [forceOverrideReason, setForceOverrideReason] = useState('');
  const [exitReason, setExitReason] = useState('');

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
        resignationDate: e.resignation_date || null,
        resignationStatus: e.resignation_status || null,
        offboarding: e.offboarding || {},
      }));
      setEmployees(rows);
    } catch {
      setError('Network error while loading employees');
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useRefreshOnNavigate(() => {
    loadActiveEmployees();
  });

  useEffect(() => {
    window.addEventListener('employeeRejoined', loadActiveEmployees);
    return () => window.removeEventListener('employeeRejoined', loadActiveEmployees);
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

  const filteredEmployees = useMemo(() => {
    let filtered = [...employees];
    const typeNorm = norm(employeeType);
    const circleNorm = norm(circle);

    if (typeNorm && circleNorm) {
      filtered = filtered.filter(emp =>
        norm(emp.employeeType).includes(typeNorm) && norm(emp.circle).includes(circleNorm)
      );
    } else if (typeNorm) {
      filtered = filtered.filter(emp => norm(emp.employeeType).includes(typeNorm));
    } else if (circleNorm) {
      filtered = filtered.filter(emp => norm(emp.circle).includes(circleNorm));
    }

    return filtered;
  }, [employees, employeeType, circle]);

  const employeeTypes = useMemo(() => {
    if (masterOptions.departments.length) return masterOptions.departments;
    return [...new Set(employees.map((e) => e.employeeType).filter(Boolean))];
  }, [masterOptions.departments, employees]);

  const circles = useMemo(() => {
    if (masterOptions.circles.length) return masterOptions.circles;
    return [...new Set(employees.map((e) => e.circle).filter(Boolean))];
  }, [masterOptions.circles, employees]);

  const fetchExitChecklist = useCallback(async (employeeId, type) => {
    if (!employeeId) return;
    setChecklistLoading(true);
    try {
      const params = new URLSearchParams({ exit_type: type || 'Resigned' });
      const res = await fetch(`${HR_API_BASE}/employees/${employeeId}/exit-checklist?${params}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setOffboardingPreview(data.offboarding || null);
        setLeaveBalance(data.leave_balance || null);
        const ei = data.exit_interview || null;
        setExitInterview(ei);
        setHrInterviewCompleted(Boolean(ei?.hr_interview_completed));
        setHrInterviewDate(ei?.hr_interview_date ? String(ei.hr_interview_date).slice(0, 10) : '');
        setHrInterviewNotes(ei?.hr_notes || '');
        if (Array.isArray(data.exit_types) && data.exit_types.length) {
          setExitTypes(data.exit_types);
        }
        if (data.offboarding?.resignation_date) {
          setResignationDate(data.offboarding.resignation_date);
        }
      } else {
        setOffboardingPreview(null);
        setLeaveBalance(null);
        setExitInterview(null);
      }
    } catch {
      setOffboardingPreview(null);
      setLeaveBalance(null);
      setExitInterview(null);
    } finally {
      setChecklistLoading(false);
    }
  }, [getAuthHeaders]);

  // Handle employee data passed from Archive
  useEffect(() => {
    if (!employeeFromArchive) return;
    const today = new Date().toISOString().slice(0, 10);
    const type = 'Resigned';
    setSelectedEmployee(employeeFromArchive);
    setExitType(type);
    setExitDate(employeeFromArchive.resignationDate || today);
    setLastWorkingDay(employeeFromArchive.resignationDate || today);
    setResignationDate(employeeFromArchive.resignationDate || '');
    setNoticeShortfallDays(0);
    setExitReason('');
    setForceOverride(false);
    setForceOverrideReason('');
    setOffboardingPreview(employeeFromArchive.offboarding || null);
    setShowConfirm(true);
    if (employeeFromArchive.id) {
      fetchExitChecklist(employeeFromArchive.id, type);
    }
  }, [employeeFromArchive, fetchExitChecklist]);

  const handleActionClick = async (employee) => {
    const today = new Date().toISOString().slice(0, 10);
    const type = 'Resigned';
    setError('');
    setSelectedEmployee(employee);
    setExitType(type);
    setExitDate(employee.resignationDate || today);
    setLastWorkingDay(employee.resignationDate || today);
    setResignationDate(employee.resignationDate || '');
    setNoticeShortfallDays(0);
    setExitReason('');
    setForceOverride(false);
    setForceOverrideReason('');
    setOffboardingPreview(employee.offboarding || null);
    setShowConfirm(true);
    await fetchExitChecklist(employee.id, type);
  };

  const handleExitTypeChange = async (e) => {
    const next = e.target.value;
    setExitType(next);
    if (selectedEmployee?.id) {
      await fetchExitChecklist(selectedEmployee.id, next);
    }
  };

  const canSubmitExit = useMemo(() => {
    if (!exitDate || !(exitReason || '').trim()) return false;
    if (forceOverride && (forceOverrideReason || '').trim().length < 10) return false;
    if (offboardingPreview && offboardingPreview.can_exit === false && !forceOverride) return false;
    return true;
  }, [exitDate, exitReason, forceOverride, forceOverrideReason, offboardingPreview]);

  const handleSaveHrInterview = async () => {
    if (!selectedEmployee?.id) return;
    setHrInterviewSaving(true);
    try {
      const res = await fetch(`${HR_API_BASE}/employees/${selectedEmployee.id}/exit-interview`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          hr_interview_completed: hrInterviewCompleted,
          hr_interview_date: hrInterviewDate || null,
          hr_notes: hrInterviewNotes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || 'Failed to save HR exit interview');
        return;
      }
      setExitInterview(data.exit_interview || null);
      if (selectedEmployee?.id) {
        await fetchExitChecklist(selectedEmployee.id, exitType);
      }
    } catch {
      setError('Network error while saving HR exit interview');
    } finally {
      setHrInterviewSaving(false);
    }
  };

  const handleConfirmExit = async () => {
    if (!selectedEmployee || submitting || !canSubmitExit) return;

    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/mark-exit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          employee_email: selectedEmployee.email,
          exit_type: exitType,
          exit_reason: (exitReason || '').trim(),
          exit_date: exitDate,
          last_working_day: lastWorkingDay || exitDate,
          resignation_date: resignationDate || undefined,
          notice_shortfall_days: Number(noticeShortfallDays || 0),
          force_override: forceOverride,
          force_override_reason: forceOverride ? (forceOverrideReason || '').trim() : '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.offboarding) setOffboardingPreview(data.offboarding);
        setError(data.message || 'Failed to exit employee');
        return;
      }
      setEmployees((prev) => prev.filter((emp) => emp.id !== selectedEmployee.id));
      window.dispatchEvent(new Event('employeeArchived'));
      if (data.login_deferred_until) {
        setSuccessMessage(
          `Employee exited. Login active until ${formatDateDDMMYYYY(data.login_deferred_until)}.${data.relieving_letter_shared ? ' Relieving letter link emailed.' : ''} F&F draft created in Accounts.`
        );
      } else {
        setSuccessMessage(
          `Employee exited successfully.${data.relieving_letter_shared ? ' Relieving letter link emailed.' : ''} F&F draft created in Accounts.`
        );
      }
      setShowSuccess(true);
    } catch {
      setError('Network error while exiting employee');
      return;
    } finally {
      setSubmitting(false);
    }

    setShowConfirm(false);
    setSelectedEmployee(null);
    setOffboardingPreview(null);
    setLeaveBalance(null);
    setExitInterview(null);

    setTimeout(() => setShowSuccess(false), 5000);
  };

  const handleCancelExit = () => {
    setShowConfirm(false);
    setSelectedEmployee(null);
    setOffboardingPreview(null);
    setLeaveBalance(null);
    setExitInterview(null);
    setForceOverride(false);
    setForceOverrideReason('');
  };

  const resetFilters = () => {
    setEmployeeType('');
    setCircle('');
    setTypeSearch('');
    setCircleSearch('');
    closeFilterDropdowns();
  };

  return (
    <div className="exit-employee-container" ref={wrapperRef}>
      <div className="exit-employee-wrapper">

        {/* Header */} 

        <div className="header-section">
          <button
            className="btn-back-updates"
            aria-label="Back to Updates"
            onClick={() => {
              if (onBack) {
                onBack();
              } else if (sourceFrom === 'archive') {
                navigate('/archive-employees', { replace: true });
              } else {
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
          <p className="exit-employee-error" role="alert">{error}</p>
        )}

        <div className="filters-section">
          <div className="filters-panel">
            <div className="filters-panel__head">
              <div className="filters-panel__title-wrap">
                <span className="filters-panel__icon" aria-hidden="true">
                  <SlidersHorizontal size={17} />
                </span>
                <h2 className="filters-toolbar-title">Find employees</h2>
              </div>
              <div className="results-badge">
                <span className="results-badge__count">{filteredEmployees.length}</span>
                <span className="results-badge__text">of {employees.length} shown</span>
              </div>
            </div>

            <div className="filter-row">
              <div className="filter-group">
                <label htmlFor="exit-emp-type">Employee type</label>
                <div className="custom-select" ref={typeSelectRef}>
                  <input
                    id="exit-emp-type"
                    type="text"
                    placeholder="Select or type"
                    value={typeSearch !== '' ? typeSearch : (employeeType || ALL_TYPES_LABEL)}
                    onFocus={(e) => {
                      setShowCircleList(false);
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
                    className="filter-input"
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

              <div className="filter-group">
                <label htmlFor="exit-circle">Circle</label>
                <div className="custom-select" ref={circleSelectRef}>
                  <input
                    id="exit-circle"
                    type="text"
                    placeholder="Select or type"
                    value={circleSearch !== '' ? circleSearch : (circle || ALL_CIRCLES_LABEL)}
                    onFocus={(e) => {
                      setShowTypeList(false);
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
                    className="filter-input"
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

              <button type="button" className="reset-button" onClick={resetFilters}>
                <RotateCcw size={16} aria-hidden />
                <span>Reset</span>
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
                <th>Separation</th>
                <th>Offboarding</th>
                <th>NOC</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" className="no-data">
                    Loading employees...
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan="9" className="no-data">
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
                      <div className="exit-separation-cell">
                        <span>{formatDateDDMMYYYY(emp.resignationDate)}</span>
                        {emp.resignationStatus && (
                          <span className="exit-resignation-pill">{emp.resignationStatus}</span>
                        )}
                      </div>
                    </td>

                    <td>
                      <span className={`exit-status-badge ${statusBadgeClass(emp.offboarding?.status)}`}>
                        {emp.offboarding?.status_label || 'Not in separation'}
                      </span>
                    </td>

                    <td>
                      {emp.offboarding?.noc_summary?.total > 0 ? (
                        <span className="exit-noc-pill">
                          {emp.offboarding.noc_summary.cleared}/{emp.offboarding.noc_summary.total} cleared
                          {emp.offboarding.noc_summary.pending > 0 && (
                            <span className="exit-noc-pending"> · {emp.offboarding.noc_summary.pending} pending</span>
                          )}
                        </span>
                      ) : (
                        <span className="exit-noc-muted">—</span>
                      )}
                    </td>

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

      {showConfirm && createPortal(
        <div className="exit-modal-overlay" onClick={handleCancelExit}>
            <div
            className="exit-modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-icon">
              <AlertCircle size={48} />
            </div>

            <h2 id="confirm-modal-title" className="modal-title">Process employee exit</h2>

            <p className="modal-message">
              Complete the exit for <strong>{selectedEmployee?.name}</strong>. Review the checklist before confirming.
            </p>

            {offboardingPreview && (
              <div className={`exit-checklist-banner ${offboardingPreview.can_exit ? 'exit-checklist-banner--ok' : 'exit-checklist-banner--warn'}`}>
                <strong>{offboardingPreview.status_label}</strong>
                {offboardingPreview.can_exit
                  ? ' — No hard blockers. You may proceed.'
                  : ` — ${offboardingPreview.hard_blocker_count} hard blocker(s). Use force override to proceed anyway.`}
              </div>
            )}

            <div className="exit-checklist-panel">
              <h3 className="exit-checklist-title">Pre-exit checklist</h3>
              {checklistLoading ? (
                <p className="exit-checklist-loading">Loading checklist…</p>
              ) : (
                <ul className="exit-checklist-list">
                  {(offboardingPreview?.checklist || []).map((item) => (
                    <li
                      key={item.key}
                      className={`exit-checklist-item exit-checklist-item--${item.severity} ${item.passed ? 'is-passed' : 'is-failed'}`}
                    >
                      <span className="exit-checklist-item__label">{item.label}</span>
                      <span className="exit-checklist-item__tag">{item.severity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {leaveBalance && (
              <div className="exit-leave-balance-panel">
                <h3 className="exit-checklist-title">Leave balance at exit</h3>
                <div className="exit-leave-balance-grid">
                  <div className="exit-leave-balance-item">
                    <span className="exit-leave-balance-item__value">{Number(leaveBalance.privilege_leave_balance || 0).toFixed(1)}</span>
                    <span className="exit-leave-balance-item__label">Privilege (PL)</span>
                  </div>
                  <div className="exit-leave-balance-item">
                    <span className="exit-leave-balance-item__value">{Number(leaveBalance.casual_leave_balance || 0).toFixed(1)}</span>
                    <span className="exit-leave-balance-item__label">Casual (CL)</span>
                  </div>
                  <div className="exit-leave-balance-item">
                    <span className="exit-leave-balance-item__value">{Number(leaveBalance.compensatory_leave_balance || 0).toFixed(1)}</span>
                    <span className="exit-leave-balance-item__label">Comp-off</span>
                  </div>
                </div>
              </div>
            )}

            <div className="exit-hr-interview-panel">
              <h3 className="exit-checklist-title">HR exit interview</h3>
              {exitInterview?.submitted_at && (
                <p className="exit-hr-interview-employee-note">
                  Employee feedback received
                  {exitInterview.overall_rating ? ` · Rating ${exitInterview.overall_rating}/5` : ''}
                  {exitInterview.would_recommend ? ' · Would recommend' : ''}
                </p>
              )}
              <label className="exit-hr-interview-check">
                <input
                  type="checkbox"
                  checked={hrInterviewCompleted}
                  onChange={(e) => setHrInterviewCompleted(e.target.checked)}
                />
                Mark HR exit interview complete
              </label>
              <div className="modal-field-row">
                <div className="modal-field">
                  <label htmlFor="hr-interview-date">Interview date</label>
                  <input
                    id="hr-interview-date"
                    type="date"
                    value={hrInterviewDate}
                    onChange={(e) => setHrInterviewDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-field">
                <label htmlFor="hr-interview-notes">HR notes</label>
                <textarea
                  id="hr-interview-notes"
                  rows={2}
                  value={hrInterviewNotes}
                  onChange={(e) => setHrInterviewNotes(e.target.value)}
                  placeholder="Interview summary or follow-up actions"
                />
              </div>
              <button
                type="button"
                className="exit-hr-interview-save"
                onClick={handleSaveHrInterview}
                disabled={hrInterviewSaving}
              >
                {hrInterviewSaving ? 'Saving…' : 'Save HR interview'}
              </button>
            </div>

            <div className="modal-form">
              <div className="modal-field">
                <label htmlFor="exit-type">Exit type</label>
                <select id="exit-type" value={exitType} onChange={handleExitTypeChange}>
                  {exitTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="modal-field-row">
                <div className="modal-field">
                  <label htmlFor="resignation-date">Resignation date</label>
                  <input
                    id="resignation-date"
                    type="date"
                    value={resignationDate || ''}
                    onChange={(e) => setResignationDate(e.target.value)}
                    readOnly={!!offboardingPreview?.resignation_date}
                  />
                </div>
                <div className="modal-field">
                  <label htmlFor="last-working-day">Last working day</label>
                  <input
                    id="last-working-day"
                    type="date"
                    value={lastWorkingDay}
                    onChange={(e) => {
                      setLastWorkingDay(e.target.value);
                      setExitDate(e.target.value);
                    }}
                    required
                  />
                </div>
              </div>
              <div className="modal-field">
                <label htmlFor="notice-shortfall">Notice shortfall (days)</label>
                <input
                  id="notice-shortfall"
                  type="number"
                  min="0"
                  step="1"
                  value={noticeShortfallDays}
                  onChange={(e) => setNoticeShortfallDays(e.target.value)}
                />
              </div>
              <div className="modal-field">
                <label htmlFor="exit-reason">Reason</label>
                <textarea
                  id="exit-reason"
                  value={exitReason}
                  onChange={(e) => setExitReason(e.target.value)}
                  rows={4}
                  placeholder="Write reason for exiting..."
                  required
                />
              </div>
              {offboardingPreview && !offboardingPreview.can_exit && (
                <div className="modal-field exit-force-override">
                  <label className="exit-force-override__label">
                    <input
                      type="checkbox"
                      checked={forceOverride}
                      onChange={(e) => setForceOverride(e.target.checked)}
                    />
                    Force override hard blockers
                  </label>
                  {forceOverride && (
                    <textarea
                      value={forceOverrideReason}
                      onChange={(e) => setForceOverrideReason(e.target.value)}
                      rows={2}
                      placeholder="Explain why exit is proceeding despite blockers (min 10 characters)"
                    />
                  )}
                </div>
              )}
            </div>

            <p className="exit-fnf-hint">
              After exit, prepare Full &amp; Final settlement in Accounts → Payroll for this employee.
            </p>

            {error && (
              <p className="exit-modal-error" role="alert">{error}</p>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="modal-button cancel-button"
                onClick={handleCancelExit}
              >
                Cancel
              </button>

              <button
                type="button"
                className="modal-button confirm-button"
                onClick={handleConfirmExit}
                disabled={submitting || !canSubmitExit}
              >
                {submitting ? 'Please wait...' : 'Confirm exit'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Success Toast */} 

      {showSuccess && (
        <div className="success-toast">
          ✓ {successMessage || 'Employee exited successfully and moved to archive'}
        </div>
      )}

    </div>
  );
};

export default ExitEmployee; 

