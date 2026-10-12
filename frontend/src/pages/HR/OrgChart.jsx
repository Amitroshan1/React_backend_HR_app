import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react';
import './OrgChart.css';

const HR_API_BASE = '/api/HumanResource';

function isUnassignedName(name) {
  return !name || String(name).trim().toLowerCase() === 'unassigned';
}

function personMeta(person) {
  const parts = [person?.emp_id, person?.designation].filter(Boolean);
  return parts.join(' · ');
}

function ChartBranch({ level, name, meta, count, unassigned, children }) {
  const hasKids = Array.isArray(children) && children.length > 0;
  return (
    <li>
      <article className={`orgx-node orgx-node--${level}${unassigned ? ' is-unassigned' : ''}`}>
        <span className="orgx-node__level">{level === 'emp' ? 'Employee' : level.toUpperCase()}</span>
        <strong>{name}</strong>
        {meta ? <span className="orgx-node__meta">{meta}</span> : null}
        {count ? <span className="orgx-node__count">{count}</span> : null}
      </article>
      {hasKids ? <ul>{children}</ul> : null}
    </li>
  );
}

function reportCountLabel(count, noun) {
  if (!count) return '';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function buildForest(treeMultilevel, tree) {
  if (treeMultilevel.length > 0) {
    return treeMultilevel.map((l3, l3Index) => (
      <ChartBranch
        key={`l3-${l3.manager?.admin_id ?? 'none'}-${l3Index}`}
        level="l3"
        name={l3.manager?.name || 'L3'}
        meta={isUnassignedName(l3.manager?.name) ? 'No L3 assigned' : (l3.manager?.email || '')}
        count={reportCountLabel(l3.report_count, 'person')}
        unassigned={isUnassignedName(l3.manager?.name)}
      >
        {(l3.children || []).map((l2, l2Index) => (
          <ChartBranch
            key={`l2-${l2.manager?.admin_id ?? 'none'}-${l3Index}-${l2Index}`}
            level="l2"
            name={l2.manager?.name || 'L2'}
            meta={isUnassignedName(l2.manager?.name) ? 'No L2 assigned' : (l2.manager?.email || '')}
            count={reportCountLabel(l2.report_count, 'person')}
            unassigned={isUnassignedName(l2.manager?.name)}
          >
            {(l2.children || []).map((l1, l1Index) => (
              <ChartBranch
                key={`l1-${l1.manager?.admin_id ?? 'none'}-${l3Index}-${l2Index}-${l1Index}`}
                level="l1"
                name={l1.manager?.name || 'L1'}
                meta={isUnassignedName(l1.manager?.name) ? 'No L1 assigned' : (l1.manager?.email || '')}
                count={reportCountLabel(l1.report_count, 'report')}
                unassigned={isUnassignedName(l1.manager?.name)}
              >
                {(l1.reports || []).map((rep) => (
                  <ChartBranch
                    key={`emp-${rep.admin_id}`}
                    level="emp"
                    name={rep.name || 'Employee'}
                    meta={personMeta(rep) || rep.email || ''}
                  />
                ))}
              </ChartBranch>
            ))}
          </ChartBranch>
        ))}
      </ChartBranch>
    ));
  }

  return tree.map((node, index) => (
    <ChartBranch
      key={`root-${node.manager?.admin_id ?? 'none'}-${index}`}
      level="l1"
      name={node.manager?.name || 'Unassigned'}
      meta={node.manager?.email || ''}
      count={reportCountLabel(node.report_count, 'report')}
      unassigned={isUnassignedName(node.manager?.name)}
    >
      {(node.reports || []).map((rep) => (
        <ChartBranch
          key={`emp-${rep.admin_id}`}
          level="emp"
          name={rep.name || 'Employee'}
          meta={personMeta(rep) || rep.email || ''}
        />
      ))}
    </ChartBranch>
  ));
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
        setTree([]);
        setTreeMultilevel([]);
      }
    } catch {
      setError('Network error');
      setEmployees([]);
      setTree([]);
      setTreeMultilevel([]);
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

  const forest = useMemo(
    () => buildForest(treeMultilevel, tree),
    [treeMultilevel, tree],
  );

  return (
    <div className="orgx">
      <button type="button" className="orgx-back" onClick={onBack}>
        <ArrowLeft size={16} />
        Back
      </button>
      <header className="orgx-head">
        <div>
          <h1>Organization chart</h1>
          <p>Reporting lines from L3 down to each employee. Scroll sideways when a branch is wide.</p>
        </div>
        <div className="orgx-head__actions">
          <button type="button" className="orgx-btn orgx-btn--ghost" onClick={load} disabled={loading}>
            <RefreshCw size={15} />
            Refresh
          </button>
          <button type="button" className="orgx-btn" onClick={exportCsv} disabled={loading || employees.length === 0}>
            <Download size={15} />
            Export CSV
          </button>
        </div>
      </header>

      <div className="orgx-stats">
        <span><strong>{employees.length}</strong> people</span>
        <span><strong>{treeMultilevel.length || tree.length}</strong> reporting lines</span>
      </div>

      <div className="orgx-toolbar">
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
        <div className="orgx-toggle" role="group" aria-label="View mode">
          <button type="button" className={viewMode === 'tree' ? 'is-active' : ''} onClick={() => setViewMode('tree')}>Tree</button>
          <button type="button" className={viewMode === 'table' ? 'is-active' : ''} onClick={() => setViewMode('table')}>Table</button>
        </div>
        <div className="orgx-legend" aria-hidden>
          <span className="orgx-legend__swatch orgx-legend__swatch--l3">L3</span>
          <span className="orgx-legend__swatch orgx-legend__swatch--l2">L2</span>
          <span className="orgx-legend__swatch orgx-legend__swatch--l1">L1</span>
          <span className="orgx-legend__swatch orgx-legend__swatch--emp">Employee</span>
        </div>
      </div>

      {error ? <p className="orgx-banner orgx-banner--error" role="alert">{error}</p> : null}

      {loading ? <p className="orgx-empty">Loading organization chart…</p> : null}

      {!loading && employees.length === 0 ? (
        <p className="orgx-empty">No employees match these filters.</p>
      ) : null}

      {!loading && viewMode === 'tree' && forest.length > 0 ? (
        <div className="orgx-canvas">
          <div className="orgx-forest">
            {forest.map((branch, index) => (
              <div className="orgx-tree" key={branch.key || `line-${index}`}>
                <ul>{branch}</ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && viewMode === 'table' && grouped.map((group) => (
        <section key={`${group.circle}-${group.emp_type}`} className="orgx-group">
          <h2>{group.circle || '—'} · {group.emp_type || '—'} <span>{group.rows.length}</span></h2>
          <div className="orgx-table-wrap">
            <table className="orgx-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>ID</th>
                  <th>Designation</th>
                  <th>L1</th>
                  <th>L2</th>
                  <th>L3</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.admin_id}>
                    <td>
                      <strong>{row.name}</strong>
                      <span>{row.email}</span>
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
        </section>
      ))}
    </div>
  );
};

export default OrgChart;
