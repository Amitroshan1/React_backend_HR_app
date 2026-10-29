const STORAGE_KEY = 'hrms_plan_context';

export function setPlanContext(plan, features, extras = {}) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        plan: plan || 'essential',
        features: Array.isArray(features) ? features : [],
        is_platform_super_admin: Boolean(extras.is_platform_super_admin),
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
    if (!raw) return { plan: 'essential', features: [], is_platform_super_admin: false };
    const parsed = JSON.parse(raw);
    return {
      plan: parsed.plan || 'essential',
      features: Array.isArray(parsed.features) ? parsed.features : [],
      is_platform_super_admin: Boolean(parsed.is_platform_super_admin),
    };
  } catch {
    return { plan: 'essential', features: [], is_platform_super_admin: false };
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

export function isPlatformSuperAdmin(user) {
  if (getPlanContext().is_platform_super_admin) return true;
  const tid = Number(user?.tenant_id);
  const et = String(user?.emp_type || '').trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  return tid === 1 && (et === 'super admin' || et.replace(/\s+/g, '') === 'superadmin');
}

export function isCompanyAdmin(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase();
  return ['admin', 'administrator', 'administration'].includes(et);
}

export function isAdminUser(user) {
  return isCompanyAdmin(user) || isPlatformSuperAdmin(user);
}

export function isHrUser(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase().replace(/-/g, ' ');
  const normalized = et.replace(/\s+/g, ' ').trim();
  if (isCompanyAdmin(user) || isPlatformSuperAdmin(user)) return true;
  return ['hr', 'human resource', 'human resources'].includes(normalized);
}

export function isFinanceUser(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase().replace(/-/g, ' ');
  const normalized = et.replace(/\s+/g, ' ').trim();
  return normalized === 'finance' || normalized.startsWith('finance ');
}

export function isAccountUser(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase().replace(/-/g, ' ');
  const normalized = et.replace(/\s+/g, ' ').trim();
  if (isPlatformSuperAdmin(user)) return true;
  return ['account', 'accounts', 'accountant'].includes(normalized);
}

export function isItUser(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase().replace(/-/g, ' ');
  const normalized = et.replace(/\s+/g, ' ').trim();
  if (isPlatformSuperAdmin(user)) return true;
  return ['it', 'it department', 'inventory'].includes(normalized);
}

/** Only the application-owner Super Admin bypasses subscription gates. */
export function adminHasFullPanelAccess(user) {
  return isPlatformSuperAdmin(user);
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
  if (!hasFeature('it_panel')) return false;
  return isItUser(user) || isCompanyAdmin(user);
}

export function canAccessHrPanel(user) {
  if (adminHasFullPanelAccess(user) || isCompanyAdmin(user)) return true;
  return hasFeature('hr_panel') && isHrUser(user);
}

export function canAccessFinancePanel(user) {
  if (adminHasFullPanelAccess(user)) return true;
  if (!hasFeature('finance_panel')) return false;
  return isFinanceUser(user) || isCompanyAdmin(user);
}

export function canAccessAccountPanel(user) {
  if (adminHasFullPanelAccess(user)) return true;
  if (!hasFeature('account_panel')) return false;
  return isAccountUser(user) || isCompanyAdmin(user);
}
