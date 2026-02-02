import React from 'react';
import styles from './Badge.module.css';

export default function Badge({ children, type }) {
  return <span className={`${styles.badge} ${styles[type]}`}>{children}</span>;
}