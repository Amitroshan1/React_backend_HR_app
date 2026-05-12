import { useEffect, useState } from "react";
import { fetchDepartmentNocRequests, uploadNocDepartmentRequest } from "../api";
import "./Requests/RequestCard.css";
import "../../IT/ReturnRequests.css";

function formatShort(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Newest NOC lines first: requested_at desc, then id desc. */
function sortNocRequestsNewestFirst(rows) {
  if (!Array.isArray(rows)) return [];
  const ts = (row) => {
    if (!row?.requested_at) return 0;
    const n = new Date(row.requested_at).getTime();
    return Number.isFinite(n) ? n : 0;
  };
  return [...rows].sort((a, b) => {
    const d = ts(b) - ts(a);
    if (d !== 0) return d;
    return (b?.id || 0) - (a?.id || 0);
  });
}

/** All department NOC lines for one resignation (shown in table Status column). */
const NOC_TABLE_DEPT_LINES = [
  { key: "MANAGER", label: "Reporting Manager NOC clearance" },
  { key: "HR", label: "Human Resource NOC clearance" },
  { key: "ACCOUNTS", label: "Accounts NOC clearance" },
  { key: "IT", label: "IT NOC clearance" },
];

function nocDeptStatusPillClass(statusText) {
  const s = (statusText || "").trim();
  if (!s || s === "Not requested") return "status-pill status-not-requested";
  return `status-pill status-${s.toLowerCase().replace(/\s+/g, "-")}`;
}

function isResignationApproved(req) {
  return (req.resignation_status || "").trim().toLowerCase() === "approved";
}

function isDepartmentNocUploaded(req) {
  return (req.status || "").trim().toLowerCase() === "uploaded";
}

/** When requireApproval is true (HR panel), download only if resignation is approved and this line is uploaded. */
function canDownloadDepartmentNoc(req, requireApproval) {
  if (!isDepartmentNocUploaded(req)) return false;
  if (!requireApproval) return true;
  return isResignationApproved(req);
}

/**
 * Department-scoped NOC queue (HR / Accounts / Reporting Manager / IT).
 * Pass apiBase: /api/HumanResource | /api/accounts | /api/manager | /api/it
 * variant: "cards" (default) | "table" — IT uses table with Sr.no, Name, Circle, emp_type, Status, Action.
 */
export const DepartmentNocPanel = ({
  apiBase = "/api/manager",
  statusFilter = "All",
  onRequestUpdated,
  variant = "cards",
  /** If true (HR), show download only when resignation is approved; manager / accounts / IT use uploaded-only. */
  requireResignationApprovedToDownload = false,
}) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadingId, setUploadingId] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError("");
        const rows = await fetchDepartmentNocRequests(apiBase, statusFilter);
        setRequests(sortNocRequestsNewestFirst(rows));
      } catch (e) {
        setError(e.message || "Unable to load NOC requests");
        setRequests([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [apiBase, statusFilter]);

  const handleUpload = async (req, file) => {
    if (!file || !req?.id) return;
    try {
      setUploadingId(req.id);
      await uploadNocDepartmentRequest(req.id, file, apiBase);
      if (onRequestUpdated) await onRequestUpdated();
      const rows = await fetchDepartmentNocRequests(apiBase, statusFilter);
      setRequests(sortNocRequestsNewestFirst(rows));
    } catch (e) {
      setError(e.message || "Upload failed");
    } finally {
      setUploadingId(null);
    }
  };

  const handleDownload = async (req) => {
    const token = localStorage.getItem("token");
    if (!token || !req?.id) return;
    try {
      const res = await fetch(`${apiBase}/noc-requests/${req.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Download failed");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = req.filename || `noc-${req.id}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || "Could not download file");
    }
  };

  if (loading) {
    return variant === "table" ? (
      <div className="rr-table-wrap">
        <p className="rr-loading">Loading NOC requests…</p>
      </div>
    ) : (
      <p>Loading NOC requests...</p>
    );
  }

  if (error && !requests.length) {
    return variant === "table" ? (
      <div className="rr-table-wrap">
        <p className="rr-empty">{error}</p>
      </div>
    ) : (
      <p>{error}</p>
    );
  }

  if (!requests.length) {
    return variant === "table" ? (
      <div className="rr-table-wrap">
        <p className="rr-empty">No NOC requests found.</p>
      </div>
    ) : (
      <p>No NOC requests found.</p>
    );
  }

  if (variant === "table") {
    return (
      <>
        {error ? <p className="manager-noc-inline-error">{error}</p> : null}
        <div className="rr-table-wrap">
          <table className="rr-table department-noc-table">
            <thead>
              <tr>
                <th>Sr. No.</th>
                <th>Name</th>
                <th>Circle</th>
                <th>emp_type</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((req, idx) => {
                const pending = (req.status || "").toLowerCase() === "pending";
                const canDl = canDownloadDepartmentNoc(req, requireResignationApprovedToDownload);
                const uploadedAwaitingApproval =
                  requireResignationApprovedToDownload &&
                  isDepartmentNocUploaded(req) &&
                  !isResignationApproved(req);
                return (
                  <tr key={req.id}>
                    <td>{idx + 1}</td>
                    <td>{req.employee_name || "—"}</td>
                    <td>{req.circle || "—"}</td>
                    <td>{req.emp_type || "—"}</td>
                    <td>
                      <div className="noc-table-status-stack">
                        <div>
                          <span className="noc-table-status-label">Resignation (reporting manager)</span>
                          <span
                            className={`status-pill status-${(req.resignation_status || "pending").toLowerCase()}`}
                          >
                            {req.resignation_status || "—"}
                          </span>
                        </div>
                        {NOC_TABLE_DEPT_LINES.map(({ key, label }) => {
                          const raw = req.noc_status_by_department?.[key];
                          const display = raw ?? "Not requested";
                          return (
                            <div key={key}>
                              <span className="noc-table-status-label">{label}</span>
                              <span className={nocDeptStatusPillClass(display)}>{display}</span>
                            </div>
                          );
                        })}
                      </div>
                      <span className="noc-table-meta" title="Requested date">
                        Requested: {formatShort(req.requested_at)} · NOC date: {formatShort(req.noc_date)}
                      </span>
                    </td>
                    <td>
                      <div className="noc-table-action-cell">
                        {pending ? (
                          <label className="noc-upload-label noc-upload-label--table">
                            <input
                              type="file"
                              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                              disabled={uploadingId === req.id}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                if (f) handleUpload(req, f);
                              }}
                            />
                            <span className="btn-upload-noc">
                              {uploadingId === req.id ? "Uploading…" : "Upload"}
                            </span>
                          </label>
                        ) : canDl ? (
                          <button
                            type="button"
                            className="btn-link-download"
                            onClick={() => handleDownload(req)}
                          >
                            Download
                          </button>
                        ) : uploadedAwaitingApproval ? (
                          <span className="noc-download-gated-hint" title="Reporting manager must approve the resignation first.">
                            NOC on file — download after resignation is approved
                          </span>
                        ) : (
                          <span className="noc-download-gated-hint">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <>
      {error ? <p className="manager-noc-inline-error">{error}</p> : null}
      {requests.map((req) => {
        const pending = (req.status || "").toLowerCase() === "pending";
        const canDl = canDownloadDepartmentNoc(req, requireResignationApprovedToDownload);
        const uploadedAwaitingApproval =
          requireResignationApprovedToDownload &&
          isDepartmentNocUploaded(req) &&
          !isResignationApproved(req);
        return (
          <div key={req.id} className="request-card noc-request-card">
            <div className="card-top-row">
              <div className="type-container">
                <span className="request-id-badge badge-noc">NOC Request</span>
                <span className={`status-pill status-${(req.status || "pending").toLowerCase()}`}>
                  {req.status || "Pending"}
                </span>
              </div>
            </div>
            <div className="request-content">
              <h4>{req.employee_name || "Employee"}</h4>
              <p className="noc-dept-line">
                <strong>{req.department_label || req.department_key}</strong>
              </p>
              <ul className="noc-detail-list">
                <li>
                  <span className="noc-label">Emp ID:</span> {req.emp_id || "—"}
                </li>
                <li>
                  <span className="noc-label">Email:</span> {req.employee_email || "—"}
                </li>
                <li>
                  <span className="noc-label">Circle:</span> {req.circle || "—"}
                </li>
                <li>
                  <span className="noc-label">NOC date (requested):</span> {formatShort(req.noc_date)}
                </li>
                <li>
                  <span className="noc-label">Requested at:</span> {formatShort(req.requested_at)}
                </li>
                <li>
                  <span className="noc-label">Resignation date:</span> {formatShort(req.resignation_date)}
                </li>
                <li className="noc-resignation-status-row">
                  <span className="noc-label">Resignation (reporting manager):</span>{" "}
                  {req.resignation_status ? (
                    <span
                      className={`status-pill status-${(req.resignation_status || "pending").toLowerCase()}`}
                    >
                      {req.resignation_status}
                    </span>
                  ) : (
                    "—"
                  )}
                </li>
              </ul>
              <p className="request-reason">
                <span className="noc-label">Reason:</span> {req.resignation_reason || "—"}
              </p>
            </div>
            {pending ? (
              <div className="noc-upload-row">
                <label className="noc-upload-label">
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                    disabled={uploadingId === req.id}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) handleUpload(req, f);
                    }}
                  />
                  <span className="btn-upload-noc">
                    {uploadingId === req.id ? "Uploading…" : "Choose file & upload"}
                  </span>
                </label>
              </div>
            ) : canDl ? (
              <div className="noc-uploaded-row">
                <button type="button" className="btn-link-download" onClick={() => handleDownload(req)}>
                  Download {req.filename || "NOC file"}
                </button>
              </div>
            ) : uploadedAwaitingApproval ? (
              <p className="noc-download-gated-hint" title="Reporting manager must approve the resignation first.">
                NOC on file — download after resignation is approved.
              </p>
            ) : null}
          </div>
        );
      })}
    </>
  );
};
