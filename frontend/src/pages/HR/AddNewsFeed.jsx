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
        <button type="button" className="btn-back-link" onClick={onBack}>
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
        </div>
      </div>
    </div>
  );
};
