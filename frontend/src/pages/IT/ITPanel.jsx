import React from 'react';
import { useNavigate } from 'react-router-dom';
import './ITPanel.css';

export const ITPanel = () => {
  const navigate = useNavigate();

  // const cards = [
  //   { title: 'Active Devices', route: '/it/ActiveDevices', value: '156' },
  //   { title: 'Open Tickets', route: '/it/OpenTicket', value: '12' },
  //   { title: 'Assets', route: '/it/Assets', value: '24' },
  //   { title: 'Inventory', route: '/it/inventory', value: '3' },
  // ];
  const cards = [
    { title: 'Active Devices', route: '/it/ActiveDevices' },
    { title: 'Open Tickets', route: '/it/OpenTicket' },
    { title: 'Assets', route: '/it/Assets'},
    { title: 'Inventory', route: '/it/inventory'},
  ];

  return (
    <div className="it-panel-container">
      <div className="it-panel-header">
        <h1>IT Panel</h1>
        <p>System Administration & Support Management</p>
      </div>
      <div className="it-panel-content">
        <div className="it-stats-grid">
          {cards.map((c) => (
            <div
              key={c.title}
              className="it-stat-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate(c.route)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(c.route); }}
              style={{ cursor: 'pointer' }}
            >
              <h3>{c.title}</h3>
              <p className="stat-value">{c.value}</p>
            </div>
          ))}
        </div>
              </div>
    </div>
  );
};
