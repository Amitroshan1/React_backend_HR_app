import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Download, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { formatDate } from '../../utils/dateFormat';
import { BiometricAttendanceDetail } from './BiometricAttendanceDetail';
import {
  deviceDisplayName,
  formatDeviceClock,
  pickPrimaryDevice,
} from './deviceStatusDisplay';
import './BiometricAttendance.css';

const API_BASE = '/api/hr/biometric';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const EMPTY_FILTERS = {
  month: currentMonth(),
  date: '',
  start: '',
  end: '',
  emp_id: '',
};

export function BiometricAttendance({ onBack }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [deviceStatus, setDeviceStatus] = useState(null);

  const fetchDeviceStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/devices`, { headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) return;
      setDeviceStatus(pickPrimaryDevice(data.devices || []));
    } catch {
      /* keep last known status */
    }
  }, []);

  const buildParams = useCallback(
    (p = page, pp = perPage) => {
      const params = new URLSearchParams();
      const date = (filters.date || '').trim();
      const start = (filters.start || '').trim();
      const end = (filters.end || '').trim();
      const empId = (filters.emp_id || '').trim();
      // Specific date/range overrides the default month so filters actually narrow.
      if (date) {
        params.set('date', date);
      } else if (start || end) {
        if (start) params.set('start', start);
        if (end) params.set('end', end);
      } else if (filters.month) {
        params.set('month', filters.month);
      }
      if (empId) params.set('emp_id', empId);
      params.set('page', String(p));
      params.set('per_page', String(pp));
      return params;
    },
    [filters, page, perPage]
  );

  const fetchRows = useCallback(
    async (p = page, pp = perPage) => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE}/summary?${buildParams(p, pp)}`, {
          headers: getAuthHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load');
        setRows(data.rows || []);
        setTotal(data.total || 0);
        setTotalPages(data.total_pages || 0);
        setPage(data.page || 1);
        fetchDeviceStatus();
      } catch (err) {
        setRows([]);
        setError(err.message || 'Network error');
      } finally {
        setLoading(false);
      }
    },
    [buildParams, page, perPage, fetchDeviceStatus]
  );

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleRefresh = () => {
    // Re-queries the HR reporting API only. Never talks to the biometric device.
    fetchRows(1, perPage);
  };

  const handleExport = async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      const date = (filters.date || '').trim();
      const start = (filters.start || '').trim();
      const end = (filters.end || '').trim();
      const empId = (filters.emp_id || '').trim();
      if (date) {
        params.set('date', date);
      } else if (start || end) {
        if (start) params.set('start', start);
        if (end) params.set('end', end);
      } else if (filters.month) {
        params.set('month', filters.month);
      }
      if (empId) params.set('emp_id', empId);
      const res = await fetch(`${API_BASE}/export?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Biometric_Attendance.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Export failed');
    }
  };

  const openDetail = (row) => {
    setDetail(row);
  };

  const closeDetail = () => setDetail(null);

  const hasActiveFilters = ['date', 'start', 'end', 'emp_id'].some((k) => filters[k]);

  return (
    <div className="bio-att-page">
      <button className="bio-att-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to HR
      </button>

      <div className="bio-att-header">
        <h2>Biometric Attendance</h2>
        <p>Raw biometric scans from the device. First and last scan of each day are highlighted.</p>
      </div>

      {deviceStatus && (
        <div className="bio-att-device-status" data-testid="bio-device-status">
          <div className="bio-att-device-status-title">{deviceDisplayName(deviceStatus)}</div>
          <div
            className={`bio-att-device-pill ${deviceStatus.online ? 'online' : 'offline'}`}
          >
            <span className="bio-att-device-dot" />
            {deviceStatus.online ? 'Online' : 'Offline'}
          </div>
          <div className="bio-att-device-meta">
            Last communication: {formatDeviceClock(deviceStatus.last_seen_at)}
          </div>
          <div className="bio-att-device-meta">
            Last attendance received: {formatDeviceClock(deviceStatus.last_data_push_at)}
          </div>
        </div>
      )}

      <div className="bio-att-filters">
        <label>
          Month
          <input
            type="month"
            value={filters.month}
            disabled
            title="Always shows the current month"
          />
        </label>
        <label>
          Date
          <input
            type="date"
            value={filters.date}
            onChange={(e) => handleFilterChange('date', e.target.value)}
          />
        </label>
        <label>
          From
          <input
            type="date"
            value={filters.start}
            onChange={(e) => handleFilterChange('start', e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filters.end}
            onChange={(e) => handleFilterChange('end', e.target.value)}
          />
        </label>
        <label>
          Employee ID
          <input
            type="text"
            placeholder="e.g. 10236"
            value={filters.emp_id}
            onChange={(e) => handleFilterChange('emp_id', e.target.value)}
          />
        </label>

      </div>

      <div className="bio-att-toolbar">
        <button className="bio-att-refresh" onClick={handleRefresh} disabled={loading}>
          <RefreshCw size={16} /> {loading ? 'Refreshing…' : 'Refresh Latest Data'}
        </button>
        <button className="bio-att-export" onClick={handleExport}>
          <Download size={16} /> Export
        </button>
        {hasActiveFilters && (
          <button
            className="bio-att-clear"
            onClick={() => {
              setFilters({ ...EMPTY_FILTERS, month: currentMonth() });
              setPage(1);
            }}
          >
            Clear filters
          </button>
        )}
        <span className="bio-att-count">{total} day-row(s)</span>
      </div>

      {error && <div className="bio-att-error">{error}</div>}

      <div className="bio-att-table-wrap">
        <table className="bio-att-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Employee ID</th>
              <th>Date</th>
              <th>First Scan</th>
              <th>Last Scan</th>
              <th>Total Scans</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="bio-att-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="bio-att-muted">
                  No biometric data found.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r, i) => (
                <tr key={`${r.admin_id ?? r.device_user_id}-${r.date}-${i}`} onClick={() => openDetail(r)}>
                  <td>{r.employee_name || 'Unmapped'}</td>
                  <td>{r.emp_id || r.device_user_id || '—'}</td>
                  <td>{formatDate(r.date)}</td>
                  <td className="bio-att-scan-highlight">
                    <Star size={12} /> {r.first_scan ? r.first_scan.slice(11) : '—'}
                  </td>
                  <td className="bio-att-scan-highlight">
                    <Star size={12} /> {r.last_scan ? r.last_scan.slice(11) : '—'}
                  </td>
                  <td>{Array.isArray(r.total_scans) ? r.total_scans.length : r.scan_count}</td>
                  <td>
                    <span className={r.mapped ? 'bio-att-badge mapped' : 'bio-att-badge unmapped'}>
                      {r.mapped ? 'Mapped' : 'Unmapped'}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="bio-att-pagination">
          <button disabled={page <= 1} onClick={() => fetchRows(page - 1, perPage)}>
            <ChevronLeft size={16} /> Prev
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => fetchRows(page + 1, perPage)}>
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}

      {detail && <BiometricAttendanceDetail row={detail} onClose={closeDetail} />}
    </div>
  );
}
