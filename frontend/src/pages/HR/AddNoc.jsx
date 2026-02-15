import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, Upload, FileText, RefreshCw } from 'lucide-react';
import './AddNoc.css';

const HR_API_BASE = '/api/HumanResource';

export const AddNoc = ({ onBack }) => {
  const [nocList, setNocList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadLoading, setUploadLoading] = useState(null);
  const [createLoading, setCreateLoading] = useState(null);
  const fileInputRef = useRef(null);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchNocList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${HR_API_BASE}/noc`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok && data.success) {
        setNocList(data.noc_list || []);
      } else {
        setNocList([]);
      }
    } catch {
      setNocList([]);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchNocList();
  }, [fetchNocList]);

  const handleCreateNoc = async (adminId) => {
    setCreateLoading(adminId);
    try {
      const res = await fetch(`${HR_API_BASE}/noc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ admin_id: adminId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || 'Failed to create NOC');
        return;
      }
      fetchNocList();
    } catch {
      alert('Network error');
    } finally {
      setCreateLoading(null);
    }
  };

  const handleUploadClick = (adminId) => {
    fileInputRef.current?.setAttribute('data-admin-id', adminId);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const adminId = fileInputRef.current?.getAttribute('data-admin-id');
    if (!adminId) return;
    e.target.value = '';
    setUploadLoading(parseInt(adminId, 10));
    try {
      const formData = new FormData();
      formData.append('admin_id', adminId);
      formData.append('file', file);
      const res = await fetch(`${HR_API_BASE}/noc/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || 'Upload failed');
        return;
      }
      fetchNocList();
    } catch {
      alert('Network error');
    } finally {
      setUploadLoading(null);
    }
  };

  return (
    <div className="noc-info-wrapper">
      <div className="noc-info-container">
        <button className="btn-back-tab" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="noc-info-card">
          <div className="noc-info-header">
            <div className="noc-header-left">
              <FileText size={24} className="noc-header-icon" />
              <div>
                <h2>NOC – No Objection Certificate</h2>
                <p className="noc-header-subtitle">
                  Employees who submitted separation/resignation form. Take NOC action below.
                </p>
              </div>
            </div>
            <button
              className="btn-refresh-noc"
              onClick={fetchNocList}
              disabled={loading}
            >
              <RefreshCw size={18} /> Refresh
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          <div className="noc-table-section">
            {loading ? (
              <div className="noc-loading-state">
                <div className="noc-spinner" />
                <p>Loading separation requests...</p>
              </div>
            ) : nocList.length === 0 ? (
              <div className="noc-empty-state">
                <FileText size={48} className="noc-empty-icon" />
                <h3>No separation requests</h3>
                <p>When employees submit resignation via the Separation page, they will appear here for NOC processing.</p>
              </div>
            ) : (
              <div className="noc-table-wrapper">
                <table className="noc-dynamic-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Emp ID</th>
                      <th>Resignation Date</th>
                      <th>Reason</th>
                      <th>NOC Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nocList.map((item, index) => (
                      <tr key={item.resignation_id || item.admin_id}>
                        <td className="noc-index-col">{index + 1}</td>
                        <td className="noc-name-col">{item.name || 'N/A'}</td>
                        <td>{item.emp_id || 'N/A'}</td>
                        <td>{item.resignation_date || '–'}</td>
                        <td className="noc-reason-col">
                          <span title={item.reason || ''}>
                            {(item.reason || '–').slice(0, 50)}
                            {(item.reason || '').length > 50 ? '...' : ''}
                          </span>
                        </td>
                        <td>
                          <span className={`noc-status-badge noc-status-${(item.noc_status || '').toLowerCase().replace(' ', '-')}`}>
                            {item.noc_status || 'No NOC'}
                          </span>
                        </td>
                        <td>
                          {item.noc_status === 'Uploaded' ? (
                            <span className="noc-action-done">Uploaded</span>
                          ) : item.noc_status === 'No NOC' ? (
                            <button
                              className="btn-noc-create"
                              onClick={() => handleCreateNoc(item.admin_id)}
                              disabled={createLoading === item.admin_id}
                            >
                              {createLoading === item.admin_id ? 'Creating...' : 'Create NOC'}
                            </button>
                          ) : (
                            <button
                              className="btn-noc-upload"
                              onClick={() => handleUploadClick(item.admin_id)}
                              disabled={uploadLoading === item.admin_id}
                            >
                              <Upload size={16} />
                              {uploadLoading === item.admin_id ? ' Uploading...' : ' Upload NOC'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
