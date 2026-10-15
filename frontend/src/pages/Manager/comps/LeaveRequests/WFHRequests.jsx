import { useState } from "react";
import { useRefreshOnNavigate } from "../../../../hooks/useRefreshOnNavigate";
import { RequestCard } from "../Requests/RequestCard";
import { actOnManagerRequest, fetchManagerRequests, requestGreyedUnlock, submitApprovalConsent } from "../../api";
import { formatDate } from "../../../../utils/dateFormat";

export const WFHRequests = ({ statusFilter = "Pending", onRequestUpdated }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState(null);
  const [selected, setSelected] = useState([]);
  const [batchNote, setBatchNote] = useState("");

  useRefreshOnNavigate(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const rows = await fetchManagerRequests("wfh", statusFilter);
        const mapped = rows.map((r) => ({
          id: r.id,
          type: "WFH",
          status: r.status,
          employeeName: r.employee_name || "N/A",
          reason: `${r.reason || "-"} (${formatDate(r.start_date)} to ${formatDate(r.end_date)})`,
          canAct: r.can_act === true,
          waitingOn: r.waiting_on || "",
        }));
        setRequests(mapped.sort((a, b) => (b.id - a.id)));
      } catch (e) {
        setError(e.message || "Unable to load WFH requests");
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
      const result = await actOnManagerRequest("wfh", id, action);
      if (onRequestUpdated) {
        await onRequestUpdated();
      }
      const newStatus = result.status || (action === "approve" ? "Approved" : "Rejected");
      if ((statusFilter || "").toLowerCase() === "pending") {
        setRequests((prev) => prev.filter((r) => r.id !== id));
      } else {
        setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: newStatus, canAct: false } : r)));
      }
    } catch (e) {
      setError(e.message || "Unable to update WFH request");
    } finally {
      setActingId(null);
    }
  };

  const greyed = (statusFilter || "").toLowerCase() === "greyed out";
  const consentIds = requests.filter((row) => row.canAct && row.waitingOn === "l2").map((row) => row.id);
  const batchIds = greyed ? requests.map((row) => row.id) : consentIds;

  const toggle = (id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const submitBatch = async () => {
    try {
      setActingId("batch");
      setBatchNote("");
      if (greyed) {
        const result = await requestGreyedUnlock({ wfhIds: selected });
        setBatchNote(result.message || "Sent to Admin.");
      } else {
        await submitApprovalConsent({ wfhIds: selected });
        setBatchNote("Consent recorded. HR and L1 have been emailed when a mailbox is configured.");
        setRequests((prev) => prev.filter((row) => !selected.includes(row.id)));
        if (onRequestUpdated) await onRequestUpdated();
      }
      setSelected([]);
    } catch (e) {
      setError(e.message || "Could not submit the selection.");
    } finally {
      setActingId(null);
    }
  };

  if (loading) return <p>Loading WFH requests...</p>;
  if (error) return <p>{error}</p>;
  if (!requests.length) return <p>No WFH requests found.</p>;

  return (
    <>
      {batchIds.length > 0 ? (
        <div className="request-batch">
          <button type="button" onClick={submitBatch} disabled={!selected.length || actingId === "batch"}>
            {greyed ? "Ask Admin to release" : "Give consent"}
          </button>
          <span>{selected.length} selected</span>
          {batchNote ? <p>{batchNote}</p> : null}
        </div>
      ) : null}
      {requests.map((req) => (
        <RequestCard
          key={req.id}
          request={req}
          onAction={handleAction}
          isActing={actingId === req.id}
          selected={selected.includes(req.id)}
          onToggle={batchIds.includes(req.id) ? toggle : null}
        />
      ))}
    </>
  );
};
