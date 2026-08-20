import React, { useCallback, useEffect, useState } from 'react';
import { X, Star } from 'lucide-react';
import { formatDate } from '../../utils/dateFormat';

const API_BASE = '/api/hr/biometric';

const getAuthHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export function BiometricAttendanceDetail({ row, onClose }) {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const path = row.mapped
        ? `${API_BASE}/employee/${row.admin_id}/day/${row.date}`
        : `${API_BASE}/unmapped/${encodeURIComponent(row.device_user_id)}/day/${row.date}`;
      const res = await fetch(path, { headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load');
      setScans(data.scans || []);
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [row]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const firstTime = scans.length ? scans[0].punch_time : null;
  const lastTime = scans.length ? scans[scans.length - 1].punch_time : null;

  return (
    <div className="bio-att-overlay" onClick={onClose}>
      <div className="bio-att-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="bio-att-drawer-header">
          <div>
            <h3>{row.employee_name || 'Unmapped PIN'}</h3>
            <p>
              {row.emp_id || row.device_user_id || '—'} · {formatDate(row.date)} · {row.scan_count}{' '}
              scan(s)
            </p>
          </div>
          <button className="bio-att-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {error && <div className="bio-att-error">{error}</div>}
        {loading && <div className="bio-att-muted">Loading scans…</div>}

        {!loading && scans.length === 0 && (
          <div className="bio-att-muted">No scans for this day.</div>
        )}

        {!loading && scans.length > 0 && (
          <div className="bio-att-scan-list">
            {scans.map((s) => {
              const isFirst = s.punch_time === firstTime;
              const isLast = s.punch_time === lastTime;
              return (
                <div
                  key={s.id}
                  className={`bio-att-scan-row ${isFirst ? 'first' : ''} ${isLast ? 'last' : ''}`}
                >
                  <div className="bio-att-scan-time">
                    {s.punch_time ? s.punch_time.slice(11) : '—'}
                    {isFirst && (
                      <span className="bio-att-flag">
                        <Star size={11} /> FIRST SCAN
                      </span>
                    )}
                    {isLast && (
                      <span className="bio-att-flag last">
                        <Star size={11} /> LAST SCAN
                      </span>
                    )}
                  </div>
                  <div className="bio-att-scan-meta">
                    <span>Device: {s.device_serial_number}</span>
                    <span>User ID: {s.device_user_id}</span>
                    <span>Verify: {s.verification_mode || '—'}</span>
                    <span>Status: {s.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
