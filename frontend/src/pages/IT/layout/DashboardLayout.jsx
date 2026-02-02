import React from 'react';
import styles from './DashboardLayout.module.css';

const DashboardLayout = ({ children }) => {
  return (
    <div className={styles.container}>
      <nav className={styles.sidebar}>
        <div className={styles.logo}>IT PANEL</div>
        {/* Navigation items would go here */}
      </nav>
      <div className={styles.content}>
        {children}
      </div>
    </div>
  );
};

export default DashboardLayout;