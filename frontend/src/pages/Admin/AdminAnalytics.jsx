import { useCallback, useMemo, useState } from 'react';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import './AdminAnalytics.css';
import { canManageCustomerRegistry } from './customerRegistryAccess';

const API_CUSTOMERS = '/api/admin/customers';

const PLAN_COLORS = {
  basic: '#8b6cc4',
  essential: '#13877f',
  enterprise: '#4778dc',
};

const STATUS_COLORS = {
  active: '#208c67',
  provisioning: '#4778dc',
  suspended: '#dc5252',
  cancelled: '#667895',
};

const PERIODS = [
  { id: '6', label: 'Last 6 months' },
  { id: '12', label: 'Last 12 months' },
  { id: '24', label: 'Last 24 months' },
];

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthLabel(date) {
  return date.toLocaleString(undefined, { month: 'short' });
}

function Donut({ slices, caption }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const drawn = slices.filter((slice) => slice.value > 0);

  return (
    <div className="admin-analytics__donut">
      <svg viewBox="0 0 180 180" role="img" aria-label={caption}>
        <g transform="rotate(-90 90 90)">
          {total === 0 ? (
            <circle cx="90" cy="90" r={radius} fill="none" stroke="#e1e7ef" strokeWidth="16" />
          ) : drawn.map((slice) => {
            const length = (slice.value / total) * circumference;
            const node = (
              <circle
                key={slice.id}
                cx="90"
                cy="90"
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth="16"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
              >
                <title>{`${slice.name}: ${slice.value}`}</title>
              </circle>
            );
            offset += length;
            return node;
          })}
        </g>
        <text x="90" y="86" textAnchor="middle" className="admin-analytics__donut-value">{total}</text>
        <text x="90" y="106" textAnchor="middle" className="admin-analytics__donut-caption">Companies</text>
      </svg>
      <ul className="admin-analytics__legend">
        {slices.map((slice) => (
          <li key={slice.id}>
            <i style={{ background: slice.color }} />
            <span>{slice.name}</span>
            <strong>{slice.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GrowthChart({ points }) {
  const width = 640;
  const height = 220;
  const padLeft = 28;
  const padRight = 12;
  const padTop = 16;
  const padBottom = 28;
  const max = Math.max(1, ...points.map((point) => point.value));
  const innerWidth = width - padLeft - padRight;
  const innerHeight = height - padTop - padBottom;
  const coords = points.map((point, index) => {
    const x = points.length === 1
      ? padLeft + innerWidth / 2
      : padLeft + (index * innerWidth) / (points.length - 1);
    const y = padTop + innerHeight - (point.value / max) * innerHeight;
    return { ...point, x, y };
  });
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  const area = coords.length
    ? `${line} L${coords[coords.length - 1].x},${padTop + innerHeight} L${coords[0].x},${padTop + innerHeight} Z`
    : '';
  const ticks = [0, Math.ceil(max / 2), max].filter((value, index, list) => list.indexOf(value) === index);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="admin-analytics__plot" role="img" aria-label="Companies registered each month">
      {ticks.map((tick) => {
        const y = padTop + innerHeight - (tick / max) * innerHeight;
        return (
          <g key={tick}>
            <line x1={padLeft} x2={width - padRight} y1={y} y2={y} className="admin-analytics__guide" />
            <text x={padLeft - 6} y={y + 4} textAnchor="end" className="admin-analytics__axis">{tick}</text>
          </g>
        );
      })}
      {area ? <path d={area} className="admin-analytics__area" /> : null}
      {line ? <path d={line} className="admin-analytics__line" /> : null}
      {coords.map((point) => (
        <g key={point.key}>
          <circle cx={point.x} cy={point.y} r="4" className="admin-analytics__dot">
            <title>{`${point.label}: ${point.value}`}</title>
          </circle>
          {points.length <= 8 || coords.indexOf(point) % 2 === 0 ? (
            <text x={point.x} y={height - 8} textAnchor="middle" className="admin-analytics__axis">{point.short}</text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

export default function AdminAnalytics() {
  const [customers, setCustomers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [period, setPeriod] = useState('12');
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      setError('Sign in again to load analytics.');
      return;
    }
    setLoading(true);
    setError('');
    const headers = { Authorization: `Bearer ${token}` };
    try {
      if (!await canManageCustomerRegistry(headers)) {
        setBlocked(true);
        setCustomers([]);
        setLoading(false);
        return;
      }
      setBlocked(false);
      const res = await fetch(API_CUSTOMERS, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Could not load companies');
      }
      setCustomers(data.customers || []);
      setPlans(data.plans || []);
      setStatuses(data.statuses || []);
    } catch (err) {
      setError(err.message || 'Could not load analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useRefreshOnNavigate(load);

  const months = useMemo(() => {
    const count = Number(period) || 12;
    const start = addMonths(monthStart(new Date()), -(count - 1));
    return Array.from({ length: count }, (_, index) => addMonths(start, index));
  }, [period]);

  const growth = useMemo(() => months.map((month) => {
    const key = monthKey(month);
    const value = customers.filter((row) => {
      const created = parseDate(row.created_at);
      return created && monthKey(monthStart(created)) === key;
    }).length;
    return {
      key,
      value,
      short: monthLabel(month),
      label: month.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    };
  }), [customers, months]);

  const planSlices = useMemo(() => {
    const catalog = plans.length
      ? plans
      : [
        { id: 'basic', label: 'Basic' },
        { id: 'essential', label: 'Essential' },
        { id: 'enterprise', label: 'Enterprise' },
      ];
    return catalog.map((plan) => ({
      id: plan.id,
      name: plan.label || plan.id,
      value: customers.filter((row) => String(row.plan || '').toLowerCase() === plan.id).length,
      color: PLAN_COLORS[plan.id] || '#13877f',
    }));
  }, [customers, plans]);

  const statusSlices = useMemo(() => {
    const catalog = statuses.length
      ? statuses
      : [
        { id: 'active', label: 'Active' },
        { id: 'provisioning', label: 'Provisioning' },
        { id: 'suspended', label: 'Suspended' },
        { id: 'cancelled', label: 'Cancelled' },
      ];
    return catalog.map((status) => ({
      id: status.id,
      name: status.label || status.id,
      value: customers.filter((row) => String(row.status || '').toLowerCase() === status.id).length,
      color: STATUS_COLORS[status.id] || '#667895',
    }));
  }, [customers, statuses]);

  const registeredInPeriod = growth.reduce((sum, point) => sum + point.value, 0);

  return (
    <section className="admin-analytics">
      <div className="admin-analytics__head">
        <div>
          <h1>Platform Analytics</h1>
          <p>
            {loading
              ? 'Loading company charts…'
              : `${customers.length} companies · ${registeredInPeriod} registered in this period`}
          </p>
        </div>
        <label className="admin-analytics__period">
          <span>Period</span>
          <select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Chart period">
            {PERIODS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {blocked ? (
        <p className="admin-analytics__note">Platform analytics is available on the platform instance only.</p>
      ) : error ? (
        <p className="admin-analytics__note">
          {error}
          <button type="button" onClick={load}>Try again</button>
        </p>
      ) : (
        <div className="admin-analytics__grid">
          <article className="admin-analytics__card admin-analytics__card--wide">
            <h2>Companies registered</h2>
            <p>New companies added in each month. Hover a point for the count.</p>
            {loading ? <div className="admin-analytics__skeleton" /> : <GrowthChart points={growth} />}
          </article>
          <article className="admin-analytics__card">
            <h2>Plan mix</h2>
            <p>How registered companies are split across Basic, Essential, and Enterprise.</p>
            {loading ? <div className="admin-analytics__skeleton" /> : (
              <Donut slices={planSlices} caption="Companies by subscription plan" />
            )}
          </article>
          <article className="admin-analytics__card">
            <h2>Company status</h2>
            <p>Active, provisioning, suspended, and cancelled companies.</p>
            {loading ? <div className="admin-analytics__skeleton" /> : (
              <Donut slices={statusSlices} caption="Companies by status" />
            )}
          </article>
        </div>
      )}
    </section>
  );
}
