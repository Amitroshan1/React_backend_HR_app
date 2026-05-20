import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Download, Clock } from 'lucide-react';
import './ExEmployeeDocumentsPublic.css';
import { AppFooter } from '../../components/layout/AppFooter';

const API_BASE = '/api/HumanResource';

export function ExEmployeeDocumentsPublic() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('t') || '').trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [expiresAt, setExpiresAt] = useState(null);
  const [files, setFiles] = useState([]);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError('This page needs a valid link from your email (?t=…).');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${API_BASE}/ex-employee-documents/public/${encodeURIComponent(token)}`
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 410 || data.expired) {
        setExpired(true);
        setError(data.message || 'This link has expired.');
        setFiles([]);
        return;
      }
      if (!res.ok || !data.success) {
        setError(data.message || 'Could not load documents.');
        setFiles([]);
        return;
      }
      setExpired(false);
      setExpiresAt(data.expires_at || null);
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch {
      setError('Network error. Check your connection and try again.');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const downloadUrl = (fileId) =>
    `${window.location.origin}${API_BASE}/ex-employee-documents/public/${encodeURIComponent(token)}/download/${fileId}`;

  return (
    <div className="ex-doc-public">
      <div className="ex-doc-public__panel">
        <div className="ex-doc-public__brand">
          <FileText size={32} className="ex-doc-public__brand-icon" />
          <h1>HR documents</h1>
        </div>
        <p className="ex-doc-public__lead">
          Download the files shared with you. This page works without logging in to HRMS.
        </p>

        {!token && (
          <div className="ex-doc-public__banner ex-doc-public__banner--error" role="alert">
            {error}
          </div>
        )}

        {token && loading && <p className="ex-doc-public__muted">Loading…</p>}

        {token && !loading && error && (
          <div
            className={`ex-doc-public__banner ${expired ? 'ex-doc-public__banner--warn' : 'ex-doc-public__banner--error'}`}
            role="alert"
          >
            {error}
          </div>
        )}

        {token && !loading && !error && expiresAt && (
          <div className="ex-doc-public__expiry">
            <Clock size={16} />
            <span>
              Link valid until{' '}
              <strong>{new Date(expiresAt).toLocaleString()}</strong>
            </span>
          </div>
        )}

        {token && !loading && !error && files.length > 0 && (
          <ul className="ex-doc-public__list">
            {files.map((f) => (
              <li key={f.id} className="ex-doc-public__item">
                <span className="ex-doc-public__fname">{f.display_name}</span>
                <a
                  className="ex-doc-public__dl"
                  href={downloadUrl(f.id)}
                  download
                >
                  <Download size={16} />
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AppFooter />
    </div>
  );
}
