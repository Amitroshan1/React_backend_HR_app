import React, { useState } from 'react';
import styles from './BackupManagement.module.css';
import { ArrowLeft, Cloud, Database, HardDrive, CheckCircle, RefreshCcw } from 'lucide-react';

const BackupManagement = ({ onBack }) => {
  const [isBackingUp, setIsBackingUp] = useState(false);

  const startBackup = () => {
    setIsBackingUp(true);
    setTimeout(() => setIsBackingUp(false), 3000);
  };

  return (
    <div className={styles.container}>
      <button onClick={onBack} className={styles.backBtn}>
        <ArrowLeft size={18} /> Back to Dashboard
      </button>

      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h2>Backup & Recovery</h2>
          <p>Secure snapshots and cloud synchronization.</p>
        </div>
        <button 
          className={`${styles.primaryBtn} ${isBackingUp ? styles.loading : ''}`} 
          onClick={startBackup}
          disabled={isBackingUp}
        >
          {isBackingUp ? <RefreshCcw size={18} className={styles.spin} /> : <Database size={18} />}
          <span>{isBackingUp ? 'Backing up...' : 'Backup Now'}</span>
        </button>
      </div>

      <div className={styles.statsGrid}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <HardDrive size={20} color="#3b82f6" />
            <h3>Storage Capacity</h3>
          </div>
          <div className={styles.storageInfo}>
            <div className={styles.usageBar}>
              <div className={styles.usageFill} style={{ width: '65%' }}></div>
            </div>
            <div className={styles.usageLabels}>
              <span>650 GB Used</span>
              <span>1 TB Total</span>
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <Cloud size={20} color="#10b981" />
            <h3>Cloud Sync</h3>
          </div>
          <div className={styles.syncStatus}>
            <CheckCircle color="#10b981" size={28} />
            <div>
              <strong>AWS S3 Active</strong>
              <p>Last verified: 12m ago</p>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.tableCard}>
        <h3>Backup History</h3>
        <div className={styles.tableResponsive}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Snapshot ID</th>
                <th>Type</th>
                <th>Size</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>snap_2026_0115</code></td>
                <td>Incremental</td>
                <td>1.2 GB</td>
                <td><span className={styles.statusDone}>Completed</span></td>
              </tr>
              <tr>
                <td><code>snap_2026_0114</code></td>
                <td>Full</td>
                <td>42.8 GB</td>
                <td><span className={styles.statusDone}>Completed</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BackupManagement;