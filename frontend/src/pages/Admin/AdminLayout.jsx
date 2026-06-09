import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ADMIN_DEPARTMENTS,
  ADMIN_SIDEBAR_ORG,
  ADMIN_PLATFORM_LINKS,
} from './adminHubConfig';
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

export default function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [showPlatform, setShowPlatform] = useState(false);

  useEffect(() => {
    if (location.pathname === '/admin' || location.pathname === '/admin/') {
      clearAdminDepartmentVisit();
    }
  }, [location.pathname]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    fetch('/api/admin/deployment-guide/access', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success) setShowPlatform(Boolean(data.can_view_deployment_guide));
      });
  }, []);

  const openDepartment = (route) => {
    markAdminDepartmentVisit();
    navigate(route);
  };

  return (
    <div className="admin-shell">
      <aside className="admin-shell__sidebar" aria-label="Admin navigation">
        <div className="admin-shell__brand">
          <span className="admin-shell__brand-icon" aria-hidden>⚙️</span>
          <div>
            <strong>Admin Management</strong>
            <span>Full organization control</span>
          </div>
        </div>

        <nav className="admin-shell__nav">
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              `admin-shell__link${isActive ? ' admin-shell__link--active' : ''}`
            }
          >
            <span className="admin-shell__link-icon" aria-hidden>🏠</span>
            Command Center
          </NavLink>

          <p className="admin-shell__nav-label">Departments</p>
          <p className="admin-shell__nav-hint">Open each team&apos;s full workspace</p>
          {ADMIN_DEPARTMENTS.map((dept) => (
            <button
              key={dept.id}
              type="button"
              className="admin-shell__dept-btn"
              onClick={() => openDepartment(dept.route)}
            >
              <span className="admin-shell__dept-icon" aria-hidden>{dept.icon}</span>
              <span className="admin-shell__dept-text">
                <strong>{dept.label}</strong>
                <small>{dept.description}</small>
              </span>
              <span className="admin-shell__dept-arrow" aria-hidden>→</span>
            </button>
          ))}

          <p className="admin-shell__nav-label">Organization data</p>
          {ADMIN_SIDEBAR_ORG.map((item) =>
            item.external ? (
              <button
                key={item.route}
                type="button"
                className="admin-shell__link"
                onClick={() => openDepartment(item.route)}
              >
                <span className="admin-shell__link-icon" aria-hidden>{item.icon}</span>
                {item.label}
              </button>
            ) : (
              <NavLink
                key={item.route}
                to={item.route}
                end={item.end}
                className={({ isActive }) =>
                  `admin-shell__link${isActive ? ' admin-shell__link--active' : ''}`
                }
              >
                <span className="admin-shell__link-icon" aria-hidden>{item.icon}</span>
                {item.label}
              </NavLink>
            ),
          )}

          {showPlatform && (
            <>
              <p className="admin-shell__nav-label">Platform</p>
              {ADMIN_PLATFORM_LINKS.map((item) => (
                <NavLink
                  key={item.route}
                  to={item.route}
                  className={({ isActive }) =>
                    `admin-shell__link${isActive ? ' admin-shell__link--active' : ''}`
                  }
                >
                  <span className="admin-shell__link-icon" aria-hidden>{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
      </aside>

      <main className="admin-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
