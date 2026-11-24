import { PLAN_CONTEXT_STORAGE_KEY } from './clientPrivacy';

const EMPTY_PLAN = Object.freeze({
  plan: 'essential',
  features: [],
  is_platform_super_admin: false,
});

let _planContext = { ...EMPTY_PLAN };

function dropLegacyPlanDisk() {
  try {
    localStorage.removeItem(PLAN_CONTEXT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

dropLegacyPlanDisk();

export function setPlanContext(plan, features, extras = {}) {
  _planContext = {
    plan: plan || 'essential',
    features: Array.isArray(features) ? features : [],
    is_platform_super_admin: Boolean(extras.is_platform_super_admin),
  };
  dropLegacyPlanDisk();
}

export function clearPlanContext() {
  _planContext = { ...EMPTY_PLAN };
  dropLegacyPlanDisk();
}

export function getPlanContext() {
  return {
    plan: _planContext.plan || 'essential',
    features: Array.isArray(_planContext.features) ? _planContext.features : [],
    is_platform_super_admin: Boolean(_planContext.is_platform_super_admin),
  };
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

function compactEmpType(user) {
  return String(user?.emp_type || '')
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function isCompanyAdmin(user) {
  const et = compactEmpType(user) || String(user?.department || '').trim().toLowerCase();
  return ['admin', 'administrator', 'administration'].includes(et);
}

/** HR Admin / Accounts Admin / Finance Admin — not company Admin or Super Admin. */
export function isDepartmentAdmin(user) {
  const et = compactEmpType(user);
  if (!et || isCompanyAdmin(user) || isPlatformSuperAdmin(user)) return false;
  if (!et.split(' ').includes('admin')) return false;
  return (
    et === 'hr' ||
    et.startsWith('hr ') ||
    et.includes('human resource') ||
    et === 'finance' ||
    et.startsWith('finance ') ||
    et === 'account' ||
    et.startsWith('account')
  );
}

export function isAdminUser(user) {
  return isCompanyAdmin(user) || isPlatformSuperAdmin(user) || isDepartmentAdmin(user);
}

/** Super Admin and company Admin land on Admin; department Admins keep the punch dashboard. */
export function postLoginHomePath(user) {
  if (isDepartmentAdmin(user)) return '/dashboard';
  if (isCompanyAdmin(user) || isPlatformSuperAdmin(user)) return '/admin';
  return '/dashboard';
}

export function userFromAccessToken(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return {};
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(padded));
    return {
      emp_type: json.emp_type,
      tenant_id: json.tenant_id,
    };
  } catch {
    return {};
  }
}

export function isHrUser(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase().replace(/-/g, ' ');
  const normalized = et.replace(/\s+/g, ' ').trim();
  if (isCompanyAdmin(user) || isPlatformSuperAdmin(user)) return true;
  return normalized === 'hr' || normalized.startsWith('hr ') || normalized.includes('human resource');
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
  return normalized === 'account' || normalized.startsWith('account');
}

export function isItUser(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase().replace(/-/g, ' ');
  const normalized = et.replace(/\s+/g, ' ').trim();
  if (isPlatformSuperAdmin(user)) return true;
  return ['it', 'it department', 'information technology'].includes(normalized);
}

export function isInventoryUser(user) {
  const et = String(user?.emp_type || user?.department || '').trim().toLowerCase().replace(/-/g, ' ');
  const normalized = et.replace(/\s+/g, ' ').trim();
  if (isPlatformSuperAdmin(user)) return true;
  return normalized === 'inventory' || normalized.startsWith('inventory ');
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

/** IT module only. Inventory emp type does not get this. */
export function canAccessItPanel(user) {
  if (adminHasFullPanelAccess(user)) return true;
  if (!hasFeature('it_panel')) return false;
  return isItUser(user) || isCompanyAdmin(user);
}

/** Inventory module only. IT emp type does not get this. */
export function canAccessInventoryPanel(user) {
  if (adminHasFullPanelAccess(user)) return true;
  if (!hasFeature('it_panel')) return false;
  return isInventoryUser(user) || isCompanyAdmin(user);
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
