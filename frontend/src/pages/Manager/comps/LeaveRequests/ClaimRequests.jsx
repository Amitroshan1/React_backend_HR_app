import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRefreshOnNavigate } from "../../../../hooks/useRefreshOnNavigate";
import { RequestCard } from "../Requests/RequestCard";
import { actOnManagerRequest, fetchManagerRequests } from "../../api";

export const ClaimRequests = ({ statusFilter = "Pending", onRequestUpdated }) => {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState(null);

  useRefreshOnNavigate(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const rows = await fetchManagerRequests("claim", statusFilter);
        const mapped = rows.map((r) => {
          const itemCount = r.line_items?.length || 0;
          const total = Number(r.total_amount || 0);
          const currency = r.currency || r.line_items?.[0]?.currency || "INR";
          return {
            id: r.id,
            type: "Claim",
            status: r.status,
            employeeName: r.employee_name || "N/A",
            reason: `${r.project_name || "Project"} - ${r.country_state || "N/A"} · ${itemCount} item(s) · ${currency} ${total.toLocaleString()}`,
            claim: r,
          };
        });
        setRequests(mapped.sort((a, b) => (b.id - a.id)));
      } catch (e) {
        setError(e.message || "Unable to load claim requests");
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
      await actOnManagerRequest("claim", id, action);
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
      setError(e.message || "Unable to update claim request");
    } finally {
      setActingId(null);
    }
  };

  if (loading) return <p>Loading claim requests...</p>;
  if (error) return <p>{error}</p>;
  if (!requests.length) return <p>No claim requests found.</p>;

  return (
    <>
      {requests.map((req) => (
        <RequestCard
          key={req.id}
          request={req}
          onAction={handleAction}
          isActing={actingId === req.id}
          onViewDetails={() =>
            navigate(`/manager/claims/${req.id}`, { state: { claim: req.claim } })
          }
        />
      ))}
    </>
  );
};
