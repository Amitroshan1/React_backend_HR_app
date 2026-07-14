import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { formatDateDDMMYYYY } from '../../../utils/dateFormat';
import './Archive.css';

const HR_API_BASE = '/api/HumanResource';

const ArchiveEmployeeDetails = () => {
  const { adminId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [employee, setEmployee] = useState(null);
  const [hrInterviewSaving, setHrInterviewSaving] = useState(false);
  const [hrForm, setHrForm] = useState({
    hr_interview_completed: false,
    hr_interview_date: '',
    hr_notes: '',
  });

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const staticBase =
    typeof window !== 'undefined' && window.__BACKEND_STATIC__
      ? window.__BACKEND_STATIC__
      : '';

  const docUrl = (path) => (path ? `${staticBase}/static/uploads/${path}` : null);

  const loadEmployee = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/archive/employee/${adminId}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const msg =
          data.message ||
          data.msg ||
          data.error ||
          (res.status === 401 || res.status === 422
            ? 'Session expired or invalid. Please sign in again.'
            : res.status === 403
              ? 'You do not have permission to view this archive record.'
              : `Unable to load archived employee (${res.status}).`);
        setError(msg);
        return;
      }
      setEmployee(data.employee);
      const ei = data.employee?.exit_interview;
      setHrForm({
        hr_interview_completed: Boolean(ei?.hr_interview_completed),
        hr_interview_date: ei?.hr_interview_date ? String(ei.hr_interview_date).slice(0, 10) : '',
        hr_notes: ei?.hr_notes || '',
      });
    } catch {
      setError('Network error while loading archived employee');
    } finally {
      setLoading(false);
    }
  }, [adminId, getAuthHeaders]);

  useEffect(() => {
    loadEmployee();
  }, [loadEmployee]);

  const downloadPdf = async (type) => {
    const path = type === 'experience'
      ? `${HR_API_BASE}/employees/${adminId}/experience-letter/pdf`
      : `${HR_API_BASE}/employees/${adminId}/relieving-letter/pdf`;
    try {
      const res = await fetch(path, { headers: getAuthHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || 'Download failed');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-letter-${adminId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Download failed');
    }
  };

  const saveHrInterview = async () => {
    setHrInterviewSaving(true);
    try {
      const res = await fetch(`${HR_API_BASE}/employees/${adminId}/exit-interview`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          hr_interview_completed: hrForm.hr_interview_completed,
          hr_interview_date: hrForm.hr_interview_date || null,
          hr_notes: hrForm.hr_notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        alert(data.message || 'Failed to save HR exit interview');
        return;
      }
      await loadEmployee();
    } catch {
      alert('Network error while saving');
    } finally {
      setHrInterviewSaving(false);
    }
  };

  const basic = employee?.basic || {};
  const employment = employee?.employment || {};
  const exitInfo = employee?.exit || {};
  const documents = employee?.documents || [];
  const education = employee?.education || [];
  const previous = employee?.previous_employment || [];
  const rehirePolicy = employee?.rehire_policy;
  const exitInterview = employee?.exit_interview;
  const exitHistory = employee?.exit_history || [];

  return (
    <div className="archive-container">
      <div className="archive-wrapper">
        <div className="archive-header">
          <button className="btn-back-updates" onClick={() => navigate('/archive-employees')}>
            <ArrowLeft size={20} />
            <span>Back to Archive</span>
          </button>
        </div>

        <div className="title-section">
          <h1 className="page-title">Archived Employee Details</h1>
          <p className="page-subtitle">
            {basic.name || 'Employee'} {employment.emp_id ? `(${employment.emp_id})` : ''}
          </p>
        </div>

        {error && <p className="archive-error">{error}</p>}
        {loading && !error && <p className="archive-error">Loading...</p>}

        {!loading && !error && (
          <div className="archive-details-grid">
            <div className="archive-detail-card archive-detail-card--offboarding">
              <h3>Offboarding</h3>
              <p><strong>F&amp;F status:</strong> {employee?.fnf_status || 'none'}</p>
              {employee?.fnf?.net_payable != null && (
                <p><strong>Net payable:</strong> ₹{Number(employee.fnf.net_payable).toLocaleString('en-IN')}</p>
              )}
              {employee?.fnf?.settlement_id && (
                <p><strong>Settlement ID:</strong> {employee.fnf.settlement_id}</p>
              )}
              {rehirePolicy && (
                <>
                  <p>
                    <strong>Rehire:</strong>{' '}
                    {rehirePolicy.can_rejoin_now ? 'Eligible now' : 'Blocked'}
                  </p>
                  {!rehirePolicy.can_rejoin_now && rehirePolicy.rehire_block_reason && (
                    <p className="archive-detail-muted">{rehirePolicy.rehire_block_reason}</p>
                  )}
                  {rehirePolicy.rehire_cooldown_until && (
                    <p><strong>Cooldown until:</strong> {formatDateDDMMYYYY(rehirePolicy.rehire_cooldown_until)}</p>
                  )}
                </>
              )}
              <div className="archive-detail-doc-actions">
                <button type="button" className="archive-letter-btn" onClick={() => downloadPdf('relieving')}>
                  <FileText size={14} />
                  Relieving letter
                </button>
                <button type="button" className="archive-letter-btn" onClick={() => downloadPdf('experience')}>
                  <FileText size={14} />
                  Experience letter
                </button>
              </div>
            </div>

            <div className="archive-detail-card">
              <h3>Exit interview</h3>
              {exitInterview?.submitted_at ? (
                <>
                  <p><strong>Employee rating:</strong> {exitInterview.overall_rating || '—'}/5</p>
                  <p><strong>Would recommend:</strong> {exitInterview.would_recommend ? 'Yes' : 'No'}</p>
                  {exitInterview.feedback && <p className="archive-detail-quote">{exitInterview.feedback}</p>}
                </>
              ) : (
                <p className="archive-detail-muted">No employee feedback submitted.</p>
              )}
              <hr />
              <label className="archive-modal__check">
                <input
                  type="checkbox"
                  checked={hrForm.hr_interview_completed}
                  onChange={(e) => setHrForm((f) => ({ ...f, hr_interview_completed: e.target.checked }))}
                />
                HR interview completed
              </label>
              <label className="archive-modal__label">Interview date</label>
              <input
                type="date"
                className="archive-modal__input"
                value={hrForm.hr_interview_date}
                onChange={(e) => setHrForm((f) => ({ ...f, hr_interview_date: e.target.value }))}
              />
              <label className="archive-modal__label">HR notes</label>
              <textarea
                className="archive-modal__textarea"
                rows={2}
                value={hrForm.hr_notes}
                onChange={(e) => setHrForm((f) => ({ ...f, hr_notes: e.target.value }))}
              />
              <button type="button" className="archive-rejoin-btn" onClick={saveHrInterview} disabled={hrInterviewSaving}>
                {hrInterviewSaving ? 'Saving…' : 'Save HR interview'}
              </button>
            </div>

            {exitHistory.length > 0 && (
              <div className="archive-detail-card">
                <h3>Exit history</h3>
                <ul className="archive-history-list archive-history-list--compact">
                  {exitHistory.map((row) => (
                    <li key={row.id} className="archive-history-item">
                      <div>
                        <strong>{row.exit_type || 'Exit'}</strong>
                        <span>LWD: {formatDateDDMMYYYY(row.last_working_day || row.exit_date)}</span>
                      </div>
                      <small>{row.created_by || '—'}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="archive-detail-card">
              <h3>Profile</h3>
              <p><strong>Name:</strong> {basic.name || '—'}</p>
              <p><strong>Email:</strong> {basic.email || '—'}</p>
              <p><strong>Mobile:</strong> {basic.mobile || '—'}</p>
              <p><strong>Username:</strong> {basic.username || '—'}</p>
            </div>

            <div className="archive-detail-card">
              <h3>Employment & Exit</h3>
              <p><strong>Employee ID:</strong> {employment.emp_id || '—'}</p>
              <p><strong>Circle:</strong> {employment.circle || '—'}</p>
              <p><strong>Type:</strong> {employment.emp_type || '—'}</p>
              <p><strong>Date of Joining:</strong> {employment.doj || '—'}</p>
              <hr />
              <p><strong>Exit Date:</strong> {exitInfo.exit_date || '—'}</p>
              <p><strong>Exit Type:</strong> {exitInfo.exit_type || '—'}</p>
              <p><strong>Exit Reason:</strong> {exitInfo.exit_reason || '—'}</p>
            </div>

            <div className="archive-detail-card">
              <h3>Previous Company</h3>
              {Array.isArray(previous) && previous.length > 0 ? (
                previous.map((pc, i) => (
                  <div key={i} className="archive-detail-subitem">
                    <p><strong>{pc.companyName || '—'}</strong></p>
                    <p>{pc.designation || '—'}</p>
                    <p>
                      {pc.doj || ''} {pc.dateOfLeaving ? `→ ${pc.dateOfLeaving}` : ''}{' '}
                      {pc.experienceYears ? `(${pc.experienceYears} yrs)` : ''}
                    </p>
                  </div>
                ))
              ) : (
                <p>No previous-company records found.</p>
              )}
            </div>

            <div className="archive-detail-card">
              <h3>Documents</h3>
              {Array.isArray(documents) && documents.length > 0 ? (
                documents.map((d, i) => {
                  const url = docUrl(d.file);
                  const isImage =
                    d.file && /\.(png|jpe?g|gif|webp)$/i.test(d.file || '');

                  return (
                    <div key={i} className="archive-detail-subitem">
                      <p>
                        <strong>{d.doc_type || 'Document'}:</strong>{' '}
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer">
                            View file
                          </a>
                        ) : (
                          'Not uploaded'
                        )}
                      </p>
                      {url && isImage && (
                        <img
                          src={url}
                          alt={d.doc_type || 'Document'}
                          style={{
                            maxWidth: '100%',
                            maxHeight: 160,
                            borderRadius: 6,
                            marginTop: 8,
                          }}
                        />
                      )}
                    </div>
                  );
                })
              ) : (
                <p>No documents found.</p>
              )}
            </div>

            <div className="archive-detail-card">
              <h3>Education</h3>
              {Array.isArray(education) && education.length > 0 ? (
                education.map((e, i) => (
                  <div key={i} className="archive-detail-subitem">
                    <p><strong>{e.degree || '—'}</strong> – {e.institute || '—'}</p>
                    <p>Year: {e.year || '—'}</p>
                  </div>
                ))
              ) : (
                <p>No education records found.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArchiveEmployeeDetails;
