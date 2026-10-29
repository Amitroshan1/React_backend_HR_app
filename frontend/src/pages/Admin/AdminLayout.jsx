import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import AdminSidebar from './AdminSidebar';
import { clearAdminDepartmentVisit } from './adminVisit';
import { canManageCustomerRegistry } from './customerRegistryAccess';
import { useUser } from '../../components/layout/UserContext';
import { isPlatformSuperAdmin } from '../../utils/planFeatures';
import './AdminLayout.css';

const PLATFORM_ONLY = ['/admin/crm', '/admin/customers', '/admin/customers/register', '/admin/analytics'];

/** Platform-admin shell. Navigation is the sidebar; the top bar is only the mobile menu. */
export default function AdminLayout() {
  const location = useLocation();
  const { userData } = useUser();
  const user = userData?.user;
  const [navOpen, setNavOpen] = useState(false);
  const [platform, setPlatform] = useState(isPlatformSuperAdmin(user));
  const path = (location.pathname || '').replace(/\/$/, '') || '/';
  const isCommandCenter = path === '/admin';

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    canManageCustomerRegistry({ Authorization: `Bearer ${token}` }).then(setPlatform);
  }, []);

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
      <AdminSidebar onNavigate={() => setNavOpen(false)} platform={platform} user={user} />
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
          {PLATFORM_ONLY.includes(path) && !platform && !isPlatformSuperAdmin(user) ? (
            <Navigate to="/admin" replace />
          ) : (
            <Outlet />
          )}
        </div>
      </div>
    </div>
  );
}
