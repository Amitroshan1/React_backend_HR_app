import React, { useState, useEffect } from "react";
import membersData from "../../data/members";
import "./TeamMembers.css";

export const TeamMembers = ({ filters, setFilters }) => {
  const { circle, type } = filters;

  // 1. ✅ Pagination State - CHANGED TO 6
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6; // Set to 6 to fit 100% screen height

  // 2. ✅ Reset to page 1 whenever filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [circle, type]);

  // ✅ FILTER LOGIC
  const filteredMembers = membersData.filter((m) => {
    const circleMatch = !circle || circle === "All" || m.circle === circle;
    const typeMatch = !type || type === "All" || m.role === type;
    return circleMatch && typeMatch;
  });

  // 3. ✅ Slicing logic for 6 members
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentMembers = filteredMembers.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredMembers.length / itemsPerPage);

  return (
    <div className="team-card">
      <div className="team-header">
        <h3>
          Team Members <span className="count">({filteredMembers.length})</span>
        </h3>
      </div>

      <div className="team-filters">
        <div>
          <label>Circle</label>
          <select
            value={circle}
            onChange={(e) => setFilters((prev) => ({ ...prev, circle: e.target.value }))}
          >
            <option value="All">All</option>
            <option value="NHQ">NHQ</option>
            <option value="Delhi">Delhi</option>
            <option value="Mumbai">Mumbai</option>
            <option value="Bangalore">Bangalore</option>
          </select>
        </div>

        <div>
          <label>Employee Type</label>
          <select
            value={type}
            onChange={(e) => setFilters((prev) => ({ ...prev, type: e.target.value }))}
          >
            <option value="All">All</option>
            <option value="Human Resource">Human Resource</option>
            <option value="Software Developer">Software Developer</option>
            <option value="Manager">Manager</option>
            <option value="Accountant">Accountant</option>
            <option value="Accounts">Accounts</option>
            <option value="Designer">Designer</option>
          </select>
        </div>
      </div>

      {/* 4. ✅ Render Sliced List (Now exactly 6 rows) */}
      <div className="team-list">
        {currentMembers.map((m) => (
          <div key={m.id} className="member-row">
            <div className="avatar">{m.name[0]}</div>
            <div className="info">
              <strong>{m.name}</strong>
              <span>{m.role}</span>
            </div>
            <div className="progress">
              <div style={{ width: `${m.perf || 0}%` }} />
            </div>
            <span className={`badge ${m.status === "WFH" ? "wfh" : ""}`}>
              {m.status || "Present"}
            </span>
          </div>
        ))}
      </div>

      {/* 5. ✅ Circular Pagination UI */}
      {totalPages > 1 && (
        <div className="modern-pagination-container">
          <div className="pagination-pill-list">
            {[...Array(totalPages)].map((_, i) => (
              <button
                key={i + 1}
                className={`page-pill ${currentPage === i + 1 ? "active" : ""}`}
                onClick={() => setCurrentPage(i + 1)}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <button
            className="pagination-next-link"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((prev) => prev + 1)}
          >
            NEXT <span className="chevron">›</span>
          </button>
        </div>
      )}
    </div>
  );
}