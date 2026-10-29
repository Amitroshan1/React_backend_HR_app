import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Download, Eye, RefreshCw, Upload } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './offboarding-ui.css';

const HR_API_BASE = '/api/HumanResource';

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function countNocs(request, separation) {
  const departments = separation?.noc_items || request?.departments || [];
  return {
    total: departments.length,
    uploaded: departments.filter((item) => ['uploaded', 'approved', 'cleared', 'completed'].includes(String(item.status || '').toLowerCase())).length,
  };
}

const WORKFLOW_LABELS = {
  pending_hr: 'Pending HR',
  pending_admin: 'Pending Admin',
  approved: 'Admin approved',
  rejected: 'Admin rejected',
};

function requestStatus(request, separation) {
  if (request.request_type !== 'exit_no_dues') {
    return WORKFLOW_LABELS[request.workflow_status] || (request.hr_document ? 'Document uploaded' : 'Pending HR');
  }
  if (String(separation?.manager_status || request.manager_status || '').toLowerCase() === 'rejected') return 'Manager rejected';
  if (String(separation?.manager_status || request.manager_status || '').toLowerCase() === 'pending') return 'Pending manager';
  const { total, uploaded } = countNocs(request, separation);
  if (!total || uploaded < total) return 'NOC pending';
  return 'NOCs uploaded';
}

function statusCategory(request) {
  if (request.request_type !== 'exit_no_dues') {
    return request.workflow_status || 'pending_hr';
  }
  const s = requestStatus(request, null).toLowerCase();
  return s.includes('pending') ? 'pending' : 'responded';
}

function statusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('approved') || normalized.includes('uploaded') || normalized.includes('responded')) return 'obx-pill--ok';
  if (normalized.includes('rejected')) return 'obx-pill--bad';
  return 'obx-pill--warn';
}

const TYPE_FILTERS = [
  ['all', 'All types'],
  ['exit_no_dues', 'No dues (Exit)'],
  ['banking_bonafide', 'Banking'],
  ['travel_bonafide', 'Visa'],
  ['other', 'Other'],
];

const STATUS_FILTERS = [
  ['all', 'All'],
  ['pending', 'Pending HR'],
  ['pending_admin', 'Pending Admin'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['responded', 'Responded'],
];

export default function HRNocApplicationRequests({ onBack }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [separation, setSeparation] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [notice, setNotice] = useState('');
  const [savingRemarks, setSavingRemarks] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [tab, setTab] = useState('requests');
  const [history, setHistory] = useState([]);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [submittingAdmin, setSubmittingAdmin] = useState(false);

  const loadHistory = useCallback(async (status = historyFilter) => {
    setHistoryLoading(true);
    try {
      const response = await fetch(
        `${HR_API_BASE}/noc-applications/history?status=${encodeURIComponent(status)}`,
        { headers: authHeaders() }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Unable to load NOC history.');
      setHistory(data.history || []);
    } catch (err) {
      setError(err.message || 'Unable to load NOC history.');
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${HR_API_BASE}/noc-applications`, { headers: authHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Unable to load NOC requests.');
      setRequests(data.requests || []);
      if (selectedRequest) {
        const latest = (data.requests || []).find((item) => String(item.id) === String(selectedRequest.id));
        if (latest) {
          setSelectedRequest(latest);
          setRemarks(latest.hr_remarks || '');
        }
      }
    } catch (err) {
      setError(err.message || 'Unable to load NOC requests.');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [selectedRequest]);

  useRefreshOnNavigate(load, []);

  const openDetails = async (request) => {
    setSelectedRequest(request);
    setSeparation(null);
    setRemarks(request.hr_remarks || '');
    setNotice('');
    setError('');
    if (!request.separation_id) return;
    try {
      const response = await fetch(`${HR_API_BASE}/separations/${request.separation_id}`, { headers: authHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Unable to load separation and NOC details.');
      setSeparation(data.separation || null);
    } catch (err) {
      setError(err.message || 'Unable to load separation and NOC details.');
    }
  };

  const saveRemarks = async () => {
    if (!selectedRequest || savingRemarks) return;
    setSavingRemarks(true);
    setError('');
    setNotice('');
    try {
      const isLegacy = String(selectedRequest.id).startsWith('legacy-separation-');
      const endpoint = isLegacy
        ? `${HR_API_BASE}/separations/${selectedRequest.separation_id}/remarks`
        : `${HR_API_BASE}/noc-applications/${selectedRequest.id}/remarks`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ remarks }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Unable to submit HR remarks.');
      const saved = data.hr_remarks || '';
      setRemarks(saved);
      setSelectedRequest((current) => ({ ...current, hr_remarks: saved }));
      setRequests((current) => current.map((item) => String(item.id) === String(selectedRequest.id) ? { ...item, hr_remarks: saved } : item));
      if (separation) setSeparation((current) => ({ ...current, hr_remarks: saved }));
      setNotice('HR remarks submitted. The employee can now see them on the NOC request.');
    } catch (err) {
      setError(err.message || 'Unable to submit HR remarks.');
    } finally {
      setSavingRemarks(false);
    }
  };

  const uploadFile = async (file) => {
    if (!file || !selectedRequest || uploading) return;
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const isExitRequest = selectedRequest.request_type === 'exit_no_dues' && separation;
      const endpoint = isExitRequest
        ? `${HR_API_BASE}/separations/${selectedRequest.separation_id}/noc/hr/upload`
        : `${HR_API_BASE}/noc-applications/${selectedRequest.id}/upload`;
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(endpoint, { method: 'POST', headers: authHeaders(), body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Unable to upload the NOC document.');
      setNotice('NOC document uploaded. The employee can download it from this request.');
      if (isExitRequest) {
        const updatedResponse = await fetch(`${HR_API_BASE}/separations/${selectedRequest.separation_id}`, { headers: authHeaders() });
        const updated = await updatedResponse.json().catch(() => ({}));
        if (updatedResponse.ok && updated.success) setSeparation(updated.separation || null);
      }
      await load();
    } catch (err) {
      setError(err.message || 'Unable to upload the NOC document.');
    } finally {
      setUploading(false);
    }
  };

  const downloadFile = async (url, filename) => {
    if (!url) return;
    setError('');
    try {
      const response = await fetch(url, { headers: authHeaders() });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Unable to download the NOC document.');
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename || 'noc-document';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      setError(err.message || 'Unable to download the NOC document.');
    }
  };

  const submitToAdmin = async () => {
    if (!selectedRequest || submittingAdmin) return;
    setSubmittingAdmin(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`${HR_API_BASE}/noc-applications/${selectedRequest.id}/submit-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ remarks }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Unable to submit to Admin.');
      setNotice(data.message || 'Sent to Admin for approval.');
      await load();
    } catch (err) {
      setError(err.message || 'Unable to submit to Admin.');
    } finally {
      setSubmittingAdmin(false);
    }
  };

  const visibleRequests = useMemo(() => requests.filter((request) => {
    if (typeFilter !== 'all' && request.request_type !== typeFilter) return false;
    if (filter === 'all') return true;
    const cat = statusCategory(request);
    if (filter === 'pending') return cat === 'pending' || cat === 'pending_hr';
    if (filter === 'responded') return cat === 'approved' || cat === 'rejected' || cat === 'responded';
    return cat === filter;
  }), [requests, filter, typeFilter]);

  if (selectedRequest) {
    const nocItems = separation?.noc_items || [];
    const nocCount = countNocs(selectedRequest, separation);
    const isExitRequest = selectedRequest.request_type === 'exit_no_dues';
    const isLegacy = String(selectedRequest.id).startsWith('legacy-separation-');
    return (
      <main className="obx">
        <header className="obx-head">
          <div>
            <button type="button" className="obx-back" onClick={() => { setSelectedRequest(null); setSeparation(null); setError(''); setNotice(''); }}>
              <ArrowLeft size={16} /> Back to NOC requests
            </button>
            <h1>NOC request details</h1>
            <p>Review the employee request, department clearances, and HR response.</p>
          </div>
          <div className="obx-actions">
            <button type="button" className="obx-btn" onClick={() => openDetails(selectedRequest)}><RefreshCw size={16} /> Refresh</button>
          </div>
        </header>
        {error ? <p className="obx-alert" role="alert">{error}</p> : null}
        {notice ? <p className="obx-alert obx-alert--ok" role="status">{notice}</p> : null}

        <section className="obx-panel">
          <div className="obx-panel-head">
            <h2>{selectedRequest.employee_name || 'Employee'} · {selectedRequest.request_label}</h2>
            <span className={`obx-pill ${statusClass(requestStatus(selectedRequest, separation))}`}>{requestStatus(selectedRequest, separation)}</span>
          </div>
          <div className="obx-sep-detail-grid">
            <div className="obx-sep-field"><span>Employee ID</span><strong>{selectedRequest.employee_id || '—'}</strong></div>
            <div className="obx-sep-field"><span>Email</span><strong>{selectedRequest.email || '—'}</strong></div>
            <div className="obx-sep-field"><span>Circle</span><strong>{selectedRequest.circle || '—'}</strong></div>
            <div className="obx-sep-field"><span>Submitted</span><strong>{formatDateDDMMYYYY(selectedRequest.created_at, '—')}</strong></div>
            {selectedRequest.separation_id ? <>
              <div className="obx-sep-field"><span>Separation date</span><strong>{formatDateDDMMYYYY(separation?.resignation_date, '—')}</strong></div>
              <div className="obx-sep-field"><span>Manager status</span><strong>{separation?.manager_status || 'Loading…'}</strong></div>
            </> : null}
            {selectedRequest.other_reason ? <div className="obx-sep-field obx-sep-field--full"><span>Reason</span><strong>{selectedRequest.other_reason}</strong></div> : null}
            <div className="obx-sep-field obx-sep-field--full"><span>Request details</span><strong className="obx-sep-reason">{selectedRequest.details || '—'}</strong></div>
          </div>
        </section>

        {isExitRequest ? (
          <section className="obx-panel">
            <div className="obx-panel-head"><h2>NOC clearances</h2><span className="obx-muted">{nocCount.uploaded}/{nocCount.total} uploaded</span></div>
            {!separation ? <p className="obx-loading">Loading department NOC details…</p> : nocItems.length === 0 ? <p className="obx-empty">No department NOCs were requested.</p> : (
              <div className="obx-table-wrap"><table className="obx-table">
                <thead><tr><th>Department</th><th>Status</th><th>File</th><th>Actions</th></tr></thead>
                <tbody>{nocItems.map((noc) => (
                  <tr key={noc.id}>
                    <td>{noc.department_label}</td>
                    <td><span className={`obx-pill ${statusClass(noc.status)}`}>{noc.status}</span></td>
                    <td>{noc.filename || '—'}</td>
                    <td><div className="obx-row-actions">
                      {noc.can_download ? <button type="button" className="obx-link" onClick={() => downloadFile(`${HR_API_BASE}/separations/${selectedRequest.separation_id}/noc/${noc.id}/download`, noc.filename)}><Download size={14} /> View / download</button> : null}
                      {noc.can_upload ? <label className="obx-link obx-upload-label"><Upload size={14} />{uploading ? 'Uploading…' : 'Upload HR NOC'}<input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" hidden disabled={uploading} onChange={(event) => { uploadFile(event.target.files?.[0]); event.target.value = ''; }} /></label> : null}
                      {!noc.can_download && !noc.can_upload ? <span className="obx-muted">Waiting</span> : null}
                    </div></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        ) : (
          <>
          <section className="obx-panel">
            <div className="obx-panel-head"><h2>HR response document</h2></div>
            {selectedRequest.hr_document ? (
              <div className="obx-row-actions">
                <span>{selectedRequest.hr_document.filename}</span>
                <button type="button" className="obx-link" onClick={() => downloadFile(`${HR_API_BASE}/noc-applications/${selectedRequest.id}/download`, selectedRequest.hr_document.filename)}><Download size={14} /> View / download</button>
              </div>
            ) : <p className="obx-muted">No NOC or letter has been uploaded yet.</p>}
            {['pending_admin', 'approved'].includes(selectedRequest.workflow_status) ? (
              <p className="obx-muted">Document locked while with Admin / approved.</p>
            ) : (
              <label className="obx-link obx-upload-label"><Upload size={14} />{uploading ? 'Uploading…' : 'Upload NOC / letter'}<input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" hidden disabled={uploading} onChange={(event) => { uploadFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
            )}
          </section>

          <section className="obx-panel">
            <div className="obx-panel-head"><h2>Submit to Admin</h2></div>
            {selectedRequest.workflow_status === 'pending_admin' ? (
              <p className="obx-alert obx-alert--ok" role="status">Waiting for Admin approval. Employee can download after Admin approves.</p>
            ) : selectedRequest.workflow_status === 'approved' ? (
              <p className="obx-alert obx-alert--ok" role="status">Admin approved — employee can now download / view this document.</p>
            ) : selectedRequest.workflow_status === 'rejected' ? (
              <p className="obx-alert" role="alert">Admin rejected this submission. Update the document/remarks and submit again. See History for the decision.</p>
            ) : !selectedRequest.hr_document ? (
              <p className="obx-muted">Upload the NOC / letter first, then submit to Admin.</p>
            ) : null}
            <div className="obx-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="obx-btn obx-btn--primary"
                disabled={submittingAdmin || !selectedRequest.can_submit_to_admin}
                onClick={submitToAdmin}
              >
                {submittingAdmin ? 'Submitting…' : 'Submit to Admin for approval'}
              </button>
            </div>
          </section>
          </>
        )}

        <section className="obx-panel">
          <div className="obx-panel-head"><h2>HR remarks</h2></div>
          <label className="obx-sep-remarks">
            Remarks visible to the employee
            <textarea rows={4} maxLength={2000} value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Add an update or instructions for the employee." disabled={!isExitRequest && ['pending_admin', 'approved'].includes(selectedRequest.workflow_status)} />
          </label>
          <div className="obx-actions" style={{ marginTop: 12 }}>
            <button type="button" className="obx-btn obx-btn--primary" disabled={savingRemarks || (isLegacy && !selectedRequest.separation_id) || (!isExitRequest && ['pending_admin', 'approved'].includes(selectedRequest.workflow_status))} onClick={saveRemarks}>{savingRemarks ? 'Saving…' : 'Save remarks'}</button>
          </div>
        </section>
      </main>
    );
  }

  const summary = {
    all: requests.length,
    pending: requests.filter((r) => ['pending', 'pending_hr'].includes(statusCategory(r))).length,
    pending_admin: requests.filter((r) => statusCategory(r) === 'pending_admin').length,
    approved: requests.filter((r) => statusCategory(r) === 'approved').length,
    rejected: requests.filter((r) => statusCategory(r) === 'rejected').length,
    responded: requests.filter((r) => ['approved', 'rejected', 'responded'].includes(statusCategory(r))).length,
  };

  return (
    <main className="obx">
      <header className="obx-head">
        <div><button type="button" className="obx-back" onClick={onBack}><ArrowLeft size={16} /> Back to HR</button><h1>NOC requests</h1><p>Review employee applications, department clearances, and HR responses.</p></div>
        <div className="obx-actions"><button type="button" className="obx-btn" onClick={() => { load(); if (tab === 'history') loadHistory(); }} disabled={loading}><RefreshCw size={16} /> Refresh</button></div>
      </header>

      <div className="obx-tabs" role="tablist" aria-label="NOC sections">
        <button type="button" role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'is-active' : ''} onClick={() => setTab('requests')}>Requests</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'is-active' : ''} onClick={() => { setTab('history'); loadHistory(historyFilter); }}>History</button>
      </div>

      {tab === 'history' ? (
        <>
          <div className="obx-sep-filters" role="tablist" aria-label="NOC history filters">
            {[['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={historyFilter === key ? 'is-active' : ''}
                onClick={() => { setHistoryFilter(key); loadHistory(key); }}
              >
                {label}
              </button>
            ))}
          </div>
          {error ? <p className="obx-alert" role="alert">{error}</p> : null}
          {historyLoading ? <p className="obx-loading">Loading history…</p> : (
            <div className="obx-table-wrap">
              <table className="obx-table">
                <thead><tr><th>Employee</th><th>Request</th><th>File</th><th>Admin decision</th><th>Decided</th><th /></tr></thead>
                <tbody>{history.length ? history.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.employee_name || 'Employee'}</strong><span className="obx-sub">{[item.employee_id, item.email].filter(Boolean).join(' · ') || '—'}</span></td>
                    <td>{item.noc_request_label}</td>
                    <td>{item.hr_document_filename || '—'}</td>
                    <td><span className={`obx-pill ${statusClass(item.status)}`}>{item.status}</span>{item.decision_note ? <span className="obx-sub">{item.decision_note}</span> : null}</td>
                    <td>{item.decided_by_name || '—'}{item.decided_at ? <span className="obx-sub">{formatDateDDMMYYYY(item.decided_at, '—')}</span> : null}</td>
                    <td>{item.hr_download_url ? <button type="button" className="obx-link" onClick={() => downloadFile(item.hr_download_url, item.hr_document_filename)}><Download size={14} /> View file</button> : '—'}</td>
                  </tr>
                )) : <tr><td colSpan="6" className="obx-empty">No NOC history for this filter.</td></tr>}</tbody>
              </table>
            </div>
          )}
        </>
      ) : (
      <>
      <div className="obx-sep-filters" role="tablist" aria-label="NOC request status filters">
        {STATUS_FILTERS.map(([key, label]) => (
          <button key={key} type="button" className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)}>{label}{typeof summary[key] === 'number' && summary[key] > 0 ? <em>{summary[key]}</em> : null}</button>
        ))}
      </div>
      <div className="obx-sep-filters" role="tablist" aria-label="NOC request type filters">
        {TYPE_FILTERS.map(([key, label]) => (
          <button key={key} type="button" className={typeFilter === key ? 'is-active' : ''} onClick={() => setTypeFilter(key)}>{label}</button>
        ))}
      </div>
      {error ? <p className="obx-alert" role="alert">{error}</p> : null}
      {loading ? <p className="obx-loading">Loading NOC requests…</p> : (
        <div className="obx-table-wrap">
          <table className="obx-table">
            <thead><tr><th>Employee</th><th>Request</th><th>Submitted</th><th>Manager</th><th>NOC</th><th>Status</th><th /></tr></thead>
            <tbody>{visibleRequests.length ? visibleRequests.map((request) => {
              const counts = countNocs(request, null);
              const status = requestStatus(request, null);
              return <tr key={request.id}>
                <td><strong>{request.employee_name || 'Employee'}</strong><span className="obx-sub">{[request.employee_id, request.email].filter(Boolean).join(' · ') || '—'}</span></td>
                <td>{request.request_label}{request.other_reason ? <span className="obx-sub">{request.other_reason}</span> : null}</td>
                <td>{formatDateDDMMYYYY(request.created_at, '—')}</td>
                <td>{request.manager_status || (request.separation_id ? 'Pending' : 'HR review')}</td>
                <td>{request.request_type === 'exit_no_dues' ? `${counts.uploaded}/${counts.total}` : request.hr_document ? 'Uploaded' : '—'}</td>
                <td><span className={`obx-pill ${statusClass(status)}`}>{status}</span></td>
                <td><button type="button" className="obx-btn obx-btn--primary" onClick={() => openDetails(request)}><Eye size={14} /> View details</button></td>
              </tr>;
            }) : <tr><td colSpan="7" className="obx-empty">No NOC requests for this filter.</td></tr>}</tbody>
          </table>
        </div>
      )}
      </>
      )}
    </main>
  );
}
