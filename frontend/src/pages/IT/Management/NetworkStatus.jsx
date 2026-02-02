import React from 'react';
import styles from './NetworkStatus.module.css';
import { ArrowLeft, Globe, Wifi, Activity, Server, Zap } from 'lucide-react';

const NetworkStatus = ({ onBack }) => {
  const nodes = [
    { name: 'Primary Gateway', ip: '192.168.1.1', load: '18%', status: 'Online', latency: '2ms' },
    { name: 'AWS Cloud Bridge', ip: '10.0.4.22', load: '64%', status: 'Online', latency: '45ms' },
    { name: 'Local Database', ip: '192.168.1.50', load: '92%', status: 'High Load', latency: '5ms' },
  ];

  return (
    <div className={styles.container}>
      <button onClick={onBack} className={styles.backBtn}>
        <ArrowLeft size={18} /> Back to Dashboard
      </button>

      <div className={styles.header}>
        <div>
          <h2>Network Infrastructure</h2>
          <p>Real-time monitoring of global connectivity and bandwidth distribution.</p>
        </div>
        <div className={styles.liveIndicator}>
          <span className={styles.pulse}></span> Live System Feed
        </div>
      </div>

      <div className={styles.topGrid}>
        {/* Bandwidth Usage Card */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <Globe size={20} color="var(--primary)" />
            <h3>Bandwidth Utilization</h3>
          </div>
          <div className={styles.speedFlex}>
            <div className={styles.speedItem}>
              <span className={styles.speedVal}>854.2</span>
              <span className={styles.speedUnit}>Mbps Download</span>
            </div>
            <div className={styles.divider}></div>
            <div className={styles.speedItem}>
              <span className={styles.speedVal}>120.5</span>
              <span className={styles.speedUnit}>Mbps Upload</span>
            </div>
          </div>
        </div>

        {/* Latency Stats Card */}
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <Zap size={20} color="#f59e0b" />
            <h3>System Latency</h3>
          </div>
          <div className={styles.latencyGrid}>
            <div className={styles.latBox}>
              <strong>12ms</strong>
              <p>Avg Ping</p>
            </div>
            <div className={styles.latBox}>
              <strong>0.02%</strong>
              <p>Packet Loss</p>
            </div>
          </div>
        </div>
      </div>

      {/* Network Nodes Table */}
      <div className={styles.nodeWrapper}>
        <h3 className={styles.sectionTitle}>Active Network Nodes</h3>
        <div className={styles.nodeGrid}>
          {nodes.map((node, index) => (
            <div key={index} className={styles.nodeCard}>
              <div className={styles.nodeMain}>
                <Server size={24} className={styles.nodeIcon} />
                <div>
                  <h4>{node.name}</h4>
                  <code>{node.ip}</code>
                </div>
              </div>
              <div className={styles.nodeStats}>
                <div className={styles.metric}>
                  <span>Load</span>
                  <strong>{node.load}</strong>
                </div>
                <div className={styles.metric}>
                  <span>Ping</span>
                  <strong>{node.latency}</strong>
                </div>
                <span className={node.status === 'Online' ? styles.statusOk : styles.statusWarn}>
                  {node.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NetworkStatus;