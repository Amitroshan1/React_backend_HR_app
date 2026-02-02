import { useNavigate } from "react-router-dom";
import "./RequestCard.css";

export const RequestCard = ({ request }) => {
  const navigate = useNavigate();

  // Updated helper to handle Resignation explicitly and default to Claim
  const getBadgeClass = (type) => {
    const t = type?.toLowerCase() || "";
    if (t.includes("leave")) return "badge-leave";
    if (t.includes("wfh") || t.includes("home")) return "badge-wfh";
    if (t.includes("resignation")) return "badge-resignation"; // Added check
    return "badge-claim"; // Default fallback
  };

  return (
    <div className="request-card">
      <div className="card-top-row">
        <div className="type-container">
          {/* Defaulting to "Claim" if type is missing or null */}
          <span className={`request-id-badge ${getBadgeClass(request.type)}`}>
            {request.type || "Claim"}
          </span>
          
          {/* Status Pill matching the visual style of your images */}
          <span className={`status-pill status-${request.status?.toLowerCase() || 'pending'}`}>
            {request.status || "Pending"}
          </span>
        </div>
      </div>

      <div className="request-content">
        <h4>{request.employeeName}</h4>
        {/* Shows the reason for resignation or claim details */}
        <p className="request-reason">{request.reason}</p>
      </div>

      <button 
        className="details-pill" 
        onClick={() => navigate(`/details/${request.id}`, { state: { request } })}
      >
        View Details
      </button>
    </div>
  );
}