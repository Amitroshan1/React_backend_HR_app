import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, CalendarClock } from 'lucide-react';

const API_BASE = '/api/HumanResource';

export const LeaveAccrualSummary = ({ onBack }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState({
    latest_run_date: null,
    latest_run: {
      events_total: 0,
      admins_affected: 0,
      pl_credits: 0,
      cl_credits: 0,
      year_resets: 0,
    },
    recent_runs: [],
  });

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/leave-accrual/summary?limit=10`, {
        headers: getAuthHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.message || 'Failed to load leave accrual summary');
        return;
      }
      setData({
        latest_run_date: json.latest_run_date || null,
        latest_run: json.latest_run || {
          events_total: 0,
          admins_affected: 0,
          pl_credits: 0,
          cl_credits: 0,
          year_resets: 0,
        },
        recent_runs: json.recent_runs || [],
      });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const latest = data.latest_run || {};

  return (
    <div className="hr-main-container">
      <button className="btn-back-updates" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Updates
      </button>

      <div className="hr-card" style={{ marginTop: '12px', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CalendarClock size={22} /> Leave Accrual Monitor
          </h2>
          <button
            type="button"
            onClick={fetchSummary}
            disabled={loading}
            style={{
              border: '1px solid #dbeafe',
              background: '#eff6ff',
              color: '#1d4ed8',
              borderRadius: '8px',
              padding: '8px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <RefreshCw size={16} /> {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: '12px', padding: '12px', borderRadius: '8px', background: '#fef2f2', color: '#b91c1c' }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(5, minmax(120px, 1fr))', gap: '10px' }}>
          <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#64748b' }}>Latest Run</div>
            <div style={{ fontWeight: 600 }}>{data.latest_run_date || '-'}</div>
          </div>
          <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#64748b' }}>Events</div>
            <div style={{ fontWeight: 600 }}>{latest.events_total ?? 0}</div>
          </div>
          <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#64748b' }}>Admins Affected</div>
            <div style={{ fontWeight: 600 }}>{latest.admins_affected ?? 0}</div>
          </div>
          <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#64748b' }}>PL Credits</div>
            <div style={{ fontWeight: 600 }}>{latest.pl_credits ?? 0}</div>
          </div>
          <div style={{ padding: '10px', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#64748b' }}>CL Credits / Resets</div>
            <div style={{ fontWeight: 600 }}>{latest.cl_credits ?? 0} / {latest.year_resets ?? 0}</div>
          </div>
        </div>

        <div style={{ marginTop: '18px' }}>
          <h3 style={{ marginTop: 0 }}>Recent Runs</h3>
          {loading ? (
            <p style={{ color: '#64748b' }}>Loading...</p>
          ) : data.recent_runs.length === 0 ? (
            <p style={{ color: '#64748b' }}>No accrual runs found yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '8px' }}>Run Date</th>
                    <th style={{ padding: '8px' }}>Events</th>
                    <th style={{ padding: '8px' }}>Admins</th>
                    <th style={{ padding: '8px' }}>PL</th>
                    <th style={{ padding: '8px' }}>CL</th>
                    <th style={{ padding: '8px' }}>Resets</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_runs.map((row) => (
                    <tr key={row.run_date} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px' }}>{row.run_date}</td>
                      <td style={{ padding: '8px' }}>{row.events_total ?? 0}</td>
                      <td style={{ padding: '8px' }}>{row.admins_affected ?? 0}</td>
                      <td style={{ padding: '8px' }}>{row.pl_credits ?? 0}</td>
                      <td style={{ padding: '8px' }}>{row.cl_credits ?? 0}</td>
                      <td style={{ padding: '8px' }}>{row.year_resets ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
