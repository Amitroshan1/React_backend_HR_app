import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import AdminSidebar from './AdminSidebar';
import { clearAdminDepartmentVisit } from './adminVisit';
import './AdminLayout.css';

/** Platform-admin shell. Navigation is the sidebar; the top bar is only the mobile menu. */
export default function AdminLayout() {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const path = (location.pathname || '').replace(/\/$/, '') || '/';
  const isCommandCenter = path === '/admin';

  useEffect(() => {
    if (isCommandCenter) {
      clearAdminDepartmentVisit();
    }
  }, [isCommandCenter]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className={`admin-platform${navOpen ? ' admin-platform--nav-open' : ''}`}>
      <button
        type="button"
        className="admin-platform__backdrop"
        aria-label="Close admin menu"
        onClick={() => setNavOpen(false)}
      />
      <AdminSidebar onNavigate={() => setNavOpen(false)} />
      <div className="admin-platform__main">
        <header className="admin-platform__bar">
          <button
            type="button"
            className="admin-platform__menu"
            aria-label="Open admin menu"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <Menu size={18} />
          </button>
        </header>
        <div className="admin-platform__content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
