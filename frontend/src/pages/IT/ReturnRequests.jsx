import { useCallback, useState } from "react";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  approveReturnRequestAPI,
  completeReturnRequestAPI,
  getITApiErrorMessage,
  listReturnRequestsAPI,
  rejectReturnRequestAPI,
} from "./Data";
import { openFirstImageInNewTab, openImageInNewTab } from "../../utils/openImageInNewTab";
import "./ReturnRequests.css";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";

const STATUS_OPTIONS = ["all", "pending", "approved", "rejected", "completed"];

const formatReturnDest = (dest) =>
  dest === "removed_from_it" ? "Removed From IT" : "Available";

export default function ReturnRequests() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("all");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listReturnRequestsAPI({
        status: status === "all" ? "" : status,
      });
      setRows(data);
    } catch (err) {
      toast.error(getITApiErrorMessage(err, "Could not load return requests."));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useRefreshOnNavigate(() => {
    load();
  }, [status]);

  const onApprove = async (id) => {
    try {
      await approveReturnRequestAPI(id);
      toast.success("Return request approved.");
      await load();
    } catch (err) {
      toast.error(getITApiErrorMessage(err, "Could not approve request."));
    }
  };

  const onReject = async (id) => {
    const reason = window.prompt("Enter rejection reason:");
    if (reason == null) return;
    if (!reason.trim()) {
      toast.error("Rejection reason is required.");
      return;
    }
    try {
      await rejectReturnRequestAPI(id, reason.trim());
      toast.success("Return request rejected.");
      await load();
    } catch (err) {
      toast.error(getITApiErrorMessage(err, "Could not reject request."));
    }
  };

  const onComplete = async (id) => {
    if (!window.confirm("Confirm physical receipt and complete this return?")) return;
    try {
      await completeReturnRequestAPI(id);
      toast.success("Return completed and asset unassigned.");
      await load();
    } catch (err) {
      toast.error(getITApiErrorMessage(err, "Could not complete request."));
    }
  };

  return (
    <div className="rr-page">
      <div className="rr-topbar">
        <button className="rr-back-btn" onClick={() => navigate("/it")}>← Back to IT Management</button>
        <h1>Return Requests</h1>
      </div>

      <div className="rr-filters">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            className={`rr-chip ${status === s ? "active" : ""}`}
            onClick={() => setStatus(s)}
          >
            {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="rr-table-wrap it-m-scroll--cards">
        {loading ? (
          <div className="rr-loading">Loading…</div>
        ) : (
          <table className="rr-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Employee</th>
                <th>Asset</th>
                <th>Qty</th>
                <th>Return To</th>
                <th>Reason</th>
                <th>Files</th>
                <th>Status</th>
                <th>Requested</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={10} className="rr-empty">No return requests found.</td></tr>
              ) : (
                rows.map((r) => {
                  const photos = Array.isArray(r.photos) ? r.photos : [];
                  const qty = Math.max(1, Number(r.quantity) || 1);
                  return (
                  <tr key={r.id}>
                    <td data-label="Code">{r.requestCode}</td>
                    <td data-label="Employee">
                      <div>{r.requesterName || "—"}</div>
                      <small>{r.requesterEmpId || r.requesterEmail || "—"}</small>
                    </td>
                    <td data-label="Asset">
                      <div>{r.assetName || "—"}</div>
                      <small>{r.category || "—"}</small>
                    </td>
                    <td data-label="Qty">{r.inventoryItemId || qty > 1 ? qty : "—"}</td>
                    <td data-label="Return To">{formatReturnDest(r.returnDestination)}</td>
                    <td className="rr-reason" data-label="Reason">{r.reason || "—"}</td>
                    <td data-label="Files">
                      {photos.length > 0 ? (
                        <button
                          type="button"
                          className="rr-files-btn"
                          onClick={() => {
                            const images = photos.filter((p) => String(p).startsWith("data:image/"));
                            if (images.length && openFirstImageInNewTab(images)) return;
                            const first = photos[0];
                            if (first) openImageInNewTab(first);
                          }}
                          title="Open attachment in new tab"
                        >
                          View ({photos.length})
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="Status"><span className={`rr-status ${r.status}`}>{r.status}</span></td>
                    <td data-label="Requested">{formatDateTimeDDMMYYYY(r.createdAt)}</td>
                    <td data-label="Action">
                      {r.status === "pending" && (
                        <div className="rr-actions">
                          <button onClick={() => onApprove(r.id)} className="approve">Approve</button>
                          <button onClick={() => onReject(r.id)} className="reject">Reject</button>
                        </div>
                      )}
                      {r.status === "approved" && (
                        <button onClick={() => onComplete(r.id)} className="complete">
                          Mark Received
                        </button>
                      )}
                      {(r.status === "rejected" || r.status === "completed") && <span>—</span>}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
