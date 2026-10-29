import { useEffect, useState } from 'react';
import { NavLink, useLocation, useSearchParams } from 'react-router-dom';
import {
  Building2,
  ChevronDown,
  Landmark,
  Laptop,
  LayoutDashboard,
  Package,
  Plus,
  ShoppingCart,
  ScrollText,
  Ticket,
  Truck,
  Wrench,
} from 'lucide-react';
import { INV_CATEGORIES } from '../inventoryCategories';
import '../../Admin/AdminSidebar.css';

const CAT_ICONS = {
  'IT Assets': Laptop,
  'Fixed Assets': Building2,
  'Transport Assets': Truck,
  'Infrastructure Assets': Landmark,
};

const BASE = '/it/inventory';

function badgeLabel(count) {
  if (count > 99) return '99+';
  return String(count);
}

export default function InventorySidebar({ onNavigate }) {
  const [collapsed, setCollapsed] = useState({});
  const [nocCount, setNocCount] = useState(0);
  const [purchaseCount, setPurchaseCount] = useState(0);
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const currentCat = searchParams.get('cat') || 'IT Assets';

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const token = localStorage.getItem('token');
      fetch('/api/it/summary', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          if (!cancelled && data.success) {
            setNocCount(Number(data.summary?.pending_inventory_noc || 0));
            setPurchaseCount(Number(data.summary?.pending_purchase || 0));
          }
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

  const groups = [
    {
      id: 'overview',
      label: 'Overview',
      items: [
        { id: 'dashboard', to: BASE, label: 'Dashboard', icon: LayoutDashboard, end: true },
        { id: 'purchase', to: `${BASE}/purchase`, label: 'Purchase requests', icon: ShoppingCart, badge: purchaseCount },
        { id: 'add', to: `${BASE}/add-assets?inv=${encodeURIComponent(currentCat)}`, label: 'Add assets', icon: Plus },
        { id: 'parcels', to: `${BASE}/parcels`, label: 'Import/Export', icon: Package },
        { id: 'repair-bills', to: `${BASE}/repair-bills`, label: 'Repair Bill', icon: Wrench },
        { id: 'log', to: `${BASE}/activity-log`, label: 'Activity log', icon: ScrollText },
        { id: 'noc', to: `${BASE}/noc-requests`, label: 'NOC requests', icon: Ticket, badge: nocCount },
      ],
    },
    {
      id: 'categories',
      label: 'Asset types',
      items: INV_CATEGORIES.map((cat) => ({
        id: cat,
        to: `${BASE}?cat=${encodeURIComponent(cat)}`,
        label: cat,
        icon: CAT_ICONS[cat] || Package,
        cat,
      })),
    },
  ];

  const linkIsActive = (item, isActive) => {
    if (item.id === 'dashboard') {
      return (pathname === BASE || pathname === `${BASE}/`) && !searchParams.get('cat');
    }
    if (item.cat) return (pathname === BASE || pathname === `${BASE}/`) && currentCat === item.cat;
    if (item.id === 'parcels') return pathname.startsWith(`${BASE}/parcels`) || pathname.startsWith(`${BASE}/add-import`) || pathname.startsWith(`${BASE}/ready-export`);
    if (item.id === 'repair-bills') return pathname.startsWith(`${BASE}/repair-bills`);
    if (item.id === 'log') return pathname.startsWith(`${BASE}/activity-log`);
    if (item.id === 'add') return pathname.startsWith(`${BASE}/add-assets`);
    if (item.id === 'purchase') return pathname.startsWith(`${BASE}/purchase`);
    if (item.id === 'noc') return pathname.startsWith(`${BASE}/noc-requests`);
    return isActive || pathname.startsWith(`${BASE}/${item.id}`);
  };

  return (
    <aside className="admin-side" aria-label="Inventory navigation">
      <div className="admin-side__brand">
        <span className="admin-side__mark" aria-hidden>
          <svg viewBox="0 0 32 32" width="36" height="36">
            <rect width="32" height="32" rx="8" fill="#13877f" />
            <path d="M9 12h14M9 16h14M9 20h10" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <strong>SaffoPeople</strong>
          <span>Inventory</span>
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
                const count = Number(item.badge || 0);
                return (
                  <NavLink
                    key={item.id}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => (
                      `admin-side__link${linkIsActive(item, isActive) ? ' admin-side__link--active' : ''}`
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
