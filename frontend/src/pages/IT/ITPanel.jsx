import React from "react";
import { useNavigate } from "react-router-dom";
import "./ITPanel.css";

export const ITPanel = () => {
  const navigate = useNavigate();

  const cards = [
    { title: "Assigned Asset", route: "/it/ActiveDevices" },
    { title: "Available Asset", route: "/it/Assets" },
    { title: "Return Requests", route: "/it/return-requests" },
    { title: "NOC Request", route: "/it/noc-requests" },
  ];

  return (
    <div className="it-panel-container">
      <div className="it-panel-header">
        <p className="it-panel-lead">System Administration &amp; Support Management</p>
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
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") navigate(c.route);
              }}
            >
              <h3>{c.title}</h3>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
