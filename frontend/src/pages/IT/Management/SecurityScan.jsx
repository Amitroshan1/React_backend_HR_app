import React, { useState } from 'react';
import styles from './SecurityScan.module.css';
import { ArrowLeft, ShieldCheck, RefreshCw, AlertTriangle, Lock, ShieldAlert } from 'lucide-react';

const SecurityScan = ({ onBack }) => {
  const [isScanning, setIsScanning] = useState(false);

  const handleScan = () => {
    setIsScanning(true);
    setTimeout(() => setIsScanning(false), 2500);
  };

  return (
    <div className={styles.container}>
      <button onClick={onBack} className={styles.backBtn}>
        <ArrowLeft size={18} /> Back to Dashboard
      </button>

      <div className={styles.header}>
        <div>
          <h2>Security System Center</h2>
          <p>Real-time infrastructure protection and threat detection.</p>
        </div>
        <button 
          className={`${styles.scanBtn} ${isScanning ? styles.loading : ''}`} 
          onClick={handleScan}
          disabled={isScanning}
        >
          <RefreshCw size={18} /> {isScanning ? 'Scanning...' : 'Run Deep Scan'}
        </button>
      </div>

      <div className={styles.topGrid}>
        {/* Health Score Card */}
        <div className={styles.card}>
          <div className={styles.scoreWrapper}>
            <div className={styles.progressRing}>
              <div className={styles.scoreText}>
                <span className={styles.bigNumber}>94</span>
                <span className={styles.scoreLabel}>Health Score</span>
              </div>
            </div>
          </div>
          <div className={styles.scoreFooter}>
            <div className={styles.statusItem}><Lock size={16} color="#22c55e"/> SSL: Active</div>
            <div className={styles.statusItem}><ShieldCheck size={16} color="#22c55e"/> Firewall: On</div>
          </div>
        </div>

        {/* Threats Card */}
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>Recent Threats</h3>
          <div className={styles.threatList}>
            <div className={`${styles.threatItem} ${styles.high}`}>
              <ShieldAlert size={18} />
              <div>
                <strong>SQL Injection Attempt</strong>
                <p>IP: 182.16.xx.xx • Blocked</p>
              </div>
            </div>
            <div className={`${styles.threatItem} ${styles.low}`}>
              <AlertTriangle size={18} />
              <div>
                <strong>Unauthorized Port Scan</strong>
                <p>IP: 104.12.xx.xx • Logged</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className={styles.logCard}>
        <h3 className={styles.cardTitle}>System Audit Log</h3>
        <table className={styles.logTable}>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>System Module</th>
              <th>Action Taken</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>11:15:22 AM</td>
              <td>Database Auth</td>
              <td>Root Login Attempt</td>
              <td><span className={styles.success}>Verified</span></td>
            </tr>
            <tr>
              <td>10:42:01 AM</td>
              <td>Cloud Storage</td>
              <td>Auto-Backup Snapshot</td>
              <td><span className={styles.success}>Completed</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SecurityScan;