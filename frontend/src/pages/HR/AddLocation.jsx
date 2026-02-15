import React, { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, Search, MapPin } from 'lucide-react';
import './AddLocation.css';

const HR_API_BASE = '/api/HumanResource';

export const AddLocation = ({ onBack }) => {
  const [form, setForm] = useState({ name: '', latitude: '', longitude: '', radius: '100' });
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchLocations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/locations`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok && data.success) {
        setLocations(data.locations || []);
      } else {
        setError(data.message || 'Failed to load locations');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
    setError('');
    setSuccess('');
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const name = (form.name || '').trim();
    if (!name) {
      setError('Location name is required');
      return;
    }
    setError('');
    setSuccess('');
    setSubmitLoading(true);
    try {
      const res = await fetch(`${HR_API_BASE}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          name: name,
          latitude: form.latitude ? parseFloat(form.latitude) : 0,
          longitude: form.longitude ? parseFloat(form.longitude) : 0,
          radius: form.radius ? parseFloat(form.radius) : 100,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Failed to add location');
        return;
      }
      setSuccess('Location added successfully');
      setForm({ name: '', latitude: '', longitude: '', radius: '100' });
      fetchLocations();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this location?')) return;
    setDeleteLoading(id);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/locations/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Failed to delete');
        return;
      }
      fetchLocations();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setDeleteLoading(null);
    }
  };

  return (
    <div className="location-page-wrapper">
      <div className="location-container">
        {/* Navigation Tab */}
        <button className="btn-back-tab" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="location-card">
          <div className="location-card-header">
            <h2>Manage Office Locations</h2>
            <Search size={20} className="header-icon-blue" />
          </div>

          <form className="search-section" onSubmit={handleAdd}>
            <div className="input-group">
              <label>Location Name</label>
              <input
                type="text"
                name="name"
                placeholder="Enter location name"
                value={form.name}
                onChange={handleChange}
              />
            </div>
            <div className="input-row">
              <div className="input-group flex-1">
                <label>Latitude</label>
                <input
                  type="text"
                  name="latitude"
                  placeholder="Latitude"
                  value={form.latitude}
                  onChange={handleChange}
                />
              </div>
              <div className="input-group flex-1">
                <label>Longitude</label>
                <input
                  type="text"
                  name="longitude"
                  placeholder="Longitude"
                  value={form.longitude}
                  onChange={handleChange}
                />
              </div>
            </div>
            <div className="input-group">
              <label>Radius (meters)</label>
              <input
                type="text"
                name="radius"
                placeholder="100"
                value={form.radius}
                onChange={handleChange}
              />
            </div>
            {error && <p className="location-error-msg">{error}</p>}
            {success && <p className="location-success-msg">{success}</p>}
            <button type="submit" className="btn-add-blue" disabled={submitLoading}>
              <MapPin size={18} /> {submitLoading ? 'Adding...' : 'Add Location'}
            </button>
          </form>

          <div className="results-section">
            <h3>Existing Locations</h3>
            {loading ? (
              <p className="location-loading">Loading...</p>
            ) : locations.length === 0 ? (
              <p className="location-empty">No locations added yet.</p>
            ) : (
              <div className="table-responsive">
                <table className="location-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Latitude</th>
                      <th>Longitude</th>
                      <th>Radius (m)</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((loc) => (
                      <tr key={loc.id}>
                        <td>{loc.name}</td>
                        <td>{loc.latitude}</td>
                        <td>{loc.longitude}</td>
                        <td>{loc.radius}</td>
                        <td>
                          <button
                            className="btn-delete-red"
                            onClick={() => handleDelete(loc.id)}
                            disabled={deleteLoading === loc.id}
                          >
                            {deleteLoading === loc.id ? 'Deleting...' : 'Delete'}
                          </button>
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
