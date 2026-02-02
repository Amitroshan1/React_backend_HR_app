import React from "react";
import { useNavigate } from "react-router-dom";

export const ResignationRequests = ({ updateSignal }) => {
  const navigate = useNavigate();

  // Mock data representing the Rahul Singh request from your screenshot
  const resignationRequests = [
    {
      id: 301,
      employeeName: "Rahul Singh",
      type: "Resignation",
      reason: "Seeking better opportunities for career growth",
      status: "Pending",
      details: {
        "Designation": "QA Engineer",
        "Employee ID": "EMP-405",
        "Email": "rsingh@sghaam.com",
        "Notice Period": "90 Days",
        "Last Working Day": "02-04-2026"
      }
    }
  ];

  const handleViewDetails = (req) => {
    navigate(`/details/${req.id}`, { state: { request: req } });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {resignationRequests.map((req) => (
        <div
          key={req.id}
          style={{
            backgroundColor: "#ffffff",
            padding: "24px",
            borderRadius: "16px",
            boxShadow: "0 2px 10px rgba(0, 0, 0, 0.04)",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start", // Matches your screenshots
            width: "100%",
            transition: "transform 0.2s ease"
          }}
        >
          {/* Header Row: Type + Status Badge */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <span style={{ 
              fontSize: "1.1rem", 
              fontWeight: "500", 
              color: "#1e293b" 
            }}>
              {req.type}
            </span>
            <span style={{
              backgroundColor: "#fef3c7", // Light amber background
              color: "#d97706",         // Dark amber text
              padding: "2px 12px",
              borderRadius: "20px",
              fontSize: "0.8rem",
              fontWeight: "600"
            }}>
              {req.status}
            </span>
          </div>

          {/* Employee Name */}
          <h2 style={{ 
            margin: "0", 
            fontSize: "1.5rem", 
            fontWeight: "700", 
            color: "#000000" 
          }}>
            {req.employeeName}
          </h2>

          {/* Reason text (Only for Resignation/WFH) */}
          <p style={{ 
            margin: "4px 0 16px 0", 
            color: "#64748b", 
            fontSize: "1.05rem",
            fontWeight: "400"
          }}>
            {req.reason}
          </p>

          {/* View Details Button */}
          <button
            onClick={() => handleViewDetails(req)}
            style={{
              padding: "8px 24px",
              borderRadius: "25px",
              border: "none",
              backgroundColor: "#f0f4ff", // Very light blue
              color: "#4f46e5",         // Purple-blue text
              fontWeight: "600",
              fontSize: "0.95rem",
              cursor: "pointer",
              transition: "background 0.2s ease"
            }}
            onMouseOver={(e) => (e.target.style.backgroundColor = "#e5edff")}
            onMouseOut={(e) => (e.target.style.backgroundColor = "#f0f4ff")}
          >
            View Details
          </button>
        </div>
      ))}
    </div>
  );
}