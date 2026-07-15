import { useNavigate, useLocation } from 'react-router-dom';
import { clearAdminDepartmentVisit } from '../../pages/Admin/AdminLayout';
import './AdminBreadcrumb.css';

/**
 * Compact Command Center breadcrumb used across Admin Management pages.
 * items: [{ label, to?, onClick? }] — last item without to/onClick is current page.
 */
export function AdminBreadcrumb({ items = [], className = '' }) {
  const navigate = useNavigate();

  if (!items.length) return null;

  return (
    <nav className={`admin-crumb ${className}`.trim()} aria-label="Admin breadcrumb">
      <ol className="admin-crumb__list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const key = `${item.label}-${index}`;
          return (
            <li key={key} className="admin-crumb__item">
              {index > 0 ? (
                <span className="admin-crumb__sep" aria-hidden="true">/</span>
              ) : null}
              {isLast || (!item.to && !item.onClick) ? (
                <span className="admin-crumb__current" aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              ) : (
                <button
                  type="button"
                  className="admin-crumb__link"
                  onClick={() => {
                    if (typeof item.onClick === 'function') {
                      item.onClick();
                      return;
                    }
                    if (item.to === '/admin') {
                      clearAdminDepartmentVisit();
                    }
                    navigate(item.to);
                  }}
                >
                  {item.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function commandCenterCrumbItem() {
  return {
    label: 'Command Center',
    to: '/admin',
  };
}

/** Build crumbs for common Admin Management department/list routes. */
export function crumbsForAdminPath(pathname) {
  const p = (pathname || '').toLowerCase();

  if (p.startsWith('/employee/')) {
    return null; // page owns its own crumb with employee name
  }

  if (p === '/employees' || p.startsWith('/employees/')) {
    return [commandCenterCrumbItem(), { label: 'Employees' }];
  }

  if (p.startsWith('/admin/leaves')) {
    return [commandCenterCrumbItem(), { label: 'Leave applications' }];
  }
  if (p.startsWith('/admin/queries')) {
    return [commandCenterCrumbItem(), { label: 'Queries' }];
  }
  if (p.startsWith('/admin/claims')) {
    return [commandCenterCrumbItem(), { label: 'Expense claims' }];
  }
  if (p.startsWith('/admin/resignations')) {
    return [commandCenterCrumbItem(), { label: 'Resignations' }];
  }
  if (p.startsWith('/admin/customers')) {
    return [commandCenterCrumbItem(), { label: 'Customers' }];
  }
  if (p.startsWith('/admin/deployment-guide')) {
    return [
      commandCenterCrumbItem(),
      { label: 'Customers', to: '/admin/customers' },
      { label: 'Deployment guide' },
    ];
  }

  if (p.startsWith('/archive-employees')) {
    return [commandCenterCrumbItem(), { label: 'Employee archive' }];
  }
  if (p.startsWith('/exit-employees')) {
    return [commandCenterCrumbItem(), { label: 'Exit employees' }];
  }

  if (p.startsWith('/hr')) {
    return [commandCenterCrumbItem(), { label: 'HR Management' }];
  }
  if (p.startsWith('/account')) {
    return [commandCenterCrumbItem(), { label: 'Accounts Management' }];
  }
  if (p.startsWith('/it/inventory')) {
    return [commandCenterCrumbItem(), { label: 'Inventory Management' }];
  }
  if (p.startsWith('/it/noc-requests')) {
    return [commandCenterCrumbItem(), { label: 'NOC Requests' }];
  }
  if (p.startsWith('/it')) {
    return [commandCenterCrumbItem(), { label: 'IT Management' }];
  }
  if (p.startsWith('/manager')) {
    return [commandCenterCrumbItem(), { label: 'Manager panel' }];
  }

  return null;
}

/** Hook-friendly helper using current location. */
export function useAdminPathCrumbs() {
  const location = useLocation();
  return crumbsForAdminPath(location.pathname);
}
