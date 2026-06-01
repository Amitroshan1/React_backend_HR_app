const STORAGE_KEY = 'hrms_plan_context';

export function setPlanContext(plan, features) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        plan: plan || 'essential',
        features: Array.isArray(features) ? features : [],
      })
    );
  } catch {
    /* ignore */
  }
}

export function clearPlanContext() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function getPlanContext() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { plan: 'essential', features: [] };
    const parsed = JSON.parse(raw);
    return {
      plan: parsed.plan || 'essential',
      features: Array.isArray(parsed.features) ? parsed.features : [],
    };
  } catch {
    return { plan: 'essential', features: [] };
  }
}

export function hasFeature(featureKey) {
  if (!featureKey) return true;
  const { plan, features } = getPlanContext();
  if (plan === 'enterprise') return true;
  return features.includes(featureKey);
}

export function isEnterprisePlan() {
  return getPlanContext().plan === 'enterprise';
}

export function getPlan() {
  return getPlanContext().plan;
}

export function isAdminUser(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase();
  if (['admin', 'administrator', 'administration'].includes(et)) return true;
  return et.includes('super');
}

/** Org Admin bypasses subscription gates for operational panels. */
export function adminHasFullPanelAccess(user) {
  return isAdminUser(user);
}

/** IT / Inventory: plan feature or org Admin / Super Admin. */
export function canAccessItPanel(user) {
  if (adminHasFullPanelAccess(user)) return true;
  if (hasFeature('it_panel')) return true;
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase();
  if (['admin', 'administrator', 'administration'].includes(et)) return true;
  if (et.includes('super')) return true;
  return false;
}

export function canAccessHrPanel(user) {
  if (adminHasFullPanelAccess(user)) return true;
  return hasFeature('hr_panel');
}

export function canAccessAccountPanel(user) {
  if (adminHasFullPanelAccess(user)) return true;
  return hasFeature('account_panel');
}
