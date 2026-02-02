import React from 'react';
import styles from './Sidebar.module.css';
import { LayoutDashboard, Users, CreditCard, ShieldCheck, LogOut } from 'lucide-react';

export default function Sidebar({ activeTab }) {
  const menu = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20}/> },
    { id: 'it-panel', label: 'IT Panel', icon: <ShieldCheck size={20}/> },
    { id: 'users', label: 'Users', icon: <Users size={20}/> },
  ];

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>HRMS PRO</div>
      <nav className={styles.nav}>
        {menu.map(item => (
          <div key={item.id} className={`${styles.item} ${activeTab === item.id ? styles.active : ''}`}>
            {item.icon} <span>{item.label}</span>
          </div>
        ))}
      </nav>
      <div className={styles.logout}><LogOut size={18}/> Logout</div>
    </aside>
  );
}