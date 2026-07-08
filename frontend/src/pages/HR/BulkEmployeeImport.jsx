import React, { useCallback, useState } from 'react';
import { ArrowLeft, Download, Upload, FileSpreadsheet } from 'lucide-react';
import './BulkEmployeeImport.css';

const HR_API_BASE = '/api/HumanResource';

export const BulkEmployeeImport = ({ onBack }) => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const handleDownloadTemplate = async () => {
    try {
      const res = await fetch(`${HR_API_BASE}/employees/import/template`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'employee-import-template.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Could not download template');
    }
  };

  const handlePreview = async () => {
    if (!file) {
      setError('Select a CSV file first');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`${HR_API_BASE}/employees/import/preview`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: form,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPreview(data);
      } else {
        setError(data.message || 'Preview failed');
        setPreview(null);
      }
    } catch {
      setError('Network error');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file) {
      setError('Select a CSV file first');
      return;
    }
    if (!window.confirm('Import employees from this CSV? Existing accounts will be skipped.')) return;
    setLoading(true);
    setError('');
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`${HR_API_BASE}/employees/import/commit`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: form,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult(data);
        setPreview(null);
      } else {
        setError(data.message || 'Import failed');
        if (data.preview) setPreview(data.preview);
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bulk-import-page">
      <button type="button" className="btn-back-updates" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Updates
      </button>

      <div className="bulk-import-card">
        <div className="bulk-import-header">
          <h2><FileSpreadsheet size={22} /> Bulk Employee Import</h2>
          <p>Upload a CSV to onboard multiple employees. Required columns match the Sign Up form.</p>
        </div>

        <button type="button" className="bulk-import-template-btn" onClick={handleDownloadTemplate}>
          <Download size={16} /> Download CSV template
        </button>

        <div className="bulk-import-upload">
          <label className="bulk-import-file-label">
            <Upload size={18} />
            <span>{file ? file.name : 'Choose CSV file'}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setPreview(null);
                setResult(null);
                setError('');
              }}
            />
          </label>
        </div>

        <div className="bulk-import-actions">
          <button type="button" onClick={handlePreview} disabled={loading || !file}>
            {loading ? 'Processing…' : 'Preview & validate'}
          </button>
          <button type="button" className="bulk-import-commit" onClick={handleImport} disabled={loading || !file}>
            Import employees
          </button>
        </div>

        {error ? <p className="bulk-import-error">{error}</p> : null}

        {preview ? (
          <div className="bulk-import-preview">
            <h3>Validation preview</h3>
            <p>
              <strong>{preview.valid_count}</strong> valid of {preview.total_rows} rows
              {preview.error_count > 0 ? ` • ${preview.error_count} with errors` : ''}
            </p>
            {preview.errors?.length > 0 ? (
              <ul className="bulk-import-errors">
                {preview.errors.map((err) => (
                  <li key={`${err.row}-${err.email}`}>
                    Row {err.row} ({err.email || '—'}): {(err.errors || []).join('; ')}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {result ? (
          <div className="bulk-import-result">
            <h3>Import complete</h3>
            <p><strong>Created:</strong> {result.created} • <strong>Failed:</strong> {result.failed}</p>
            {result.errors?.length > 0 ? (
              <ul className="bulk-import-errors">
                {result.errors.map((err) => (
                  <li key={`${err.row}-${err.email}`}>
                    Row {err.row}: {(err.errors || []).join('; ')}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default BulkEmployeeImport;
