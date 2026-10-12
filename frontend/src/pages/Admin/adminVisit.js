const ADMIN_DEPT_SESSION = 'adminDeptVisit';

export function markAdminDepartmentVisit() {
  try {
    sessionStorage.setItem(ADMIN_DEPT_SESSION, '1');
  } catch {
    /* no-op */
  }
}

export function clearAdminDepartmentVisit() {
  try {
    sessionStorage.removeItem(ADMIN_DEPT_SESSION);
  } catch {
    /* no-op */
  }
}

export function isAdminDepartmentPath(pathname) {
  const p = (pathname || '').toLowerCase();
  return (
    p.startsWith('/hr')
    || p.startsWith('/account')
    || p.startsWith('/it')
    || p.startsWith('/manager')
    || p.startsWith('/employees')
    || p.startsWith('/employee/')
    || p.startsWith('/archive-employees')
    || p.startsWith('/exit-employees')
    || p.startsWith('/profile')
  );
}
