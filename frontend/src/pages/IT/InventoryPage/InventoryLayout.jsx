import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import InventorySidebar from './InventorySidebar';
import { InventoryUploadProvider } from './InventoryUploadLock';
import { AdminReturnBar } from '../../../components/layout/AdminReturnBar';
import { isAdminVisitActive } from '../../../hooks/useAdminVisitNav';
import '../../Admin/AdminLayout.css';

export default function InventoryLayout() {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const showAdminCrumb = isAdminVisitActive();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname, location.search]);

  return (
    <InventoryUploadProvider>
    <div className={`admin-platform${navOpen ? ' admin-platform--nav-open' : ''}`}>
      <button
        type="button"
        className="admin-platform__backdrop"
        aria-label="Close inventory menu"
        onClick={() => setNavOpen(false)}
      />
      <InventorySidebar onNavigate={() => setNavOpen(false)} />
      <div className="admin-platform__main">
        <header className="admin-platform__bar">
          <button
            type="button"
            className="admin-platform__menu"
            aria-label="Open inventory menu"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <Menu size={18} />
          </button>
        </header>
        <div className="admin-platform__content">
          <AdminReturnBar visible={showAdminCrumb} />
          <Outlet />
        </div>
      </div>
    </div>
    </InventoryUploadProvider>
  );
}
