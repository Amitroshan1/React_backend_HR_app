import React, { useCallback, useState } from 'react';
import { ArrowLeft, Mail, Plus, Trash2, Send } from 'lucide-react';
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
        const suggested = base || file.name.replace(/\.[^.]+$/, '') || file.name;
        return { ...r, file, displayName: suggested };
      })
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const email = recipientEmail.trim();
    if (!email || !email.includes('@')) {
      setMessage({ type: 'error', text: 'Enter a valid email address.' });
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
        JSON.stringify(ready.map((r) => (r.displayName || '').trim()))
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
          text: data.message || 'Email sent. Link is valid for 24 hours.',
        });
        setRecipientEmail('');
        setRows([newRow()]);
      } else {
        setMessage({
          type: 'error',
          text: data.message || 'Could not send. Try again.',
        });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error.' });
    } finally {
      setSubmitting(false);
    }
  };

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
              Send a secure download link (24 hours) to a former employee&apos;s email. No HRMS login
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
    </div>
  );
}
