import "./RequestCard.css";

export const RequestCard = ({ request, onAction, isActing }) => {
  const getBadgeClass = (type) => {
    const t = type?.toLowerCase() || "";
    if (t.includes("leave")) return "badge-leave";
    if (t.includes("wfh") || t.includes("home")) return "badge-wfh";
    if (t.includes("resignation")) return "badge-resignation";
    return "badge-claim";
  };

  const isPending = (request.status || "").toLowerCase() === "pending";

  return (
    <div className="request-card">
      <div className="card-top-row">
        <div className="type-container">
          <span className={`request-id-badge ${getBadgeClass(request.type)}`}>
            {request.type || "Claim"}
          </span>

          <span className={`status-pill status-${request.status?.toLowerCase() || 'pending'}`}>
            {request.status || "Pending"}
          </span>
        </div>
      </div>

      <div className="request-content">
        <h4>{request.employeeName}</h4>
        <p className="request-reason">{request.reason || "-"}</p>
      </div>

      {isPending && onAction ? (
        <div className="request-actions">
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
      ) : (
        <span className="details-pill">Processed</span>
      )}
    </div>
  );
};