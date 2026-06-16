import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  actOnManagerRequest,
  fetchManagerClaimById,
  fetchManagerClaimFileBlob,
} from "./api";
import { formatDate } from "../../utils/dateFormat";
import "./ManagerClaimDetails.css";

function isImageFile(name) {
  if (!name) return false;
  return /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(name);
}

function isPdfFile(name) {
  if (!name) return false;
  return /\.pdf$/i.test(name);
}

export const ManagerClaimDetails = () => {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [claim, setClaim] = useState(location.state?.claim || null);
  const [loading, setLoading] = useState(!location.state?.claim);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [acting, setActing] = useState(false);
  const [activeLineId, setActiveLineId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewName, setPreviewName] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const load = useCallback(async () => {
    if (!claimId) return;
    setError("");
    try {
      const data = await fetchManagerClaimById(claimId);
      setClaim(data);
    } catch (err) {
      setError(err.message || "Failed to load claim");
      setClaim(null);
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!claim?.line_items?.length || activeLineId) return;
    const firstWithFile = claim.line_items.find((li) => li.has_file);
    if (firstWithFile) setActiveLineId(firstWithFile.id);
  }, [claim, activeLineId]);

  const lineItems = claim?.line_items || [];
  const activeLine = useMemo(
    () => lineItems.find((li) => li.id === activeLineId) || null,
    [lineItems, activeLineId]
  );

  const isPending = (claim?.status || "").toLowerCase() === "pending";

  useEffect(() => {
    let revokeUrl = null;
    const loadPreview = async () => {
      if (!claim?.id || !activeLine?.has_file) {
        setPreviewUrl("");
        setPreviewName("");
        setPreviewError("");
        return;
      }
      setPreviewLoading(true);
      setPreviewError("");
      try {
        const blob = await fetchManagerClaimFileBlob(claim.id, activeLine.id);
        const url = window.URL.createObjectURL(blob);
        revokeUrl = url;
        setPreviewUrl(url);
        setPreviewName(activeLine.file_path?.split("/").pop() || activeLine.file || "Receipt");
      } catch (err) {
        setPreviewUrl("");
        setPreviewName("");
        setPreviewError(err.message || "Unable to load file");
      } finally {
        setPreviewLoading(false);
      }
    };
    loadPreview();
    return () => {
      if (revokeUrl) window.URL.revokeObjectURL(revokeUrl);
    };
  }, [claim?.id, activeLine?.id, activeLine?.has_file, activeLine?.file, activeLine?.file_path]);

  const handleAction = async (action) => {
    if (!claim?.id) return;
    const label = action === "approve" ? "approve" : "reject";
    if (!window.confirm(`Are you sure you want to ${label} this claim?`)) return;
    setActing(true);
    setError("");
    setSuccess("");
    try {
      await actOnManagerRequest("claim", claim.id, action);
      setSuccess(`Claim ${action === "approve" ? "approved" : "rejected"} successfully.`);
      await load();
    } catch (err) {
      setError(err.message || "Failed to update claim");
    } finally {
      setActing(false);
    }
  };

  const openFileInNewTab = async (lineItem) => {
    if (!claim?.id || !lineItem?.has_file) return;
    try {
      const blob = await fetchManagerClaimFileBlob(claim.id, lineItem.id);
      const url = window.URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err.message || "Unable to open file");
    }
  };

  if (loading) {
    return (
      <div className="mcd-page">
        <p className="mcd-muted">Loading claim details…</p>
      </div>
    );
  }

  if (!claim) {
    return (
      <div className="mcd-page">
        <p className="mcd-error">{error || "Claim not found."}</p>
        <button type="button" className="mcd-back-btn" onClick={() => navigate("/manager")}>
          Back to Manager
        </button>
      </div>
    );
  }

  return (
    <div className="mcd-page">
      <header className="mcd-header">
        <button type="button" className="mcd-back-btn" onClick={() => navigate("/manager")}>
          ← Back
        </button>
        <div>
          <h1>{claim.employee_name}</h1>
          <p className="mcd-subtitle">
            Expense claim · <span className={`mcd-status mcd-status-${(claim.status || "").toLowerCase().replace(/\s+/g, "-")}`}>{claim.status}</span>
          </p>
        </div>
      </header>

      {error && <p className="mcd-error">{error}</p>}
      {success && <p className="mcd-success">{success}</p>}

      <div className="mcd-grid">
        <section className="mcd-card">
          <h2>Claim information</h2>
          <div className="mcd-meta-grid">
            <div><label>Employee ID</label><p>{claim.emp_id || "—"}</p></div>
            <div><label>Email</label><p>{claim.employee_email || "—"}</p></div>
            <div><label>Designation</label><p>{claim.designation || "—"}</p></div>
            <div><label>Circle</label><p>{claim.circle || "—"}</p></div>
            <div><label>Project</label><p>{claim.project_name || "—"}</p></div>
            <div><label>Location</label><p>{claim.country_state || "—"}</p></div>
            <div><label>Travel from</label><p>{formatDate(claim.travel_from_date)}</p></div>
            <div><label>Travel to</label><p>{formatDate(claim.travel_to_date)}</p></div>
            <div><label>Total amount</label><p className="mcd-total">{claim.currency || "INR"} {Number(claim.total_amount || 0).toLocaleString()}</p></div>
          </div>

          <h3>Expense line items</h3>
          <div className="mcd-table-wrap">
            <table className="mcd-table">
              <thead>
                <tr>
                  <th>Sr</th>
                  <th>Date</th>
                  <th>Purpose</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li) => (
                  <tr
                    key={li.id}
                    className={activeLineId === li.id ? "mcd-row-active" : ""}
                    onClick={() => li.has_file && setActiveLineId(li.id)}
                  >
                    <td>{li.sr_no}</td>
                    <td>{formatDate(li.date)}</td>
                    <td>{li.purpose}</td>
                    <td>{li.currency || claim.currency} {Number(li.amount || 0).toLocaleString()}</td>
                    <td>
                      <span className={`mcd-line-status mcd-line-status-${(li.status || "").toLowerCase()}`}>
                        {li.status || "—"}
                      </span>
                    </td>
                    <td>
                      {li.has_file ? (
                        <button
                          type="button"
                          className="mcd-link-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveLineId(li.id);
                            openFileInNewTab(li);
                          }}
                        >
                          View
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mcd-card mcd-preview-card">
          <h2>Receipt preview</h2>
          {!activeLine?.has_file ? (
            <p className="mcd-muted">No receipt attached for the selected line item.</p>
          ) : previewLoading ? (
            <p className="mcd-muted">Loading file…</p>
          ) : previewError ? (
            <p className="mcd-error">{previewError}</p>
          ) : previewUrl ? (
            <div className="mcd-preview-body">
              <p className="mcd-preview-name">{previewName}</p>
              {isImageFile(previewName) ? (
                <img src={previewUrl} alt={previewName} className="mcd-preview-image" />
              ) : isPdfFile(previewName) ? (
                <iframe src={previewUrl} title={previewName} className="mcd-preview-iframe" />
              ) : (
                <div className="mcd-preview-fallback">
                  <p>Preview not available for this file type.</p>
                  <button type="button" className="mcd-link-btn" onClick={() => openFileInNewTab(activeLine)}>
                    Open file
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {isPending && (
        <footer className="mcd-footer">
          <button type="button" className="mcd-btn-reject" onClick={() => handleAction("reject")} disabled={acting}>
            {acting ? "Updating…" : "Reject claim"}
          </button>
          <button type="button" className="mcd-btn-approve" onClick={() => handleAction("approve")} disabled={acting}>
            {acting ? "Updating…" : "Approve claim"}
          </button>
        </footer>
      )}
    </div>
  );
};
