import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Users, Download } from 'lucide-react';
import './OrgChart.css';
import './OffboardingDashboard.css';

const HR_API_BASE = '/api/HumanResource';

function isUnassignedName(name) {
  return !name || String(name).trim().toLowerCase() === 'unassigned';
}

function OrgTreeL1({ node }) {
  const name = node.manager?.name || 'L1';
  const unassigned = isUnassignedName(name);
  return (
    <div className={`org-tree-l1${unassigned ? ' org-tree-l1--unassigned' : ''}`}>
      <div className="org-tree-l1-head">
        <div className="org-tree-level-title">
          <span className="org-tree-level-badge org-tree-level-badge--l1">L1</span>
          <strong>{name}</strong>
        </div>
        <span className="org-tree-count-pill">
          {node.report_count} report{node.report_count === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="org-tree-reports">
        {(node.reports || []).map((rep) => (
          <li key={rep.admin_id}>
            <span className="org-tree-avatar" aria-hidden>
              {(rep.name || '?').trim().charAt(0).toUpperCase()}
            </span>
            <div className="org-tree-person">
              <span className="org-tree-emp">{rep.name}</span>
              <span className="org-tree-meta">{rep.emp_id || '—'} · {rep.designation || '—'}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrgTreeL2({ node }) {
  const name = node.manager?.name || 'L2';
  const unassigned = isUnassignedName(name);
  return (
    <div className={`org-tree-l2${unassigned ? ' org-tree-l2--unassigned' : ''}`}>
      <div className="org-tree-l2-head">
        <div className="org-tree-level-title">
          <span className="org-tree-level-badge org-tree-level-badge--l2">L2</span>
          <strong>{name}</strong>
        </div>
      </div>
      <div className="org-tree-l2-children">
        {(node.children || []).map((child) => (
          <OrgTreeL1 key={child.manager?.admin_id ?? `l1-${child.report_count}`} node={child} />
        ))}
      </div>
    </div>
  );
}

function OrgTreeL3({ node }) {
  const name = node.manager?.name || 'L3';
  const unassigned = isUnassignedName(name);
  return (
    <div className={`org-tree-l3${unassigned ? ' org-tree-l3--unassigned' : ''}`}>
      <div className="org-tree-l3-head">
        <div className="org-tree-level-title">
          <span className="org-tree-level-badge org-tree-level-badge--l3">L3</span>
          <strong>{name}</strong>
        </div>
        <span className="org-tree-count-pill org-tree-count-pill--on-dark">
          {node.report_count} in hierarchy
        </span>
      </div>
      <div className="org-tree-l3-children">
        {(node.children || []).map((child) => (
          <OrgTreeL2 key={child.manager?.admin_id ?? `l2-${child.report_count}`} node={child} />
        ))}
      </div>
    </div>
  );
}

export const OrgChart = ({ onBack, circleOptions = [], empTypeOptions = [] }) => {
  const [circle, setCircle] = useState('');
  const [empType, setEmpType] = useState('');
  const [employees, setEmployees] = useState([]);
  const [tree, setTree] = useState([]);
  const [treeMultilevel, setTreeMultilevel] = useState([]);
  const [viewMode, setViewMode] = useState('tree');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (circle) params.set('circle', circle);
      if (empType) params.set('emp_type', empType);
      const res = await fetch(`${HR_API_BASE}/org-chart?${params}`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok && data.success) {
        setEmployees(data.employees || []);
        setTree(data.tree || []);
        setTreeMultilevel(data.tree_multilevel || []);
      } else {
        setError(data.message || 'Failed to load org chart');
        setEmployees([]);
      }
    } catch {
      setError('Network error');
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [circle, empType, getAuthHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (circle) params.set('circle', circle);
      if (empType) params.set('emp_type', empType);
      const res = await fetch(`${HR_API_BASE}/org-chart/export?${params}`, { headers: getAuthHeaders() });
      if (!res.ok) {
        setError('Failed to export org chart');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'org-chart.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('Failed to export org chart');
    }
  }, [circle, empType, getAuthHeaders]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const emp of employees) {
      const key = `${emp.circle || '—'}|${emp.emp_type || '—'}`;
      if (!map.has(key)) {
        map.set(key, { circle: emp.circle, emp_type: emp.emp_type, rows: [] });
      }
      map.get(key).rows.push(emp);
    }
    return Array.from(map.values());
  }, [employees]);

  return (
    <div className="ob-dash-container">
      <div className="ob-dash-wrapper hr-updates-shell">
        <div className="hr-updates-header">
          <button type="button" className="btn-back-updates" onClick={onBack}>
            <ArrowLeft size={16} /> Back to Updates
          </button>
          <div className="hr-updates-header__title">
            <h2><Users size={22} /> Organization Chart</h2>
            <p>Reporting hierarchy (L1 / L2 / L3) by circle and department.</p>
          </div>
          <button type="button" className="hr-updates-refresh" onClick={load} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button type="button" className="hr-updates-secondary" onClick={exportCsv} disabled={loading || employees.length === 0}>
            <Download size={16} /> Export CSV
          </button>
        </div>

        <div className="org-chart-filters">
          <label>
            Circle
            <select value={circle} onChange={(e) => setCircle(e.target.value)}>
              <option value="">All circles</option>
              {circleOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>
            Department
            <select value={empType} onChange={(e) => setEmpType(e.target.value)}>
              <option value="">All departments</option>
              {empTypeOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <div className="org-chart-view-toggle" role="group" aria-label="View mode">
            <button type="button" className={viewMode === 'tree' ? 'is-active' : ''} onClick={() => setViewMode('tree')}>Tree</button>
            <button type="button" className={viewMode === 'table' ? 'is-active' : ''} onClick={() => setViewMode('table')}>Table</button>
          </div>
        </div>

        {error ? <p className="hr-updates-error">{error}</p> : null}
        {loading ? <p className="hr-updates-loading">Loading org chart…</p> : null}

        {!loading && employees.length === 0 ? (
          <p className="hr-updates-empty">No employees match these filters.</p>
        ) : null}

        {!loading && viewMode === 'tree' && (treeMultilevel.length > 0 || tree.length > 0) ? (
          <div className="org-chart-tree-wrap">
            {treeMultilevel.length > 0 ? (
              treeMultilevel.map((node) => (
                <OrgTreeL3 key={node.manager?.admin_id ?? 'root'} node={node} />
              ))
            ) : (
              tree.map((node) => (
                <div key={node.manager?.admin_id ?? 'unassigned'} className="org-tree-node">
                  <div className="org-tree-manager">
                    <strong>{node.manager?.name || 'Unassigned'}</strong>
                    <span>{node.report_count} direct report{node.report_count === 1 ? '' : 's'}</span>
                  </div>
                  <ul className="org-tree-reports">
                    {node.reports.map((rep) => (
                      <li key={rep.admin_id}>
                        <span className="org-tree-emp">{rep.name}</span>
                        <span className="org-tree-meta">{rep.emp_id || '—'} · {rep.designation || '—'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        ) : null}

        {viewMode === 'table' && grouped.map((group) => (
          <div key={`${group.circle}-${group.emp_type}`} className="org-chart-group">
            <h3>{group.circle || '—'} · {group.emp_type || '—'} <span>({group.rows.length})</span></h3>
            <div className="org-chart-table-wrap">
              <table className="org-chart-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>ID</th>
                    <th>Designation</th>
                    <th>L1 Manager</th>
                    <th>L2 Manager</th>
                    <th>L3 Manager</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.admin_id}>
                      <td>
                        <div className="org-chart-emp">{row.name}</div>
                        <div className="org-chart-email">{row.email}</div>
                      </td>
                      <td>{row.emp_id || '—'}</td>
                      <td>{row.designation || '—'}</td>
                      <td>{row.managers?.l1?.name || '—'}</td>
                      <td>{row.managers?.l2?.name || '—'}</td>
                      <td>{row.managers?.l3?.name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OrgChart;
