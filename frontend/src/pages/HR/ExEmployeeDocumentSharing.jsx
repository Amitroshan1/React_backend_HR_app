import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Mail, Plus, Trash2, Send } from 'lucide-react';
import { personalEmailValidationError } from '../../utils/emailDomain';
import './ExEmployeeDocumentSharing.css';

const HR_API_BASE = '/api/HumanResource';

function newRow() {
  return { localKey: `${Date.now()}-${Math.random()}`, file: null, displayName: '' };
}

export function ExEmployeeDocumentSharing({ onBack }) {
  const [recipientEmail, setRecipientEmail] = useState('');
  const [rows, setRows] = useState([newRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historyQuery, setHistoryQuery] = useState('');

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const updateRow = (localKey, patch) => {
    setRows((prev) =>
      prev.map((r) => (r.localKey === localKey ? { ...r, ...patch } : r))
    );
  };

  const addRow = () => setRows((prev) => [...prev, newRow()]);

  const removeRow = (localKey) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.localKey !== localKey)));
  };

  const onFilePick = (localKey, fileList) => {
    const file = fileList?.[0];
    if (!file) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.localKey !== localKey) return r;
        const base = r.displayName?.trim();
        const suggested = base || file.name;
        return { ...r, file, displayName: suggested };
      })
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const email = recipientEmail.trim();
    const emailErr = personalEmailValidationError(email);
    if (emailErr) {
      setMessage({ type: 'error', text: emailErr });
      return;
    }
    const ready = rows.filter((r) => r.file);
    if (ready.length === 0) {
      setMessage({ type: 'error', text: 'Add at least one file.' });
      return;
    }
    const missingName = ready.some((r) => !(r.displayName || '').trim());
    if (missingName) {
      setMessage({ type: 'error', text: 'Each file needs a display name.' });
      return;
    }

    setSubmitting(true);
    setMessage({ type: '', text: '' });
    try {
      const formData = new FormData();
      formData.append('recipient_email', email);
      formData.append(
        'display_names',
        JSON.stringify(
          ready.map((r) => {
            const name = (r.displayName || '').trim();
            const fileName = r.file?.name || '';
            const dot = fileName.lastIndexOf('.');
            const ext = dot > 0 ? fileName.slice(dot) : '';
            if (ext && name && !name.toLowerCase().endsWith(ext.toLowerCase())) {
              return `${name}${ext}`;
            }
            return name || fileName;
          })
        )
      );
      ready.forEach((r) => formData.append('files', r.file));

      const res = await fetch(`${HR_API_BASE}/ex-employee-documents/send`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage({
          type: 'success',
          text: data.message || 'Email sent. Link is valid for 48 hours.',
        });
        setRecipientEmail('');
        setRows([newRow()]);
        await loadHistory();
      } else {
        const providerHint = String(data.email_provider_message || '').trim();
        const baseErr = data.message || `Could not send (HTTP ${res.status}). Try again.`;
        setMessage({
          type: 'error',
          text: providerHint ? `${baseErr} — ${providerHint}` : baseErr,
        });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error.' });
    } finally {
      setSubmitting(false);
    }
  };

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const res = await fetch(`${HR_API_BASE}/ex-employee-documents/history?limit=100`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Could not load history.');
      }
      setHistoryRows(Array.isArray(data.history) ? data.history : []);
    } catch (err) {
      setHistoryRows([]);
      setHistoryError(err.message || 'Could not load history.');
    } finally {
      setHistoryLoading(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const filteredHistoryRows = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    return historyRows.filter((row) => {
      const matchesStatus =
        historyStatus === 'all'
          ? true
          : historyStatus === 'active'
            ? !row.is_expired
            : !!row.is_expired;
      if (!matchesStatus) return false;
      if (!q) return true;
      return String(row.recipient_email || '').toLowerCase().includes(q);
    });
  }, [historyRows, historyStatus, historyQuery]);

  return (
    <div className="ex-doc-share">
      <button type="button" className="ex-doc-share__back" onClick={onBack}>
        <ArrowLeft size={18} /> Back to Updates
      </button>
      <div className="ex-doc-share__card">
        <div className="ex-doc-share__header">
          <div className="ex-doc-share__icon">
            <Mail size={28} />
          </div>
          <div>
            <h1 className="ex-doc-share__title">Ex-Employee Document Sharing</h1>
            <p className="ex-doc-share__subtitle">
              Send a secure download link (48 hours) to a former employee&apos;s email. No HRMS login
              required for them.
            </p>
          </div>
        </div>

        <form className="ex-doc-share__form" onSubmit={handleSubmit}>
          <label className="ex-doc-share__label">
            Recipient email
            <input
              type="email"
              className="ex-doc-share__input"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="personal or active inbox they can access"
              autoComplete="email"
              required
            />
          </label>

          <div className="ex-doc-share__files-head">
            <span className="ex-doc-share__files-title">Documents</span>
            <button type="button" className="ex-doc-share__btn-add" onClick={addRow} disabled={submitting}>
              <Plus size={16} /> Add file
            </button>
          </div>

          <div className="ex-doc-share__rows">
            {rows.map((row) => (
              <div key={row.localKey} className="ex-doc-share__row">
                <label className="ex-doc-share__file">
                  <span className="ex-doc-share__mini-label">File</span>
                  <input
                    type="file"
                    onChange={(e) => onFilePick(row.localKey, e.target.files)}
                    disabled={submitting}
                  />
                </label>
                <label className="ex-doc-share__name">
                  <span className="ex-doc-share__mini-label">Display name</span>
                  <input
                    type="text"
                    className="ex-doc-share__input"
                    value={row.displayName}
                    onChange={(e) => updateRow(row.localKey, { displayName: e.target.value })}
                    placeholder="e.g. Relieving letter"
                    disabled={submitting}
                  />
                </label>
                <button
                  type="button"
                  className="ex-doc-share__btn-remove"
                  onClick={() => removeRow(row.localKey)}
                  disabled={submitting || rows.length <= 1}
                  aria-label="Remove row"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>

          {message.text && (
            <div
              className={`ex-doc-share__msg ex-doc-share__msg--${message.type}`}
              role="alert"
            >
              {message.text}
            </div>
          )}

          <button type="submit" className="ex-doc-share__submit" disabled={submitting}>
            <Send size={18} />
            {submitting ? 'Sending…' : 'Send email with link'}
          </button>
        </form>
      </div>

      <div className="ex-doc-share__history-card">
        <div className="ex-doc-share__history-head">
          <h2 className="ex-doc-share__history-title">Shared History</h2>
          <button
            type="button"
            className="ex-doc-share__history-refresh"
            onClick={loadHistory}
            disabled={historyLoading}
          >
            {historyLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        <div className="ex-doc-share__history-filters">
          <label>
            Status
            <select
              value={historyStatus}
              onChange={(e) => setHistoryStatus(e.target.value)}
              className="ex-doc-share__history-select"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
            </select>
          </label>
          <label>
            Recipient search
            <input
              type="text"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              className="ex-doc-share__history-search"
              placeholder="Search by recipient email"
            />
          </label>
        </div>

        {historyError && (
          <div className="ex-doc-share__msg ex-doc-share__msg--error" role="alert">
            {historyError}
          </div>
        )}

        {!historyError && historyLoading && (
          <p className="ex-doc-share__history-muted">Loading shared history…</p>
        )}

        {!historyError && !historyLoading && historyRows.length === 0 && (
          <p className="ex-doc-share__history-muted">No document links shared yet.</p>
        )}

        {!historyError && !historyLoading && historyRows.length > 0 && filteredHistoryRows.length === 0 && (
          <p className="ex-doc-share__history-muted">No history rows match your filter/search.</p>
        )}

        {!historyError && !historyLoading && filteredHistoryRows.length > 0 && (
          <div className="ex-doc-share__history-table-wrap">
            <table className="ex-doc-share__history-table">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Documents</th>
                  <th>Shared At</th>
                  <th>Expires At</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistoryRows.map((h) => (
                  <tr key={h.share_id}>
                    <td>{h.recipient_email || '-'}</td>
                    <td>
                      <div className="ex-doc-share__history-docs">
                        {(h.documents || []).map((d) => (
                          <span key={d.id} className="ex-doc-share__history-chip">
                            {d.display_name}
                          </span>
                        ))}
                        {(!h.documents || h.documents.length === 0) && '-'}
                      </div>
                    </td>
                    <td>{h.created_at ? new Date(h.created_at).toLocaleString() : '-'}</td>
                    <td>{h.expires_at ? new Date(h.expires_at).toLocaleString() : '-'}</td>
                    <td>
                      <span className={`ex-doc-share__status ${h.is_expired ? 'expired' : 'active'}`}>
                        {h.is_expired ? 'Expired' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
