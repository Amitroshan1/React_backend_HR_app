import React, { useCallback, useEffect, useState } from 'react';
import './PolicyAckModal.css';

const API_BASE = '/api/auth';

export function PolicyAckModal() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ackIndex, setAckIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/policies/pending`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (!cancelled && res.ok && data.success) {
          setPolicies(data.policies || []);
        }
      } catch {
        /* optional gate */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getAuthHeaders]);

  if (loading || policies.length === 0) return null;

  const current = policies[ackIndex];
  if (!current) return null;

  const handleAck = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/policies/${current.id}/acknowledge`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || 'Failed to acknowledge');
        return;
      }
      if (ackIndex + 1 >= policies.length) {
        setPolicies([]);
      } else {
        setAckIndex((i) => i + 1);
      }
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="policy-ack-overlay" role="dialog" aria-modal="true">
      <div className="policy-ack-modal">
        <h3>Policy acknowledgment required</h3>
        <p className="policy-ack-meta">{current.title} · v{current.version}</p>
        {current.file_path ? (
          <p className="policy-ack-pdf">
            <a href={`/static/uploads/${current.file_path}`} target="_blank" rel="noopener noreferrer">Open policy PDF</a>
          </p>
        ) : null}
        <div className="policy-ack-body">{current.content_html || 'Please read and acknowledge this policy to continue.'}</div>
        {error ? <p className="policy-ack-error">{error}</p> : null}
        <div className="policy-ack-footer">
          <span>{ackIndex + 1} of {policies.length}</span>
          <button type="button" onClick={handleAck} disabled={submitting}>
            {submitting ? 'Saving…' : 'I have read and agree'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PolicyAckModal;
