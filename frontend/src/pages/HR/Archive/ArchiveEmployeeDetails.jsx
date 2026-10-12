import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { formatDateDDMMYYYY } from '../../../utils/dateFormat';
import { fetchAuthenticatedObjectUrl, toAuthContentUrl } from '../../../utils/secureFileUrl';
import { fetchAndOpenAuthenticatedFile } from '../../../utils/openBlobFile';
import '../offboarding-ui.css';

const HR_API_BASE = '/api/HumanResource';

function shown(value) {
  if (value == null || value === '') return '—';
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? (formatDateDDMMYYYY(text) || text) : text;
}

function Facts({ items }) {
  return (
    <dl className="obx-facts">
      {items.filter(Boolean).map((item) => (
        <div key={item.label} className={item.wide ? 'obx-facts-wide' : undefined}>
          <dt>{item.label}</dt>
          <dd>{item.node || shown(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function SecureArchiveThumb({ path, alt }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let revoke = () => {};
    let cancelled = false;
    (async () => {
      const result = await fetchAuthenticatedObjectUrl(path);
      if (cancelled) {
        result.revoke();
        return;
      }
      revoke = result.revoke;
      setSrc(result.objectUrl || '');
    })();
    return () => {
      cancelled = true;
      revoke();
    };
  }, [path]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt || 'Document'}
      style={{
        maxWidth: '100%',
        maxHeight: 160,
        borderRadius: 6,
        marginTop: 8,
      }}
    />
  );
}

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

  const openArchiveDoc = async (path) => {
    if (!path) return;
    try {
      await fetchAndOpenAuthenticatedFile(toAuthContentUrl(path), {
        fileName: String(path).split('/').pop() || 'document',
      });
    } catch (e) {
      alert(e.message || 'Unable to open file');
    }
  };

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
    <section className="obx">
        <header className="obx-hero">
          <div>
            <button type="button" className="obx-back" onClick={() => navigate('/archive-employees')}>
              <ArrowLeft size={16} />
              Back to Archive
            </button>
            <h1>{basic.name || 'Archived employee'}</h1>
            <p className="obx-muted">
              {[employment.emp_id, employment.circle, employment.emp_type].filter(Boolean).join(' · ') || 'Exit record'}
            </p>
          </div>
          {!loading && !error ? (
            <div className="obx-actions">
              <button type="button" className="obx-btn" onClick={() => downloadPdf('relieving')}>
                <FileText size={14} /> Relieving letter
              </button>
              <button type="button" className="obx-btn" onClick={() => downloadPdf('experience')}>
                <FileText size={14} /> Experience letter
              </button>
            </div>
          ) : null}
        </header>

        {error ? <p className="obx-alert">{error}</p> : null}
        {loading && !error ? <p className="obx-loading">Loading archive record…</p> : null}

        {!loading && !error && (
          <div className="obx-cards">
            <div className="obx-card">
              <h2>Settlement</h2>
              <Facts items={[
                {
                  label: 'F&F status',
                  value: employee?.fnf_status || 'none',
                  node: <span className="obx-pill">{employee?.fnf_status || 'none'}</span>,
                },
                {
                  label: 'Net payable',
                  value: employee?.fnf?.net_payable != null
                    ? `₹${Number(employee.fnf.net_payable).toLocaleString('en-IN')}`
                    : '—',
                },
                { label: 'Settlement ID', value: employee?.fnf?.settlement_id },
                rehirePolicy ? {
                  label: 'Rehire',
                  value: rehirePolicy.can_rejoin_now ? 'Eligible' : 'Blocked',
                  node: (
                    <span className={`obx-pill ${rehirePolicy.can_rejoin_now ? 'obx-pill--ok' : 'obx-pill--bad'}`}>
                      {rehirePolicy.can_rejoin_now ? 'Eligible' : 'Blocked'}
                    </span>
                  ),
                } : null,
                rehirePolicy?.rehire_cooldown_until ? {
                  label: 'Cooldown until',
                  value: rehirePolicy.rehire_cooldown_until,
                } : null,
                rehirePolicy && !rehirePolicy.can_rejoin_now && rehirePolicy.rehire_block_reason
                  && !/cooldown/i.test(rehirePolicy.rehire_block_reason) ? {
                    label: 'Block reason',
                    value: rehirePolicy.rehire_block_reason,
                    wide: true,
                  } : null,
              ]} />
            </div>

            <div className="obx-card">
              <h2>Exit interview</h2>
              {exitInterview?.submitted_at ? (
                <>
                  <Facts items={[
                    { label: 'Employee rating', value: `${exitInterview.overall_rating || '—'}/5` },
                    { label: 'Would recommend', value: exitInterview.would_recommend ? 'Yes' : 'No' },
                  ]} />
                  {exitInterview.feedback ? <p className="obx-quote">{exitInterview.feedback}</p> : null}
                </>
              ) : (
                <p className="obx-muted">No employee feedback submitted.</p>
              )}
              <form className="obx-form" onSubmit={(event) => { event.preventDefault(); saveHrInterview(); }}>
                <label className="obx-check-row">
                  <input
                    type="checkbox"
                    checked={hrForm.hr_interview_completed}
                    onChange={(e) => setHrForm((f) => ({ ...f, hr_interview_completed: e.target.checked }))}
                  />
                  HR interview completed
                </label>
                <div className="obx-span">
                  <label htmlFor="detail-interview-date">Interview date</label>
                  <input
                    id="detail-interview-date"
                    type="date"
                    value={hrForm.hr_interview_date}
                    onChange={(e) => setHrForm((f) => ({ ...f, hr_interview_date: e.target.value }))}
                  />
                </div>
                <div className="obx-span">
                  <label htmlFor="detail-interview-notes">HR notes</label>
                  <textarea
                    id="detail-interview-notes"
                    rows={3}
                    value={hrForm.hr_notes}
                    onChange={(e) => setHrForm((f) => ({ ...f, hr_notes: e.target.value }))}
                  />
                </div>
                <button type="submit" className="obx-btn obx-btn--primary" disabled={hrInterviewSaving}>
                  {hrInterviewSaving ? 'Saving…' : 'Save HR interview'}
                </button>
              </form>
            </div>

            <div className="obx-card">
              <h2>Profile</h2>
              <Facts items={[
                { label: 'Name', value: basic.name },
                { label: 'Username', value: basic.username },
                { label: 'Email', value: basic.email, wide: true },
                { label: 'Mobile', value: basic.mobile },
              ]} />
            </div>

            <div className="obx-card">
              <h2>Employment</h2>
              <Facts items={[
                { label: 'Employee ID', value: employment.emp_id },
                { label: 'Date of joining', value: employment.doj },
                { label: 'Circle', value: employment.circle },
                { label: 'Department', value: employment.emp_type },
              ]} />
            </div>

            <div className="obx-card obx-card--wide">
              <h2>Exit</h2>
              <Facts items={[
                { label: 'Exit date', value: exitInfo.exit_date },
                { label: 'Exit type', value: exitInfo.exit_type },
                { label: 'Reason', value: exitInfo.exit_reason, wide: true },
              ]} />
              {exitHistory.length > 0 ? (
                <ul className="obx-history">
                  {exitHistory.map((row) => (
                    <li key={row.id}>
                      <div>
                        <strong>{row.exit_type || 'Exit'}</strong>
                        <span>Last working day {formatDateDDMMYYYY(row.last_working_day || row.exit_date)}</span>
                      </div>
                      <small>{row.created_by || '—'}</small>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="obx-card">
              <h2>Previous company</h2>
              {Array.isArray(previous) && previous.length > 0 ? (
                previous.map((pc, i) => (
                  <div key={i} className="obx-doc">
                    <Facts items={[
                      { label: 'Company', value: pc.companyName },
                      { label: 'Designation', value: pc.designation },
                      { label: 'From', value: pc.doj },
                      { label: 'To', value: pc.dateOfLeaving },
                      pc.experienceYears ? { label: 'Experience', value: `${pc.experienceYears} yrs` } : null,
                    ]} />
                  </div>
                ))
              ) : (
                <p className="obx-muted">No previous company on file.</p>
              )}
            </div>

            <div className="obx-card">
              <h2>Education</h2>
              {Array.isArray(education) && education.length > 0 ? (
                education.map((row, i) => (
                  <div key={i} className="obx-doc">
                    <Facts items={[
                      { label: 'Degree', value: row.degree },
                      { label: 'Year', value: row.year },
                      { label: 'Institute', value: row.institute, wide: true },
                    ]} />
                  </div>
                ))
              ) : (
                <p className="obx-muted">No education on file.</p>
              )}
            </div>

            <div className="obx-card obx-card--wide">
              <h2>Documents</h2>
              {Array.isArray(documents) && documents.length > 0 ? (
                <div className="obx-docs">
                  {documents.map((d, i) => {
                    const hasFile = Boolean(d.file);
                    const isImage = d.file && /\.(png|jpe?g|gif|webp)$/i.test(d.file || '');
                    return (
                      <div key={i} className="obx-doc-tile">
                        <span>{d.doc_type || 'Document'}</span>
                        {hasFile ? (
                          <button type="button" className="obx-link" onClick={() => openArchiveDoc(d.file)}>View file</button>
                        ) : (
                          <em>Not uploaded</em>
                        )}
                        {hasFile && isImage ? <SecureArchiveThumb path={d.file} alt={d.doc_type || 'Document'} /> : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="obx-muted">No documents on file.</p>
              )}
            </div>
          </div>
        )}
    </section>
  );
};

export default ArchiveEmployeeDetails;
