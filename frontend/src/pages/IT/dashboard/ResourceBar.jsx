import React from 'react';
import styles from './ResourceBar.module.css';

const ResourceBar = ({ label, value }) => (
  <div className={styles.container}>
    <div className={styles.info}>
      <span>{label}</span>
      <span>{value}%</span>
    </div>
    <div className={styles.track}>
      <div className={styles.fill} style={{ width: `${value}%` }} />
    </div>
  </div>
);

export default ResourceBar;