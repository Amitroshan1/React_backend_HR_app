import React from 'react';
import './ITPanel.css';

export const ITPanel = () => {
  return (
    <div className="it-panel-container">
      <div className="it-panel-header">
        <h1>IT Panel</h1>
        <p>System Administration & Support Management</p>
      </div>
      
      <div className="it-panel-content">
        <div className="it-stats-grid">
          <div className="it-stat-card">
            <h3>Active Devices</h3>
            <p className="stat-value">156</p>
          </div>
          <div className="it-stat-card">
            <h3>Server Uptime</h3>
            <p className="stat-value">99.9%</p>
          </div>
          <div className="it-stat-card">
            <h3>Security Alerts</h3>
            <p className="stat-value">3</p>
          </div>
          <div className="it-stat-card">
            <h3>Open Tickets</h3>
            <p className="stat-value">12</p>
          </div>
        </div>
        
        <div className="it-panel-message">
          <p>IT Panel functionality coming soon...</p>
        </div>
      </div>
    </div>
  );
};
