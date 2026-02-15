import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
// import StatsCards from "../components/StatsCards/StatsCards";
import {StatsCards} from "./comps/StatsCards/StatsCards";
import {TeamMembers} from "./comps/TeamMembers/TeamMembers";
import {LeaveRequests} from "./comps/LeaveRequests/LeaveRequests";
import {SprintPerformance} from "./comps/SprintPerformance/SprintPerformance";

import {ClaimRequests} from "./comps/LeaveRequests/ClaimRequests";
import {WFHRequests} from "./comps/LeaveRequests/WFHRequests";
import {ResignationRequests} from "./comps/LeaveRequests/ResignationRequests";
import { fetchPendingCounts } from "./api";

export const Manager = () =>{
  const [activePanel, setActivePanel] = useState("leave");
  const [showFullTable, setShowFullTable] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All"); 
  const location = useLocation();
  const [updateSignal, setUpdateSignal] = useState(null);
  const [statsCounts, setStatsCounts] = useState({
    leave: 0,
    wfh: 0,
    claim: 0,
    resignation: 0,
  });
  const reloadCounts = async () => {
    try {
      const counts = await fetchPendingCounts();
      setStatsCounts(counts);
    } catch (error) {
      console.error("Manager stats count load error:", error);
    }
  };

  useEffect(() => {
    if (location.state?.updatedId && location.state?.newStatus) {
      setUpdateSignal({
        id: location.state.updatedId,
        status: location.state.newStatus
      });
    }
  }, [location.state]);

  useEffect(() => {
    reloadCounts();
  }, []);

  const [filters, setFilters] = useState({ circle: "All", type: "All" });
  const handleCardSelect = (key) => {
    setActivePanel(key);
    setStatusFilter("All");
    setShowFullTable(true);
  };

  const renderRightPanel = (currentFilter = "All") => {
    const panelProps = { updateSignal, statusFilter: currentFilter, onRequestUpdated: reloadCounts };
    const normalizedKey = activePanel?.toLowerCase().trim();
    
    switch (normalizedKey) { 
      case "claims": 
      case "claim": return <ClaimRequests {...panelProps} />;
      case "wfh": 
      case "work from home": return <WFHRequests {...panelProps} />;
      case "resignation": 
      case "resignations": return <ResignationRequests {...panelProps} />; 
      default: return <LeaveRequests {...panelProps} />;
    }
  };

  const getPanelTitle = () => {
    const key = activePanel?.toLowerCase().trim();
    if (key.includes("claim")) return "Claim Requests";
    if (key.includes("wfh") || key.includes("home")) return "Work From Home Requests";
    if (key.includes("resign")) return "Resignation Requests";
    return "Leave Requests";
  };

  return (
    <div className="manager-dashboard-wrapper" style={{ padding: "24px", background: "#f8fafc", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      
      {showFullTable && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", backgroundColor: "#ffffff", zIndex: 9999, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "30px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9" }}>
            <h2 style={{ fontSize: "2rem", margin: 0 }}>All {getPanelTitle()}</h2>
            <button onClick={() => { setShowFullTable(false); setStatusFilter("All"); }} style={{ padding: "10px 25px", borderRadius: "30px", border: "1px solid #ddd", cursor: "pointer", fontWeight: "600" }}>Close Table</button>
          </div>

          <div style={{ padding: "15px 40px", display: "flex", gap: "10px", backgroundColor: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
            {["All", "Pending", "Approved", "Rejected"].map((status) => (
              <button key={status} onClick={() => setStatusFilter(status)} style={{ padding: "8px 20px", borderRadius: "20px", border: "none", cursor: "pointer", fontWeight: "600", backgroundColor: statusFilter === status ? "#4f46e5" : "#e2e8f0", color: statusFilter === status ? "#ffffff" : "#64748b", transition: "0.2s" }}>
                {status}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "40px" }}>
             {renderRightPanel(statusFilter)}
          </div>
        </div>
      )}
      
      <div style={{ flex: "0 0 auto", marginBottom: '24px' }}>
        <StatsCards onSelect={handleCardSelect} counts={statsCounts} />
      </div>

      <div className="main-content-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, flex: 1, minHeight: 0, width: "100%" }}>
        <div className="left-column-content" style={{ height: "100%", overflow: "hidden" }}>
            <TeamMembers filters={filters} setFilters={setFilters} />
        </div>

        <div className="right-column-stack" style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "hidden" }}>
          <div style={{ flex: "0 0 auto" }}>
            <SprintPerformance />
          </div>
        </div>
      </div>
    </div>
  );
}