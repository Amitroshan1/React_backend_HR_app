import React, { useEffect, useState } from "react";
import { fetchSprintPerformance } from "../../api";
import "./SprintPerformance.css";

export const SprintPerformance = () => {
  const [sprintData, setSprintData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const items = await fetchSprintPerformance();
        if (cancelled) return;
        setSprintData(items);
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Failed to load sprint performance");
        setSprintData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="sprint-card">
      <h3>Performance Review Summary</h3>
      <div className="progress-list">
        {loading && <p className="sprint-empty-msg">Loading...</p>}
        {error && !loading && <p className="sprint-empty-msg">{error}</p>}
        {!loading && !error && sprintData.map((item, index) => (
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
        {!loading && !error && sprintData.length === 0 && (
          <p className="sprint-empty-msg">No performance data available.</p>
        )}
      </div>
    </div>
  );
}
