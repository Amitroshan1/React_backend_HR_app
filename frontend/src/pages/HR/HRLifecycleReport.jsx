import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, CalendarDays, RefreshCw, TrendingDown, UserPlus, Users } from 'lucide-react';
import './HRLifecycleReport.css';

const FILTERS = [30, 60, 90, 180];
const API_BASE = '/api/HumanResource';

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('token') || ''}` };
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed (HTTP ${response.status}).`);
  }
  return data;
}

function inDateWindow(value, days) {
  if (!value) return false;
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const date = String(value).slice(0, 10);
  const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return date >= toIso(start) && date <= toIso(end);
}

async function loadFromExistingAdminRoutes(kind, days) {
  if (kind === 'exits') {
    const response = await fetch(`${API_BASE}/employee-archive`, { headers: authHeaders() });
    const data = await readJson(response);
    return (data.employees || [])
      .map((employee) => ({ ...employee, event_date: employee.exit_date }))
      .filter((employee) => inDateWindow(employee.event_date, days));
  }

  const response = await fetch(`${API_BASE}/employees/active`, { headers: authHeaders() });
  const data = await readJson(response);
  const activeEmployees = data.employees || [];
  const detailedEmployees = await Promise.all(activeEmployees.map(async (employee) => {
    if (employee.doj) return { ...employee, event_date: employee.doj };
    if (!employee.email) return employee;
    try {
      const detailResponse = await fetch(
        `${API_BASE}/employee/by-email/${encodeURIComponent(employee.email)}`,
        { headers: authHeaders() },
      );
      const detailData = await readJson(detailResponse);
      const profile = detailData.employee || {};
      return {
        ...employee,
        ...profile,
        id: employee.id,
        name: profile.first_name || employee.name,
        event_date: profile.doj,
      };
    } catch {
      return employee;
    }
  }));
  return detailedEmployees.filter((employee) => inDateWindow(employee.event_date || employee.doj, days));
}

function displayDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export default function HRLifecycleReport({ kind = 'new_hires', onBack, onOpenOffboarding }) {
  const isExitReport = kind === 'exits';
  const [days, setDays] = useState(30);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(
          `${API_BASE}/dashboard/lifecycle?kind=${kind}&days=${days}`,
          { headers: authHeaders() },
        );
        if (response.status === 404) {
          const legacyRows = await loadFromExistingAdminRoutes(kind, days);
          if (!cancelled) setEmployees(legacyRows);
        } else {
          const data = await readJson(response);
          if (!cancelled) setEmployees(data.employees || []);
        }
      } catch (err) {
        if (!cancelled) {
          setEmployees([]);
          setError(err.message || 'Unable to load employee details.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [days, kind]);

  const eventLabel = isExitReport ? 'Exit date' : 'Onboarded on';
  const ReportIcon = isExitReport ? TrendingDown : UserPlus;
  return (
    <main className="hr-lifecycle-page hr-main-container">
      <button type="button" className="hr-lifecycle-back" onClick={onBack}>
        <ArrowLeft size={17} /> Back to dashboard
      </button>
      <header className="hr-lifecycle-header">
        <div className="hr-lifecycle-title-wrap">
          <div className={`hr-lifecycle-hero-icon ${isExitReport ? 'is-exit' : 'is-hire'}`}>
            <ReportIcon size={25} strokeWidth={2.1} />
          </div>
          <div className="hr-lifecycle-title-copy">
          <p className="hr-lifecycle-eyebrow">Workforce overview</p>
          <h1>{isExitReport ? 'Employee exits' : 'New hires'}</h1>
          <p>{isExitReport ? 'Employees whose exit date falls within the selected period.' : 'Employees whose onboarding date falls within the selected period.'}</p>
          </div>
        </div>
        {isExitReport && onOpenOffboarding && (
          <button type="button" className="hr-lifecycle-offboard-btn" onClick={onOpenOffboarding}>
            Go to Offboarding →
          </button>
        )}
        <label className="hr-lifecycle-filter">
          <span><CalendarDays size={15} /> Reporting period</span>
          <div className="hr-lifecycle-select-wrap">
            <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
              {FILTERS.map((value) => <option key={value} value={value}>Last {value} days</option>)}
            </select>
          </div>
        </label>
      </header>
      <section className="hr-lifecycle-panel" aria-live="polite">
        <div className="hr-lifecycle-panel-head">
          <div className="hr-lifecycle-panel-title">
            <span className="hr-lifecycle-panel-icon"><Users size={17} /></span>
            <div>
              <h2>{isExitReport ? 'Exited employees' : 'Employees onboarded'}</h2>
              <p>Employee records for the selected period</p>
            </div>
          </div>
          {!loading && !error && (
            <span className="hr-lifecycle-count"><strong>{employees.length}</strong> {employees.length === 1 ? 'employee' : 'employees'}</span>
          )}
        </div>
        {loading ? (
          <div className="hr-lifecycle-state">
            <span className="hr-lifecycle-state-icon is-loading"><RefreshCw size={22} className="hr-lifecycle-spinner" /></span>
            <strong>Loading employee details</strong>
            <span>Fetching records for the last {days} days…</span>
          </div>
        ) : error ? (
          <div className="hr-lifecycle-state hr-lifecycle-error" role="alert">
            <span className="hr-lifecycle-state-icon is-error"><AlertCircle size={23} /></span>
            <strong>Couldn’t load employee details</strong>
            <span>{error}</span>
          </div>
        ) : employees.length === 0 ? (
          <div className="hr-lifecycle-state hr-lifecycle-empty">
            <span className={`hr-lifecycle-state-icon ${isExitReport ? 'is-exit' : 'is-hire'}`}><ReportIcon size={24} /></span>
            <strong>No {isExitReport ? 'exits' : 'new hires'} in this period</strong>
            <span>There are no employee records for the last {days} days.</span>
          </div>
        ) : (
          <div className="hr-lifecycle-table-wrap">
            <table className="hr-lifecycle-table">
              <thead>
                <tr>
                  <th>Name</th><th>Username</th><th>Employee ID</th><th>Email</th><th>Mobile</th>
                  <th>Department</th><th>Circle</th><th>Employment status</th><th>{eventLabel}</th>
                  {!isExitReport && <th>Probation end date</th>}
                  {isExitReport && <><th>Exit type</th><th>Reason</th></>}
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td>{employee.name || '—'}</td>
                    <td>{employee.user_name || '—'}</td>
                    <td>{employee.emp_id || '—'}</td>
                    <td>{employee.email || '—'}</td>
                    <td>{employee.mobile || '—'}</td>
                    <td>{employee.emp_type || '—'}</td>
                    <td>{employee.circle || '—'}</td>
                    <td>{employee.employment_status || '—'}</td>
                    <td>{displayDate(employee.event_date)}</td>
                    {!isExitReport && <td>{displayDate(employee.probation_end_date)}</td>}
                    {isExitReport && <><td>{employee.exit_type || '—'}</td><td>{employee.exit_reason || '—'}</td></>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
