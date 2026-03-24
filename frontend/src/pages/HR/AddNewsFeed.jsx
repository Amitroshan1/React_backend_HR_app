import React, { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import './AddNewsFeed.css';

const API_BASE = '/api/HumanResource';
const MASTER_OPTIONS_API = '/api/auth/master-options';

const FALLBACK_CIRCLES = ['NHQ', 'Delhi', 'Mumbai', 'Bangalore', 'Hyderabad'];
const FALLBACK_EMP_TYPES = ['Software Developer', 'Human Resource', 'Accounts', 'Admin'];

export const AddNewsFeed = ({ onBack, circleOptions: propCircleOptions, empTypeOptions: propEmpTypeOptions }) => {
  const [circleOptions, setCircleOptions] = useState(() => ['All', ...(propCircleOptions || FALLBACK_CIRCLES)]);
  const [empTypeOptions, setEmpTypeOptions] = useState(() => ['All', 'All Employees', ...(propEmpTypeOptions || FALLBACK_EMP_TYPES)]);
  const [form, setForm] = useState({
    circle: 'All',
    emp_type: 'All Employees',
    title: '',
    content: '',
  });
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('No file chosen');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setFileName(f ? f.name : 'No file chosen');
    setError('');
  };

  // For history attachments, build backend static URL to avoid SPA 404s.
  const backendStaticBase =
    typeof window !== 'undefined' && window.__BACKEND_STATIC__
      ? window.__BACKEND_STATIC__
      : '';
  const historyAttachmentUrl = (item) =>
    item?.file_url || (item?.file_path ? `${backendStaticBase}/uploads/${item.file_path}` : null);

  useEffect(() => {
    if (propCircleOptions?.length) setCircleOptions(['All', ...propCircleOptions]);
    else if (!propCircleOptions) {
      const token = localStorage.getItem('token');
      if (token) {
        fetch(MASTER_OPTIONS_API, { headers: { Authorization: `Bearer ${token}` } })
          .then((res) => res.json().catch(() => ({})))
          .then((data) => { if (data.success && data.circles?.length) setCircleOptions(['All', ...data.circles]); });
      }
    }
  }, [propCircleOptions]);
  useEffect(() => {
    if (propEmpTypeOptions?.length) setEmpTypeOptions(['All', 'All Employees', ...propEmpTypeOptions]);
    else if (!propEmpTypeOptions) {
      const token = localStorage.getItem('token');
      if (token) {
        fetch(MASTER_OPTIONS_API, { headers: { Authorization: `Bearer ${token}` } })
          .then((res) => res.json().catch(() => ({})))
          .then((data) => { if (data.success && data.departments?.length) setEmpTypeOptions(['All', 'All Employees', ...data.departments]); });
      }
    }
  }, [propEmpTypeOptions]);

  const fetchHistory = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    setHistoryLoading(true);
    setHistoryError('');
    try {
      const res = await fetch(`${API_BASE}/news-feed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setHistory([]);
        setHistoryError(data.message || 'Failed to load news feed history.');
        return;
      }
      setHistory(Array.isArray(data.items) ? data.items : []);
    } catch {
      setHistory([]);
      setHistoryError('Network error while loading history.');
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleDeletePost = async (id) => {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please log in.');
      return;
    }
    if (!window.confirm('Are you sure you want to delete this news feed post?')) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/news-feed/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        alert(data.message || 'Failed to delete post.');
        return;
      }
      setHistory((prev) => prev.filter((p) => p.id !== id));
    } catch {
      alert('Network error while deleting post.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    if (!form.title?.trim() || !form.content?.trim()) {
      setError('Title and content are required.');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in to post.');
      return;
    }
    setSubmitting(true);
    try {
      const body = new FormData();
      body.append('title', form.title.trim());
      body.append('content', form.content.trim());
      body.append('circle', form.circle);
      body.append('emp_type', form.emp_type === 'All Employees' ? 'All' : form.emp_type);
      if (file) body.append('file', file);

      const res = await fetch(`${API_BASE}/news-feed`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setSuccess(true);
        setForm({ circle: form.circle, emp_type: form.emp_type, title: '', content: '' });
        setFile(null);
        setFileName('No file chosen');
        const fileInput = document.getElementById('news-file');
        if (fileInput) fileInput.value = '';
        await fetchHistory();
      } else {
        setError(data.message || 'Failed to post.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="newsfeed-page-container">
      <div className="newsfeed-content">
        <button type="button" className="btn-back-updates" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="announcement-card">
          <form className="newsfeed-form" onSubmit={handleSubmit}>
            {success && (
              <div className="newsfeed-success" style={{ padding: '12px', marginBottom: '16px', background: '#dcfce7', color: '#166534', borderRadius: '8px' }}>
                News feed posted successfully.
              </div>
            )}
            {error && (
              <div className="newsfeed-error" style={{ padding: '12px', marginBottom: '16px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px' }}>
                {error}
              </div>
            )}

            <div className="form-item">
              <label>Circle</label>
              <select name="circle" value={form.circle} onChange={handleChange}>
                {circleOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="form-item">
              <label>Employee Type</label>
              <select name="emp_type" value={form.emp_type} onChange={handleChange}>
                {empTypeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="form-item">
              <label>Title</label>
              <input
                type="text"
                name="title"
                placeholder="Enter title"
                value={form.title}
                onChange={handleChange}
              />
            </div>

            <div className="form-item">
              <label>Content</label>
              <textarea
                name="content"
                placeholder="Enter content"
                rows={5}
                value={form.content}
                onChange={handleChange}
              />
            </div>

            <div className="form-item">
              <label>File (optional)</label>
              <div className="file-input-wrapper">
                <label htmlFor="news-file" className="custom-file-upload">
                  <span className="choose-btn">Choose File</span>
                  <span className="file-name">{fileName}</span>
                </label>
                <input
                  type="file"
                  id="news-file"
                  onChange={handleFileChange}
                />
              </div>
            </div>

            <div className="form-submit">
              <button type="submit" className="btn-post" disabled={submitting}>
                {submitting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </form>

          <div className="newsfeed-history">
            <h3>News Feed History</h3>

            {historyLoading && <p>Loading history…</p>}
            {historyError && !historyLoading && (
              <p className="newsfeed-error">{historyError}</p>
            )}

            {!historyLoading && !historyError && history.length === 0 && (
              <p>No previous announcements found.</p>
            )}

            {!historyLoading && !historyError && history.length > 0 && (
              <div className="newsfeed-history-table-wrapper">
                <table className="newsfeed-history-table">
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Circle</th>
                      <th>Employee Type</th>
                      <th>Date</th>
                      <th>Attachment</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr key={item.id}>
                        <td>{item.title}</td>
                        <td>{item.circle || 'All'}</td>
                        <td>{item.emp_type || 'All'}</td>
                        <td>{item.created_at ? item.created_at.split('T')[0] : '-'}</td>
                        <td>
                          {(item.file_url || item.file_path) ? (
                            <a
                              href={historyAttachmentUrl(item)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              View
                            </a>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="newsfeed-delete-btn"
                            onClick={() => handleDeletePost(item.id)}
                          >
                            Delete
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
