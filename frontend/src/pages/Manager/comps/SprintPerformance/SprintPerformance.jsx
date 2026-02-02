import React from "react";
import "./SprintPerformance.css";

export const SprintPerformance = () => {
  // Sample data (you can replace with API data)
  const sprintData = [
    { name: "Completed Tasks", value: 75 },
    { name: "Pending Tasks", value: 20 },
    { name: "Overdue Tasks", value: 5 },
  ];

  return (
    <div className="sprint-card">
      <h3>Sprint Performance</h3>
      <div className="progress-list">
        {sprintData.map((item, index) => (
          <div key={index} className="progress-item">
            <div className="progress-header">
              <span>{item.name}</span>
              <span>{item.value}%</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${item.value}%` }}
              ></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
