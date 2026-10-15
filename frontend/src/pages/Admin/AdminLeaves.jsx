import React, { useMemo, useState } from 'react';
import './AdminList.css';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { usePagedList } from '../../hooks/usePagedList';
import Pager from '../../components/Pager';
import { isPagedScreenEnabled } from '../../utils/pagedScreens';
import { formatDate } from '../../utils/dateFormat';
import { matchesListQuery } from './adminListQuery';

const API = '/api/admin/leaves';
const PER_PAGE = 25;

const leaveSearchValues = (row) => [
  row.employee_name,
  row.employee_email,
  row.emp_id,
  row.circle,
  row.leave_type,
];

async function fetchLeavesPage(params) {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Please sign in again.');
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') qs.set(key, String(value));
  });
  const query = qs.toString();
  const res = await fetch(`${API}${query ? `?${query}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || 'Could not load leave applications.');
  return data;
}

const selectRequests = (body) => (Array.isArray(body?.requests) ? body.requests : []);
const leaveMatchesSearch = (row, needle) => matchesListQuery(needle, leaveSearchValues(row));

const AdminLeaves = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('All');
  const [query, setQuery] = useState('');

  const paged = useMemo(() => isPagedScreenEnabled('adminLeaves'), []);
  const filters = useMemo(() => (status !== 'All' ? { status } : {}), [status]);
  const list = usePagedList({
    fetchList: fetchLeavesPage,
    select: selectRequests,
    filters,
    perPage: PER_PAGE,
    skip: !paged,
    matchesSearch: leaveMatchesSearch,
  });

  useRefreshOnNavigate(() => {
    // The paged list loads itself and refetches when the status changes.
    if (paged) return;
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : '';
    fetch(`${API}${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        setRequests(data.success && data.requests ? data.requests : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status]);

  const visible = useMemo(
    () => requests.filter((row) => matchesListQuery(query, leaveSearchValues(row))),
    [query, requests],
  );

  const rows = paged ? list.rows : visible;
  const isLoading = paged ? list.loading && list.rows.length === 0 : loading;
  const searchValue = paged ? list.searchInput : query;
  const setSearchValue = paged ? list.setSearchInput : setQuery;
  const nothingLoaded = paged ? list.total === 0 && !list.searchInput.trim() : requests.length === 0;

  return (
    <div className="admin-list-container">
      <div className="admin-list-header">
        <div>
          <h1>Leave applications</h1>
          <p className="admin-list-copy">Company leave requests. Status filters still load from the server.</p>
        </div>
      </div>
      <div className="admin-list-filters">
        <label className="admin-list-search">
          <span>Search</span>
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Name, ID, circle, leave type"
          />
        </label>
        <div className="status-buttons">
          {['All', 'Pending', 'Approved', 'Rejected'].map((s) => (
            <button
              key={s}
              type="button"
              className={`status-btn ${status === s ? 'active' : ''}`}
              onClick={() => setStatus(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="admin-list-table-wrap">
        {isLoading ? (
          <p>Loading...</p>
        ) : (
          <table className="admin-list-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Emp ID</th>
                <th>Circle</th>
                <th>Leave Type</th>
                <th>Start</th>
                <th>End</th>
                <th>Status</th>
                <th>Days</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.employee_name || r.employee_email || '—'}</td>
                  <td>{r.emp_id || '—'}</td>
                  <td>{r.circle || '—'}</td>
                  <td>{r.leave_type || '—'}</td>
                  <td>{formatDate(r.start_date)}</td>
                  <td>{formatDate(r.end_date)}</td>
                  <td><span className={`status-badge ${(r.status || '').toLowerCase()}`}>{r.status || '—'}</span></td>
                  <td>{r.deducted_days != null ? r.deducted_days : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {paged && !isLoading ? (
          <Pager
            page={list.page}
            pages={list.pages}
            total={list.total}
            perPage={list.perPage}
            onPage={list.setPage}
            loading={list.loading}
            noun="applications"
          />
        ) : null}
      </div>
      {paged && list.error ? (
        <p className="admin-list-empty">{list.error.message || 'Could not load leave applications.'}</p>
      ) : null}
      {!isLoading && !(paged && list.error) && rows.length === 0 && (
        <p className="admin-list-empty">
          {nothingLoaded ? 'No leave applications found.' : 'No leave applications match that search.'}
        </p>
      )}
    </div>
  );
};

export default AdminLeaves;
