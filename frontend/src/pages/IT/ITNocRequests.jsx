import { useNavigate } from "react-router-dom";
import { DepartmentNocPanel } from "../Manager/comps/DepartmentNocPanel";
import "./ReturnRequests.css";

/** IT department NOC clearance queue (same list/upload flow as other department panels). */
export default function ITNocRequests() {
  const navigate = useNavigate();

  return (
    <div className="rr-page">
      <div className="rr-topbar">
        <button type="button" className="rr-back-btn" onClick={() => navigate("/it")}>
          ← Back to IT Management
        </button>
        <h1>NOC Requests</h1>
      </div>
      <p style={{ color: "#64748b", marginBottom: 16, maxWidth: 720 }}>
        Separation NOC requests routed to IT. Upload clearance documents when status is Pending.
      </p>
      <DepartmentNocPanel apiBase="/api/it" statusFilter="All" variant="table" />
    </div>
  );
}
