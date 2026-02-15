import React, { useState, useCallback } from 'react';
import { ArrowLeft, Search, Upload, Plus } from 'lucide-react';
import './AddAssets.css';

const HR_API_BASE = '/api/HumanResource';

export const AddAssets = ({ onBack }) => {
  const [employeeId, setEmployeeId] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [employee, setEmployee] = useState(null);
  const [assets, setAssets] = useState([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', description: '', remark: '' });
  const [addImages, setAddImages] = useState([]);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState(false);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchAssets = useCallback(async (adminId) => {
    if (!adminId) return;
    setAssetsLoading(true);
    try {
      const res = await fetch(`${HR_API_BASE}/employee/${adminId}/assets`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAssets(data.assets || []);
      } else {
        setAssets([]);
      }
    } catch {
      setAssets([]);
    } finally {
      setAssetsLoading(false);
    }
  }, [getAuthHeaders]);

  const handleSearch = useCallback(async () => {
    const id = (employeeId || '').trim();
    if (!id) {
      setSearchError('Please enter Employee ID');
      return;
    }
    setSearchError('');
    setEmployee(null);
    setAssets([]);
    setSearchLoading(true);
    try {
      const res = await fetch(`${HR_API_BASE}/employee/lookup?emp_id=${encodeURIComponent(id)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.message || 'Employee not found');
        return;
      }
      if (data.success && data.employee) {
        setEmployee(data.employee);
        fetchAssets(data.employee.admin_id);
      } else {
        setSearchError('Employee not found');
      }
    } catch {
      setSearchError('Network error. Please try again.');
    } finally {
      setSearchLoading(false);
    }
  }, [employeeId, getAuthHeaders, fetchAssets]);

  const handleAddAsset = async (e) => {
    e.preventDefault();
    if (!employee?.admin_id) return;
    const name = (addForm.name || '').trim();
    if (!name) {
      setAddError('Asset name is required');
      return;
    }
    setAddError('');
    setAddSuccess(false);
    setAddSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('admin_id', employee.admin_id);
      formData.append('name', name);
      formData.append('description', (addForm.description || '').trim());
      formData.append('remark', (addForm.remark || '').trim());
      addImages.forEach((file) => {
        if (file) formData.append('images', file);
      });

      const res = await fetch(`${HR_API_BASE}/assign-asset`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.message || 'Failed to assign asset');
        return;
      }
      setAddSuccess(true);
      setAddForm({ name: '', description: '', remark: '' });
      setAddImages([]);
      setShowAddForm(false);
      fetchAssets(employee.admin_id);
    } catch {
      setAddError('Network error. Please try again.');
    } finally {
      setAddSubmitting(false);
    }
  };

  return (
    <div className="assets-page-wrapper">
      <div className="assets-container">
        <button className="btn-back-link" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="assets-card">
          <div className="assets-card-header">
            <h2>Add Assets</h2>
            <Search size={20} className="header-search-icon" />
          </div>

          <div className="search-section">
            <h3>Search Employee</h3>
            <label>Employee ID</label>
            <div className="search-input-group">
              <input
                type="text"
                value={employeeId}
                onChange={(e) => { setEmployeeId(e.target.value); setSearchError(''); }}
                placeholder="Enter Employee ID"
              />
              <button
                className="btn-search-blue"
                onClick={handleSearch}
                disabled={searchLoading}
              >
                {searchLoading ? 'Searching...' : 'Search'}
              </button>
            </div>
            {searchError && <p className="assets-error-msg">{searchError}</p>}
            <p className="sub-label">Search to add assets</p>
          </div>

          {employee && (
            <div className="employee-details-section">
              <h3>Employee Details</h3>
              <table className="details-table">
                <tbody>
                  <tr>
                    <td className="label-cell">Name</td>
                    <td className="value-cell">{employee.name || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="label-cell">Employee Type</td>
                    <td className="value-cell">{employee.emp_type || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="label-cell">Circle</td>
                    <td className="value-cell">{employee.circle || 'N/A'}</td>
                  </tr>
                </tbody>
              </table>

              <h4 className="assets-list-title">Assigned Assets</h4>
              {assetsLoading ? (
                <p className="assets-loading">Loading assets...</p>
              ) : assets.length === 0 ? (
                <p className="assets-empty">No assets assigned yet.</p>
              ) : (
                <ul className="assets-list">
                  {assets.map((a) => (
                    <li key={a.id} className="asset-item">
                      <span className="asset-name">{a.name}</span>
                      {a.description && <span className="asset-desc"> – {a.description}</span>}
                    </li>
                  ))}
                </ul>
              )}

              <div className="assets-footer">
                {!showAddForm ? (
                  <button className="btn-add-asset" onClick={() => setShowAddForm(true)}>
                    <Plus size={18} /> Add Asset
                  </button>
                ) : (
                  <form className="add-asset-form" onSubmit={handleAddAsset}>
                    <h4>Add New Asset</h4>
                    {addError && <p className="assets-error-msg">{addError}</p>}
                    {addSuccess && <p className="assets-success-msg">Asset assigned successfully.</p>}
                    <div className="form-row">
                      <label>Asset Name <span className="required">*</span></label>
                      <input
                        type="text"
                        value={addForm.name}
                        onChange={(e) => setAddForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Laptop, ID Card"
                        required
                      />
                    </div>
                    <div className="form-row">
                      <label>Description</label>
                      <input
                        type="text"
                        value={addForm.description}
                        onChange={(e) => setAddForm((p) => ({ ...p, description: e.target.value }))}
                        placeholder="Optional description"
                      />
                    </div>
                    <div className="form-row">
                      <label>Remark</label>
                      <input
                        type="text"
                        value={addForm.remark}
                        onChange={(e) => setAddForm((p) => ({ ...p, remark: e.target.value }))}
                        placeholder="Optional remark"
                      />
                    </div>
                    <div className="form-row">
                      <label>Images (optional)</label>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => setAddImages(Array.from(e.target.files || []))}
                      />
                    </div>
                    <div className="form-actions">
                      <button type="submit" className="btn-add-asset" disabled={addSubmitting}>
                        {addSubmitting ? 'Assigning...' : 'Assign Asset'}
                      </button>
                      <button
                        type="button"
                        className="btn-cancel"
                        onClick={() => {
                          setShowAddForm(false);
                          setAddForm({ name: '', description: '', remark: '' });
                          setAddImages([]);
                          setAddError('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
