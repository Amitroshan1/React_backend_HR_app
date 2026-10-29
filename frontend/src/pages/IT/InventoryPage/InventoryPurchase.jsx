import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRefreshOnNavigate } from '../../../hooks/useRefreshOnNavigate';
import { INV_CATEGORIES } from '../inventoryCategories';
import { isUploadAbort, useInventoryUpload } from './InventoryUploadLock';
import './InventoryPurchase.css';

const API = '/api/it/inventory/purchase';

function authHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || 'Request failed');
  }
  return data;
}

function money(value) {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

const IT_CATEGORIES = ['Laptop', 'Desktop', 'Mobile', 'Tablet', 'Software', 'Accessories', 'Network', 'Other'];

const EMPTY = {
  title: '',
  category: 'IT Assets',
  item_name: '',
  quantity: '1',
  unit: 'pcs',
  estimated_amount: '',
  vendor_hint: '',
  needed_by: '',
  justification: '',
};

export default function InventoryPurchase({ source = 'inventory' }) {
  const navigate = useNavigate();
  const { runUpload, busy: uploadBusy } = useInventoryUpload();
  const [rows, setRows] = useState([]);
  const emptyForm = source === 'it' ? { ...EMPTY, category: 'Laptop' } : EMPTY;
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actingId, setActingId] = useState(null);
  const [filter, setFilter] = useState('open');

  const load = async () => {
    const data = await readJson(await fetch(API, { headers: authHeaders() }));
    setRows(data.requests || []);
  };

  useRefreshOnNavigate(() => {
    load().catch((err) => setError(err.message || 'Could not load purchase requests'));
  });

  const visible = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'open') {
      return rows.filter((row) =>
        ['pending_manager', 'pending_finance', 'finance_approved'].includes(row.status)
      );
    }
    return rows.filter((row) => row.status === filter);
  }, [rows, filter]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (uploadBusy) return;
    try {
      setBusy(true);
      setError('');
      await runUpload('Uploading request…', async ({ signal }) => {
        const body = new FormData();
        Object.entries(form).forEach(([key, value]) => body.append(key, value));
        body.append('source', source === 'it' ? 'it' : 'inventory');
        files.forEach((file) => body.append('files', file));
        await readJson(await fetch(API, { method: 'POST', headers: authHeaders(), body, signal }));
      });
      setForm(emptyForm);
      setFiles([]);
      await load();
    } catch (err) {
      if (!isUploadAbort(err)) setError(err.message || 'Could not submit this request');
    } finally {
      setBusy(false);
    }
  };

  const act = async (id, path, payload = {}) => {
    try {
      setActingId(id);
      setError('');
      await readJson(await fetch(`${API}/${id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      }));
      await load();
    } catch (err) {
      setError(err.message || 'Could not update this request');
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="inv-pr">
      <header className="inv-pr__head">
        <div>
          <p>Purchase request</p>
          <h1>{source === 'it' ? 'Ask Finance for IT equipment' : 'Ask Finance for inventory'}</h1>
          <span>Manager confirms the need first. Finance then approves the budget. IT and Inventory both see the status.</span>
        </div>
      </header>

      {error ? <p className="inv-pr__error">{error}</p> : null}

      <form className="inv-pr__form" onSubmit={submit}>
        <label>
          Title
          <input value={form.title} onChange={(e) => setField('title', e.target.value)} required />
        </label>
        <label>
          Category
          <select value={form.category} onChange={(e) => setField('category', e.target.value)}>
            {(source === 'it' ? IT_CATEGORIES : INV_CATEGORIES).map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </label>
        <label>
          Item
          <input value={form.item_name} onChange={(e) => setField('item_name', e.target.value)} />
        </label>
        <label>
          Quantity
          <input type="number" min="1" value={form.quantity} onChange={(e) => setField('quantity', e.target.value)} />
        </label>
        <label>
          Unit
          <input value={form.unit} onChange={(e) => setField('unit', e.target.value)} />
        </label>
        <label>
          Estimated amount
          <input value={form.estimated_amount} onChange={(e) => setField('estimated_amount', e.target.value)} />
        </label>
        <label>
          Preferred vendor
          <input value={form.vendor_hint} onChange={(e) => setField('vendor_hint', e.target.value)} />
        </label>
        <label>
          Needed by
          <input type="date" value={form.needed_by} onChange={(e) => setField('needed_by', e.target.value)} />
        </label>
        <label className="inv-pr__wide">
          Why this is needed
          <textarea
            value={form.justification}
            onChange={(e) => setField('justification', e.target.value)}
            rows={4}
            required
          />
        </label>
        <label className="inv-pr__wide">
          Attachments
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
          <em>Quote, spec, or approval note. PDF, images, or Excel. 8 MB each.</em>
        </label>
        <div className="inv-pr__actions">
          <button type="submit" disabled={busy || uploadBusy}>{busy ? 'Submitting…' : 'Submit request'}</button>
        </div>
      </form>

      <section className="inv-pr__list">
        <div className="inv-pr__list-head">
          <h2>Requests</h2>
          <div className="inv-pr__filters">
            {[
              ['open', 'Open'],
              ['pending_manager', 'Manager'],
              ['pending_finance', 'Finance'],
              ['finance_approved', 'To receive'],
              ['all', 'All'],
            ].map(([key, label]) => (
              <button key={key} type="button" className={filter === key ? 'is-on' : ''} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {visible.length === 0 ? <p className="inv-pr__empty">No requests in this view.</p> : null}
        {visible.map((row) => (
          <article key={row.id} className="inv-pr__card">
            <div>
              <strong>{row.request_no} · {row.title}</strong>
              <span>{row.source_label || 'Inventory'} · {row.item_name || row.category} · Qty {row.quantity} {row.unit || ''} · {money(row.estimated_amount)}</span>
              <span>{row.status_label}</span>
              <p>{row.justification}</p>
              {row.attachments?.length ? (
                <div className="inv-pr__files">
                  {row.attachments.map((file) => (
                    <a key={file.url || file.name} href={file.url} target="_blank" rel="noreferrer">{file.name}</a>
                  ))}
                </div>
              ) : null}
              {row.manager_remarks ? <em>Manager: {row.manager_remarks}</em> : null}
              {row.finance_remarks ? <em>Finance: {row.finance_remarks}</em> : null}
            </div>
            <div className="inv-pr__card-actions">
              {['pending_manager', 'pending_finance'].includes(row.status) ? (
                <button type="button" disabled={actingId === row.id} onClick={() => act(row.id, 'cancel')}>Cancel</button>
              ) : null}
              {row.status === 'finance_approved' ? (
                <>
                  <button type="button" disabled={actingId === row.id} onClick={() => act(row.id, 'receive', { notes: 'Goods received' })}>
                    Mark received
                  </button>
                  <button type="button" className="inv-pr__primary" onClick={() => navigate(`/it/inventory/add-assets?inv=${encodeURIComponent(row.source === 'it' ? 'IT Assets' : (row.category || 'IT Assets'))}&fromPr=${row.id}`)}>
                    Add assets
                  </button>
                </>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
