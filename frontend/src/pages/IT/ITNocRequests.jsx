import { useNavigate } from "react-router-dom";
import { DepartmentNocPanel } from "../Manager/comps/DepartmentNocPanel";
import { isAdminVisitActive } from "../../hooks/useAdminVisitNav";
import "./ReturnRequests.css";
import "./ITNocRequests.css";

/** IT department NOC clearance queue (same list/upload flow as other department panels). */
export default function ITNocRequests() {
  const navigate = useNavigate();
  const fromAdmin = isAdminVisitActive();

  return (
    <div className={`it-noc-page${fromAdmin ? " it-noc-page--admin" : ""}`}>
      <div className="it-noc-shell">
        {!fromAdmin && (
          <button type="button" className="it-noc-back" onClick={() => navigate("/it")}>
            ← Back to IT Management
          </button>
        )}

        <header className="it-noc-hero">
          <div className="it-noc-hero__main">
            <h1>NOC Requests</h1>
            <p>
              Separation NOC requests routed to IT. Upload clearance documents when status is
              Pending.
            </p>
          </div>
          <span className="it-noc-hero__badge">IT Clearance</span>
        </header>

        <div className="it-noc-body">
          <div className="it-noc-panel">
            <DepartmentNocPanel apiBase="/api/it" statusFilter="All" variant="table" />
          </div>
        </div>
      </div>
    </div>
  );
}
