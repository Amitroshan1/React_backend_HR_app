import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import './HrAdminRequest.css';

const HR_API_BASE = '/api/HumanResource';

export default function HrAdminRequest({ onBack }) {
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${HR_API_BASE}/admin-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ subject, details }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || 'Could not send this request.');
        return;
      }
      setSubject('');
      setDetails('');
      setNotice(data.message || 'Request sent to Admin.');
    } catch {
      setError('Network error while sending the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hr-admin-request">
      <button type="button" className="hr-admin-request__back" onClick={onBack}>
        <ArrowLeft size={16} />
        Back
      </button>
      <header className="hr-admin-request__head">
        <div>
          <h1>Request to Admin</h1>
          <p>
            Write what you need. Admin sees it under Requests for approval and can approve or reject it.
            Check outcomes on the Request History card.
          </p>
        </div>
      </header>
      {error ? <p className="hr-admin-request__banner hr-admin-request__banner--error" role="alert">{error}</p> : null}
      {notice ? <p className="hr-admin-request__banner hr-admin-request__banner--ok" role="status">{notice}</p> : null}
      <form className="hr-admin-request__card" onSubmit={submit}>
        <div className="hr-admin-request__field">
          <div className="hr-admin-request__label-row">
            <label htmlFor="admin-request-subject">Subject</label>
            <span className="hr-admin-request__count">{subject.length}/150</span>
          </div>
          <input
            id="admin-request-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={150}
            placeholder="Add a new department"
            required
          />
        </div>
        <div className="hr-admin-request__field">
          <div className="hr-admin-request__label-row">
            <label htmlFor="admin-request-details">Details</label>
            <span className="hr-admin-request__count">{details.length}/4000</span>
          </div>
          <textarea
            id="admin-request-details"
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={4000}
            placeholder="Explain what you need Admin to do."
            required
          />
        </div>
        <div className="hr-admin-request__actions">
          <p className="hr-admin-request__hint">This only sends a request. It does not change employees or departments.</p>
          <button type="submit" className="hr-admin-request__submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send to Admin'}
          </button>
        </div>
      </form>
    </div>
  );
}
