import { useCallback, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, Upload } from 'lucide-react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './offboarding-ui.css';

const HR_API_BASE = '/api/HumanResource';

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function statusClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'uploaded' || s === 'approved') return 'obx-pill--ok';
  if (s === 'pending') return 'obx-pill--warn';
  if (s === 'rejected') return 'obx-pill--bad';
  return '';
}

/**
 * HR separation detail: manager status, NOCs, HR upload, remarks → Admin exit.
 */
export default function SeparationDetail({ resignationId, onBack }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!resignationId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${HR_API_BASE}/separations/${resignationId}`, {
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to load separation');
      }
      setDetail(data.separation || null);
      setRemarks(data.separation?.hr_remarks || '');
    } catch (err) {
      setError(err.message || 'Failed to load separation');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [resignationId]);

  useRefreshOnNavigate(() => {
    load();
  });

  const downloadNoc = async (nocReqId, filename) => {
    try {
      const res = await fetch(
        `${HR_API_BASE}/separations/${resignationId}/noc/${nocReqId}/download`,
        { headers: authHeaders() }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Download failed');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || `noc-${nocReqId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Download failed');
    }
  };

  const uploadHrNoc = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`${HR_API_BASE}/separations/${resignationId}/noc/hr/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Upload failed');
      }
      setNotice('HR NOC uploaded.');
      await load();
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const submitToAdmin = async () => {
    if (submitting) return;
    if ((remarks || '').trim().length < 10) {
      setError('Write HR remarks of at least 10 characters.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${HR_API_BASE}/separations/${resignationId}/submit-exit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          remarks: remarks.trim(),
          exit_date: detail?.exit_preview?.exit_date,
          last_working_day: detail?.exit_preview?.last_working_day,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Could not submit to Admin');
      }
      setNotice(data.message || 'Sent to Admin.');
      if (data.detail) {
        setDetail(data.detail);
        setRemarks(data.detail.hr_remarks || remarks);
      } else {
        await load();
      }
    } catch (err) {
      setError(err.message || 'Could not submit to Admin');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="obx">
      <header className="obx-head">
        <div>
          <button type="button" className="obx-back" onClick={onBack}>
            <ArrowLeft size={16} />
            Back to Offboarding
          </button>
          <h1>Separation details</h1>
          <p>Manager decision, NOC clearances, HR remarks, and Admin exit submission.</p>
        </div>
        <div className="obx-actions">
          <button type="button" className="obx-btn" onClick={load} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </header>

      {error ? <p className="obx-alert" role="alert">{error}</p> : null}
      {notice ? <p className="obx-alert obx-alert--ok" role="status">{notice}</p> : null}

      {loading && !detail ? (
        <p className="obx-loading">Loading…</p>
      ) : !detail ? (
        <p className="obx-empty">Separation not found.</p>
      ) : (
        <>
          <section className="obx-panel">
            <div className="obx-panel-head">
              <h2>{detail.employee_name}</h2>
              <span className={`obx-pill ${statusClass(detail.manager_status)}`}>
                Manager: {detail.manager_status}
              </span>
            </div>
            <div className="obx-sep-detail-grid">
              <div className="obx-sep-field">
                <span>Employee ID</span>
                <strong>{detail.emp_id || '—'}</strong>
              </div>
              <div className="obx-sep-field">
                <span>Email</span>
                <strong>{detail.employee_email || '—'}</strong>
              </div>
              <div className="obx-sep-field">
                <span>Circle / Dept</span>
                <strong>
                  {detail.circle || '—'} / {detail.emp_type || '—'}
                </strong>
              </div>
              <div className="obx-sep-field">
                <span>Resignation date</span>
                <strong>{formatDateDDMMYYYY(detail.resignation_date)}</strong>
              </div>
              <div className="obx-sep-field">
                <span>Applied on</span>
                <strong>{formatDateDDMMYYYY(detail.applied_on)}</strong>
              </div>
              <div className="obx-sep-field obx-sep-field--full">
                <span>Reason</span>
                <strong className="obx-sep-reason">{detail.reason || '—'}</strong>
              </div>
            </div>
          </section>

          <section className="obx-panel">
            <div className="obx-panel-head">
              <h2>NOC clearances</h2>
              <span className="obx-muted">
                {detail.noc_applied
                  ? `${detail.noc_uploaded}/${detail.noc_total} uploaded`
                  : 'Not applied'}
              </span>
            </div>
            {detail.noc_applied === false ? (
              <div>
                <p className="obx-empty" style={{ marginBottom: 8 }}>
                  Not applied for NOC
                </p>
                <p className="obx-muted">
                  Employee has not submitted “No dues clearance (Exit)” from Apply NOC.
                  Bonafide / other letter requests are not exit NOCs.
                </p>
              </div>
            ) : (detail.noc_items || []).length === 0 ? (
              <p className="obx-empty">No department NOCs were requested.</p>
            ) : (
              <div className="obx-table-wrap">
                <table className="obx-table">
                  <thead>
                    <tr>
                      <th>Department</th>
                      <th>Status</th>
                      <th>File</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.noc_items.map((noc) => (
                      <tr key={noc.id}>
                        <td>{noc.department_label}</td>
                        <td>
                          <span className={`obx-pill ${statusClass(noc.status)}`}>{noc.status}</span>
                        </td>
                        <td>{noc.filename || '—'}</td>
                        <td>
                          <div className="obx-row-actions">
                            {noc.can_download ? (
                              <button
                                type="button"
                                className="obx-link"
                                onClick={() => downloadNoc(noc.id, noc.filename)}
                              >
                                <Download size={14} /> View / download
                              </button>
                            ) : null}
                            {noc.can_upload ? (
                              <label className="obx-link obx-upload-label">
                                <Upload size={14} />
                                {uploading ? 'Uploading…' : 'Upload HR NOC'}
                                <input
                                  type="file"
                                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                                  hidden
                                  disabled={uploading}
                                  onChange={uploadHrNoc}
                                />
                              </label>
                            ) : null}
                            {!noc.can_download && !noc.can_upload ? (
                              <span className="obx-muted">Waiting</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="obx-panel">
            <div className="obx-panel-head">
              <h2>Submit exit to Admin</h2>
            </div>
            {detail.pending_admin_exit ? (
              <p className="obx-alert obx-alert--ok" role="status">
                An exit request is already waiting for Admin approval
                {detail.pending_exit?.id ? ` (#${detail.pending_exit.id})` : ''}.
                If Admin rejects it, check Request history.
              </p>
            ) : null}
            {detail.can_submit_to_admin && detail.noc_applied === false ? (
              <p className="obx-alert" role="status" style={{ background: 'var(--obx-warn-bg)', color: 'var(--obx-warn)' }}>
                No exit NOC applied — proceeding without department clearances.
              </p>
            ) : null}
            {!detail.can_submit_to_admin && !detail.pending_admin_exit ? (
              <p className="obx-muted">{detail.submit_blocked_reason}</p>
            ) : null}
            <label className="obx-sep-remarks">
              HR remarks
              <textarea
                rows={4}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Summarize clearance and any notes for Admin (min 10 characters)"
                disabled={detail.pending_admin_exit || detail.is_exited}
              />
            </label>
            <div className="obx-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="obx-btn obx-btn--primary"
                disabled={
                  submitting ||
                  !detail.can_submit_to_admin ||
                  detail.pending_admin_exit ||
                  detail.is_exited
                }
                onClick={submitToAdmin}
              >
                {submitting ? 'Submitting…' : 'Submit to Admin for exit approval'}
              </button>
            </div>
            <p className="obx-muted" style={{ marginTop: 8 }}>
              On Admin approve, the employee is exited and cannot log in. On reject, the outcome
              appears in Request history.
            </p>
          </section>
        </>
      )}
    </section>
  );
}
