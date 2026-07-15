import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { AdminBreadcrumb, commandCenterCrumbItem } from '../../components/layout/AdminBreadcrumb';
import { formatDate } from '../../utils/dateFormat';
import './EmployeePunches.css';

const PUNCHES_API = '/api/admin/employees';
const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

function punchDayLabel(item) {
  if (item.on_leave) {
    return item.leave_type ? `Leave (${item.leave_type})` : 'Leave';
  }
  if (item.is_wfh) return 'WFH';
  return '—';
}

function displayDate(item) {
  const raw = item?.date || item?.startDate || '';
  if (!raw) return '—';
  const formatted = formatDate(raw, '');
  return formatted || raw;
}

function displayTime(value) {
  if (value == null || value === '') return '—';
  return value;
}

const EmployeePunches = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useMemo(() => new Date(), []);
  const month = Number(searchParams.get('month')) || now.getMonth() + 1;
  const year = Number(searchParams.get('year')) || now.getFullYear();

  const [employee, setEmployee] = useState(null);
  const [punches, setPunches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    const list = [];
    for (let i = y; i >= y - 6; i -= 1) list.push(i);
    return list;
  }, [now]);

  const load = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!id || !token) {
      setLoading(false);
      setError('Unable to load punches');
      return;
    }
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ month: String(month), year: String(year) });
    fetch(`${PUNCHES_API}/${id}/punches?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success) {
          setEmployee(data.employee || null);
          setPunches(Array.isArray(data.punches) ? data.punches : []);
        } else {
          setError(data.message || 'Failed to load punches');
          setPunches([]);
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load punches');
        setLoading(false);
      });
  }, [id, month, year]);

  useRefreshOnNavigate(load, [id, month, year]);

  const setFilter = (nextMonth, nextYear) => {
    setSearchParams({ month: String(nextMonth), year: String(nextYear) });
  };

  const crumbName = employee
    ? `${employee.name}${employee.emp_id ? ` · ${employee.emp_id}` : ''}`
    : 'Employee';

  return (
    <div className="emp-punches">
      <AdminBreadcrumb
        items={[
          commandCenterCrumbItem(),
          { label: 'Employees', to: '/employees' },
          { label: crumbName, to: `/employee/${id}` },
          { label: 'Punches' },
        ]}
      />

      <div className="emp-punches__toolbar">
        <div className="emp-punches__filters">
          <label className="emp-punches__field">
            <span>Month</span>
            <select
              value={month}
              onChange={(e) => setFilter(Number(e.target.value), year)}
              aria-label="Filter by month"
            >
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="emp-punches__field">
            <span>Year</span>
            <select
              value={year}
              onChange={(e) => setFilter(month, Number(e.target.value))}
              aria-label="Filter by year"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="emp-punches__back"
          onClick={() => navigate(`/employee/${id}`)}
        >
          Back to employee
        </button>
      </div>

      <div className="emp-punches__card">
        {loading ? (
          <p className="emp-punches__muted">Loading punches…</p>
        ) : error ? (
          <p className="emp-punches__error" role="alert">{error}</p>
        ) : punches.length === 0 ? (
          <p className="emp-punches__muted">No punch records for this month.</p>
        ) : (
          <div className="emp-punches__table-wrap">
            <table className="emp-punches__table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Punch in</th>
                  <th>Punch out</th>
                  <th>Worked</th>
                  <th>Day status</th>
                </tr>
              </thead>
              <tbody>
                {punches.map((item) => (
                  <tr key={item.id}>
                    <td>{displayDate(item)}</td>
                    <td>{displayTime(item.punch_in)}</td>
                    <td>{displayTime(item.punch_out)}</td>
                    <td>{item.today_work || '—'}</td>
                    <td>
                      {item.on_leave || item.is_wfh ? (
                        <span
                          className={`emp-punches__tag${
                            item.on_leave ? ' emp-punches__tag--leave' : ' emp-punches__tag--wfh'
                          }`}
                        >
                          {punchDayLabel(item)}
                        </span>
                      ) : (
                        '—'
                      )}
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

export default EmployeePunches;
