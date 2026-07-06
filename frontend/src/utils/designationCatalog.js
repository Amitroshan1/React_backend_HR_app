import { designationOptions as defaultDesignationOptions } from '../pages/Profile/utils/profileUtils';

const STORAGE_KEY = 'hr_custom_designations';
const API_PATH = '/api/HumanResource/designations';

const normKey = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

export function getStoredCustomDesignations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function addCustomDesignation(name) {
  const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return getStoredCustomDesignations();
  const existing = getStoredCustomDesignations();
  const key = normKey(trimmed);
  if (existing.some((item) => normKey(item) === key)) {
    return existing;
  }
  const next = [...existing, trimmed];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function mergeDesignationLists(...lists) {
  const seen = new Set();
  const merged = [];
  lists.flat().forEach((item) => {
    const label = String(item || '').trim().replace(/\s+/g, ' ');
    if (!label) return;
    const key = normKey(label);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(label);
  });
  return merged.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export async function fetchDesignationCatalog() {
  const token = localStorage.getItem('token');
  const local = getStoredCustomDesignations();
  let remote = [];

  if (token) {
    try {
      const res = await fetch(API_PATH, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && Array.isArray(data.designations)) {
        remote = data.designations;
      }
    } catch {
      // fall back to defaults + local custom entries
    }
  }

  return mergeDesignationLists(defaultDesignationOptions, remote, local);
}
