import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, ChevronDown, ChevronUp, Download, Eye, FileCheck2, Send } from 'lucide-react';
import { useUser } from '../../components/layout/UserContext';
import './NocApplication.css';

const API_URL = '/api/leave/noc-applications';
const REQUEST_OPTIONS = [
  { value: 'exit_no_dues', label: 'No dues clearance (Exit)' },
  { value: 'banking_bonafide', label: 'Bonafide letter for banking purpose' },
  { value: 'travel_bonafide', label: 'Bonafide letter for visa (personal holiday)' },
  { value: 'other', label: 'Other reason' },
];
const NO_DUES_DEPARTMENTS = [
  { value: 'MANAGER', label: 'Manager' },
  { value: 'INVENTORY', label: 'Inventory' },
  { value: 'IT', label: 'IT' },
  { value: 'ACCOUNTS', label: 'Accounts' },
  { value: 'HR', label: 'Human Resource' },
];

function authHeaders(json = false) {
  const token = localStorage.getItem('token');
  return {
    Authorization: `Bearer ${token || ''}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default function NocApplication() {
  const { userData } = useUser();
  const sessionUser = userData?.user || {};
  const [employee, setEmployee] = useState(() => ({
    name: sessionUser.name || sessionUser.first_name || sessionUser.user_name || '',
    email: sessionUser.email || '',
    employee_id: sessionUser.emp_id || '',
    circle: sessionUser.circle || '',
  }));
  const [today, setToday] = useState(new Date().toISOString().slice(0, 10));
  const [separation, setSeparation] = useState(null);
  const [requests, setRequests] = useState([]);
  const [visibleRequestCount, setVisibleRequestCount] = useState(3);
  const [expandedStatusIds, setExpandedStatusIds] = useState({});
  const [downloadingId, setDownloadingId] = useState(null);
  const [requestType, setRequestType] = useState('');
  const [departmentKeys, setDepartmentKeys] = useState([]);
  const [otherReason, setOtherReason] = useState('');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [serviceAvailable, setServiceAvailable] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setEmployee({
      name: sessionUser.name || sessionUser.first_name || sessionUser.user_name || '',
      email: sessionUser.email || '',
      employee_id: sessionUser.emp_id || '',
      circle: sessionUser.circle || '',
    });
    try {
      const response = await fetch(API_URL, { headers: authHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        if (response.status === 404) {
          // A 404 can also be the API's authenticated "employee not found"
          // response. Only report a missing endpoint when the server did not
          // return that application-level error; otherwise restarting cannot
          // fix a stale or invalid employee identity.
          const message = String(data.message || '').toLowerCase();
          if (message.includes('employee not found')) {
            throw new Error('We could not match your login to an employee record. Please sign out and back in, then contact HR if this continues.');
          }
          throw new Error('The NOC request endpoint is not available on the backend currently serving this app. Confirm the updated HR backend is running and reachable at /api/leave/noc-applications.');
        }
        throw new Error(data.message || 'Unable to load your request details.');
      }
      setServiceAvailable(true);
      setEmployee((current) => ({ ...current, ...(data.employee || {}) }));
      setToday(data.today || new Date().toISOString().slice(0, 10));
      setSeparation(data.separation || null);
      setRequests(Array.isArray(data.requests) ? data.requests : []);
      setVisibleRequestCount(3);
    } catch (err) {
      if (err.message?.includes('endpoint is not available') || err.message?.includes('Restart the backend server')) setServiceAvailable(false);
      try {
        const response = await fetch('/api/leave/seperation', { headers: authHeaders() });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.success) {
          const resignation = data.already_submitted ? data.resignation : null;
          setSeparation(resignation ? {
            id: resignation.id,
            date: resignation.resignation_date,
            reason: resignation.reason,
            status: resignation.status,
          } : null);
          if (data.employee) {
            setEmployee((current) => ({
              ...current,
              name: current.name || data.employee.name || '',
              email: current.email || data.employee.email || '',
              circle: current.circle || data.employee.circle || '',
            }));
          }
        }
      } catch {
        // UserContext still provides the employee identity fields.
      }
      setError(err.message || 'Unable to load your details.');
    } finally {
      setLoading(false);
    }
  }, [sessionUser.name, sessionUser.first_name, sessionUser.user_name, sessionUser.email, sessionUser.emp_id, sessionUser.circle]);

  useEffect(() => { load(); }, [load]);

  const needsSeparation = requestType === 'exit_no_dues';
  const canSubmit = Boolean(
    serviceAvailable && requestType && details.trim() && (!needsSeparation || (separation && departmentKeys.length > 0))
      && (requestType !== 'other' || otherReason.trim()),
  );

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ request_type: requestType, other_reason: otherReason, details, department_keys: departmentKeys }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Unable to submit your request.');
      setSuccess(data.message || 'Your request was submitted to Human Resources.');
      setRequestType('');
      setDepartmentKeys([]);
      setOtherReason('');
      setDetails('');
      await load();
    } catch (err) {
      setError(err.message || 'Unable to submit your request.');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadFile = async (downloadUrl, filename, key) => {
    if (!downloadUrl || downloadingId) return;
    setDownloadingId(key);
    setError('');
    try {
      const response = await fetch(downloadUrl, { headers: authHeaders() });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Unable to download the requested NOC file.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename || 'noc-clearance';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      setError(err.message || 'Unable to download the requested NOC file.');
    } finally {
      setDownloadingId(null);
    }
  };

  const sortedRequests = [...requests].sort((a, b) => {
    const dateDifference = new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    return (Number.isNaN(dateDifference) ? 0 : dateDifference) || Number(b.id || 0) - Number(a.id || 0);
  });

  if (loading) return <main className="noc-application"><div className="noc-application__loading">Loading your details…</div></main>;

  return (
    <main className="noc-application">
      <div className="noc-application__shell">
        <Link className="noc-application__back" to="/dashboard"><ArrowLeft size={17} /> Back to dashboard</Link>
        <header className="noc-application__hero">
          <span className="noc-application__hero-icon"><FileCheck2 size={26} /></span>
          <div className="noc-application__hero-text">
            <p className="noc-application__eyebrow">EMPLOYEE SERVICES</p>
            <h1>Apply for NOC</h1>
            <p>Request an exit clearance or a bonafide letter from Human Resources.</p>
          </div>
          <span className="noc-application__hero-date">Applied on {formatDate(today)}</span>
        </header>

        {error && <div className="noc-application__alert noc-application__alert--error" role="alert">{error}</div>}
        {success && <div className="noc-application__alert noc-application__alert--success" role="status"><BadgeCheck size={18} />{success}</div>}

        <section className="noc-application__card" aria-labelledby="noc-employee-details">
          <div className="noc-application__card-head">
            <div><span className="noc-application__step">01</span><h2 id="noc-employee-details">Your details</h2></div>
            <span className="noc-application__date">Applied on {formatDate(today)}</span>
          </div>
          <div className="noc-application__details-grid">
            <div><span>Employee name</span><strong>{employee?.name || '—'}</strong></div>
            <div><span>Email</span><strong>{employee?.email || '—'}</strong></div>
            <div><span>Employee ID</span><strong>{employee?.employee_id || '—'}</strong></div>
            <div><span>Circle</span><strong>{employee?.circle || '—'}</strong></div>
          </div>
          <div className={`noc-application__separation${separation ? '' : ' is-empty'}`}>
            <div><span>Separation request</span><strong>{separation ? `${separation.status} · ${formatDate(separation.date)}` : 'No active separation request'}</strong></div>
            {separation && <p>{separation.reason}</p>}
          </div>
        </section>

        <form className="noc-application__card noc-application__form" onSubmit={submit}>
          <div className="noc-application__card-head">
            <div><span className="noc-application__step">02</span><h2>Request details</h2></div>
          </div>
          <label className="noc-application__field">
            <span className="noc-application__field-label"><span>*</span> Select NOC or letter Required</span>
            <select value={requestType} onChange={(event) => { setRequestType(event.target.value); setDepartmentKeys([]); setError(''); }} required>
              <option value="">Select</option>
              {REQUEST_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          {needsSeparation && separation && (
            <fieldset className="noc-application__departments">
              <legend>Departments requiring no-dues clearance <span>*</span></legend>
              <p>Select every department that needs to provide a clearance.</p>
              <div className="noc-application__department-options">
                {NO_DUES_DEPARTMENTS.map(({ value, label }) => (
                  <label key={value} className="noc-application__department-option">
                    <input
                      type="checkbox"
                      checked={departmentKeys.includes(value)}
                      onChange={(event) => setDepartmentKeys((current) => event.target.checked
                        ? [...current, value]
                        : current.filter((key) => key !== value))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="noc-application__flow" aria-label="Approval flow">
                <p>Approval flow</p>
                <ol>
                  {NO_DUES_DEPARTMENTS.map(({ value, label }, index) => (
                    <li key={value} className={departmentKeys.includes(value) ? 'is-selected' : undefined}>
                      {index > 0 ? <span className="noc-application__flow-arrow" aria-hidden>→</span> : null}
                      <span>{label}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </fieldset>
          )}

          {needsSeparation && !separation && (
            <div className="noc-application__alert noc-application__alert--warning" role="alert">
              Apply for separation first. No-dues clearance for exit is available after your separation request is submitted.
              <Link to="/separation">Go to Separation</Link>
            </div>
          )}

          {requestType === 'other' && (
            <label className="noc-application__field">
              Reason for request <span>*</span>
              <input maxLength={255} value={otherReason} onChange={(event) => setOtherReason(event.target.value)} placeholder="Enter the reason for your request" required />
            </label>
          )}

          {requestType && (
            <label className="noc-application__field">
              Additional details <span>*</span>
              <textarea rows={5} maxLength={5000} value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Add the information HR needs to process your request" required />
              <small>{details.length}/5000</small>
            </label>
          )}

          <div className="noc-application__actions">
            <p>{needsSeparation ? 'Each selected department will receive a review task and email.' : 'Your request will be sent to Human Resources for review.'}</p>
            <button type="submit" disabled={!canSubmit || submitting}>
              <Send size={16} /> {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </form>

        {requests.length > 0 && (
          <section className="noc-application__card">
            <div className="noc-application__card-head"><div><span className="noc-application__step">03</span><h2>Your NOC requests</h2></div></div>
            <div className="noc-application__history">
              {sortedRequests.slice(0, visibleRequestCount).map((item) => (
                <article key={item.id}>
                  <div><strong>{item.request_label}</strong><span>{formatDate(item.created_at)}</span></div>
                  {item.other_reason && <p>Reason: {item.other_reason}</p>}
                  {item.department_labels?.length > 0 && <p>Departments: {item.department_labels.join(', ')}</p>}
                  <p>{item.details}</p>
                  {item.hr_remarks && <p><strong>HR remarks:</strong> {item.hr_remarks}</p>}
                  {item.hr_document && (
                    <div className="noc-application__request-file">
                      <span>HR uploaded · {item.hr_document.filename}</span>
                      <button
                        type="button"
                        onClick={() => downloadFile(item.hr_document.download_url, item.hr_document.filename, `${item.id}-hr-document`)}
                        disabled={Boolean(downloadingId)}
                      >
                        <Download size={14} /> {downloadingId === `${item.id}-hr-document` ? 'Downloading…' : 'Download file'}
                      </button>
                    </div>
                  )}
                  {item.department_requests?.length > 0 && (
                    <button
                      type="button"
                      className="noc-application__view-status"
                      aria-expanded={Boolean(expandedStatusIds[item.id])}
                      onClick={() => setExpandedStatusIds((current) => ({
                        ...current,
                        [item.id]: !current[item.id],
                      }))}
                    >
                      <Eye size={15} />
                      {expandedStatusIds[item.id] ? 'Hide status' : 'View status'}
                      <span>
                        {item.department_requests.filter((d) => ['uploaded', 'approved', 'cleared', 'completed'].includes(String(d.status || '').toLowerCase())).length}
                        /{item.department_requests.length} uploaded
                      </span>
                      {expandedStatusIds[item.id] ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                  )}
                  {item.department_requests?.length > 0 && expandedStatusIds[item.id] && (
                    <div className="noc-application__department-history" aria-label="Department clearance status">
                      <strong>Department clearance status</strong>
                      {item.department_requests.map((department) => {
                        const downloadKey = `${item.id}-department-${department.id}`;
                        return (
                          <div className="noc-application__department-row" key={department.id}>
                            <div className="noc-application__department-info">
                              <strong>{department.department_label}</strong>
                              <span>Requested {formatDate(department.requested_at)}</span>
                            </div>
                            <span className={`noc-application__department-status noc-application__department-status--${String(department.status || '').toLowerCase()}`}>{department.status}</span>
                            {department.filename && (
                              <button
                                type="button"
                                onClick={() => downloadFile(department.download_url, department.filename, downloadKey)}
                                disabled={Boolean(downloadingId)}
                              >
                                <Download size={14} /> {downloadingId === downloadKey ? 'Downloading…' : 'Download file'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {item.final_noc && (
                    <div className="noc-application__request-file">
                      <span>Final NOC certificate · {item.final_noc.filename}</span>
                      <button
                        type="button"
                        onClick={() => downloadFile(item.final_noc.download_url, item.final_noc.filename, `${item.id}-final-noc`)}
                        disabled={Boolean(downloadingId)}
                      >
                        <Download size={14} /> {downloadingId === `${item.id}-final-noc` ? 'Downloading…' : 'Download file'}
                      </button>
                    </div>
                  )}
                  <span className={`noc-application__status noc-application__status--${String(item.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{item.status}</span>
                </article>
              ))}
              {visibleRequestCount < sortedRequests.length && (
                <button
                  type="button"
                  className="noc-application__show-more"
                  onClick={() => setVisibleRequestCount((count) => count + 5)}
                >
                  Show 5 more requests
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
