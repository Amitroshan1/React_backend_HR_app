import React, { useState, useCallback } from 'react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { useNavigate, useLocation } from 'react-router-dom';
import './AdminDeploymentGuide.css';

const API_ACCESS = '/api/admin/deployment-guide/access';
const API_GUIDE = '/api/admin/deployment-guide';
const STORAGE_KEY = 'hrms_deployment_checklist_v1';

function loadChecked() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveChecked(map) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export default function AdminDeploymentGuide() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = location.state || {};
  const [guide, setGuide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(loadChecked);
  const [customerName, setCustomerName] = useState(prefill.customerName || '');
  const [customerPlan, setCustomerPlan] = useState(prefill.customerPlan || 'essential');
  const [customerUrl, setCustomerUrl] = useState(prefill.customerUrl || '');
  const [customerDb, setCustomerDb] = useState(prefill.customerDb || '');

  const token = () => localStorage.getItem('token');
  const headers = () => ({
    Authorization: `Bearer ${token()}`,
  });

  const loadGuide = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const accessRes = await fetch(API_ACCESS, { headers: headers() });
      const accessData = await accessRes.json().catch(() => ({}));
      if (!accessRes.ok || !accessData.can_view_deployment_guide) {
        navigate('/admin', { replace: true });
        return;
      }
      const res = await fetch(API_GUIDE, { headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to load guide');
      }
      setGuide(data.guide);
    } catch (err) {
      setError(err.message || 'Failed to load deployment guide');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useRefreshOnNavigate(() => {
    loadGuide();
  });

  const toggleItem = (sectionId, index) => {
    const key = `${sectionId}:${index}`;
    setChecked((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveChecked(next);
      return next;
    });
  };

  const resetProgress = () => {
    if (!window.confirm('Clear all checklist progress on this browser?')) return;
    setChecked({});
    saveChecked({});
  };

  const progressForSection = (section) => {
    const total = section.items.length;
    const done = section.items.filter((_, i) => checked[`${section.id}:${i}`]).length;
    return { done, total };
  };

  const totalProgress = () => {
    if (!guide?.sections) return { done: 0, total: 0 };
    let done = 0;
    let total = 0;
    guide.sections.forEach((s) => {
      const p = progressForSection(s);
      done += p.done;
      total += p.total;
    });
    return { done, total };
  };

  if (loading) {
    return (
      <div className="deploy-guide-page">
        <p className="deploy-guide-muted">Loading deployment guide…</p>
      </div>
    );
  }

  if (error || !guide) {
    return (
      <div className="deploy-guide-page">
        <p className="deploy-guide-error">{error || 'Guide unavailable'}</p>
        <button type="button" className="deploy-guide-back" onClick={() => navigate('/admin/customers')}>
          ← Customers
        </button>
      </div>
    );
  }

  const { done, total } = totalProgress();

  return (
    <div className="deploy-guide-page">
      <div className="deploy-guide-header">
        <button type="button" className="deploy-guide-back" onClick={() => navigate('/admin/customers')}>
          ← Customers
        </button>
        <h1>{guide.title}</h1>
        <p className="deploy-guide-sub">{guide.subtitle}</p>
        <div className="deploy-guide-progress-bar">
          <div
            className="deploy-guide-progress-fill"
            style={{ width: total ? `${(done / total) * 100}%` : '0%' }}
          />
        </div>
        <p className="deploy-guide-progress-text">
          Checklist: {done} / {total} completed
          <button type="button" className="deploy-guide-reset" onClick={resetProgress}>
            Reset progress
          </button>
        </p>
      </div>

      <div className="deploy-guide-customer-card">
        <h2>Customer record (for your notes)</h2>
        <div className="deploy-guide-customer-grid">
          <label>
            Company name
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Acme Corp"
            />
          </label>
          <label>
            Plan
            <select value={customerPlan} onChange={(e) => setCustomerPlan(e.target.value)}>
              {(guide.plans || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Login URL
            <input
              type="url"
              value={customerUrl}
              onChange={(e) => setCustomerUrl(e.target.value)}
              placeholder="https://hr.acme.com"
            />
          </label>
          <label>
            Database name
            <input
              type="text"
              value={customerDb}
              onChange={(e) => setCustomerDb(e.target.value)}
              placeholder="hrms_acme"
            />
          </label>
        </div>
        {customerName && (
          <p className="deploy-guide-customer-summary">
            Deploying <strong>{customerName}</strong> ({customerPlan})
            {customerUrl ? ` at ${customerUrl}` : ''}
            {customerDb ? ` · DB: ${customerDb}` : ''}
          </p>
        )}
      </div>

      <div className="deploy-guide-sections">
        {guide.sections.map((section) => {
          const p = progressForSection(section);
          return (
            <section key={section.id} className="deploy-guide-section">
              <h3>
                {section.title}
                <span className="deploy-guide-section-count">
                  {p.done}/{p.total}
                </span>
              </h3>
              <ul className="deploy-guide-checklist">
                {section.items.map((item, index) => {
                  const key = `${section.id}:${index}`;
                  const isDone = Boolean(checked[key]);
                  return (
                    <li key={key} className={isDone ? 'done' : ''}>
                      <label>
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => toggleItem(section.id, index)}
                        />
                        <span>{item}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {guide.env_template?.length > 0 && (
        <div className="deploy-guide-env-card">
          <h2>Environment variables (per customer)</h2>
          <table className="deploy-guide-env-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Hint</th>
              </tr>
            </thead>
            <tbody>
              {guide.env_template.map((row) => (
                <tr key={row.key}>
                  <td>
                    <code>{row.key}</code>
                  </td>
                  <td>{row.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {guide.plans?.length > 0 && (
        <div className="deploy-guide-plans-card">
          <h2>Plans reference</h2>
          <ul>
            {guide.plans.map((p) => (
              <li key={p.id}>
                <strong>{p.label}</strong> — {p.notes}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="deploy-guide-footer">
        Full document: <code>docs/NEW_CUSTOMER_DEPLOYMENT.md</code> in the repository.
      </p>
    </div>
  );
}
