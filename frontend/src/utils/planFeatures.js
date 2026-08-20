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

export function isHrUser(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase().replace(/-/g, ' ');
  const normalized = et.replace(/\s+/g, ' ').trim();
  if (isAdminUser(user)) return true;
  return ['hr', 'human resource', 'human resources'].includes(normalized);
}

export function isAccountUser(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase().replace(/-/g, ' ');
  const normalized = et.replace(/\s+/g, ' ').trim();
  if (isAdminUser(user)) return true;
  return ['account', 'accounts', 'accountant'].includes(normalized);
}

export function isItUser(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase().replace(/-/g, ' ');
  const normalized = et.replace(/\s+/g, ' ').trim();
  if (isAdminUser(user)) return true;
  return ['it', 'it department', 'inventory'].includes(normalized);
}

/** Org Admin bypasses subscription gates for operational panels. */
export function adminHasFullPanelAccess(user) {
  return isAdminUser(user);
}

/** Normalized employee id from profile (emp_id / empId). */
export function getUserEmpId(user) {
  return String(user?.emp_id || user?.empId || "").trim();
}

/** Employee viewing their own assigned assets (My Assets dashboard tile). */
export function canViewOwnAssignedAssets(user, routeEmpId) {
  if (!hasFeature("dashboard_my_assets")) return false;
  const myEmpId = getUserEmpId(user);
  const target = String(routeEmpId || "").trim();
  if (!myEmpId || !target) return false;
  return myEmpId.toUpperCase() === target.toUpperCase();
}

/** IT / Inventory: plan feature or org Admin / Super Admin. */
export function canAccessItPanel(user) {
  if (adminHasFullPanelAccess(user)) return true;
  return hasFeature('it_panel') && isItUser(user);
}

export function canAccessHrPanel(user) {
  if (adminHasFullPanelAccess(user)) return true;
  return hasFeature('hr_panel') && isHrUser(user);
}

export function canAccessAccountPanel(user) {
  if (adminHasFullPanelAccess(user)) return true;
  return hasFeature('account_panel') && isAccountUser(user);
}
