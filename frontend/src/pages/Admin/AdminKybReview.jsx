import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { markKybSeen } from './kybInbox';
import { ArrowLeft, CheckCircle2, Download, FileText, RotateCcw } from 'lucide-react';
import './AdminKybReview.css';
import { canManageCustomerRegistry } from './customerRegistryAccess';
import { getAccessToken } from '../../utils/authSession';

const API_CUSTOMERS = '/api/admin/customers';

const DOC_LABELS = {
  coi: 'Certificate of incorporation',
  gst_cert: 'GST certificate',
  company_pan: 'Company PAN',
  authorization: 'Authorization / signatory proof',
};

function authHeaders(json = false) {
  const token = getAccessToken();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function statusClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'verified') return 'kyb-page__pill kyb-page__pill--ok';
  if (s === 'submitted') return 'kyb-page__pill kyb-page__pill--wait';
  if (s === 'needs_fix') return 'kyb-page__pill kyb-page__pill--fix';
  return 'kyb-page__pill';
}

export default function AdminKybReview() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const backTo = location.state?.from || '/admin/kyb';
  const [detail, setDetail] = useState(null);
  const [companyName, setCompanyName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!(await canManageCustomerRegistry(authHeaders()))) {
        navigate('/admin', { replace: true });
        return;
      }
      const listRes = await fetch(API_CUSTOMERS, {
        headers: authHeaders(),
        credentials: 'include',
      });
      const listData = await listRes.json().catch(() => ({}));
      const row = (listData.customers || []).find((c) => String(c.id) === String(customerId));
      if (row) {
        setCompanyName(row.company_name || '');
        markKybSeen(row);
      }
      const res = await fetch(`${API_CUSTOMERS}/${customerId}/kyb`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Could not load KYB pack');
      }
      setDetail(data);
    } catch (err) {
      setError(err.message || 'Could not load KYB pack');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [customerId, navigate]);

  useEffect(() => {
    load();
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const profile = detail?.profile || {};
  const auto = detail?.auto_check || {};
  const docs = detail?.documents || [];
  const status = (detail?.tenant?.kyc_status || '').replace(/_/g, ' ');

  const fields = useMemo(
    () => [
      { label: 'Legal name', value: profile.legal_name },
      { label: 'Entity type', value: profile.entity_type },
      { label: 'GSTIN', value: profile.gstin },
      { label: 'PAN', value: profile.pan },
      { label: 'CIN', value: profile.cin },
      {
        label: 'Authorised signatory',
        value: [profile.signatory_name, profile.signatory_email].filter(Boolean).join(' · ') || '',
      },
    ],
    [profile],
  );

  const fetchDocBlob = async (doc) => {
    const res = await fetch(`${API_CUSTOMERS}/${customerId}/kyb/documents/${doc.id}`, {
      headers: authHeaders(),
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Could not open document');
    return res.blob();
  };

  const downloadDoc = async (doc) => {
    try {
      const blob = await fetchDocBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.original_filename || doc.doc_type;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Download failed');
    }
  };

  const openPreview = async (doc) => {
    try {
      const blob = await fetchDocBlob(doc);
      if (preview?.url) URL.revokeObjectURL(preview.url);
      const url = URL.createObjectURL(blob);
      setPreview({
        url,
        name: doc.original_filename || doc.doc_type,
        type: blob.type || '',
      });
    } catch (err) {
      setError(err.message || 'Preview failed');
    }
  };

  const approve = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_CUSTOMERS}/${customerId}/kyb/approve`, {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Approve failed');
      navigate('/admin/kyb', {
        replace: true,
        state: { message: `${companyName || 'Company'} KYB approved — company is active` },
      });
    } catch (err) {
      setError(err.message || 'Approve failed');
    } finally {
      setSaving(false);
    }
  };

  const sendBack = async () => {
    const text = note.trim();
    if (text.length < 8) {
      setError('Explain what to fix (at least 8 characters).');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_CUSTOMERS}/${customerId}/kyb/request-changes`, {
        method: 'POST',
        headers: authHeaders(true),
        credentials: 'include',
        body: JSON.stringify({ note: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Could not request changes');
      navigate('/admin/kyb', {
        replace: true,
        state: { message: `Asked ${companyName || 'the company'} to update documents` },
      });
    } catch (err) {
      setError(err.message || 'Could not request changes');
    } finally {
      setSaving(false);
    }
  };

  const gst = auto.registry?.gst || {};
  const mca = auto.registry?.mca || {};

  return (
    <div className="kyb-page">
      <button type="button" className="kyb-page__back" onClick={() => navigate(backTo)}>
        <ArrowLeft size={16} /> {backTo === '/admin/customers' ? 'Companies' : 'KYB'}
      </button>

      <header className="kyb-page__hero">
        <div>
          <p className="kyb-page__eyebrow">KYB review</p>
          <h1>{companyName || 'Company verification'}</h1>
          <p>Check identity details and uploaded proofs, then approve or send back for corrections.</p>
        </div>
        {status ? <span className={statusClass(detail?.tenant?.kyc_status)}>{status}</span> : null}
      </header>

      {error ? <p className="kyb-page__error">{error}</p> : null}
      {loading ? <p className="kyb-page__muted">Loading pack…</p> : null}

      {!loading && detail ? (
        <>
          <section className="kyb-page__card">
            <h2>Company identity</h2>
            <div className="kyb-page__grid">
              {fields.map((f) => (
                <div key={f.label} className="kyb-page__field">
                  <span>{f.label}</span>
                  <strong>{f.value || '—'}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="kyb-page__card">
            <h2>Auto-check</h2>
            <ul className="kyb-page__checks">
              <li>
                {auto.identity_ok ? 'IDs look valid.' : `IDs: ${auto.identity_error || 'incomplete'}`}
                {(auto.missing_docs || []).length
                  ? ` Missing ${auto.missing_docs.join(', ')}.`
                  : ' Required files are present.'}
              </li>
              <li>
                GST: {gst.checksum_ok ? 'check digit valid' : 'check digit failed or blank'}
                {gst.live_status ? ` — registry ${gst.live_status}` : ' — live GST status not queried (no paid API)'}
              </li>
              <li>
                MCA/CIN: {mca.format_ok ? 'format valid' : 'no CIN or invalid'}
                {mca.live_status ? ` — registry ${mca.live_status}` : ' — live MCA status not queried (no paid API)'}
              </li>
              {auto.registry?.pan_matches_gstin != null ? (
                <li>PAN vs GSTIN: {auto.registry.pan_matches_gstin ? 'match' : 'mismatch'}</li>
              ) : null}
            </ul>
          </section>

          <section className="kyb-page__card">
            <h2>Uploaded documents</h2>
            {docs.length === 0 ? (
              <p className="kyb-page__muted">No files in this pack.</p>
            ) : (
              <div className="kyb-page__docs">
                {docs.map((doc) => (
                  <article key={doc.id} className="kyb-page__doc">
                    <div className="kyb-page__doc-icon" aria-hidden>
                      <FileText size={20} />
                    </div>
                    <div className="kyb-page__doc-body">
                      <strong>{DOC_LABELS[doc.doc_type] || doc.doc_type}</strong>
                      <span>{doc.original_filename || 'File'}</span>
                    </div>
                    <div className="kyb-page__doc-actions">
                      <button type="button" onClick={() => openPreview(doc)}>
                        Preview
                      </button>
                      <button type="button" onClick={() => downloadDoc(doc)}>
                        <Download size={14} /> Download
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {preview ? (
              <div className="kyb-page__preview">
                <div className="kyb-page__preview-bar">
                  <span>{preview.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(preview.url);
                      setPreview(null);
                    }}
                  >
                    Close preview
                  </button>
                </div>
                {preview.type.includes('pdf') || preview.name.toLowerCase().endsWith('.pdf') ? (
                  <iframe title={preview.name} src={preview.url} className="kyb-page__iframe" />
                ) : preview.type.startsWith('image/') ? (
                  <img src={preview.url} alt={preview.name} className="kyb-page__image" />
                ) : (
                  <p className="kyb-page__muted">Preview is not available for this file type. Download it instead.</p>
                )}
              </div>
            ) : null}
          </section>

          {detail.can_request_changes ? (
            <section className="kyb-page__card">
              <h2>Request changes</h2>
              <label className="kyb-page__note">
                What the customer must fix
                <textarea
                  rows={4}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Explain the correction needed (min 8 characters)"
                />
              </label>
            </section>
          ) : null}

          <footer className="kyb-page__footer">
            <button type="button" className="kyb-page__btn kyb-page__btn--ghost" onClick={() => navigate(backTo)}>
              Back to list
            </button>
            {detail.can_request_changes ? (
              <button type="button" className="kyb-page__btn" onClick={sendBack} disabled={saving}>
                <RotateCcw size={16} /> Send back
              </button>
            ) : null}
            {detail.can_approve ? (
              <button type="button" className="kyb-page__btn kyb-page__btn--primary" onClick={approve} disabled={saving}>
                <CheckCircle2 size={16} /> Approve &amp; activate
              </button>
            ) : null}
          </footer>
        </>
      ) : null}
    </div>
  );
}
