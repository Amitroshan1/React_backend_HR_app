/**
 * App-wide display formatting for dates (DD/MM/YYYY) in Indian Standard Time.
 * API datetimes are stored as UTC; naive ISO strings from the API are parsed as UTC.
 */

export const IST_TIMEZONE = 'Asia/Kolkata';
export const DATE_DISPLAY_FALLBACK = '—';

const HAS_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize naive API datetime strings to UTC (append Z). */
export function normalizeApiDateTimeString(raw) {
  let s = String(raw || '').trim();
  if (!s) return s;
  if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) {
    s = s.replace(' ', 'T');
  }
  if (
    /^\d{4}-\d{2}-\d{2}T/.test(s) &&
    !/[zZ]$/.test(s) &&
    !/[+-]\d{2}:?\d{2}$/.test(s)
  ) {
    return `${s}Z`;
  }
  return s;
}

/** Milliseconds since epoch; naive API ISO is treated as UTC. */
export function parseApiUtcMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  if (DATE_ONLY_RE.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return new Date(normalizeApiDateTimeString(raw)).getTime();
}

function getISTParts(date, includeTime) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(includeTime
      ? { hour: 'numeric', minute: '2-digit', hour12: true }
      : {}),
  });
  return formatter.formatToParts(date);
}

function partValue(parts, type) {
  return parts.find((p) => p.type === type)?.value ?? '';
}

function formatISTDateFromInstant(date) {
  const parts = getISTParts(date, false);
  const day = partValue(parts, 'day');
  const month = partValue(parts, 'month');
  const year = partValue(parts, 'year');
  return `${day}/${month}/${year}`;
}

function formatISTTimeFromInstant(date) {
  const parts = getISTParts(date, true);
  const hour = partValue(parts, 'hour');
  const minute = partValue(parts, 'minute');
  const dayPeriod = partValue(parts, 'dayPeriod').toLowerCase();
  return `${hour}:${minute} ${dayPeriod}`;
}

/**
 * Parse common API / form date values into a Date (instant).
 * Date-only YYYY-MM-DD uses local calendar (no UTC day shift).
 * Datetimes without timezone are parsed as UTC.
 */
export function parseAppDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (DATE_ONLY_RE.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split('/').map(Number);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  if (HAS_TIME_RE.test(raw) || /[zZ]$|[+-]\d{2}/.test(raw)) {
    const ms = parseApiUtcMs(raw);
    if (Number.isNaN(ms)) return null;
    return new Date(ms);
  }

  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Date only: DD/MM/YYYY (IST when value includes a time / UTC offset). */
export function formatDateDDMMYYYY(value, fallback = DATE_DISPLAY_FALLBACK) {
  if (value == null || value === '') return fallback;

  const raw = String(value).trim();
  if (!raw) return fallback;

  const d = parseAppDate(value);
  if (!d) return String(value);

  if (HAS_TIME_RE.test(raw) || /[zZ]$|[+-]\d{2}/.test(raw)) {
    return formatISTDateFromInstant(d);
  }

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/** Date + time: DD/MM/YYYY, h:mm am/pm in IST. */
export function formatDateTimeDDMMYYYY(value, fallback = DATE_DISPLAY_FALLBACK) {
  if (value == null || value === '') return fallback;

  const raw = String(value).trim();
  if (!raw) return fallback;

  const d = parseAppDate(value);
  if (!d) return String(value);

  if (DATE_ONLY_RE.test(raw)) {
    return formatDateDDMMYYYY(value, fallback);
  }

  return `${formatISTDateFromInstant(d)}, ${formatISTTimeFromInstant(d)}`;
}

/** Month + year label for payroll (e.g. June 2026). */
export function formatMonthYear(value, fallback = DATE_DISPLAY_FALLBACK) {
  const d = parseAppDate(value);
  if (!d) return fallback;
  return d.toLocaleString('en-IN', {
    timeZone: IST_TIMEZONE,
    month: 'long',
    year: 'numeric',
  });
}

/** Short aliases used across the app */
export const formatDate = formatDateDDMMYYYY;
export const formatDateTime = formatDateTimeDDMMYYYY;
export const formatDateForDisplay = formatDateDDMMYYYY;
export const formatDateTimeIST = formatDateTimeDDMMYYYY;
