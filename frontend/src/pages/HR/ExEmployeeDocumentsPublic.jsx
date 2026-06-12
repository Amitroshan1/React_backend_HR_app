import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileText, Download, Clock } from 'lucide-react';
import './ExEmployeeDocumentsPublic.css';
import { AppFooter } from '../../components/layout/AppFooter';
import { formatDateTimeDDMMYYYY } from '../../utils/dateFormat';

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
    `${API_BASE}/ex-employee-documents/public/${encodeURIComponent(token)}/download/${fileId}`;

  const parseContentDispositionFilename = (header) => {
    if (!header) return '';
    const star = header.match(/filename\*=(?:UTF-8''|utf-8'')([^;]+)/i);
    if (star?.[1]) {
      try {
        return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ''));
      } catch {
        return star[1].trim().replace(/^["']|["']$/g, '');
      }
    }
    const plain = header.match(/filename="([^"]+)"/i) || header.match(/filename=([^;]+)/i);
    return plain?.[1]?.trim().replace(/^["']|["']$/g, '') || '';
  };

  const handleDownload = async (fileId, fallbackName) => {
    try {
      const res = await fetch(downloadUrl(fileId));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Download failed. Try again.');
        return;
      }
      const blob = await res.blob();
      const filename =
        parseContentDispositionFilename(res.headers.get('Content-Disposition')) ||
        fallbackName ||
        'document';
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError('Download failed. Check your connection and try again.');
    }
  };

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
              <strong>{formatDateTimeDDMMYYYY(expiresAt)}</strong>
            </span>
          </div>
        )}

        {token && !loading && !error && files.length > 0 && (
          <ul className="ex-doc-public__list">
            {files.map((f) => (
              <li key={f.id} className="ex-doc-public__item">
                <span className="ex-doc-public__fname">{f.display_name}</span>
                <button
                  type="button"
                  className="ex-doc-public__dl"
                  onClick={() => handleDownload(f.id, f.display_name)}
                >
                  <Download size={16} />
                  Download
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <AppFooter />
    </div>
  );
}
