import { useState } from "react";
import { useRefreshOnNavigate } from "../../../../hooks/useRefreshOnNavigate";
import { RequestCard } from "../Requests/RequestCard";
import { actOnManagerRequest, fetchManagerRequests } from "../../api";
import { formatDate } from "../../../../utils/dateFormat";

function formatCompOffWillUse(slices) {
  if (!Array.isArray(slices) || !slices.length) return "";
  return slices
    .map((s) => {
      const days = s.days != null ? s.days : 1;
      const earned = formatDate(s.gain_date);
      const exp = formatDate(s.expiry_date);
      return `${days} from ${earned} (exp. ${exp})`;
    })
    .join("; ");
}

export const LeaveRequests = ({ statusFilter = "Pending", onRequestUpdated }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState(null);

  useRefreshOnNavigate(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const rows = await fetchManagerRequests("leave", statusFilter);
        const mapped = rows.map((r) => {
          const isCompOff = (r.leave_type || "") === "Compensatory Leave";
          const willUseText = isCompOff ? formatCompOffWillUse(r.compoff_will_use) : "";
          return {
            id: r.id,
            type: "Leave",
            status: r.status,
            employeeName: r.employee_name || "N/A",
            leaveType: r.leave_type || "Leave",
            reason: `${r.leave_type || "Leave"} (${formatDate(r.start_date)} to ${formatDate(r.end_date)})`,
            isCompOff,
            compOffExpiry: isCompOff ? r.compoff_earliest_expiry || null : null,
            compOffWillUse: willUseText || null,
            compOffWarning: isCompOff ? r.compoff_warning || null : null,
            compOffApprovalOk: isCompOff ? r.compoff_approval_ok : null,
          };
        });
        setRequests(mapped.sort((a, b) => (b.id - a.id)));
      } catch (e) {
        setError(e.message || "Unable to load leave requests");
        setRequests([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [statusFilter]);

  const handleAction = async (id, action) => {
    try {
      setActingId(id);
      await actOnManagerRequest("leave", id, action);
      if (onRequestUpdated) {
        await onRequestUpdated();
      }
      const newStatus = action === "approve" ? "Approved" : "Rejected";
      if ((statusFilter || "").toLowerCase() === "pending") {
        setRequests((prev) => prev.filter((r) => r.id !== id));
      } else {
        setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: newStatus } : r)));
      }
    } catch (e) {
      setError(e.message || "Unable to update leave request");
    } finally {
      setActingId(null);
    }
  };

  if (loading) return <p>Loading leave requests...</p>;
  if (error) return <p>{error}</p>;
  if (!requests.length) return <p>No leave requests found.</p>;

  return (
    <>
      {requests.map((req) => (
        <RequestCard
          key={req.id}
          request={req}
          onAction={handleAction}
          isActing={actingId === req.id}
        />
      ))}
    </>
  );
};
