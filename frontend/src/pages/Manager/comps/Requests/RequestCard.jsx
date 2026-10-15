import "./RequestCard.css";
import { formatDate } from "../../../../utils/dateFormat";

export const RequestCard = ({ request, onAction, isActing, onViewDetails, selected = false, onToggle }) => {
  const getBadgeClass = (type) => {
    const t = type?.toLowerCase() || "";
    if (t.includes("leave")) return "badge-leave";
    if (t.includes("wfh") || t.includes("home")) return "badge-wfh";
    if (t.includes("resignation")) return "badge-resignation";
    return "badge-claim";
  };

  const canAct = request.canAct === true || (request.canAct == null && (request.status || "").toLowerCase() === "pending");
  const statusClass = (request.status || "pending").toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="request-card">
      <div className="card-top-row">
        <div className="type-container">
          <span className={`request-id-badge ${getBadgeClass(request.type)}`}>
            {request.type || "Claim"}
          </span>

          <span className={`status-pill status-${statusClass}`}>
            {request.status || "Pending"}
          </span>
        </div>
      </div>

      <div className="request-content">
        <h4>{request.employeeName}</h4>
        <p className="request-reason">{request.reason || "-"}</p>
        {request.isCompOff ? (
          <div className="request-compoff-meta">
            {request.compOffExpiry ? (
              <p className="request-compoff-expiry">
                Comp Off credit expires: <strong>{formatDate(request.compOffExpiry)}</strong>
              </p>
            ) : null}
            {request.compOffWillUse ? (
              <p className="request-compoff-will-use" title={request.compOffWillUse}>
                Uses: {request.compOffWillUse}
              </p>
            ) : (
              <p className="request-compoff-will-use request-compoff-will-use--warn">
                No matching Comp Off credit mapped for this request
              </p>
            )}
            {request.compOffWarning ? (
              <p className="request-compoff-warning">{request.compOffWarning}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {onToggle ? (
        <label className="request-select">
          <input type="checkbox" checked={selected} onChange={() => onToggle(request.id)} />
          Select
        </label>
      ) : null}
      {canAct && onAction ? (
        <div className="request-actions">
          {onViewDetails ? (
            <button type="button" className="details-pill" onClick={onViewDetails}>
              View details
            </button>
          ) : null}
          <button
            className="btn-reject-small"
            onClick={() => onAction(request.id, "reject")}
            disabled={isActing}
          >
            {isActing ? "Updating..." : "Reject"}
          </button>
          <button
            className="btn-approve-small"
            onClick={() => onAction(request.id, "approve")}
            disabled={isActing}
          >
            {isActing ? "Updating..." : "Approve"}
          </button>
        </div>
      ) : onViewDetails ? (
        <button type="button" className="details-pill" onClick={onViewDetails}>
          View details
        </button>
      ) : (
        <span className="details-pill">Processed</span>
      )}
    </div>
  );
};
