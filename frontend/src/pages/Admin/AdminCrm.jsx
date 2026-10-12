import { useCallback, useMemo, useState } from 'react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDateDDMMYYYY } from '../../utils/dateFormat';
import './AdminCrm.css';

const API = '/api/admin/crm';

const FALLBACK_STAGES = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'demo', label: 'Demo' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];

const FALLBACK_SOURCES = [
  { id: 'website', label: 'Website' },
  { id: 'referral', label: 'Referral' },
  { id: 'outbound', label: 'Outbound' },
  { id: 'event', label: 'Event' },
  { id: 'other', label: 'Other' },
];

const EMPTY_FORM = {
  company_name: '',
  contact_name: '',
  email: '',
  phone: '',
  plan: 'essential',
  amount: '',
  stage: 'new',
  source: 'outbound',
  expected_close: '',
  follow_up: '',
  follow_up_on: '',
  notes: '',
};

function money(value) {
  const amount = Number(value) || 0;
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function monthLabel(key) {
  const [year, month] = String(key).split('-').map(Number);
  if (!year || !month) return key;
  return new Date(year, month - 1, 1).toLocaleString(undefined, { month: 'short' });
}

function lastMonths(count) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return key;
  });
}

function Bars({ rows, asCount = false }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value) || 0));
  return (
    <div className="crm-bars">
      {rows.map((row) => {
        const value = Number(row.value) || 0;
        return (
          <div key={row.id} className="crm-bars__row">
            <span>{row.label}</span>
            <span className="crm-bars__track">
              <span style={{ width: `${(value / max) * 100}%` }} />
            </span>
            <strong>{asCount ? value : money(value)}</strong>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminCrm() {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const headers = () => ({
    Authorization: `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json',
  });

  const load = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      setError('Sign in again to open CRM.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/dashboard`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Could not load CRM');
      setBoard(data);
    } catch (err) {
      setError(err.message || 'Could not load CRM');
    } finally {
      setLoading(false);
    }
  }, []);

  useRefreshOnNavigate(load);

  const months = useMemo(() => {
    const keys = lastMonths(6);
    const counts = board?.created_by_month || {};
    return keys.map((key) => ({ id: key, label: monthLabel(key), value: counts[key] || 0 }));
  }, [board]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submitDeal = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API}/deals`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          ...form,
          amount: form.amount === '' ? 0 : Number(form.amount),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Could not save the deal');
      setForm(EMPTY_FORM);
      setCreating(false);
      setNotice(`${data.deal.company_name} is on the pipeline.`);
      await load();
    } catch (err) {
      setError(err.message || 'Could not save the deal');
    } finally {
      setSaving(false);
    }
  };

  const moveStage = async (deal, stage) => {
    setError('');
    const res = await fetch(`${API}/deals/${deal.id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ stage }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      setError(data.message || 'Could not update the stage');
      return;
    }
    await load();
  };

  const completeFollowUp = async (activity) => {
    const res = await fetch(`${API}/activities/${activity.id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ done: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      setError(data.message || 'Could not update the follow-up');
      return;
    }
    await load();
  };

  const kpis = board?.kpis || {};
  const stages = board?.stages || [];
  const plans = board?.plans || [];

  return (
    <section className="crm-page">
      <div className="crm-head">
        <div>
          <h1>Customer Relationship Management</h1>
          <p>Sales pipeline for this company. Amounts are what the team enters on each deal.</p>
        </div>
        <button type="button" className="crm-add" onClick={() => { setCreating((open) => !open); setNotice(''); }}>
          {creating ? 'Close form' : 'New deal'}
        </button>
      </div>

      {notice ? <p className="crm-notice">{notice}</p> : null}
      {error ? <p className="crm-error">{error}</p> : null}

      {creating ? (
        <form className="crm-form" onSubmit={submitDeal}>
          <h2>New deal</h2>
          <div className="crm-form__grid">
            <label>Company *
              <input value={form.company_name} onChange={(event) => setField('company_name', event.target.value)} required placeholder="Acme Corp" />
            </label>
            <label>Contact
              <input value={form.contact_name} onChange={(event) => setField('contact_name', event.target.value)} placeholder="Priya Shah" />
            </label>
            <label>Email
              <input type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} placeholder="priya@acme.com" />
            </label>
            <label>Phone
              <input value={form.phone} onChange={(event) => setField('phone', event.target.value)} placeholder="9876543210" />
            </label>
            <label>Plan
              <select value={form.plan} onChange={(event) => setField('plan', event.target.value)}>
                <option value="">Not chosen</option>
                {(board?.plans || [{ id: 'basic', label: 'Basic' }, { id: 'essential', label: 'Essential' }, { id: 'enterprise', label: 'Enterprise' }]).map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.label}</option>
                ))}
              </select>
            </label>
            <label>Amount (₹)
              <input type="number" min="0" step="1" value={form.amount} onChange={(event) => setField('amount', event.target.value)} placeholder="120000" />
            </label>
            <label>Stage
              <select value={form.stage} onChange={(event) => setField('stage', event.target.value)}>
                {(board?.stages?.length ? board.stages : FALLBACK_STAGES).map((stage) => (
                  <option key={stage.id} value={stage.id}>{stage.label}</option>
                ))}
              </select>
            </label>
            <label>Source
              <select value={form.source} onChange={(event) => setField('source', event.target.value)}>
                {(board?.sources?.length ? board.sources : FALLBACK_SOURCES).map((source) => (
                  <option key={source.id} value={source.id}>{source.label}</option>
                ))}
              </select>
            </label>
            <label>Expected close
              <input type="date" value={form.expected_close} onChange={(event) => setField('expected_close', event.target.value)} />
            </label>
            <label>Next follow-up
              <input value={form.follow_up} onChange={(event) => setField('follow_up', event.target.value)} placeholder="Call after the demo" />
            </label>
            <label>Follow-up date
              <input type="date" value={form.follow_up_on} onChange={(event) => setField('follow_up_on', event.target.value)} />
            </label>
            <label className="crm-form__wide">Notes
              <textarea rows={2} value={form.notes} onChange={(event) => setField('notes', event.target.value)} />
            </label>
          </div>
          <div className="crm-form__actions">
            <button type="button" className="crm-ghost" onClick={() => setCreating(false)} disabled={saving}>Cancel</button>
            <button type="submit" className="crm-add" disabled={saving}>{saving ? 'Saving…' : 'Add to pipeline'}</button>
          </div>
        </form>
      ) : null}

      <div className="crm-kpis">
        <article><span>Open deals</span><strong>{loading ? '—' : kpis.open_deals ?? 0}</strong></article>
        <article><span>Pipeline</span><strong>{loading ? '—' : money(kpis.pipeline_value)}</strong></article>
        <article><span>Won</span><strong>{loading ? '—' : money(kpis.won_value)}</strong></article>
        <article><span>Follow-ups due</span><strong>{loading ? '—' : kpis.due_followups ?? 0}</strong></article>
      </div>

      <div className="crm-grid">
        <article className="crm-card crm-card--wide">
          <h2>Pipeline by stage</h2>
          <p>Open and closed value. Move a deal from the list to change its stage.</p>
          {loading ? <div className="crm-skeleton" /> : <Bars rows={stages} />}
        </article>
        <article className="crm-card">
          <h2>New deals</h2>
          <p>Deals added in each of the last six months.</p>
          {loading ? <div className="crm-skeleton" /> : <Bars rows={months} asCount />}
        </article>
        <article className="crm-card">
          <h2>Open deals by plan</h2>
          <p>Pipeline value still in play, split by Basic, Essential, and Enterprise.</p>
          {loading ? <div className="crm-skeleton" /> : <Bars rows={plans} />}
        </article>
        <article className="crm-card">
          <h2>Follow-ups</h2>
          <p>Calls, meetings, and tasks that are not done.</p>
          {loading ? <div className="crm-skeleton" /> : (board?.followups || []).length === 0 ? (
            <p className="crm-empty">No open follow-ups.</p>
          ) : (
            <ul className="crm-followups">
              {board.followups.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.company_name || 'Deal'}</strong>
                    <span>{item.summary}{item.due_on ? ` · ${formatDateDDMMYYYY(item.due_on)}` : ''}</span>
                  </div>
                  <button type="button" onClick={() => completeFollowUp(item)}>Done</button>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article className="crm-card crm-card--wide">
          <h2>Deals</h2>
          <p>Latest deals for this company. Lost deals stay here so win rate can be read from the stage chart.</p>
          {loading ? <div className="crm-skeleton" /> : (board?.deals || []).length === 0 ? (
            <p className="crm-empty">No deals yet. Add the first one for the sales team.</p>
          ) : (
            <div className="crm-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Contact</th>
                    <th>Plan</th>
                    <th>Amount</th>
                    <th>Close</th>
                    <th>Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {board.deals.map((deal) => (
                    <tr key={deal.id}>
                      <td>
                        <strong>{deal.company_name}</strong>
                        <span>{deal.source_label || '—'}</span>
                      </td>
                      <td>{deal.contact_name || deal.email || '—'}</td>
                      <td>{deal.plan_label || '—'}</td>
                      <td>{money(deal.amount)}</td>
                      <td>{deal.expected_close ? formatDateDDMMYYYY(deal.expected_close) : '—'}</td>
                      <td>
                        <select value={deal.stage} onChange={(event) => moveStage(deal, event.target.value)} aria-label={`Stage for ${deal.company_name}`}>
                          {(board.stages || []).map((stage) => (
                            <option key={stage.id} value={stage.id}>{stage.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
