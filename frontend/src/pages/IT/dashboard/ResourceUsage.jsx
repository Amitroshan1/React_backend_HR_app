import React from 'react';
import styles from './ResourceUsage.module.css';

export default function ResourceUsage() {
  const usage = [{l:'CPU Usage', v:45}, {l:'Memory Usage', v:68}, {l:'Storage Usage', v:72}];
  return (
    <div className={styles.card}>
      <h3>Resource Usage</h3>
      {usage.map((u, i) => (
        <div key={i} className={styles.barWrap}>
          <div className={styles.labels}><span>{u.l}</span><span>{u.v}%</span></div>
          <div className={styles.track}><div className={styles.fill} style={{width: `${u.v}%`}}/></div>
        </div>
      ))}
    </div>
  );
}