import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BookOpen,
  Building2,
  CalendarDays,
  ChartColumn,
  ChevronDown,
  CircleDollarSign,
  CircleUserRound,
  Handshake,
  ClipboardCheck,
  ClipboardList,
  Inbox,
  LayoutDashboard,
  Mail,
  Monitor,
  Package,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { markAdminDepartmentVisit } from './adminVisit';
import './AdminSidebar.css';

const groups = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { id: 'dashboard', to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { id: 'analytics', to: '/admin/analytics', label: 'Platform Analytics', icon: ChartColumn },
      { id: 'crm', to: '/admin/crm', label: 'Customer Relationship Management', icon: Handshake },
    ],
  },
  {
    id: 'companies',
    label: 'Companies',
    items: [
      { id: 'customers', to: '/admin/customers', label: 'Customers', icon: Building2 },
      { id: 'register', to: '/admin/customers/register', label: 'Register company', icon: UserPlus },
      { id: 'mailboxes', to: '/admin/mailboxes', label: 'Company mailboxes', icon: Mail },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'employees', to: '/employees', label: 'Employees', icon: Users },
      { id: 'requests', to: '/admin/requests', label: 'Request & Approval', icon: ClipboardCheck },
      { id: 'leaves', to: '/admin/leaves', label: 'All Leaves', icon: CalendarDays },
      { id: 'queries', to: '/admin/queries', label: 'All Queries', icon: Inbox },
      { id: 'claims', to: '/admin/claims', label: 'Claims', icon: Wallet },
      { id: 'resignations', to: '/admin/resignations', label: 'Resignations', icon: UserMinus },
    ],
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    items: [
      { id: 'hr', to: '/hr', label: 'HR Management', icon: ClipboardList, external: true },
      { id: 'accounts', to: '/account', label: 'Accounts Management', icon: CircleDollarSign, external: true },
      { id: 'it', to: '/it', label: 'IT Management', icon: Monitor, external: true },
      { id: 'inventory', to: '/it/inventory', label: 'Inventory Management', icon: Package, external: true },
    ],
  },
  {
    id: 'account',
    label: 'Account',
    items: [
      { id: 'guide', to: '/admin/deployment-guide', label: 'Deployment guide', icon: BookOpen },
      { id: 'profile', to: '/profile', label: 'My Profile', icon: CircleUserRound, external: true },
    ],
  },
];

function linkIsActive(item, pathname, isActive) {
  if (item.id === 'customers') return pathname === '/admin/customers';
  if (item.id === 'register') return pathname.startsWith('/admin/customers/register');
  if (item.id === 'it') return pathname.startsWith('/it') && !pathname.startsWith('/it/inventory');
  if (item.id === 'inventory') return pathname.startsWith('/it/inventory');
  if (item.id === 'employees') return pathname.startsWith('/employees') || pathname.startsWith('/employee');
  if (item.id === 'requests') {
    return pathname.startsWith('/admin/requests')
      || pathname.startsWith('/admin/departments')
      || pathname.startsWith('/admin/employee-changes');
  }
  return isActive;
}

export default function AdminSidebar({ onNavigate }) {
  const [collapsed, setCollapsed] = useState({});
  const { pathname } = useLocation();

  return (
    <aside className="admin-side" aria-label="Admin navigation">
      <div className="admin-side__brand">
        <span className="admin-side__mark" aria-hidden>
          <svg viewBox="0 0 32 32" width="36" height="36">
            <rect width="32" height="32" rx="8" fill="#13877f" />
            <circle cx="16" cy="12" r="4" fill="#ffffff" />
            <path d="M8.5 23.5c1.2-3.2 3.8-4.8 7.5-4.8s6.3 1.6 7.5 4.8" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <strong>SaffoPeople</strong>
          <span>Platform Admin</span>
        </div>
      </div>
      <div className="admin-side__scroll">
        {groups.map((group) => {
          const isOpen = collapsed[group.id] !== true;
          return (
            <section key={group.id} className="admin-side__group">
              <button
                type="button"
                className="admin-side__label"
                aria-expanded={isOpen}
                onClick={() => setCollapsed((current) => ({ ...current, [group.id]: isOpen }))}
              >
                {group.label}
                <ChevronDown size={14} style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
              </button>
              {isOpen && group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.id}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => (
                      `admin-side__link${linkIsActive(item, pathname, isActive) ? ' admin-side__link--active' : ''}`
                    )}
                    onClick={() => {
                      if (item.external) markAdminDepartmentVisit();
                      onNavigate?.();
                    }}
                  >
                    <Icon size={16} aria-hidden />
                    {item.label}
                  </NavLink>
                );
              })}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
