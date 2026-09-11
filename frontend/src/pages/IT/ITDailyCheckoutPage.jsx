import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  approveDayUseRequestAPI,
  acknowledgeAndDownloadAcceptanceAPI,
  completeDayUseReturnAPI,
  downloadDayUseDocumentAPI,
  fetchDayUseInboxAPI,
  rejectDayUseRequestAPI,
  toastITApiFailure,
} from "./Data";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import { dayUseItRemark, dayUseItemsLabel, dayUseTimeline } from "./dayUseDisplay";
import "./DailyAssets.css";

const STATUS_LABEL = {
  requested: "Requested",
  approved: "Approved",
  assigned: "Assigned",
  return_requested: "Return requested",
  overdue: "Overdue",
  rejected: "Rejected",
  cancelled: "Cancelled",
  returned: "Returned",
};

const FILTERS = [
  { value: "", label: "All" },
  { value: "requested", label: "Requested" },
  { value: "approved", label: "Approved" },
  { value: "assigned", label: "Assigned" },
  { value: "return_requested", label: "Return requested" },
  { value: "overdue", label: "Overdue" },
  { value: "returned", label: "Returned" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

function statusClass(status) {
  const key = String(status || "").toLowerCase();
  if (key === "approved" || key === "assigned") return `da-pill da-pill--${key}`;
  if (key === "overdue" || key === "rejected") return "da-pill da-pill--alert";
  if (key === "return_requested") return "da-pill da-pill--warn";
  if (key === "returned" || key === "cancelled") return "da-pill da-pill--muted";
  return "da-pill";
}

function requestItemsLabel(row) {
  return dayUseItemsLabel(row);
}

function TimelineCell({ row }) {
  const t = dayUseTimeline(row);
  return (
    <div className="da-history-times da-history-times--compact">
      <span>
        <em>Requested</em> {formatDateTimeDDMMYYYY(t.requestedAt) || "—"}
      </span>
      <span>
        <em>Assigned</em> {formatDateTimeDDMMYYYY(t.assignedAt) || "—"}
      </span>
      <span>
        <em>Return accepted</em> {formatDateTimeDDMMYYYY(t.returnedAt) || "—"}
      </span>
    </div>
  );
}

export default function ITDailyCheckoutPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDayUseInboxAPI(status || undefined);
      setRows(data.requests || []);
    } catch (err) {
      toastITApiFailure(err, "Unable to load inbox");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  return (
    <div className="da-page">
      <div className="da-container">
        <header className="da-topbar">
          <button type="button" className="da-back" onClick={() => navigate("/it")}>
            ← Back
          </button>
          <div className="da-title-block">
            <p className="da-kicker">IT · Asset Management</p>
            <h1 className="da-title">Day-use Assets</h1>
          </div>
          <p className="da-total">
            {loading ? (
              "Loading…"
            ) : (
              <>
                <strong>{rows.length}</strong> request{rows.length === 1 ? "" : "s"}
              </>
            )}
          </p>
        </header>

        <p className="da-sub">
          Approve requests, then assign an inventory unit and record accessory comments on the assign page.
        </p>

        <div className="da-toolbar">
          <div className="da-filters">
            {FILTERS.map((f) => (
              <button
                key={f.value || "all"}
                type="button"
                className={status === f.value ? "active" : ""}
                onClick={() => setStatus(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="da-muted da-loading">Loading…</p>
        ) : (
              <div className="da-table-wrap it-m-scroll--cards">
            <table className="da-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Employee</th>
                  <th>Items</th>
                  <th>Status</th>
                  <th>Timeline</th>
                  <th>Notes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="da-empty it-m-empty">
                      No requests in this filter.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const remark = dayUseItRemark(r);
                    return (
                    <tr key={r.id}>
                      <td data-label="Code">
                        <span className="da-code">{r.request_code}</span>
                      </td>
                      <td data-label="Employee">
                        <div className="da-cell-stack">
                          <strong>{r.requester_name}</strong>
                          <span>{r.requester_emp_id}</span>
                        </div>
                      </td>
                      <td data-label="Items">
                        <span className="da-items-cell" title={requestItemsLabel(r)}>
                          {requestItemsLabel(r)}
                        </span>
                      </td>
                      <td data-label="Status">
                        <span className={statusClass(r.status)}>{STATUS_LABEL[r.status] || r.status}</span>
                      </td>
                      <td data-label="Timeline">
                        <TimelineCell row={r} />
                      </td>
                          <td data-label="Notes">
                            <div className="da-notes-cell">
                              <span title={r.requested_notes || ""}>
                                {r.requested_notes?.trim() ? r.requested_notes : "—"}
                              </span>
                              {r.expected_return_at ? (
                                <span className="da-muted da-due-line">
                                  Due {formatDateTimeDDMMYYYY(r.expected_return_at)}
                                </span>
                              ) : null}
                              {remark.text ? (
                                <span
                                  className="da-due-line"
                                  style={
                                    String(r.status || "").toLowerCase() === "rejected"
                                      ? { color: "#b91c1c" }
                                      : undefined
                                  }
                                >
                                  {remark.label}: {remark.text}
                                </span>
                              ) : null}
                            </div>
                          </td>
                      <td className="da-actions" data-label="Action">
                        {r.status === "requested" && (
                          <>
                            <button
                              type="button"
                              className="da-btn da-btn--primary"
                              disabled={busyId === r.id}
                              onClick={async () => {
                                setBusyId(r.id);
                                try {
                                  await approveDayUseRequestAPI(r.id);
                                  toast.success("Approved");
                                  await loadInbox();
                                } catch (err) {
                                  toastITApiFailure(err);
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="da-btn da-btn--danger"
                              disabled={busyId === r.id}
                              onClick={async () => {
                                const reason = window.prompt("Rejection reason");
                                if (!reason) return;
                                setBusyId(r.id);
                                try {
                                  await rejectDayUseRequestAPI(r.id, reason);
                                  toast.success("Rejected");
                                  await loadInbox();
                                } catch (err) {
                                  toastITApiFailure(err);
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {r.status === "approved" && (
                          <button
                            type="button"
                            className="da-btn da-btn--primary"
                            onClick={() => navigate(`/it/daily-checkout/assign/${r.id}`)}
                          >
                            Assign unit
                          </button>
                        )}
                        {["assigned", "overdue", "return_requested"].includes(r.status) && (
                          <>
                            {!r.documents?.acceptance ? (
                              <button
                                type="button"
                                className="da-btn da-btn--primary"
                                disabled={busyId === r.id}
                                onClick={async () => {
                                  setBusyId(r.id);
                                  try {
                                    await acknowledgeAndDownloadAcceptanceAPI(r.id);
                                    toast.success("Acceptance PDF downloaded");
                                    await loadInbox();
                                  } catch (err) {
                                    toastITApiFailure(err);
                                  } finally {
                                    setBusyId(null);
                                  }
                                }}
                              >
                                Acknowledge PDF
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="da-btn da-btn--ghost"
                                onClick={() =>
                                  downloadDayUseDocumentAPI(r.id, "acceptance").catch((err) =>
                                    toastITApiFailure(err),
                                  )
                                }
                              >
                                Acceptance PDF
                              </button>
                            )}
                            <button
                              type="button"
                              className="da-btn da-btn--ghost"
                              disabled={busyId === r.id}
                              onClick={async () => {
                                const remarks = window.prompt("Return remarks (required for employee history)", "") || "";
                                if (!remarks.trim()) {
                                  toast.error("Add a return remark");
                                  return;
                                }
                                setBusyId(r.id);
                                try {
                                  await completeDayUseReturnAPI(r.id, {
                                    conditionIn: "ok",
                                    remarks,
                                    walkUp: r.status !== "return_requested",
                                  });
                                  toast.success("Return completed");
                                  await loadInbox();
                                } catch (err) {
                                  toastITApiFailure(err);
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                            >
                              {r.status === "return_requested" ? "Receive" : "Walk-up return"}
                            </button>
                          </>
                        )}
                        {r.documents?.acceptance &&
                          !["assigned", "overdue", "return_requested"].includes(r.status) && (
                          <button
                            type="button"
                            className="da-btn da-btn--ghost"
                            onClick={() =>
                              downloadDayUseDocumentAPI(r.id, "acceptance").catch((err) =>
                                toastITApiFailure(err),
                              )
                            }
                          >
                            Acceptance PDF
                          </button>
                        )}
                        {r.documents?.return_ack && (
                          <button
                            type="button"
                            className="da-btn da-btn--ghost"
                            onClick={() =>
                              downloadDayUseDocumentAPI(r.id, "return_ack").catch((err) =>
                                toastITApiFailure(err),
                              )
                            }
                          >
                            Return PDF
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
              </div>
        )}
      </div>
    </div>
  );
}
