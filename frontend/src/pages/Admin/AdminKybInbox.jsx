import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import './AdminKybReview.css';
import './AdminKybInbox.css';
import { canManageCustomerRegistry } from './customerRegistryAccess';
import { getAccessToken } from '../../utils/authSession';
import { formatDateTime } from '../../utils/dateFormat';
import {
  hasKybPack,
  isUnseenSubmittedKyb,
  loadKybSeen,
  sortKybInbox,
} from './kybInbox';

const API_CUSTOMERS = '/api/admin/customers';

function authHeaders() {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function statusClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'verified') return 'kyb-page__pill kyb-page__pill--ok';
  if (s === 'submitted') return 'kyb-page__pill kyb-page__pill--wait';
  if (s === 'needs_fix') return 'kyb-page__pill kyb-page__pill--fix';
  return 'kyb-page__pill';
}

export default function AdminKybInbox() {
  const navigate = useNavigate();
  const location = useLocation();
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState(location.state?.message || '');
  const [loading, setLoading] = useState(true);
  const [seenTick, setSeenTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (!(await canManageCustomerRegistry(authHeaders()))) {
        navigate('/admin', { replace: true });
        return;
      }
      const res = await fetch(API_CUSTOMERS, {
        headers: authHeaders(),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Could not load KYB packs');
      }
      setCustomers(data.customers || []);
      setSeenTick((n) => n + 1);
    } catch (err) {
      setError(err.message || 'Could not load KYB packs');
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!location.state?.message) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const packs = useMemo(() => {
    void seenTick;
    const seen = loadKybSeen();
    const q = query.trim().toLowerCase();
    const rows = sortKybInbox((customers || []).filter(hasKybPack)).map((row) => ({
      ...row,
      isNew: isUnseenSubmittedKyb(row, seen),
    }));
    if (!q) return rows;
    return rows.filter((row) =>
      [row.company_name, row.slug, row.contact_email]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [customers, query, seenTick]);

  return (
    <div className="kyb-page">
      <button type="button" className="kyb-page__back" onClick={() => navigate('/admin/customers')}>
        <ArrowLeft size={16} /> Companies
      </button>

      <header className="kyb-page__hero">
        <div>
          <p className="kyb-page__eyebrow">KYB</p>
          <h1>Company documents</h1>
          <p>Every submitted pack, including already reviewed files. Open a company to preview or download proofs.</p>
        </div>
      </header>

      {message ? <p className="kyb-inbox__message">{message}</p> : null}
      {error ? <p className="kyb-page__error">{error}</p> : null}

      <label className="kyb-inbox__search">
        Find a company
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Company name, slug, or email"
        />
      </label>

      {loading ? <p className="kyb-page__muted">Loading packs…</p> : null}

      {!loading && packs.length === 0 ? (
        <p className="kyb-page__muted">No KYB documents yet.</p>
      ) : null}

      <div className="kyb-inbox__list">
        {packs.map((row) => (
          <button
            key={row.id}
            type="button"
            className="kyb-inbox__row"
            onClick={() =>
              navigate(`/admin/customers/${row.id}/kyb`, { state: { from: '/admin/kyb' } })
            }
          >
            <span className="kyb-inbox__icon" aria-hidden>
              <FileText size={18} />
            </span>
            <span className="kyb-inbox__body">
              <strong>{row.company_name || 'Company'}</strong>
              <span>
                {row.kyb_submitted_at
                  ? `Submitted ${formatDateTime(row.kyb_submitted_at)}`
                  : 'Documents on file'}
              </span>
            </span>
            <span className="kyb-inbox__meta">
              {row.isNew ? <span className="kyb-inbox__new">New</span> : null}
              <span className={statusClass(row.kyc_status)}>
                {(row.kyc_status || '').replace(/_/g, ' ')}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
