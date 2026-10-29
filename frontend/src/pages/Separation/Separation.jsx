import React, { useState, useEffect } from 'react';
import { useUser } from '../../components/layout/UserContext';
import { Toast } from '../Wfh/ui/Toast';
import './Separation.css';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDate } from '../../utils/dateFormat';

const API_BASE_URL = '/api/leave';
const SUBMIT_ENABLE_CHARS = 10;
const NOTICE_CHARS = 500;
const EMPTY_NOTICE = {
  notice_active: false,
  notice_period_days: 30,
  notice_start_date: null,
  notice_end_date: null,
  days_left: 0,
  can_revoke: false,
};

function Button({ children, variant = 'primary', className = '', ...props }) {
  return (
    <button
      type="button"
      className={['btn', variant, className].filter(Boolean).join(' ')}
      {...props}
    >
      {children}
    </button>
  );
}

function DownloadExperienceLetterButton({ apiBase }) {
  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setDownloading(true);
    try {
      const res = await fetch(`${apiBase}/experience-letter`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        res.headers.get('Content-Disposition')?.split('filename=')?.[1]?.replace(/"/g, '') ||
        'experience-letter.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Could not download experience letter. Please try again.');
    } finally {
      setDownloading(false);
    }
  };
  return (
    <button type="button" className="btn-download-noc" onClick={handleDownload} disabled={downloading}>
      {downloading ? 'Downloading...' : 'Download experience letter'}
    </button>
  );
}

function DownloadRelievingLetterButton({ apiBase }) {
  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setDownloading(true);
    try {
      const res = await fetch(`${apiBase}/relieving-letter`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download =
        res.headers.get('Content-Disposition')?.split('filename=')?.[1]?.replace(/"/g, '') ||
        'relieving-letter.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Could not download relieving letter. Please try again.');
    } finally {
      setDownloading(false);
    }
  };
  return (
    <button type="button" className="btn-download-noc" onClick={handleDownload} disabled={downloading}>
      {downloading ? 'Downloading...' : 'Download relieving letter'}
    </button>
  );
}

export const Separation = () => {
  const { userData } = useUser();
  const [step, setStep] = useState('policy');
  const [resignation, setResignation] = useState(null);
  const [notice, setNotice] = useState(EMPTY_NOTICE);
  const [revoking, setRevoking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [history, setHistory] = useState([]);
  const [employeeOffboarding, setEmployeeOffboarding] = useState(null);

  const user = userData?.user || {};
  const userName = user?.name || user?.first_name || 'User';
  const userEmail = user?.email || '';
  const userDoj = user?.doj
    ? formatDate(user.doj)
    : user?.date_of_joining
      ? formatDate(user.date_of_joining)
      : 'N/A';

  const fetchResignationStatus = async (updateStep = true) => {
    if (updateStep) setLoading(true);
    const token = localStorage.getItem('token');
    if (!token) {
      if (updateStep) setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/seperation`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await res.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch (e) {
        throw new Error('The server could not complete this request. Please try again.');
      }

      if (!res.ok) {
        throw new Error(json.message || 'Failed to fetch resignation status');
      }

      setHistory(Array.isArray(json.history) ? json.history : []);

      if (json.success && json.resignation) {
        setResignation(json.resignation);
        setNotice(json.notice || EMPTY_NOTICE);
        setEmployeeOffboarding(json.employee_offboarding || null);

        if (updateStep) {
          const alreadySubmitted = Boolean(json.already_submitted);
          if (alreadySubmitted) {
            setStep('success');
          } else {
            setStep('resignation');
          }
        }
      } else {
        setResignation(null);
        setNotice(json.notice || EMPTY_NOTICE);
        setEmployeeOffboarding(json.employee_offboarding || null);
        if (updateStep) setStep('resignation');
      }
    } catch (err) {
      console.error('Error fetching resignation status:', err);
    } finally {
      if (updateStep) setLoading(false);
    }
  };

  useRefreshOnNavigate(() => {
    fetchResignationStatus();
  });

  useEffect(() => {
    const onRevoked = () => {
      fetchResignationStatus(false).then(() => setStep('resignation'));
    };
    window.addEventListener('resignation-revoked', onRevoked);
    return () => window.removeEventListener('resignation-revoked', onRevoked);
  }, []);

  // Submit only the separation request. Department NOC is handled downstream.
  const handleApplySeparation = async (data) => {
    if (submitting) return;
    if (!data?.resignationDate || !data?.reason?.trim()) {
      setToast({
        show: true,
        message: 'Please enter a resignation date and reason.',
        type: 'error',
      });
      setStep('resignation');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      setToast({ show: true, message: 'Please login again', type: 'error' });
      return;
    }

    setSubmitting(true);
    setToast({ show: false, message: '', type: 'success' });
    try {
      const res = await fetch(`${API_BASE_URL}/seperation`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resignation_date: data.resignationDate,
          reason: data.reason.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.message || 'Failed to submit separation');
      }
      setToast({
        show: true,
        message: json.message || 'Separation submitted successfully.',
        type: 'success',
      });
      await fetchResignationStatus(false);
      setStep('success');
    } catch (err) {
      setToast({
        show: true,
        message: err.message || 'Failed to submit separation',
        type: 'error',
      });
      console.error('Error finalizing separation:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeResignation = async () => {
    if (revoking) return;
    const token = localStorage.getItem('token');
    if (!token) {
      setToast({ show: true, message: 'Please login again', type: 'error' });
      return;
    }
    const ok = window.confirm('Are you sure you want to revoke your resignation?');
    if (!ok) return;

    setRevoking(true);
    setToast({ show: false, message: '', type: 'success' });
    try {
      const res = await fetch(`${API_BASE_URL}/seperation/revoke`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      const text = await res.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch (e) {
        throw new Error(
          res.ok
            ? 'Resignation may have been revoked, but the server returned an empty response. Please refresh.'
            : 'The server could not complete this request. Please try again.'
        );
      }
      if (!res.ok || !json.success) {
        throw new Error(json.message || json.msg || json.error || 'Failed to revoke resignation');
      }
      setToast({
        show: true,
        message: json.message || 'Resignation revoked successfully',
        type: 'success',
      });
      if (json.notice) {
        setNotice(json.notice);
      }
      window.dispatchEvent(new CustomEvent('resignation-revoked', { detail: json }));
      await fetchResignationStatus(false);
      setFormData({});
      setStep('resignation');
    } catch (err) {
      setToast({
        show: true,
        message: err.message || 'Failed to revoke resignation',
        type: 'error',
      });
      console.error('Error revoking resignation:', err);
    } finally {
      setRevoking(false);
    }
  };

  if (loading) {
    return (
      <div className="separation-page-wrapper">
        <div className="separation-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="separation-page-wrapper">
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, show: false })}
          hideIcon
          hideClose
        />
      )}

      <div className="separation-card-container">
        {step === 'policy' && (
          <div className="card slide-in warning">
            <h2>Resignation Policy</h2>
            <p>Please review the company exit policy carefully before initiating your resignation.</p>
            <Button onClick={() => setStep('resignation')}>I Understand</Button>
          </div>
        )}

        {step === 'resignation' && (
          <>
            <ResignationFormCard
              userName={userName}
              userEmail={userEmail}
              userDoj={userDoj}
              userCircle={user?.circle || ''}
              noticePeriodDays={notice?.notice_period_days}
              onSubmit={handleApplySeparation}
              submitting={submitting}
            />
            {history.length > 0 && (
              <div className="card slide-in history-card">
                <h3>Previous Resignation Requests</h3>
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Reason</th>
                      <th>Submitted On</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr key={item.id}>
                        <td>{item.resignation_date ? formatDate(item.resignation_date) : '-'}</td>
                        <td>{item.status}</td>
                        <td>{item.reason}</td>
                        <td>{item.created_at ? formatDate(item.created_at) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {step === 'success' && (
          <div className="card slide-in success">
            <h2>Request Submitted</h2>
            <p>Your resignation has been successfully submitted. Manager and HR have been notified.</p>
            {resignation && (
              <div className="success-details">
                <div className="detail-row">
                  <span className="label">Resignation Date:</span>
                  <span className="value">{formatDate(resignation.resignation_date)}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Reason:</span>
                  <span className="value">{resignation.reason}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Submitted On:</span>
                  <span className="value">{formatDate(resignation.created_at)}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Status:</span>
                  <span className="value">{resignation.status || 'Pending'}</span>
                </div>
                {notice?.notice_active && (
                  <>
                    <div className="detail-row">
                      <span className="label">Notice End:</span>
                      <span className="value">{formatDate(notice.notice_end_date)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="label">Days Left:</span>
                      <span className="value">{notice.days_left} day(s)</span>
                    </div>
                  </>
                )}
              </div>
            )}
            {notice?.notice_active && notice?.can_revoke && (
              <div className="revoke-section">
                <Button variant="danger" onClick={handleRevokeResignation} disabled={revoking}>
                  {revoking ? 'Revoking...' : 'Revoke Resignation'}
                </Button>
              </div>
            )}
            {employeeOffboarding?.is_exited && (
              <div className="noc-download-section exit-status-section">
                <h4>Exit status</h4>
                <div className="detail-row">
                  <span className="label">Exit type:</span>
                  <span className="value">{employeeOffboarding.exit_type || '—'}</span>
                </div>
                <div className="detail-row">
                  <span className="label">Last working day:</span>
                  <span className="value">{formatDate(employeeOffboarding.exit_date)}</span>
                </div>
                {employeeOffboarding.login_until && (
                  <div className="detail-row">
                    <span className="label">System access until:</span>
                    <span className="value">{formatDate(employeeOffboarding.login_until)}</span>
                  </div>
                )}
                <div className="detail-row">
                  <span className="label">F&amp;F status:</span>
                  <span className="value">{employeeOffboarding.fnf_status || 'none'}</span>
                </div>
                {employeeOffboarding.can_download_relieving_letter && (
                  <DownloadRelievingLetterButton apiBase={API_BASE_URL} />
                )}
                {employeeOffboarding.can_download_experience_letter && (
                  <DownloadExperienceLetterButton apiBase={API_BASE_URL} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

function ResignationFormCard({ userName, userEmail, userDoj, userCircle, noticePeriodDays, onSubmit, submitting }) {
  const [resignationDate, setResignationDate] = useState('');
  const [reason, setReason] = useState('');
  const [canSubmit, setCanSubmit] = useState(false);

  useEffect(() => {
    setCanSubmit(resignationDate.trim() !== '' && reason.trim().length >= SUBMIT_ENABLE_CHARS);
  }, [resignationDate, reason]);

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ resignationDate, reason });
  };

  return (
    <div className="card slide-in large-form">
      <div className="card-header">
        <h3>Submit Resignation</h3>
        <p>Complete this form. Nothing is saved until you confirm the resignation request.</p>
      </div>

      <div className="info-pills">
        <span className="pill">👤 {userName}</span>
        <span className="pill">✉️ {userEmail}</span>
        <span className="pill">📅 Joined: {userDoj}</span>
      </div>

      <div className="statement-box">
        I, <strong>{userName}</strong>, with the registered Email ID
        <strong> {userEmail}</strong>, hereby formally submit my resignation and express my
        intention to separate from this organization.
      </div>

      <label>Resignation Date *</label>
      <input type="date" value={resignationDate} onChange={(e) => setResignationDate(e.target.value)} />

      <label>Reason for Resignation *</label>
      <textarea
        rows="8"
        placeholder="Explain your reason clearly and professionally..."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />

      <div className={`char-count ${reason.length < NOTICE_CHARS ? 'error' : 'success'}`}>
        {reason.length}/{NOTICE_CHARS} characters
      </div>

      <p className="section-hint">
        Notice period: <strong>{noticePeriodDays || (String(userCircle).trim().toUpperCase() === 'NHQ' ? 90 : 30)} days</strong>
        {String(userCircle).trim().toUpperCase() === 'NHQ' ? ' for NHQ' : ' for your circle'}.
      </p>
      <Button onClick={handleSubmit} disabled={!canSubmit || submitting}>
        {submitting ? 'Submitting…' : 'Apply for separation'}
      </Button>
    </div>
  );
}
