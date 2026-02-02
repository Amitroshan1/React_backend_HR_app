import React from 'react';
import styles from './StatCards.module.css';
// Ensure these are imported correctly from the library
import { Monitor, Server, Shield, AlertTriangle } from 'lucide-react';

const StatCard = ({ title, val, sub, type }) => {
  // Logic to determine which logo/icon to show
  const renderIcon = () => {
    switch (type) {
      case 'device': return <Monitor size={20} />;
      case 'server': return <Server size={20} />;
      case 'security': return <Shield size={20} />;
      case 'ticket': return <AlertTriangle size={20} />;
      default: return <Monitor size={20} />;
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.content}>
        <span className={styles.title}>{title}</span>
        <h2 className={styles.value}>{val}</h2>
        <span className={styles.subtext}>{sub}</span>
      </div>
      <div className={styles.iconBox}>
        {renderIcon()}
      </div>
    </div>
  );
};

export default StatCard;