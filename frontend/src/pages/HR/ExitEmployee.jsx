import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Archive, RotateCcw, X } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { useAdminVisitNav } from '../../hooks/useAdminVisitNav';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './offboarding-ui.css';

const HR_API_BASE = '/api/HumanResource';
const ALL_TYPES_LABEL = 'All Types';
const ALL_CIRCLES_LABEL = 'All Circles';
const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
const EXIT_TYPES_DEFAULT = ['Resigned', 'Terminated', 'Absconded', 'Retirement', 'End of Contract'];
const PAGE_SIZE = 5;

const statusBadgeClass = (status) => {
  const map = {
    initiated: 'obx-pill--info',
    notice: 'obx-pill--warn',
    clearance: 'obx-pill--bad',
    ready: 'obx-pill--ok',
    exited: 'obx-pill',
    fnf_settled: 'obx-pill--ok',
  };
  return map[status] || '';
};

const ExitEmployee = ({onBack}) => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Check if employee data was passed from Archive and where we came from
  const employeeFromArchive = location.state?.selectedEmployee;
  const sourceFrom = location.state?.from; // 'archive' or undefined (from HR)
  const { fromAdmin, backLabel, goBack } = useAdminVisitNav({
    fallbackTo: sourceFrom === 'archive' ? '/archive-employees' : '/hr',
    fallbackLabel: sourceFrom === 'archive'
      ? 'Back to Archive'
      : (onBack ? 'Back to Offboarding' : 'Back to Updates'),
    onFallback: () => {
      if (onBack) {
        onBack();
        return;
      }
      if (sourceFrom === 'archive') {
        navigate('/archive-employees', { replace: true });
        return;
      }
      navigate('/hr', { state: { view: 'updates' }, replace: true });
    },
  });

  const wrapperRef = useRef(null);
  const typeSelectRef = useRef(null);
  const circleSelectRef = useRef(null);

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [employeeType, setEmployeeType] = useState('');
  const [circle, setCircle] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [employeeType, circle, employees]);

  const visibleEmployees = filteredEmployees.slice(0, visibleCount);
  const hiddenCount = filteredEmployees.length - visibleEmployees.length;

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
      if (data.pending_approval) {
        setSuccessMessage(data.message || 'Exit sent for Admin approval. The employee stays active until an Admin approves it.');
      } else {
        setEmployees((prev) => prev.filter((emp) => emp.id !== selectedEmployee.id));
        window.dispatchEvent(new Event('employeeArchived'));
        setSuccessMessage(data.message || 'Employee exited successfully.');
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
    <section className="obx" ref={wrapperRef}>
      <header className="obx-head">
        <div>
          <button
            type="button"
            className="obx-back"
            onClick={() => goBack({ replace: true })}
          >
            <ArrowLeft size={16} />
            {fromAdmin ? backLabel : (sourceFrom === 'archive' ? 'Back to Archive' : (onBack ? 'Back to Offboarding' : 'Back to Updates'))}
          </button>
          <h1>Exit an employee</h1>
          <p>The request goes to Admin. The person stays active until it is approved.</p>
        </div>
        <div className="obx-actions">
          <button type="button" className="obx-btn" onClick={() => navigate('/archive-employees')}>
            <Archive size={16} />
            Archive
          </button>
        </div>
      </header>
      {error && !showConfirm ? <p className="obx-alert" role="alert">{error}</p> : null}

      <div className="obx-toolbar">
        <div className="obx-filters">
          <div className="obx-field" ref={typeSelectRef}>
            <label htmlFor="exit-emp-type">Employee type</label>
            <input
              id="exit-emp-type"
              type="text"
              placeholder="Select or type"
              value={typeSearch !== '' ? typeSearch : (employeeType || ALL_TYPES_LABEL)}
              onFocus={(e) => {
                setShowCircleList(false);
                setShowTypeList(true);
                if (!employeeType && typeSearch === '') requestAnimationFrame(() => e.target.select());
              }}
              onChange={(e) => {
                const val = e.target.value;
                setTypeSearch(val);
                if (val === '' || val === ALL_TYPES_LABEL) setEmployeeType('');
                setShowTypeList(true);
              }}
            />
            {showTypeList && (
              <div className="obx-menu">
                <button type="button" className={!employeeType ? 'is-on' : ''} onClick={() => { setEmployeeType(''); setTypeSearch(''); setShowTypeList(false); }}>{ALL_TYPES_LABEL}</button>
                {employeeTypes.filter((type) => type.toLowerCase().includes(typeSearch.toLowerCase())).map((type) => (
                  <button type="button" key={type} onClick={() => { setEmployeeType(type); setTypeSearch(''); setShowTypeList(false); }}>{type}</button>
                ))}
              </div>
            )}
          </div>
          <div className="obx-field" ref={circleSelectRef}>
            <label htmlFor="exit-circle">Circle</label>
            <input
              id="exit-circle"
              type="text"
              placeholder="Select or type"
              value={circleSearch !== '' ? circleSearch : (circle || ALL_CIRCLES_LABEL)}
              onFocus={(e) => {
                setShowTypeList(false);
                setShowCircleList(true);
                if (!circle && circleSearch === '') requestAnimationFrame(() => e.target.select());
              }}
              onChange={(e) => {
                const val = e.target.value;
                setCircleSearch(val);
                if (val === '' || val === ALL_CIRCLES_LABEL) setCircle('');
                setShowCircleList(true);
              }}
            />
            {showCircleList && (
              <div className="obx-menu">
                <button type="button" className={!circle ? 'is-on' : ''} onClick={() => { setCircle(''); setCircleSearch(''); setShowCircleList(false); }}>{ALL_CIRCLES_LABEL}</button>
                {circles.filter((cir) => cir.toLowerCase().includes(circleSearch.toLowerCase())).map((cir) => (
                  <button type="button" key={cir} onClick={() => { setCircle(cir); setCircleSearch(''); setShowCircleList(false); }}>{cir}</button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="obx-btn" onClick={resetFilters}>
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
        <span className="obx-count">{visibleEmployees.length} of {filteredEmployees.length}</span>
      </div>

      <div className="obx-table-wrap">
        <table className="obx-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Circle</th>
              <th>Type</th>
              <th>Separation</th>
              <th>Status</th>
              <th>NOC</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7">Loading employees…</td></tr>
            ) : filteredEmployees.length === 0 ? (
              <tr><td colSpan="7">No employees match these filters.</td></tr>
            ) : visibleEmployees.map((emp) => (
              <tr key={emp.id}>
                <td>
                  <strong>{emp.name}</strong>
                  <span className="obx-sub">{emp.employeeId} · {emp.email}</span>
                </td>
                <td>{emp.circle || '—'}</td>
                <td>{emp.employeeType || '—'}</td>
                <td>
                  <span>{formatDateDDMMYYYY(emp.resignationDate)}</span>
                  {emp.resignationStatus ? <span className="obx-sub">{emp.resignationStatus}</span> : null}
                </td>
                <td>
                  <span className={`obx-pill ${statusBadgeClass(emp.offboarding?.status)}`}>
                    {emp.offboarding?.status_label || 'Not in separation'}
                  </span>
                </td>
                <td>
                  {emp.offboarding?.noc_summary?.total > 0
                    ? `${emp.offboarding.noc_summary.cleared}/${emp.offboarding.noc_summary.total}`
                    : '—'}
                </td>
                <td>
                  <button type="button" className="obx-btn obx-btn--primary" onClick={() => handleActionClick(emp)} disabled={submitting}>
                    Start exit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 ? (
        <div className="obx-more">
          <button type="button" className="obx-btn" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
            See more ({Math.min(PAGE_SIZE, hiddenCount)} of {hiddenCount} left)
          </button>
        </div>
      ) : null}

      {/* Modal */} 

      {showConfirm && createPortal(
        <div className="obx-overlay" onClick={handleCancelExit}>
          <div className="obx-sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title" onClick={(e) => e.stopPropagation()}>
            <div className="obx-sheet-head">
              <div>
                <h2 id="confirm-modal-title">Exit {selectedEmployee?.name}</h2>
                <p>
                  {offboardingPreview
                    ? (offboardingPreview.can_exit
                      ? `${offboardingPreview.status_label}. No hard blockers.`
                      : `${offboardingPreview.status_label}. ${offboardingPreview.hard_blocker_count} hard blocker(s).`)
                    : 'Review the checklist, then send this to Admin.'}
                </p>
              </div>
              <button type="button" className="obx-btn" onClick={handleCancelExit} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="obx-sheet-body">
              <aside className="obx-sheet-side">
                <h3>Checklist</h3>
                {checklistLoading ? <p className="obx-muted">Loading checklist…</p> : (
                  <ul className="obx-check">
                    {(offboardingPreview?.checklist || []).map((item) => (
                      <li key={item.key} className={item.passed ? '' : 'is-failed'}>
                        <span>{item.label}</span>
                        <span className={`obx-pill ${item.passed ? 'obx-pill--ok' : item.severity === 'hard' ? 'obx-pill--bad' : 'obx-pill--warn'}`}>{item.severity}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {leaveBalance ? (
                  <>
                    <h3>Leave balance</h3>
                    <div className="obx-leave">
                      <div><strong>{Number(leaveBalance.privilege_leave_balance || 0).toFixed(1)}</strong><span>Privilege</span></div>
                      <div><strong>{Number(leaveBalance.casual_leave_balance || 0).toFixed(1)}</strong><span>Casual</span></div>
                      <div><strong>{Number(leaveBalance.compensatory_leave_balance || 0).toFixed(1)}</strong><span>Comp-off</span></div>
                    </div>
                  </>
                ) : null}
                <h3>HR interview</h3>
                {exitInterview?.submitted_at ? (
                  <p className="obx-muted">
                    Employee feedback received
                    {exitInterview.overall_rating ? ` · ${exitInterview.overall_rating}/5` : ''}
                    {exitInterview.would_recommend ? ' · Would recommend' : ''}
                  </p>
                ) : null}
                <label className="obx-check-row">
                  <input type="checkbox" checked={hrInterviewCompleted} onChange={(e) => setHrInterviewCompleted(e.target.checked)} />
                  Interview complete
                </label>
                <div className="obx-span">
                  <label htmlFor="hr-interview-date">Interview date</label>
                  <input id="hr-interview-date" type="date" value={hrInterviewDate} onChange={(e) => setHrInterviewDate(e.target.value)} />
                </div>
                <div className="obx-span">
                  <label htmlFor="hr-interview-notes">Notes</label>
                  <textarea id="hr-interview-notes" rows={2} value={hrInterviewNotes} onChange={(e) => setHrInterviewNotes(e.target.value)} placeholder="Summary or follow-up" />
                </div>
                <button type="button" className="obx-btn" onClick={handleSaveHrInterview} disabled={hrInterviewSaving}>
                  {hrInterviewSaving ? 'Saving…' : 'Save interview'}
                </button>
              </aside>
              <div className="obx-sheet-main">
                <div className="obx-form-grid">
                  <div className="obx-span">
                    <label htmlFor="exit-type">Exit type</label>
                    <select id="exit-type" value={exitType} onChange={handleExitTypeChange}>
                      {exitTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="resignation-date">Resignation date</label>
                    <input id="resignation-date" type="date" value={resignationDate || ''} onChange={(e) => setResignationDate(e.target.value)} readOnly={!!offboardingPreview?.resignation_date} />
                  </div>
                  <div>
                    <label htmlFor="last-working-day">Last working day</label>
                    <input id="last-working-day" type="date" value={lastWorkingDay} onChange={(e) => { setLastWorkingDay(e.target.value); setExitDate(e.target.value); }} required />
                  </div>
                  <div>
                    <label htmlFor="notice-shortfall">Notice shortfall (days)</label>
                    <input id="notice-shortfall" type="number" min="0" step="1" value={noticeShortfallDays} onChange={(e) => setNoticeShortfallDays(e.target.value)} />
                  </div>
                  <div className="obx-span">
                    <label htmlFor="exit-reason">Reason</label>
                    <textarea id="exit-reason" value={exitReason} onChange={(e) => setExitReason(e.target.value)} rows={4} placeholder="Why is this employee exiting?" required />
                  </div>
                  {offboardingPreview && !offboardingPreview.can_exit ? (
                    <div className="obx-span">
                      <label className="obx-check-row">
                        <input type="checkbox" checked={forceOverride} onChange={(e) => setForceOverride(e.target.checked)} />
                        Override hard blockers
                      </label>
                      {forceOverride ? (
                        <textarea value={forceOverrideReason} onChange={(e) => setForceOverrideReason(e.target.value)} rows={2} placeholder="Why this is proceeding despite blockers (at least 10 characters)" />
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <p className="obx-muted">This stays a request until an Admin approves it. Settlement starts after approval.</p>
                {error ? <p className="obx-alert" role="alert">{error}</p> : null}
              </div>
            </div>
            <div className="obx-sheet-foot">
              <button type="button" className="obx-btn" onClick={handleCancelExit}>Cancel</button>
              <button type="button" className="obx-btn obx-btn--primary" onClick={handleConfirmExit} disabled={submitting || !canSubmitExit}>
                {submitting ? 'Sending…' : 'Send for approval'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showSuccess ? (
        <div className="obx-toast" role="status">{successMessage || 'Exit sent for Admin approval.'}</div>
      ) : null}
    </section>
  );
};

export default ExitEmployee; 

