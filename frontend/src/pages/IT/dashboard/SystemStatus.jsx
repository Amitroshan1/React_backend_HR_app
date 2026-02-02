import React from 'react';
import styles from './SystemStatus.module.css';
import Badge from '../UI/Badge';

export default function SystemStatus() {
  const systems = [
    { name: 'Main Server', uptime: '99.99%', status: 'success' },
    { name: 'Database Server', uptime: '99.95%', status: 'success' },
    { name: 'Email Server', uptime: '98.50%', status: 'warning' }
  ];
  return (
    <div className={styles.card}>
      <h3>System Status</h3>
      {systems.map((s, i) => (
        <div key={i} className={styles.row}>
          <div><strong>{s.name}</strong><br/><small>Uptime: {s.uptime}</small></div>
          <Badge type={s.status}>{s.status === 'success' ? 'Operational' : 'Warning'}</Badge>
        </div>
      ))}
    </div>
  );
}