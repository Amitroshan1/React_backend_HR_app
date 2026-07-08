/** Recently used HR modules (localStorage). */

const STORAGE_KEY = 'hr_recent_modules';
const MAX_RECENT = 5;
const DASHBOARD_RECENT_LIMIT = 3;

export function recordRecentModule(title) {
  if (!title || typeof localStorage === 'undefined') return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const prev = Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
    const next = [title, ...prev.filter((t) => t !== title)].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / parse errors */
  }
}

export function getRecentModuleTitles() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function resolveRecentModules(updateOptions, { limit = MAX_RECENT } = {}) {
  const titles = getRecentModuleTitles().slice(0, limit);
  const byTitle = new Map(updateOptions.map((o) => [o.title, o]));
  return titles.map((title) => byTitle.get(title)).filter(Boolean);
}

export { MAX_RECENT, DASHBOARD_RECENT_LIMIT };
