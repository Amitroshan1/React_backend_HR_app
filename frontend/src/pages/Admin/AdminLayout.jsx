import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import './AdminLayout.css';

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
  );
}

/** Full-width shell only — department navigation lives on Command Center cards. */
export default function AdminLayout() {
  const location = useLocation();
  const path = (location.pathname || '').replace(/\/$/, '') || '/';
  const isCommandCenter = path === '/admin';

  useEffect(() => {
    if (isCommandCenter) {
      clearAdminDepartmentVisit();
    }
  }, [isCommandCenter]);

  return (
    <div className="admin-shell admin-shell--full">
      <main className="admin-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
