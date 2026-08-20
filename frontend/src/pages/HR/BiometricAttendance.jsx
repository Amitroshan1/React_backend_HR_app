import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Download, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { formatDate } from '../../utils/dateFormat';
import { BiometricAttendanceDetail } from './BiometricAttendanceDetail';
import './BiometricAttendance.css';

const API_BASE = '/api/hr/biometric';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const EMPTY_FILTERS = {
  month: '',
  date: '',
  start: '',
  end: '',
  emp_id: '',
  emp_type: '',
  circle: '',
  device_sn: '',
};

export function BiometricAttendance({ onBack, empTypeOptions = [], circleOptions = [] }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [devices, setDevices] = useState([]);
  const [detail, setDetail] = useState(null);

  const buildParams = useCallback(
    (p = page, pp = perPage) => {
      const params = new URLSearchParams();
      if (filters.month) params.set('month', filters.month);
      if (filters.date) params.set('date', filters.date);
      if (filters.start) params.set('start', filters.start);
      if (filters.end) params.set('end', filters.end);
      if (filters.emp_id) params.set('emp_id', filters.emp_id);
      if (filters.emp_type) params.set('emp_type', filters.emp_type);
      if (filters.circle) params.set('circle', filters.circle);
      if (filters.device_sn) params.set('device_sn', filters.device_sn);
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
      } catch (err) {
        setRows([]);
        setError(err.message || 'Network error');
      } finally {
        setLoading(false);
      }
    },
    [buildParams, page, perPage]
  );

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/devices`, { headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) setDevices(data.devices || []);
    } catch {
      /* ignore device list errors */
    }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

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
      if (filters.month) params.set('month', filters.month);
      if (filters.date) params.set('date', filters.date);
      if (filters.start) params.set('start', filters.start);
      if (filters.end) params.set('end', filters.end);
      if (filters.emp_id) params.set('emp_id', filters.emp_id);
      if (filters.emp_type) params.set('emp_type', filters.emp_type);
      if (filters.circle) params.set('circle', filters.circle);
      if (filters.device_sn) params.set('device_sn', filters.device_sn);
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

  const hasActiveFilters = Object.values(filters).some((v) => v);

  return (
    <div className="bio-att-page">
      <button className="bio-att-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to HR
      </button>

      <div className="bio-att-header">
        <h2>Biometric Attendance</h2>
        <p>Raw biometric scans from the device. First and last scan of each day are highlighted.</p>
      </div>

      <div className="bio-att-filters">
        <label>
          Month
          <input
            type="month"
            value={filters.month}
            onChange={(e) => handleFilterChange('month', e.target.value)}
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
        <label>
          Department
          <select
            value={filters.emp_type}
            onChange={(e) => handleFilterChange('emp_type', e.target.value)}
          >
            <option value="">All</option>
            {empTypeOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          Circle
          <select
            value={filters.circle}
            onChange={(e) => handleFilterChange('circle', e.target.value)}
          >
            <option value="">All</option>
            {circleOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Device
          <select
            value={filters.device_sn}
            onChange={(e) => handleFilterChange('device_sn', e.target.value)}
          >
            <option value="">All</option>
            {devices.map((d) => (
              <option key={d.serial_number} value={d.serial_number}>
                {d.name || d.serial_number}
              </option>
            ))}
          </select>
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
              setFilters(EMPTY_FILTERS);
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
                  <td>{r.scan_count}</td>
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
