import { useLocation } from 'react-router-dom';
import { AdminBreadcrumb, crumbsForAdminPath } from './AdminBreadcrumb';

export function AdminReturnBar({ visible }) {
  const location = useLocation();
  const path = (location.pathname || '').toLowerCase();

  // Employee detail owns a richer crumb (includes employee name).
  if (path.startsWith('/employee/')) {
    return null;
  }

  if (!visible) {
    return null;
  }

  const items = crumbsForAdminPath(location.pathname);
  if (!items?.length) return null;

  return <AdminBreadcrumb items={items} />;
}
