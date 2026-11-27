import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { AppFooter } from '../../components/layout/AppFooter';
import './CompanyKybPublic.css';

const API = '/api/public/company-kyb';

const emptyProfile = () => ({
  company_name: '',
  contact_email: '',
  country: '',
  legal_name: '',
  trade_name: '',
  entity_type: 'pvt_ltd',
  cin: '',
  llpin: '',
  gstin: '',
  pan: '',
  gst_exempt_reason: '',
  registered_address: '',
  signatory_name: '',
  signatory_designation: '',
  signatory_pan: '',
  signatory_mobile: '',
  signatory_email: '',
});

export default function CompanyKybPublic() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('t') || '').trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [ctx, setCtx] = useState(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [busy, setBusy] = useState(false);

  const applyCtx = (data, { keepProfile = true } = {}) => {
    setCtx(data);
    if (keepProfile && data?.profile) {
      setProfile((current) => ({ ...current, ...data.profile }));
    }
  };

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError('This page needs a valid link from your onboarding email.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}?t=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || 'This onboarding link is invalid or has expired.');
        setCtx(null);
        return;
      }
      applyCtx(data);
    } catch {
      setError('Network error. Check your connection and try again.');
      setCtx(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (key, value) => {
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const saveDraft = async () => {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const res = await fetch(`${API}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...profile }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || 'Could not save draft.');
        return;
      }
      applyCtx(data);
      setInfo('Draft saved.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (docType, file) => {
    if (!file) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const body = new FormData();
      body.append('token', token);
      body.append('doc_type', docType);
      body.append('file', file);
      const res = await fetch(`${API}/documents`, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || 'Could not upload file.');
        return;
      }
      applyCtx(data);
      setInfo('File uploaded.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const saveRes = await fetch(`${API}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...profile }),
      });
      const saveData = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok || !saveData.success) {
        setError(saveData.message || 'Could not save details.');
        return;
      }
      const res = await fetch(`${API}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || 'Could not submit.');
        if (saveData) applyCtx(saveData);
        return;
      }
      applyCtx(data, { keepProfile: false });
      setProfile(emptyProfile());
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const readOnly = Boolean(ctx?.read_only);
  const submitted = Boolean(ctx?.already_submitted);

  return (
    <div className="kyb-page">
      <header className="kyb-header">
        <Building2 size={28} />
        <div>
          <h1>Company onboarding</h1>
          <p>{ctx?.company_name || 'Company details and legal documents'}</p>
        </div>
      </header>
      <main className="kyb-main">
        {loading ? <p>Loading…</p> : null}
        {error ? <p className="kyb-error">{error}</p> : null}
        {info && !error ? <p className="kyb-info">{info}</p> : null}
        {ctx?.review_note ? (
          <p className="kyb-error">Please update: {ctx.review_note}</p>
        ) : null}
        {submitted ? (
          <div className="kyb-card">
            <h2>Submitted</h2>
            <p>Thank you. Super Admin has been notified and will review your details and documents. You will hear by email if anything else is needed.</p>
          </div>
        ) : null}
        {ctx && !loading && !submitted ? (
          <form className="kyb-card" onSubmit={submit}>
            <h2>Company</h2>
            <p className="kyb-hint">
              Subscription ({ctx.company?.plan_label || ctx.company?.plan || '—'}) and internal id
              ({ctx.company?.slug || '—'}) were set by your provider and cannot be changed here.
            </p>
            <label>
              Company name *
              <input
                value={profile.company_name}
                disabled={readOnly}
                onChange={(e) => setField('company_name', e.target.value)}
                required
              />
            </label>
            <label>
              Contact email *
              <input
                type="email"
                value={profile.contact_email}
                disabled={readOnly}
                onChange={(e) => setField('contact_email', e.target.value)}
                required
              />
            </label>
            <label>
              Country *
              <select
                value={
                  (ctx.countries || []).includes(profile.country)
                    ? profile.country
                    : (profile.country ? '__other__' : '')
                }
                disabled={readOnly}
                required
                onChange={(e) => {
                  if (e.target.value === '__other__') {
                    setField('country', (ctx.countries || []).includes(profile.country) ? ' ' : profile.country || ' ');
                    return;
                  }
                  setField('country', e.target.value);
                }}
              >
                <option value="">Choose a country</option>
                {(ctx.countries || []).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
                <option value="__other__">Other</option>
              </select>
            </label>
            {profile.country && !(ctx.countries || []).includes(profile.country) ? (
              <label>
                Country name *
                <input
                  value={profile.country.trim()}
                  disabled={readOnly}
                  onChange={(e) => setField('country', e.target.value)}
                  required
                />
              </label>
            ) : null}
            <h2>Legal entity</h2>
            <label>
              Legal name *
              <input
                value={profile.legal_name}
                disabled={readOnly}
                onChange={(e) => setField('legal_name', e.target.value)}
                required
              />
            </label>
            <label>
              Trade / brand name
              <input value={profile.trade_name} disabled={readOnly} onChange={(e) => setField('trade_name', e.target.value)} />
            </label>
            <label>
              Entity type *
              <select
                value={profile.entity_type}
                disabled={readOnly}
                onChange={(e) => setField('entity_type', e.target.value)}
              >
                {(ctx.entity_types || []).map((row) => (
                  <option key={row.id} value={row.id}>{row.label}</option>
                ))}
              </select>
            </label>
            <label>
              CIN
              <input value={profile.cin} disabled={readOnly} onChange={(e) => setField('cin', e.target.value.toUpperCase())} />
            </label>
            <label>
              LLPIN
              <input value={profile.llpin} disabled={readOnly} onChange={(e) => setField('llpin', e.target.value.toUpperCase())} />
            </label>
            <label>
              GSTIN
              <input value={profile.gstin} disabled={readOnly} onChange={(e) => setField('gstin', e.target.value.toUpperCase())} />
            </label>
            <label>
              Company PAN
              <input value={profile.pan} disabled={readOnly} onChange={(e) => setField('pan', e.target.value.toUpperCase())} />
            </label>
            <label>
              If no GSTIN, reason
              <input
                value={profile.gst_exempt_reason}
                disabled={readOnly}
                onChange={(e) => setField('gst_exempt_reason', e.target.value)}
              />
            </label>
            <label>
              Registered office
              <textarea
                rows={2}
                value={profile.registered_address}
                disabled={readOnly}
                onChange={(e) => setField('registered_address', e.target.value)}
              />
            </label>
            <h2>Authorized signatory</h2>
            <label>
              Name *
              <input value={profile.signatory_name} disabled={readOnly} onChange={(e) => setField('signatory_name', e.target.value)} />
            </label>
            <label>
              Designation
              <input
                value={profile.signatory_designation}
                disabled={readOnly}
                onChange={(e) => setField('signatory_designation', e.target.value)}
              />
            </label>
            <label>
              PAN
              <input
                value={profile.signatory_pan}
                disabled={readOnly}
                onChange={(e) => setField('signatory_pan', e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Mobile
              <input value={profile.signatory_mobile} disabled={readOnly} onChange={(e) => setField('signatory_mobile', e.target.value)} />
            </label>
            <label>
              Email *
              <input
                type="email"
                value={profile.signatory_email}
                disabled={readOnly}
                onChange={(e) => setField('signatory_email', e.target.value)}
              />
            </label>
            <h2>Documents</h2>
            <p className="kyb-hint">PDF, JPG or PNG. Max 8 MB each. Companies: incorporation + PAN + authorization. Add GST certificate if you entered GSTIN.</p>
            {(ctx.doc_types || []).map((doc) => (
              <label key={doc.id}>
                {doc.label}
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                  disabled={readOnly || busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) upload(doc.id, file);
                  }}
                />
              </label>
            ))}
            <ul className="kyb-files">
              {(ctx.documents || []).map((doc) => (
                <li key={doc.id}>{doc.doc_type}: {doc.original_filename}</li>
              ))}
            </ul>
            {!readOnly ? (
              <div className="kyb-actions">
                <button type="button" className="kyb-btn kyb-btn--ghost" disabled={busy} onClick={saveDraft}>
                  Save draft
                </button>
                <button type="submit" className="kyb-btn" disabled={busy}>
                  {busy ? 'Working…' : 'Submit for review'}
                </button>
              </div>
            ) : null}
          </form>
        ) : null}
      </main>
      <AppFooter />
    </div>
  );
}
