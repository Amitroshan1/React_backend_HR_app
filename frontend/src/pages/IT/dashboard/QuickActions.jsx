import React from 'react';
import styles from './QuickActions.module.css';
import { Users, Shield, Wifi, HardDrive, Package, Ticket, Bell } from 'lucide-react';

const QuickActions = ({ onNavigate }) => {
  const actions = [
    { id: 'users', label: 'User Management', icon: <Users size={24}/>, color: '#3b82f6', alerts: 5 },
    { id: 'security', label: 'Security Scan', icon: <Shield size={24}/>, color: '#3b82f6', alerts: 3 },
    { id: 'network', label: 'Network Status', icon: <Wifi size={24}/>, color: '#3b82f6', alerts: 1 },
    { id: 'backup', label: 'Backup Now', icon: <HardDrive size={24}/>, color: '#10b981', alerts: 0 },
    { id: 'assets', label: 'Asset Management', icon: <Package size={24}/>, color: '#f59e0b', alerts: 2 },
    { id: 'tickets', label: 'Support Tickets', icon: <Ticket size={24}/>, color: '#8b5cf6', alerts: 4 },
  ];

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Quick Actions</h3>
      <div className={styles.grid}>
        {actions.map((act) => (
          <div key={act.id} className={styles.card} onClick={() => onNavigate(act.id)}>
            {/* Red Notification Badge */}
            {act.alerts > 0 && <div className={styles.badge}>{act.alerts}</div>}
            
            <div className={styles.iconBox} style={{ backgroundColor: act.color }}>
              {act.icon}
            </div>
            
            <span className={styles.label}>{act.label}</span>
            
            {/* Alert label below the title */}
            {act.alerts > 0 && (
              <div className={styles.alertNote}>
                <Bell size={10} /> {act.alerts} alerts
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default QuickActions;