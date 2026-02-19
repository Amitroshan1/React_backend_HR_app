import { useEffect, useState } from "react";
import { RequestCard } from "../Requests/RequestCard";
import { actOnManagerRequest, fetchManagerRequests } from "../../api";

export const LeaveRequests = ({ statusFilter = "Pending", onRequestUpdated }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const rows = await fetchManagerRequests("leave", statusFilter);
        const mapped = rows.map((r) => ({
          id: r.id,
          type: "Leave",
          status: r.status,
          employeeName: r.employee_name || "N/A",
          reason: `${r.leave_type || "Leave"} (${r.start_date || "-"} to ${r.end_date || "-"})`,
        }));
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
