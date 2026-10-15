import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { useDebounced, usePagedList } from '../../hooks/usePagedList';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import { isPagedScreenEnabled } from '../../utils/pagedScreens';
import { matchesListQuery } from './adminListQuery';
import { markAdminDepartmentVisit } from './adminVisit';
import { UserAvatar } from '../../components/UserAvatar';
import './AdminList.css';
import './Employee.css';

const MASTER_OPTIONS_API = '/api/auth/master-options';
const ADMIN_EMPLOYEES_API = '/api/admin/employees';
const PAGE_SIZE = 20;

const STATUS_LABELS = {
  active: 'Active',
  inactive: 'Inactive',
  on_probation: 'On probation',
  review_pending: 'Review in progress',
  awaiting_hr: 'Awaiting HR decision',
  confirmed: 'Confirmed',
  extended: 'Probation extended',
  failed: 'Probation not cleared',
};

function statusKey(employee) {
  if (employee.is_active === false) return 'inactive';
  const raw = String(employee.employment_status || '').trim();
  return raw || 'active';
}

function statusLabel(key) {
  if (STATUS_LABELS[key]) return STATUS_LABELS[key];
  const text = String(key || '').replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Active';
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(rows) {
  const header = ['Name', 'Employee ID', 'Email', 'Mobile', 'Type', 'Circle', 'Joined', 'Status'];
  const lines = [
    header.join(','),
    ...rows.map((row) => [
      row.name,
      row.emp_id || row.id,
      row.email,
      row.mobile,
      row.emp_type,
      row.circle,
      row.doj ? formatDateDDMMYYYY(row.doj) : '',
      statusLabel(statusKey(row)),
    ].map(csvCell).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'employees.csv';
  link.click();
  URL.revokeObjectURL(url);
}

async function fetchDirectoryPage(params) {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Please sign in again.');
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  });
  const res = await fetch(`${ADMIN_EMPLOYEES_API}?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || 'The directory could not be loaded.');
  return data;
}

const selectEmployees = (body) => (Array.isArray(body?.employees) ? body.employees : []);
const selectFacets = (body) => body?.facets || null;
const EMPTY_FACETS = { total: 0, typeCounts: {}, types: [], circles: [], statuses: [] };
const byCountThenName = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]);

const Employee = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [employeeTypeOptions, setEmployeeTypeOptions] = useState([]);
  const [circleOptions, setCircleOptions] = useState([]);
  const [employeeType, setEmployeeType] = useState('All');
  const [circle, setCircle] = useState('All');
  const [status, setStatus] = useState('All');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  const paged = useMemo(() => isPagedScreenEnabled('adminEmployees'), []);
  const searchTerm = useDebounced(query.trim(), 300);
  const directoryFilters = useMemo(() => ({
    view: 'directory',
    ...(employeeType !== 'All' ? { type: employeeType } : {}),
    ...(circle !== 'All' ? { in_circle: circle } : {}),
    ...(status !== 'All' ? { status } : {}),
    ...(searchTerm ? { q: searchTerm } : {}),
    sort: sortKey,
    dir: sortDir,
  }), [circle, employeeType, searchTerm, sortDir, sortKey, status]);
  const list = usePagedList({
    fetchList: fetchDirectoryPage,
    select: selectEmployees,
    selectMeta: selectFacets,
    filters: directoryFilters,
    perPage: PAGE_SIZE,
    skip: !paged,
  });
  const facets = list.meta || EMPTY_FACETS;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch(MASTER_OPTIONS_API, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (!data.success) return;
        if (data.departments?.length) setEmployeeTypeOptions(data.departments);
        if (data.circles?.length) setCircleOptions(data.circles);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!location.state) return;
    if (location.state.employeeType) setEmployeeType(location.state.employeeType);
    if (location.state.circle) setCircle(location.state.circle);
  }, [location.state]);

  const loadEmployees = useCallback(() => {
    // The paged list loads itself and refetches when filters, search or sort change.
    if (paged) return;
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      setFailed(true);
      return;
    }
    setLoading(true);
    setFailed(false);
    fetch(ADMIN_EMPLOYEES_API, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})).then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.success && Array.isArray(data.employees)) {
          setEmployees(data.employees);
        } else {
          setEmployees([]);
          setFailed(true);
        }
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  }, [paged]);

  useRefreshOnNavigate(loadEmployees);

  const typeCounts = useMemo(() => {
    if (paged) return Object.entries(facets.typeCounts || {}).sort(byCountThenName);
    const counts = new Map();
    employees.forEach((row) => {
      const key = row.emp_type || 'Unassigned';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries()).sort(byCountThenName);
  }, [employees, facets, paged]);
  const typeChoices = useMemo(
    () => uniqueSorted([
      ...employeeTypeOptions,
      ...(paged ? facets.types || [] : employees.map((row) => row.emp_type)),
      ...typeCounts.map(([name]) => name),
    ]),
    [employeeTypeOptions, employees, facets, paged, typeCounts],
  );
  const circleChoices = useMemo(
    () => uniqueSorted([...circleOptions, ...(paged ? facets.circles || [] : employees.map((row) => row.circle))]),
    [circleOptions, employees, facets, paged],
  );
  const statusChoices = useMemo(
    () => uniqueSorted(paged ? facets.statuses || [] : employees.map((row) => statusKey(row))),
    [employees, facets, paged],
  );

  const visible = useMemo(() => {
    if (paged) return [];
    const filtered = employees.filter((row) => {
      if (employeeType !== 'All' && (row.emp_type || 'Unassigned') !== employeeType) return false;
      if (circle !== 'All' && (row.circle || '') !== circle) return false;
      if (status !== 'All' && statusKey(row) !== status) return false;
      return matchesListQuery(query, [row.name, row.emp_id, row.email, row.mobile, row.emp_type, row.circle]);
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      const left = sortKey === 'status' ? statusLabel(statusKey(a)) : (a[sortKey] || '');
      const right = sortKey === 'status' ? statusLabel(statusKey(b)) : (b[sortKey] || '');
      return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
    return filtered;
  }, [circle, employeeType, employees, paged, query, sortDir, sortKey, status]);

  useEffect(() => {
    setPage(1);
  }, [query, employeeType, circle, status, sortKey, sortDir]);

  const isLoading = paged ? list.loading && !list.meta : loading;
  const isFailed = paged ? Boolean(list.error) : failed;
  const retry = paged ? list.reload : loadEmployees;
  const companyCount = paged ? facets.total : employees.length;
  const matchCount = paged ? list.total : visible.length;
  const pageCount = paged ? list.pages : Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = paged ? list.page : Math.min(page, pageCount);
  const goToPage = paged ? list.setPage : setPage;
  const pageRows = paged ? list.rows : visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = matchCount ? (safePage - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, matchCount);
  const filtersActive = query.trim() || employeeType !== 'All' || circle !== 'All' || status !== 'All';

  const exportVisible = async () => {
    if (!paged) {
      downloadCsv(visible);
      return;
    }
    setExporting(true);
    setExportFailed(false);
    try {
      downloadCsv(selectEmployees(await fetchDirectoryPage(directoryFilters)));
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  };

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir('asc');
  };

  const openEmployee = (id) => {
    markAdminDepartmentVisit();
    navigate(`/employee/${id}`);
  };

  const clearFilters = () => {
    setQuery('');
    setEmployeeType('All');
    setCircle('All');
    setStatus('All');
  };

  const sortLabel = (key, label) => {
    const active = sortKey === key;
    const mark = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return (
      <button
        type="button"
        className={`emp-dir__sort${active ? ' is-on' : ''}`}
        onClick={() => toggleSort(key)}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}{mark}
      </button>
    );
  };

  return (
    <div className="admin-list-container emp-dir">
      <div className="admin-list-header">
        <div>
          <h1>Employees</h1>
          <p className="admin-list-copy">
            {isLoading
              ? 'Loading the company directory…'
              : `${companyCount} in this company${filtersActive ? ` · ${matchCount} match` : ''}`}
          </p>
        </div>
        <button
          type="button"
          className="emp-dir__export"
          onClick={exportVisible}
          disabled={isLoading || exporting || matchCount === 0}
        >
          {exporting ? 'Exporting…' : exportFailed ? 'Export failed – retry' : 'Export'}
        </button>
      </div>

      {!isLoading && typeCounts.length > 0 ? (
        <div className="emp-dir__chips" role="toolbar" aria-label="Filter by type">
          <button
            type="button"
            className={employeeType === 'All' ? 'is-on' : ''}
            onClick={() => setEmployeeType('All')}
          >
            All <strong>{companyCount}</strong>
          </button>
          {typeCounts.map(([name, count]) => (
            <button
              key={name}
              type="button"
              className={employeeType === name ? 'is-on' : ''}
              onClick={() => setEmployeeType(name)}
            >
              {name} <strong>{count}</strong>
            </button>
          ))}
        </div>
      ) : null}

      <div className="admin-list-filters">
        <label className="admin-list-search">
          <span>Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, ID, email, mobile"
          />
        </label>
        <label className="emp-dir__field">
          <span>Type</span>
          <select value={employeeType} onChange={(event) => setEmployeeType(event.target.value)} aria-label="Filter by type">
            <option value="All">All types</option>
            {typeChoices.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="emp-dir__field">
          <span>Circle</span>
          <select value={circle} onChange={(event) => setCircle(event.target.value)} aria-label="Filter by circle">
            <option value="All">All circles</option>
            {circleChoices.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="emp-dir__field">
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
            <option value="All">All statuses</option>
            {statusChoices.map((option) => (
              <option key={option} value={option}>{statusLabel(option)}</option>
            ))}
          </select>
        </label>
        {filtersActive ? (
          <button type="button" className="emp-dir__clear" onClick={clearFilters}>
            Clear
          </button>
        ) : null}
      </div>

      <div className="admin-list-table-wrap">
        {isLoading ? (
          <p className="emp-dir__loading">Loading employees…</p>
        ) : isFailed ? (
          <p className="emp-dir__loading">
            The directory could not be loaded.
            <button type="button" className="emp-dir__retry" onClick={retry}>Try again</button>
          </p>
        ) : pageRows.length > 0 ? (
          <table className="admin-list-table">
            <thead>
              <tr>
                <th>{sortLabel('name', 'Employee')}</th>
                <th>{sortLabel('emp_id', 'ID')}</th>
                <th>{sortLabel('emp_type', 'Type')}</th>
                <th>{sortLabel('circle', 'Circle')}</th>
                <th>Mobile</th>
                <th>{sortLabel('doj', 'Joined')}</th>
                <th>{sortLabel('status', 'Status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((employee) => {
                const key = statusKey(employee);
                return (
                  <tr key={employee.id} className="emp-dir__row" onClick={() => openEmployee(employee.id)}>
                    <td>
                      <div className="emp-dir__person">
                        <UserAvatar
                          user={employee}
                          name={employee.name}
                          alt=""
                          className="emp-dir__avatar"
                          initialsBg="#13877f"
                        />
                        <span>
                          <strong>{employee.name || '—'}</strong>
                          <span>{employee.email || 'No email'}</span>
                        </span>
                      </div>
                    </td>
                    <td>{employee.emp_id || employee.id}</td>
                    <td>{employee.emp_type || '—'}</td>
                    <td>{employee.circle || '—'}</td>
                    <td>{employee.mobile || '—'}</td>
                    <td>{employee.doj ? formatDateDDMMYYYY(employee.doj) : '—'}</td>
                    <td>
                      <span className={`emp-dir__status emp-dir__status--${key}`}>{statusLabel(key)}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="admin-list-view-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEmployee(employee.id);
                        }}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
        {!isLoading && !isFailed && matchCount === 0 ? (
          <p className="admin-list-empty">
            {companyCount === 0
              ? 'No employees are in this company yet.'
              : 'No employees match these filters.'}
          </p>
        ) : null}
        {!isLoading && !isFailed && matchCount > 0 ? (
          <div className="emp-dir__pager">
            <span>Showing {rangeStart}–{rangeEnd} of {matchCount}</span>
            <div>
              <button type="button" onClick={() => goToPage(Math.max(1, safePage - 1))} disabled={safePage <= 1}>
                Previous
              </button>
              <span>Page {safePage} of {pageCount}</span>
              <button type="button" onClick={() => goToPage(Math.min(pageCount, safePage + 1))} disabled={safePage >= pageCount}>
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Employee;
