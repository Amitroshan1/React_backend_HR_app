import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  ClipboardCheck,
  Laptop,
  LayoutDashboard,
  Mail,
  Monitor,
  Package,
  RotateCcw,
  ShoppingCart,
  Ticket,
  UserPlus,
  Wrench,
} from 'lucide-react';
import '../Admin/AdminSidebar.css';

const groups = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { id: 'dashboard', to: '/it', label: 'Dashboard', icon: LayoutDashboard, end: true, countKey: 'pending_requests' },
    ],
  },
  {
    id: 'workspaces',
    label: 'Workspaces',
    items: [
      { id: 'assigned', to: '/it/ActiveDevices', label: 'Assigned assets', icon: Laptop },
      { id: 'available', to: '/it/Assets', label: 'Available assets', icon: Package },
      { id: 'activity', to: '/it/Assets/activity-log', label: 'Activity log', icon: Monitor },
      { id: 'returns', to: '/it/return-requests', label: 'Return requests', icon: RotateCcw, countKey: 'pending_returns' },
      { id: 'repair-bills', to: '/it/repair-bills', label: 'Repair Bill', icon: Wrench },
      { id: 'dayuse', to: '/it/daily-checkout', label: 'Loan assets', icon: ClipboardCheck, countKey: 'pending_day_use' },
      { id: 'noc', to: '/it/noc-requests', label: 'NOC requests', icon: Ticket, countKey: 'pending_noc' },
      { id: 'emails', to: '/it/official-email-requests', label: 'Generate email ID', icon: Mail, countKey: 'pending_emails' },
      { id: 'assign', to: '/it/asset-assignment-requests', label: 'Asset assignment', icon: UserPlus, countKey: 'pending_assignments' },
      { id: 'purchase', to: '/it/purchase', label: 'Purchase requests', icon: ShoppingCart, countKey: 'pending_purchase' },
    ],
  },
];

function linkIsActive(item, pathname, isActive) {
  if (item.id === 'dashboard') return pathname === '/it';
  if (item.id === 'available') return pathname === '/it/Assets' || pathname.startsWith('/it/AssetsPage');
  if (item.id === 'activity') return pathname.startsWith('/it/Assets/activity-log');
  if (item.id === 'assigned') return pathname.startsWith('/it/ActiveDevices') || pathname.startsWith('/it/employee/');
  if (item.id === 'dayuse') return pathname.startsWith('/it/daily-checkout');
  if (item.id === 'repair-bills') return pathname.startsWith('/it/repair-bills');
  if (item.id === 'purchase') return pathname.startsWith('/it/purchase');
  return isActive;
}

function badgeLabel(count) {
  if (count > 99) return '99+';
  return String(count);
}

export default function ITSidebar({ onNavigate }) {
  const [collapsed, setCollapsed] = useState({});
  const [counts, setCounts] = useState({});
  const { pathname } = useLocation();

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const token = localStorage.getItem('token');
      fetch('/api/it/summary', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          if (!cancelled && data.success) setCounts(data.summary || {});
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [pathname]);

  return (
    <aside className="admin-side" aria-label="IT navigation">
      <div className="admin-side__brand">
        <span className="admin-side__mark" aria-hidden>
          <svg viewBox="0 0 32 32" width="36" height="36">
            <rect width="32" height="32" rx="8" fill="#13877f" />
            <path d="M10 16h12M16 10v12" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <strong>SaffoPeople</strong>
          <span>IT Management</span>
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
                const count = Number(counts[item.countKey] || 0);
                return (
                  <NavLink
                    key={item.id}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => (
                      `admin-side__link${linkIsActive(item, pathname, isActive) ? ' admin-side__link--active' : ''}`
                    )}
                    onClick={() => onNavigate?.()}
                  >
                    <Icon size={16} aria-hidden />
                    <span className="admin-side__link-text">{item.label}</span>
                    {count > 0 ? (
                      <span className="admin-side__badge" aria-label={`${count} pending`}>
                        {badgeLabel(count)}
                      </span>
                    ) : null}
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
