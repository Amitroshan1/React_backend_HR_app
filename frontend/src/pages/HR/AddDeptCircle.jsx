import React, { useState, useCallback, useEffect } from 'react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { ArrowLeft } from 'lucide-react';
import { scrollAppToTop } from '../../utils/scrollToTop';
import '../Admin/AdminList.css';

const API_BASE = '/api/HumanResource/master';

/** Reserved — matches Admin panel emp_type values; HR must not create these as departments. */
const RESERVED_DEPARTMENTS = new Set(['admin', 'administrator', 'administration']);

const AddDeptCircle = ({ onBack, backLabel = 'Back to Updates' }) => {
  const [departments, setDepartments] = useState([]);
  const [circles, setCircles] = useState([]);
  
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [showCircleForm, setShowCircleForm] = useState(false);
  
  const [deptName, setDeptName] = useState('');
  const [circleName, setCircleName] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingType, setSavingType] = useState('');
  const [deletingKey, setDeletingKey] = useState('');
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    scrollAppToTop();
    const raf = requestAnimationFrame(() => scrollAppToTop());
    const t = window.setTimeout(() => scrollAppToTop(), 80);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, []);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchMasterRows = useCallback(async () => {
    setLoading(true);
    setMessage({ type: '', text: '' });
    try {
      const [depRes, circleRes] = await Promise.all([
        fetch(`${API_BASE}/department`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE}/circle`, { headers: getAuthHeaders() }),
      ]);

      const depData = await depRes.json().catch(() => ({}));
      const circleData = await circleRes.json().catch(() => ({}));

      if (!depRes.ok || !circleRes.ok) {
        const errMsg = depData.message || circleData.message || 'Failed to load department/circle data';
        setMessage({ type: 'error', text: errMsg });
        return;
      }

      setDepartments(depData.items || []);
      setCircles(circleData.items || []);
    } catch {
      setMessage({ type: 'error', text: 'Network error while loading data.' });
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useRefreshOnNavigate(() => {
    fetchMasterRows();
  });

  // Handle Add Department button click
  const handleAddDeptClick = () => {
    setShowDeptForm(true);
    setShowCircleForm(false);
    setDeptName('');
  };

  // Handle Add Circle button click
  const handleAddCircleClick = () => {
    setShowCircleForm(true);
    setShowDeptForm(false);
    setCircleName('');
  };

  // Handle Department form submission
  const handleDeptSubmit = async (e) => {
    e.preventDefault();
    
    const name = deptName.trim();
    if (name === '') {
      setMessage({ type: 'error', text: 'Please enter a department name' });
      return;
    }
    if (RESERVED_DEPARTMENTS.has(name.toLowerCase())) {
      setMessage({
        type: 'error',
        text: 'Admin cannot be added as a department. This value is reserved for system administrators.',
      });
      return;
    }

    setSavingType('department');
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch(`${API_BASE}/department`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: 'error', text: data.message || 'Failed to add department' });
        return;
      }
      setDeptName('');
      setShowDeptForm(false);
      setMessage({ type: 'success', text: data.message || 'Department added successfully' });
      await fetchMasterRows();
    } catch {
      setMessage({ type: 'error', text: 'Network error while adding department.' });
    } finally {
      setSavingType('');
    }
  };

  // Handle Circle form submission
  const handleCircleSubmit = async (e) => {
    e.preventDefault();
    
    if (circleName.trim() === '') {
      alert('Please enter a circle name');
      return;
    }

    setSavingType('circle');
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch(`${API_BASE}/circle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ name: circleName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: 'error', text: data.message || 'Failed to add circle' });
        return;
      }
      setCircleName('');
      setShowCircleForm(false);
      setMessage({ type: 'success', text: data.message || 'Circle added successfully' });
      await fetchMasterRows();
    } catch {
      setMessage({ type: 'error', text: 'Network error while adding circle.' });
    } finally {
      setSavingType('');
    }
  };

  // Handle Department removal
  const handleRemoveDept = async (deptId) => {
    if (window.confirm('Are you sure you want to remove this department?')) {
      setDeletingKey(`department-${deptId}`);
      setMessage({ type: '', text: '' });
      try {
        const res = await fetch(`${API_BASE}/department/${deptId}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessage({ type: 'error', text: data.message || 'Failed to delete department' });
          return;
        }
        setMessage({ type: 'success', text: data.message || 'Department deleted successfully' });
        await fetchMasterRows();
      } catch {
        setMessage({ type: 'error', text: 'Network error while deleting department.' });
      } finally {
        setDeletingKey('');
      }
    }
  };

  // Handle Circle removal
  const handleRemoveCircle = async (circleId) => {
    if (window.confirm('Are you sure you want to remove this circle?')) {
      setDeletingKey(`circle-${circleId}`);
      setMessage({ type: '', text: '' });
      try {
        const res = await fetch(`${API_BASE}/circle/${circleId}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessage({ type: 'error', text: data.message || 'Failed to delete circle' });
          return;
        }
        setMessage({ type: 'success', text: data.message || 'Circle deleted successfully' });
        await fetchMasterRows();
      } catch {
        setMessage({ type: 'error', text: 'Network error while deleting circle.' });
      } finally {
        setDeletingKey('');
      }
    }
  };

  // Handle form cancel
  const handleCancel = () => {
    setShowDeptForm(false);
    setShowCircleForm(false);
    setDeptName('');
    setCircleName('');
  };

  return (
    <div className="admin-list-container">
      {onBack ? (
        <button type="button" className="admin-master-back" onClick={onBack}>
          <ArrowLeft size={16} />
          {backLabel}
        </button>
      ) : null}
      <div className="admin-list-header">
        <div>
          <h1>Departments & circles</h1>
          <p className="admin-list-copy">Add the departments and circles this company can assign to employees.</p>
        </div>
        <div className="admin-master-actions">
          <button type="button" className="admin-list-view-btn" onClick={handleAddDeptClick}>Add department</button>
          <button type="button" className="admin-master-secondary" onClick={handleAddCircleClick}>Add circle</button>
        </div>
      </div>

      {message.text ? (
        <p className={message.type === 'error' ? 'admin-master-alert' : 'admin-master-notice'} role={message.type === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}

      {showDeptForm ? (
        <form className="admin-master-form" onSubmit={handleDeptSubmit}>
          <label htmlFor="new-department">Department name</label>
          <input
            id="new-department"
            type="text"
            placeholder="Engineering"
            value={deptName}
            onChange={(e) => setDeptName(e.target.value)}
            autoFocus
          />
          <button type="submit" className="admin-list-view-btn" disabled={savingType === 'department'}>
            {savingType === 'department' ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="admin-master-secondary" onClick={handleCancel}>Cancel</button>
        </form>
      ) : null}

      {showCircleForm ? (
        <form className="admin-master-form" onSubmit={handleCircleSubmit}>
          <label htmlFor="new-circle">Circle name</label>
          <input
            id="new-circle"
            type="text"
            placeholder="North"
            value={circleName}
            onChange={(e) => setCircleName(e.target.value)}
            autoFocus
          />
          <button type="submit" className="admin-list-view-btn" disabled={savingType === 'circle'}>
            {savingType === 'circle' ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="admin-master-secondary" onClick={handleCancel}>Cancel</button>
        </form>
      ) : null}

      <div className="admin-master-grid">
        <section>
          <h2>Departments <span>{departments.length}</span></h2>
          <div className="admin-list-table-wrap admin-master-table">
            <table className="admin-list-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="2">Loading…</td></tr>
                ) : departments.length === 0 ? (
                  <tr><td colSpan="2">No departments yet.</td></tr>
                ) : departments.map((dept) => (
                  <tr key={dept.id}>
                    <td>{dept.name}</td>
                    <td>
                      <button
                        type="button"
                        className="admin-master-remove"
                        onClick={() => handleRemoveDept(dept.id)}
                        disabled={deletingKey === `department-${dept.id}`}
                      >
                        {deletingKey === `department-${dept.id}` ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2>Circles <span>{circles.length}</span></h2>
          <div className="admin-list-table-wrap admin-master-table">
            <table className="admin-list-table">
              <thead>
                <tr>
                  <th>Circle</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="2">Loading…</td></tr>
                ) : circles.length === 0 ? (
                  <tr><td colSpan="2">No circles yet.</td></tr>
                ) : circles.map((circle) => (
                  <tr key={circle.id}>
                    <td>{circle.name}</td>
                    <td>
                      <button
                        type="button"
                        className="admin-master-remove"
                        onClick={() => handleRemoveCircle(circle.id)}
                        disabled={deletingKey === `circle-${circle.id}`}
                      >
                        {deletingKey === `circle-${circle.id}` ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

export default AddDeptCircle;