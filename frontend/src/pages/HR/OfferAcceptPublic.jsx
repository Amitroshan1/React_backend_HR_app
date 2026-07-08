import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, FileText } from 'lucide-react';
import './OfferAcceptPublic.css';
import { AppFooter } from '../../components/layout/AppFooter';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';

const API_BASE = '/api/HumanResource/ats/public/offer';

export default function OfferAcceptPublic() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('t') || '').trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offer, setOffer] = useState(null);
  const [signerName, setSignerName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError('This page needs a valid link from your offer email (?t=…).');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}?t=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || 'Could not load offer details.');
        setOffer(null);
        return;
      }
      setOffer(data);
      if (data.candidate_name) {
        setSignerName((prev) => prev || data.candidate_name);
      }
    } catch {
      setError('Network error. Check your connection and try again.');
      setOffer(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAccept = async (e) => {
    e.preventDefault();
    if (!token || !signerName.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, signer_name: signerName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || 'Could not record acceptance.');
        return;
      }
      setOffer(data);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const accepted = Boolean(offer?.already_accepted || offer?.accepted_at);

  return (
    <div className="offer-accept-page">
      <header className="offer-accept-header">
        <FileText size={28} />
        <div>
          <h1>Offer of Employment</h1>
          <p>Review and accept your offer online</p>
        </div>
      </header>

      <main className="offer-accept-main">
        {loading ? <p className="offer-accept-muted">Loading offer…</p> : null}
        {error ? <p className="offer-accept-error">{error}</p> : null}

        {!loading && offer ? (
          <div className="offer-accept-card">
            <h2>{offer.role_title || 'Position'}</h2>
            {offer.circle ? <p className="offer-accept-muted">Location / circle: {offer.circle}</p> : null}
            <dl className="offer-accept-details">
              {offer.annual_ctc != null ? (
                <>
                  <dt>Annual CTC</dt>
                  <dd>₹ {Number(offer.annual_ctc).toLocaleString('en-IN')}</dd>
                </>
              ) : null}
              {offer.joining_date ? (
                <>
                  <dt>Joining date</dt>
                  <dd>{formatDateDDMMYYYY(offer.joining_date)}</dd>
                </>
              ) : null}
            </dl>

            {accepted ? (
              <div className="offer-accept-done">
                <CheckCircle size={40} />
                <p>
                  Offer accepted
                  {offer.accepted_by_name ? ` by ${offer.accepted_by_name}` : ''}.
                </p>
                <p className="offer-accept-muted">HR will contact you with next steps for onboarding.</p>
              </div>
            ) : (
              <form className="offer-accept-form" onSubmit={handleAccept}>
                <label>
                  Full name (electronic signature)
                  <input
                    type="text"
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder="Enter your full name"
                    required
                    minLength={2}
                    autoComplete="name"
                  />
                </label>
                <p className="offer-accept-legal">
                  By clicking Accept, you confirm that you have read the attached offer letter and agree to the terms of employment.
                </p>
                <button type="submit" className="offer-accept-btn" disabled={submitting}>
                  {submitting ? 'Submitting…' : 'Accept offer'}
                </button>
              </form>
            )}
          </div>
        ) : null}
      </main>

      <AppFooter />
    </div>
  );
}
