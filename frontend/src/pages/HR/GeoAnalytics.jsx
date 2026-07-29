import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, MapPin, AlertTriangle, Activity, Settings, Search, Shield, Wrench, BarChart3, GitCompare, Rocket } from 'lucide-react';
import './GeoAnalytics.css';

const HR_API = '/api/HumanResource';

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'offices', label: 'Office Health', icon: MapPin },
  { id: 'browsers', label: 'Browser Health', icon: Activity },
  { id: 'audit', label: 'Audit', icon: Search },
  { id: 'comparison', label: 'Engine Comparison', icon: GitCompare },
  { id: 'rollout', label: 'Production Rollout', icon: Rocket },
  { id: 'config', label: 'Configuration', icon: Settings },
  { id: 'monitoring', label: 'Monitoring', icon: Activity },
  { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
  { id: 'tuning', label: 'Tuning', icon: Wrench },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'troubleshoot', label: 'Troubleshoot', icon: Search },
];

const authHeaders = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') p.set(k, v);
  });
  return p.toString();
};

const MetricCard = ({ label, value, hint }) => (
  <div className="geo-metric-card">
    <div className="geo-metric-label">{label}</div>
    <div className="geo-metric-value">{value ?? '—'}</div>
    {hint ? <div className="geo-metric-hint">{hint}</div> : null}
  </div>
);

export const GeoAnalytics = ({ onBack }) => {
  const [tab, setTab] = useState('overview');
  const [preset, setPreset] = useState('weekly');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [summary, setSummary] = useState(null);
  const [breakdownDim, setBreakdownDim] = useState('department');
  const [breakdown, setBreakdown] = useState(null);
  const [offices, setOffices] = useState(null);
  const [browsers, setBrowsers] = useState(null);
  const [monitoring, setMonitoring] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [recs, setRecs] = useState(null);
  const [security, setSecurity] = useState(null);
  const [cmpSummary, setCmpSummary] = useState(null);
  const [cmpOffices, setCmpOffices] = useState(null);
  const [cmpDiffs, setCmpDiffs] = useState(null);
  const [cmpDiffPage, setCmpDiffPage] = useState(1);
  const [cmpFilters, setCmpFilters] = useState({ difference_category: '', office: '', emp_id: '', only_diff: '1' });
  const [rollout, setRollout] = useState(null);
  const [modeMsg, setModeMsg] = useState('');

  const [auditFilters, setAuditFilters] = useState({
    emp_id: '',
    office: '',
    decision: '',
    attempt_id: '',
    device: '',
    browser: '',
    network_match: '',
  });
  const [audit, setAudit] = useState(null);
  const [auditPage, setAuditPage] = useState(1);

  const [configItems, setConfigItems] = useState([]);
  const [configEdits, setConfigEdits] = useState({});
  const [configReason, setConfigReason] = useState('');
  const [configHistory, setConfigHistory] = useState([]);
  const [configMsg, setConfigMsg] = useState('');

  const [attemptId, setAttemptId] = useState('');
  const [attemptDetail, setAttemptDetail] = useState(null);

  const rangeParams = useMemo(() => {
    if (dateFrom || dateTo) {
      return { from: dateFrom || undefined, to: dateTo || undefined };
    }
    return { preset };
  }, [preset, dateFrom, dateTo]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = qs(rangeParams);
      const [sRes, bRes] = await Promise.all([
        fetch(`${HR_API}/geo-analytics/summary?${q}`, { headers: authHeaders() }),
        fetch(`${HR_API}/geo-analytics/breakdowns?${q}&dimension=${breakdownDim}`, { headers: authHeaders() }),
      ]);
      const sJson = await sRes.json();
      const bJson = await bRes.json();
      if (!sRes.ok || !sJson.success) throw new Error(sJson.message || 'Summary failed');
      setSummary(sJson);
      setBreakdown(bJson.success ? bJson : null);
    } catch (e) {
      setError(e.message || 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, [rangeParams, breakdownDim]);

  const loadOffices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API}/geo-analytics/office-health?${qs(rangeParams)}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Office health failed');
      setOffices(json);
    } catch (e) {
      setError(e.message || 'Failed to load office health');
    } finally {
      setLoading(false);
    }
  }, [rangeParams]);

  const loadBrowsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API}/geo-analytics/browser-health?${qs(rangeParams)}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Browser health failed');
      setBrowsers(json);
    } catch (e) {
      setError(e.message || 'Failed to load browser health');
    } finally {
      setLoading(false);
    }
  }, [rangeParams]);

  const loadAudit = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = { ...rangeParams, ...auditFilters, page, page_size: 50 };
      const res = await fetch(`${HR_API}/geo-analytics/audit?${qs(params)}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Audit search failed');
      setAudit(json);
      setAuditPage(page);
    } catch (e) {
      setError(e.message || 'Failed to load audit');
    } finally {
      setLoading(false);
    }
  }, [rangeParams, auditFilters]);

  const exportAudit = async () => {
    try {
      const res = await fetch(`${HR_API}/geo-analytics/audit/export?${qs({ ...rangeParams, ...auditFilters })}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        alert('Export failed');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'geo-audit-export.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed');
    }
  };

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cRes, hRes] = await Promise.all([
        fetch(`${HR_API}/geo-analytics/config`, { headers: authHeaders() }),
        fetch(`${HR_API}/geo-analytics/config/history?limit=50`, { headers: authHeaders() }),
      ]);
      const cJson = await cRes.json();
      const hJson = await hRes.json();
      if (!cRes.ok || !cJson.success) throw new Error(cJson.message || 'Config load failed');
      setConfigItems(cJson.items || []);
      setConfigEdits({});
      setConfigHistory(hJson.rows || []);
    } catch (e) {
      setError(e.message || 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, []);

  const saveConfig = async () => {
    setConfigMsg('');
    const updates = {};
    Object.entries(configEdits).forEach(([k, v]) => {
      if (String(v).trim() !== '') updates[k] = v;
    });
    if (!Object.keys(updates).length) {
      setConfigMsg('No edits to save.');
      return;
    }
    try {
      const res = await fetch(`${HR_API}/geo-analytics/config`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates, reason: configReason }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setConfigMsg(json.message || 'Save failed');
        return;
      }
      setConfigMsg(json.message || 'Saved');
      setConfigReason('');
      loadConfig();
    } catch {
      setConfigMsg('Network error');
    }
  };

  const loadMonitoring = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API}/geo-analytics/monitoring?${qs(rangeParams)}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Monitoring failed');
      setMonitoring(json);
    } catch (e) {
      setError(e.message || 'Failed to load monitoring');
    } finally {
      setLoading(false);
    }
  }, [rangeParams]);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API}/geo-analytics/alerts?${qs(rangeParams)}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Alerts failed');
      setAlerts(json);
    } catch (e) {
      setError(e.message || 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [rangeParams]);

  const loadTuning = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API}/geo-analytics/recommendations?${qs(rangeParams)}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Recommendations failed');
      setRecs(json);
    } catch (e) {
      setError(e.message || 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  }, [rangeParams]);

  const loadSecurity = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API}/geo-analytics/security?${qs(rangeParams)}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Security failed');
      setSecurity(json);
    } catch (e) {
      setError(e.message || 'Failed to load security');
    } finally {
      setLoading(false);
    }
  }, [rangeParams]);

  const loadComparison = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = qs(rangeParams);
      const [sRes, oRes] = await Promise.all([
        fetch(`${HR_API}/geo-analytics/comparison/summary?${q}`, { headers: authHeaders() }),
        fetch(`${HR_API}/geo-analytics/comparison/offices?${q}`, { headers: authHeaders() }),
      ]);
      const sJson = await sRes.json();
      const oJson = await oRes.json();
      if (!sRes.ok || !sJson.success) throw new Error(sJson.message || 'Comparison failed');
      setCmpSummary(sJson);
      setCmpOffices(oJson.success ? oJson : null);
    } catch (e) {
      setError(e.message || 'Failed to load comparison');
    } finally {
      setLoading(false);
    }
  }, [rangeParams]);

  const loadDisagreements = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = { ...rangeParams, ...cmpFilters, page, page_size: 50 };
      const res = await fetch(`${HR_API}/geo-analytics/comparison/disagreements?${qs(params)}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Disagreements failed');
      setCmpDiffs(json);
      setCmpDiffPage(page);
    } catch (e) {
      setError(e.message || 'Failed to load disagreements');
    } finally {
      setLoading(false);
    }
  }, [rangeParams, cmpFilters]);

  const exportDisagreements = async () => {
    try {
      const res = await fetch(`${HR_API}/geo-analytics/comparison/disagreements/export?${qs({ ...rangeParams, ...cmpFilters })}`, {
        headers: authHeaders(),
      });
      if (!res.ok) { alert('Export failed'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'geo-engine-disagreements.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed');
    }
  };

  const loadRollout = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API}/geo-analytics/rollout?${qs(rangeParams)}`, { headers: authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Rollout failed');
      setRollout(json);
    } catch (e) {
      setError(e.message || 'Failed to load rollout');
    } finally {
      setLoading(false);
    }
  }, [rangeParams]);

  const setEngineMode = async (mode) => {
    setModeMsg('');
    const reason = window.prompt(`Reason for switching to ${mode} (required):`, `Rollout: set mode ${mode}`);
    if (!reason || reason.trim().length < 5) {
      setModeMsg('Reason required (5+ chars). Mode not changed.');
      return;
    }
    try {
      const res = await fetch(`${HR_API}/geo-analytics/engine-mode`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, reason: reason.trim() }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setModeMsg(json.message || 'Mode change failed');
        return;
      }
      setModeMsg(`Mode set to ${mode}. Takes effect immediately (no deploy).`);
      loadRollout();
    } catch {
      setModeMsg('Network error');
    }
  };

  const loadAttempt = async () => {
    if (!attemptId.trim()) return;
    setLoading(true);
    setError('');
    setAttemptDetail(null);
    try {
      const res = await fetch(`${HR_API}/geo-analytics/attempt/${encodeURIComponent(attemptId.trim())}`, {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || 'Attempt not found');
      setAttemptDetail(json);
    } catch (e) {
      setError(e.message || 'Failed to load attempt');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'overview') loadOverview();
    else if (tab === 'offices') loadOffices();
    else if (tab === 'browsers') loadBrowsers();
    else if (tab === 'audit') loadAudit(1);
    else if (tab === 'config') loadConfig();
    else if (tab === 'monitoring') loadMonitoring();
    else if (tab === 'alerts') loadAlerts();
    else if (tab === 'tuning') loadTuning();
    else if (tab === 'security') loadSecurity();
    else if (tab === 'comparison') { loadComparison(); loadDisagreements(1); }
    else if (tab === 'rollout') loadRollout();
    else if (tab === 'troubleshoot' && attemptId.trim()) loadAttempt();
    // Intentionally: audit filters apply only on Search click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, preset, dateFrom, dateTo, breakdownDim]);

  const d = summary?.decisions || {};
  const p = summary?.policies || {};
  const a = summary?.averages || {};

  return (
    <div className="geo-analytics">
      <div className="geo-analytics__header">
        <button type="button" className="geo-analytics__back" onClick={onBack}>
          <ArrowLeft size={18} /> Back
        </button>
        <div>
          <h2 className="geo-analytics__title">Geo Monitoring &amp; Analytics</h2>
          <p className="geo-analytics__sub">
            Operational visibility, audit, tuning, and troubleshooting — does not change punch behavior.
          </p>
        </div>
      </div>

      <div className="geo-analytics__filters">
        <label>
          Preset
          <select value={preset} onChange={(e) => { setPreset(e.target.value); setDateFrom(''); setDateTo(''); }}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label>
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <button
          type="button"
          className="geo-btn"
          onClick={() => {
            if (tab === 'overview') loadOverview();
            if (tab === 'offices') loadOffices();
            if (tab === 'browsers') loadBrowsers();
            if (tab === 'audit') loadAudit(1);
            if (tab === 'monitoring') loadMonitoring();
            if (tab === 'alerts') loadAlerts();
            if (tab === 'tuning') loadTuning();
            if (tab === 'security') loadSecurity();
            if (tab === 'comparison') { loadComparison(); loadDisagreements(1); }
            if (tab === 'rollout') loadRollout();
          }}
        >
          Refresh
        </button>
      </div>

      <div className="geo-analytics__tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              className={`geo-tab${tab === t.id ? ' geo-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {error ? <div className="geo-error">{error}</div> : null}
      {loading ? <div className="geo-loading">Loading…</div> : null}

      {tab === 'overview' && summary && (
        <div className="geo-panel">
          <div className="geo-metric-grid">
            <MetricCard label="Total punches / checks" value={summary.total_punches} />
            <MetricCard label="INSIDE %" value={`${d.INSIDE?.pct ?? 0}%`} hint={`${d.INSIDE?.count ?? 0}`} />
            <MetricCard label="UNCERTAIN %" value={`${d.UNCERTAIN?.pct ?? 0}%`} />
            <MetricCard label="OUTSIDE %" value={`${d.OUTSIDE?.pct ?? 0}%`} />
            <MetricCard label="LOW_SIGNAL %" value={`${d.LOW_SIGNAL?.pct ?? 0}%`} />
            <MetricCard label="NO_GPS %" value={`${d.NO_GPS?.pct ?? 0}%`} />
            <MetricCard label="ALLOW_FLAGGED %" value={`${p.ALLOW_FLAGGED?.pct ?? 0}%`} />
            <MetricCard label="REQUIRE_REASON %" value={`${p.REQUIRE_REASON?.pct ?? 0}%`} />
            <MetricCard label="Avg accuracy (m)" value={a.accuracy_m} />
            <MetricCard label="Avg confidence" value={a.confidence} />
            <MetricCard label="Avg acquisition (ms)" value={a.acquisition_ms} />
            <MetricCard label="Avg retries" value={a.retry_count} />
          </div>

          <div className="geo-panel__toolbar">
            <h3>Breakdown</h3>
            <select value={breakdownDim} onChange={(e) => setBreakdownDim(e.target.value)}>
              <option value="office">Office</option>
              <option value="department">Department</option>
              <option value="circle">Employee group (circle)</option>
              <option value="browser">Browser</option>
              <option value="os">Operating system</option>
              <option value="device">Device type</option>
              <option value="network">Network match</option>
            </select>
          </div>
          <div className="geo-table-wrap">
            <table className="geo-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Total</th>
                  <th>Avg Acc</th>
                  <th>Avg Conf</th>
                  <th>Inside %</th>
                  <th>Outside %</th>
                  <th>Low signal %</th>
                  <th>Reason %</th>
                  <th>Network %</th>
                </tr>
              </thead>
              <tbody>
                {(breakdown?.rows || []).map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>{r.total}</td>
                    <td>{r.avg_accuracy_m ?? '—'}</td>
                    <td>{r.avg_confidence ?? '—'}</td>
                    <td>{r.inside_pct}</td>
                    <td>{r.outside_pct}</td>
                    <td>{r.low_signal_pct}</td>
                    <td>{r.require_reason_pct}</td>
                    <td>{r.network_match_pct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'offices' && offices && (
        <div className="geo-panel">
          {offices.attention?.length ? (
            <div className="geo-attention">
              <AlertTriangle size={16} /> {offices.attention.length} office(s) need attention
            </div>
          ) : null}
          <div className="geo-table-wrap">
            <table className="geo-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Office</th>
                  <th>Total</th>
                  <th>Avg Acc</th>
                  <th>Avg Conf</th>
                  <th>Avg Acq ms</th>
                  <th>Outside %</th>
                  <th>Low signal %</th>
                  <th>Reason %</th>
                  <th>Network %</th>
                  <th>Quality</th>
                  <th>Top failures</th>
                </tr>
              </thead>
              <tbody>
                {(offices.offices || []).map((r) => (
                  <tr key={r.label} className={r.needs_attention ? 'geo-row--warn' : ''}>
                    <td>{r.rank}</td>
                    <td>{r.label}</td>
                    <td>{r.total}</td>
                    <td>{r.avg_accuracy_m ?? '—'}</td>
                    <td>{r.avg_confidence ?? '—'}</td>
                    <td>{r.avg_acquisition_ms ?? '—'}</td>
                    <td>{r.outside_pct}</td>
                    <td>{r.low_signal_pct}</td>
                    <td>{r.require_reason_pct}</td>
                    <td>{r.network_match_pct}</td>
                    <td>{r.quality_score}</td>
                    <td>
                      {(r.top_failure_reasons || []).map((f) => `${f.reason}(${f.count})`).join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'browsers' && browsers && (
        <div className="geo-panel">
          <div className="geo-table-wrap">
            <table className="geo-table">
              <thead>
                <tr>
                  <th>Browser</th>
                  <th>Total</th>
                  <th>Avg Acc</th>
                  <th>Avg Conf</th>
                  <th>Avg retries</th>
                  <th>Success-ish %</th>
                  <th>Avg acq ms</th>
                  <th>LOW_SIGNAL %</th>
                </tr>
              </thead>
              <tbody>
                {(browsers.browsers || []).map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>{r.total}</td>
                    <td>{r.avg_accuracy_m ?? '—'}</td>
                    <td>{r.avg_confidence ?? '—'}</td>
                    <td>{r.avg_retry_count ?? '—'}</td>
                    <td>{r.punch_success_rate_pct}</td>
                    <td>{r.avg_acquisition_ms ?? '—'}</td>
                    <td>{r.low_signal_frequency_pct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="geo-panel">
          <div className="geo-audit-filters">
            <input placeholder="Emp ID" value={auditFilters.emp_id} onChange={(e) => setAuditFilters({ ...auditFilters, emp_id: e.target.value })} />
            <input placeholder="Office" value={auditFilters.office} onChange={(e) => setAuditFilters({ ...auditFilters, office: e.target.value })} />
            <select value={auditFilters.decision} onChange={(e) => setAuditFilters({ ...auditFilters, decision: e.target.value })}>
              <option value="">Decision</option>
              {['INSIDE', 'UNCERTAIN', 'OUTSIDE', 'LOW_SIGNAL', 'NO_GPS', 'NO_OFFICE'].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <input placeholder="Attempt ID" value={auditFilters.attempt_id} onChange={(e) => setAuditFilters({ ...auditFilters, attempt_id: e.target.value })} />
            <select value={auditFilters.device} onChange={(e) => setAuditFilters({ ...auditFilters, device: e.target.value })}>
              <option value="">Device</option>
              <option value="mobile">mobile</option>
              <option value="desktop">desktop</option>
            </select>
            <input placeholder="Browser" value={auditFilters.browser} onChange={(e) => setAuditFilters({ ...auditFilters, browser: e.target.value })} />
            <select value={auditFilters.network_match} onChange={(e) => setAuditFilters({ ...auditFilters, network_match: e.target.value })}>
              <option value="">Network</option>
              <option value="true">Match</option>
              <option value="false">No match</option>
            </select>
            <button type="button" className="geo-btn" onClick={() => loadAudit(1)}>Search</button>
            <button type="button" className="geo-btn geo-btn--secondary" onClick={exportAudit}>
              <Download size={14} /> CSV
            </button>
          </div>
          <div className="geo-table-wrap">
            <table className="geo-table geo-table--dense">
              <thead>
                <tr>
                  <th>Attempt</th>
                  <th>Time</th>
                  <th>Emp</th>
                  <th>Lat/Lon</th>
                  <th>Acc</th>
                  <th>Conf</th>
                  <th>Dist</th>
                  <th>Office</th>
                  <th>R/G</th>
                  <th>Decision</th>
                  <th>Policy</th>
                  <th>Device</th>
                  <th>Browser/OS</th>
                  <th>Samples</th>
                  <th>Spread</th>
                  <th>Acq</th>
                  <th>Retries</th>
                  <th>Net</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {(audit?.rows || []).map((r) => (
                  <tr key={r.attempt_id}>
                    <td>
                      <button
                        type="button"
                        className="geo-link"
                        onClick={() => { setAttemptId(r.attempt_id); setTab('troubleshoot'); }}
                      >
                        {String(r.attempt_id).slice(0, 8)}…
                      </button>
                    </td>
                    <td>{r.timestamp}</td>
                    <td>{r.emp_id || r.admin_id || '—'}</td>
                    <td>{r.latitude != null ? `${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)}` : '—'}</td>
                    <td>{r.accuracy_m ?? '—'}</td>
                    <td>{r.confidence ?? '—'}</td>
                    <td>{r.distance_m ?? '—'}</td>
                    <td>{r.office_name || '—'}</td>
                    <td>{r.radius_m ?? '—'}/{r.grace_m ?? '—'}</td>
                    <td>{r.geo_decision}</td>
                    <td>{r.policy_action}</td>
                    <td>{r.device_type}</td>
                    <td>{r.browser}/{r.operating_system}</td>
                    <td>{r.sample_count ?? '—'}</td>
                    <td>{r.spread_m ?? '—'}</td>
                    <td>{r.acquisition_ms ?? '—'}</td>
                    <td>{r.retry_count ?? '—'}</td>
                    <td>{r.network_match ? 'Y' : 'N'}</td>
                    <td>{r.flag_reason || r.error_code || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {audit ? (
            <div className="geo-pager">
              <button type="button" className="geo-btn geo-btn--secondary" disabled={auditPage <= 1} onClick={() => loadAudit(auditPage - 1)}>Prev</button>
              <span>Page {audit.page} · {audit.total} rows</span>
              <button type="button" className="geo-btn geo-btn--secondary" disabled={auditPage * audit.page_size >= audit.total} onClick={() => loadAudit(auditPage + 1)}>Next</button>
            </div>
          ) : null}
        </div>
      )}

      {tab === 'config' && (
        <div className="geo-panel">
          <p className="geo-hint">Changes are versioned. Engine reads live Flask config (DB overrides applied at boot and on save).</p>
          <label className="geo-config-reason">
            Change reason (required)
            <input value={configReason} onChange={(e) => setConfigReason(e.target.value)} placeholder="Why are you changing this?" />
          </label>
          <button type="button" className="geo-btn" onClick={saveConfig}>Save changes</button>
          {configMsg ? <div className="geo-config-msg">{configMsg}</div> : null}
          <div className="geo-table-wrap">
            <table className="geo-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Current</th>
                  <th>Default</th>
                  <th>New value</th>
                  <th>Docs</th>
                </tr>
              </thead>
              <tbody>
                {configItems.map((item) => (
                  <tr key={item.key} className={item.overridden ? 'geo-row--override' : ''}>
                    <td><code>{item.key}</code></td>
                    <td>{String(item.value)}</td>
                    <td>{String(item.default)}</td>
                    <td>
                      <input
                        className="geo-config-input"
                        value={configEdits[item.key] ?? ''}
                        placeholder="leave blank = no change"
                        onChange={(e) => setConfigEdits({ ...configEdits, [item.key]: e.target.value })}
                      />
                    </td>
                    <td className="geo-doc">{item.doc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Change history</h3>
          <div className="geo-table-wrap">
            <table className="geo-table">
              <thead>
                <tr>
                  <th>Ver</th>
                  <th>When</th>
                  <th>Key</th>
                  <th>Old</th>
                  <th>New</th>
                  <th>Who</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {configHistory.map((h) => (
                  <tr key={h.id}>
                    <td>{h.version}</td>
                    <td>{h.created_at}</td>
                    <td><code>{h.config_key}</code></td>
                    <td>{h.old_value}</td>
                    <td>{h.new_value}</td>
                    <td>{h.changed_by_email || h.changed_by_admin_id}</td>
                    <td>{h.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'monitoring' && monitoring && (
        <div className="geo-panel">
          <div className="geo-metric-grid">
            <MetricCard label="Period volume" value={monitoring.daily_punch_volume} />
            <MetricCard label="Avg acquisition ms" value={monitoring.avg_acquisition_ms} />
            <MetricCard label="Avg retries" value={monitoring.avg_retry_count} />
            <MetricCard label="Error rate %" value={monitoring.error_rate_pct} />
            <MetricCard label="GPS timeout rate %" value={monitoring.gps_timeout_rate_pct} />
            <MetricCard label="Permission denied %" value={monitoring.permission_denied_rate_pct} />
            <MetricCard label="Offices configured" value={monitoring.offices_configured} />
          </div>
          <h3>Daily volume</h3>
          <div className="geo-table-wrap">
            <table className="geo-table">
              <thead><tr><th>Day</th><th>Count</th></tr></thead>
              <tbody>
                {(monitoring.daily_volume || []).map((r) => (
                  <tr key={r.day}><td>{r.day}</td><td>{r.count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Hourly volume</h3>
          <div className="geo-table-wrap">
            <table className="geo-table">
              <thead><tr><th>Hour</th><th>Count</th></tr></thead>
              <tbody>
                {(monitoring.hourly_volume || []).slice(-48).map((r) => (
                  <tr key={r.hour}><td>{r.hour}</td><td>{r.count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="geo-hint">
            API / DB / engine latency: instrument via APM / reverse-proxy in production
            ({monitoring.notes?.api_latency}).
          </div>
        </div>
      )}

      {tab === 'alerts' && alerts && (
        <div className="geo-panel">
          <p className="geo-hint">Alert design only — no email/Slack integration yet. Wire a notifier later.</p>
          {(alerts.alerts || []).length === 0 ? <p>No alerts for this period.</p> : null}
          <ul className="geo-alert-list">
            {(alerts.alerts || []).map((al, i) => (
              <li key={`${al.code}-${i}`} className={`geo-alert geo-alert--${al.severity}`}>
                <strong>[{al.severity}] {al.title}</strong>
                <div>{al.message}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'tuning' && recs && (
        <div className="geo-panel">
          <p className="geo-hint">Data-driven recommendations. Review before changing config.</p>
          {(recs.recommendations || []).length === 0 ? <p>No recommendations — sample may be too small.</p> : null}
          <ul className="geo-rec-list">
            {(recs.recommendations || []).map((r, i) => (
              <li key={i} className={`geo-rec geo-rec--${r.priority}`}>
                <strong>{r.title}</strong>
                <div className="geo-rec__ev">{r.evidence}</div>
                <div className="geo-rec__sug">{r.suggestion}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'security' && security && (
        <div className="geo-panel">
          <div className="geo-attention">{security.disclaimer}</div>
          <h3>Repeated OUTSIDE</h3>
          <div className="geo-table-wrap">
            <table className="geo-table">
              <thead><tr><th>Emp</th><th>Name</th><th>Count</th></tr></thead>
              <tbody>
                {(security.repeated_outside || []).map((r) => (
                  <tr key={r.admin_id}><td>{r.emp_id || r.admin_id}</td><td>{r.name}</td><td>{r.outside_count}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Suspicious GPS jumps (precise + far)</h3>
          <div className="geo-table-wrap">
            <table className="geo-table">
              <thead><tr><th>Attempt</th><th>Admin</th><th>Distance</th><th>Acc</th><th>Decision</th><th>Time</th></tr></thead>
              <tbody>
                {(security.suspicious_gps_jumps || []).map((r) => (
                  <tr key={r.attempt_id}>
                    <td>
                      <button type="button" className="geo-link" onClick={() => { setAttemptId(r.attempt_id); setTab('troubleshoot'); }}>
                        {String(r.attempt_id).slice(0, 8)}…
                      </button>
                    </td>
                    <td>{r.admin_id}</td>
                    <td>{r.distance_m}</td>
                    <td>{r.accuracy_m}</td>
                    <td>{r.geo_decision}</td>
                    <td>{r.timestamp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>Network match but weak geo: <strong>{security.network_match_but_weak_geo}</strong></p>
        </div>
      )}

      {tab === 'comparison' && cmpSummary && (
        <div className="geo-panel">
          <div className="geo-metric-grid">
            <MetricCard label="Total compared" value={cmpSummary.total_compared} />
            <MetricCard label="Decision match %" value={`${cmpSummary.decision_match_pct}%`} />
            <MetricCard label="Policy match %" value={`${cmpSummary.policy_match_pct}%`} />
            <MetricCard label="Difference %" value={`${cmpSummary.decision_difference_pct}%`} />
            <MetricCard label="Legacy INSIDE" value={cmpSummary.legacy_counts?.INSIDE ?? 0} />
            <MetricCard label="V2 INSIDE" value={cmpSummary.v2_counts?.INSIDE ?? 0} />
            <MetricCard label="Legacy OUTSIDE" value={cmpSummary.legacy_counts?.OUTSIDE ?? 0} />
            <MetricCard label="V2 OUTSIDE" value={cmpSummary.v2_counts?.OUTSIDE ?? 0} />
            <MetricCard label="Legacy LOW_SIGNAL" value={cmpSummary.legacy_counts?.LOW_SIGNAL ?? 0} />
            <MetricCard label="V2 LOW_SIGNAL" value={cmpSummary.v2_counts?.LOW_SIGNAL ?? 0} />
            <MetricCard label="Legacy UNCERTAIN" value={cmpSummary.legacy_counts?.UNCERTAIN ?? 0} />
            <MetricCard label="V2 UNCERTAIN" value={cmpSummary.v2_counts?.UNCERTAIN ?? 0} />
            <MetricCard label="Avg V2 confidence" value={cmpSummary.avg_confidence} />
            <MetricCard label="Avg legacy ms" value={cmpSummary.avg_execution_legacy_ms} />
            <MetricCard label="Avg V2 ms" value={cmpSummary.avg_execution_v2_ms} />
            <MetricCard label="p95 V2 ms" value={cmpSummary.p95_v2_ms} />
            <MetricCard label="p99 V2 ms" value={cmpSummary.p99_v2_ms} />
            <MetricCard label="V2 error %" value={cmpSummary.v2_error_rate_pct} />
          </div>

          <h3>Daily trend</h3>
          <div className="geo-table-wrap">
            <table className="geo-table">
              <thead><tr><th>Day</th><th>Total</th><th>Match %</th></tr></thead>
              <tbody>
                {(cmpSummary.daily_trend || []).map((r) => (
                  <tr key={r.day}><td>{r.day}</td><td>{r.total}</td><td>{r.match_pct}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Office comparison</h3>
          {cmpOffices?.attention?.length ? (
            <div className="geo-attention"><AlertTriangle size={16} /> {cmpOffices.attention.length} office(s) need review</div>
          ) : null}
          <div className="geo-table-wrap">
            <table className="geo-table">
              <thead>
                <tr>
                  <th>Office</th><th>Total</th><th>Match %</th><th>Avg Conf</th><th>Avg Acc</th>
                  <th>Legacy Out %</th><th>V2 Out %</th><th>Diff %</th>
                </tr>
              </thead>
              <tbody>
                {(cmpOffices?.offices || []).map((r) => (
                  <tr key={r.office} className={r.needs_review ? 'geo-row--warn' : ''}>
                    <td>{r.office}</td>
                    <td>{r.total}</td>
                    <td>{r.decision_match_pct}</td>
                    <td>{r.avg_confidence ?? '—'}</td>
                    <td>{r.avg_accuracy_m ?? '—'}</td>
                    <td>{r.legacy_outside_pct}</td>
                    <td>{r.v2_outside_pct}</td>
                    <td>{r.largest_difference_pct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Disagreement analysis</h3>
          <div className="geo-audit-filters">
            <input placeholder="Difference category" value={cmpFilters.difference_category} onChange={(e) => setCmpFilters({ ...cmpFilters, difference_category: e.target.value })} />
            <input placeholder="Office" value={cmpFilters.office} onChange={(e) => setCmpFilters({ ...cmpFilters, office: e.target.value })} />
            <input placeholder="Emp ID" value={cmpFilters.emp_id} onChange={(e) => setCmpFilters({ ...cmpFilters, emp_id: e.target.value })} />
            <select value={cmpFilters.only_diff} onChange={(e) => setCmpFilters({ ...cmpFilters, only_diff: e.target.value })}>
              <option value="1">Mismatches only</option>
              <option value="0">All comparisons</option>
            </select>
            <button type="button" className="geo-btn" onClick={() => loadDisagreements(1)}>Search</button>
            <button type="button" className="geo-btn geo-btn--secondary" onClick={exportDisagreements}><Download size={14} /> CSV</button>
          </div>
          <div className="geo-table-wrap">
            <table className="geo-table geo-table--dense">
              <thead>
                <tr>
                  <th>Attempt</th><th>Time</th><th>Emp</th><th>Office</th>
                  <th>Legacy</th><th>V2</th><th>L Policy</th><th>V2 Policy</th>
                  <th>Dist L/V2</th><th>Conf</th><th>Acc</th><th>Device</th><th>Diff</th>
                </tr>
              </thead>
              <tbody>
                {(cmpDiffs?.rows || []).map((r) => (
                  <tr key={`${r.attempt_id}-${r.timestamp}`}>
                    <td>
                      <button type="button" className="geo-link" onClick={() => { setAttemptId(r.attempt_id); setTab('troubleshoot'); }}>
                        {String(r.attempt_id).slice(0, 8)}…
                      </button>
                    </td>
                    <td>{r.timestamp}</td>
                    <td>{r.emp_id || r.admin_id || '—'}</td>
                    <td>{r.office_name || '—'}</td>
                    <td>{r.legacy_decision}</td>
                    <td>{r.v2_decision}</td>
                    <td>{r.legacy_policy}</td>
                    <td>{r.v2_policy}</td>
                    <td>{r.legacy_distance_m ?? '—'}/{r.v2_distance_m ?? '—'}</td>
                    <td>{r.v2_confidence ?? '—'}</td>
                    <td>{r.accuracy_m ?? '—'}</td>
                    <td>{r.device_type || '—'}</td>
                    <td>{r.difference_category || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cmpDiffs ? (
            <div className="geo-pager">
              <button type="button" className="geo-btn geo-btn--secondary" disabled={cmpDiffPage <= 1} onClick={() => loadDisagreements(cmpDiffPage - 1)}>Prev</button>
              <span>Page {cmpDiffs.page} · {cmpDiffs.total} rows</span>
              <button type="button" className="geo-btn geo-btn--secondary" disabled={cmpDiffPage * cmpDiffs.page_size >= cmpDiffs.total} onClick={() => loadDisagreements(cmpDiffPage + 1)}>Next</button>
            </div>
          ) : null}
        </div>
      )}

      {tab === 'rollout' && rollout && (
        <div className="geo-panel">
          <div className={`geo-attention${rollout.readiness === 'READY FOR FULL ROLLOUT' ? '' : ''}`}>
            <Rocket size={16} /> Current mode: <strong>{rollout.current_engine_mode}</strong>
            &nbsp;· Readiness: <strong>{rollout.readiness}</strong>
          </div>
          <p className="geo-hint">{rollout.recommendation}</p>
          <div className="geo-metric-grid">
            <MetricCard label="Shadow comparisons" value={rollout.total_shadow_comparisons} />
            <MetricCard label="Decision match %" value={`${rollout.decision_match_pct}%`} />
            <MetricCard label="Policy match %" value={`${rollout.policy_match_pct}%`} />
            <MetricCard label="V2 error %" value={rollout.v2_error_rate_pct} />
            <MetricCard label="Legacy OUTSIDE" value={rollout.signals?.legacy_outside_count} />
            <MetricCard label="V2 OUTSIDE" value={rollout.signals?.v2_outside_count} />
            <MetricCard label="V2 reducing Outside?" value={rollout.signals?.v2_reducing_outside == null ? '—' : (rollout.signals.v2_reducing_outside ? 'Yes' : 'No')} />
          </div>
          <h3>Top difference categories</h3>
          <ul className="geo-rec-list">
            {(rollout.top_difference_categories || []).map((c) => (
              <li key={c.category} className="geo-rec"><strong>{c.category}</strong> — {c.count}</li>
            ))}
          </ul>
          <h3>Instant mode switch (no deploy)</h3>
          <div className="geo-audit-filters">
            <button type="button" className="geo-btn geo-btn--secondary" onClick={() => setEngineMode('LEGACY')}>LEGACY</button>
            <button type="button" className="geo-btn geo-btn--secondary" onClick={() => setEngineMode('SHADOW')}>SHADOW</button>
            <button type="button" className="geo-btn" onClick={() => setEngineMode('V2')}>V2</button>
          </div>
          {modeMsg ? <div className="geo-config-msg">{modeMsg}</div> : null}
          <p className="geo-hint">
            Rollback: set LEGACY immediately. Shadow never affects punch approval/rejection/geo reason.
          </p>
        </div>
      )}

      {tab === 'troubleshoot' && (
        <div className="geo-panel">
          <div className="geo-audit-filters">
            <input
              placeholder="Attempt ID"
              value={attemptId}
              onChange={(e) => setAttemptId(e.target.value)}
              style={{ minWidth: 280 }}
            />
            <button type="button" className="geo-btn" onClick={loadAttempt}>Explain</button>
          </div>
          {attemptDetail && (
            <>
              <h3>Final result</h3>
              <pre className="geo-pre">{JSON.stringify(attemptDetail.final_result, null, 2)}</pre>
              <h3>Decision pipeline</h3>
              {(attemptDetail.pipeline || []).map((step) => (
                <div key={step.step} className="geo-pipeline-step">
                  <strong>Step {step.step}: {step.name}</strong>
                  <pre className="geo-pre">{JSON.stringify(step.detail, null, 2)}</pre>
                </div>
              ))}
              <h3>Config snapshot (effective at explain time)</h3>
              <pre className="geo-pre">{JSON.stringify(attemptDetail.config_snapshot, null, 2)}</pre>
              <h3>Attempt record</h3>
              <pre className="geo-pre">{JSON.stringify(attemptDetail.attempt, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default GeoAnalytics;
