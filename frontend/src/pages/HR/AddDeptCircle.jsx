import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, X, ArrowLeft } from 'lucide-react';
import './AddDeptCircle.css';

const API_BASE = '/api/HumanResource/master';

const AddDeptCircle = ({ onBack }) => {
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

  useEffect(() => {
    fetchMasterRows();
  }, [fetchMasterRows]);

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
    
    if (deptName.trim() === '') {
      alert('Please enter a department name');
      return;
    }

    setSavingType('department');
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch(`${API_BASE}/department`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ name: deptName.trim() }),
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
    <div className="add-dept-circle-container">
      <div className="add-dept-circle-wrapper">
        {/* Back Button */}
        {onBack && (
          <button className="btn-back-updates" onClick={onBack}>
            <ArrowLeft size={16} /> Back to Updates
          </button>
        )}
        
        {/* Page Heading */}
        <div className="page-header">
          <h1 className="page-heading">Department & Circle Management</h1>
        </div>
        {message.text && (
          <div style={{ marginBottom: '12px', padding: '10px 12px', borderRadius: '8px', background: message.type === 'error' ? '#fef2f2' : '#dcfce7', color: message.type === 'error' ? '#b91c1c' : '#166534' }}>
            {message.text}
          </div>
        )}

        {/* Action Buttons */}
        <div className="action-buttons">
          <button 
            className="add-button add-dept-button" 
            onClick={handleAddDeptClick}
          >
            <Plus size={20} />
            Add Department
          </button>
          <button 
            className="add-button add-circle-button" 
            onClick={handleAddCircleClick}
          >
            <Plus size={20} />
            Add Circle
          </button>
        </div>

        {/* Forms Section */}
        {(showDeptForm || showCircleForm) && (
          <div className="form-container">
            {showDeptForm && (
              <form className="input-form" onSubmit={handleDeptSubmit}>
                <div className="form-header">
                  <h3>Add New Department</h3>
                  <button 
                    type="button" 
                    className="close-button" 
                    onClick={handleCancel}
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="form-body">
                  <input
                    type="text"
                    placeholder="Enter department name"
                    value={deptName}
                    onChange={(e) => setDeptName(e.target.value)}
                    className="form-input"
                    autoFocus
                  />
                  <div className="form-actions">
                    <button type="submit" className="submit-button" disabled={savingType === 'department'}>
                      {savingType === 'department' ? 'Submitting...' : 'Submit'}
                    </button>
                    <button 
                      type="button" 
                      className="cancel-button" 
                      onClick={handleCancel}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            )}

            {showCircleForm && (
              <form className="input-form" onSubmit={handleCircleSubmit}>
                <div className="form-header">
                  <h3>Add New Circle</h3>
                  <button 
                    type="button" 
                    className="close-button" 
                    onClick={handleCancel}
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="form-body">
                  <input
                    type="text"
                    placeholder="Enter circle name"
                    value={circleName}
                    onChange={(e) => setCircleName(e.target.value)}
                    className="form-input"
                    autoFocus
                  />
                  <div className="form-actions">
                    <button type="submit" className="submit-button" disabled={savingType === 'circle'}>
                      {savingType === 'circle' ? 'Submitting...' : 'Submit'}
                    </button>
                    <button 
                      type="button" 
                      className="cancel-button" 
                      onClick={handleCancel}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Two Column Layout */}
        <div className="content-grid">
          {/* Left Section - Departments */}
          <div className="card-container">
            <div className="card-header">
              <h2>Departments</h2>
              <span className="count-badge">{departments.length}</span>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="2" className="no-data">
                        Loading...
                      </td>
                    </tr>
                  ) : departments.length === 0 ? (
                    <tr>
                      <td colSpan="2" className="no-data">
                        No departments added yet
                      </td>
                    </tr>
                  ) : (
                    departments.map((dept) => (
                      <tr key={dept.id}>
                        <td className="item-name">{dept.name}</td>
                        <td>
                          <button
                            className="remove-button"
                            onClick={() => handleRemoveDept(dept.id)}
                            title="Remove department"
                            disabled={deletingKey === `department-${dept.id}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Section - Circles */}
          <div className="card-container">
            <div className="card-header">
              <h2>Circles</h2>
              <span className="count-badge">{circles.length}</span>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Circle</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="2" className="no-data">
                        Loading...
                      </td>
                    </tr>
                  ) : circles.length === 0 ? (
                    <tr>
                      <td colSpan="2" className="no-data">
                        No circles added yet
                      </td>
                    </tr>
                  ) : (
                    circles.map((circle) => (
                      <tr key={circle.id}>
                        <td className="item-name">{circle.name}</td>
                        <td>
                          <button
                            className="remove-button"
                            onClick={() => handleRemoveCircle(circle.id)}
                            title="Remove circle"
                            disabled={deletingKey === `circle-${circle.id}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddDeptCircle;