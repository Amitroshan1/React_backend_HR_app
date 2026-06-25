import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, FileText, Unlock, X } from "lucide-react";
import { TaxDeclarationDetailBody } from "./TaxDeclarationDetailBody";
import {
    authHeaders,
    parseApiResponse,
} from "./taxDeclarationReviewUtils";
import { notifyError, notifySuccess, notifyWarning } from "../../utils/notify";
import "./TaxDeclaration.css";

export function TaxDeclarationReviewDetail({ apiBase = "/api/accounts", declId, onBack }) {
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [reviewComment, setReviewComment] = useState("");
    const [reviewing, setReviewing] = useState(false);

    const loadDetail = useCallback(async () => {
        if (!declId) return;
        setLoading(true);
        try {
            const res = await fetch(`${apiBase}/tax-declarations/${declId}`, {
                headers: authHeaders(),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Failed to load declaration");
            setDetail(data);
            setReviewComment("");
        } catch (err) {
            notifyError(err.message || "Unable to load declaration detail");
            setDetail(null);
        } finally {
            setLoading(false);
        }
    }, [apiBase, declId]);

    useEffect(() => {
        loadDetail();
    }, [loadDetail]);

    const handleReview = async (action) => {
        if (!declId) return;
        if (action === "reject" && !reviewComment.trim()) {
            notifyWarning("Please enter a reason for rejection.");
            return;
        }
        setReviewing(true);
        try {
            const res = await fetch(`${apiBase}/tax-declarations/${declId}/review`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({
                    action,
                    comment: reviewComment.trim() || undefined,
                }),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Review failed");
            notifySuccess(data.message || `Declaration ${action}d.`);
            if (action === "approve" || action === "reject") {
                setTimeout(() => onBack?.(), 800);
            } else {
                await loadDetail();
            }
        } catch (err) {
            notifyError(err.message || "Review failed");
        } finally {
            setReviewing(false);
        }
    };

    const handleFinalProofReview = async (action) => {
        if (!declId) return;
        if (action === "reject" && !reviewComment.trim()) {
            notifyWarning("Please enter a reason for rejection.");
            return;
        }
        setReviewing(true);
        try {
            const res = await fetch(`${apiBase}/tax-declarations/${declId}/final-proof-review`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({
                    action,
                    comment: reviewComment.trim() || undefined,
                }),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Final proof review failed");
            notifySuccess(data.message || `Final proof ${action}d.`);
            if (action === "approve" || action === "reject") {
                setTimeout(() => onBack?.(), 800);
            } else {
                await loadDetail();
            }
        } catch (err) {
            notifyError(err.message || "Final proof review failed");
        } finally {
            setReviewing(false);
        }
    };

    const handleAmendUnlock = async () => {
        if (!declId) return;
        if (!reviewComment.trim()) {
            notifyWarning("Please enter a reason for unlocking this declaration.");
            return;
        }
        setReviewing(true);
        try {
            const res = await fetch(`${apiBase}/tax-declarations/${declId}/amend`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({ comment: reviewComment.trim() }),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Amendment unlock failed");
            notifySuccess(data.message || "Declaration unlocked for amendment.");
            setTimeout(() => onBack?.(), 800);
        } catch (err) {
            notifyError(err.message || "Amendment unlock failed");
        } finally {
            setReviewing(false);
        }
    };

    const decl = detail?.declaration;
    const schema = detail?.schema;
    const employee = detail?.employee;
    const canReview = decl?.status === "submitted";
    const canReviewFinalProof =
        decl?.status === "approved" && (decl?.final_proof_status || "").toLowerCase() === "submitted";
    const canAmendUnlock =
        decl?.status === "approved" &&
        (decl?.final_proof_status || "").toLowerCase() !== "submitted";
    const amendPolicy = detail?.amendment_policy;
    const amendRemaining = amendPolicy?.remaining;
    const amendLimitReached =
        amendPolicy?.limit > 0 && amendRemaining != null && amendRemaining <= 0;

    const reviewFooter = canReview ? (
        <div className="tax-decl-review-actions">
            <label className="tax-decl-field tax-decl-field--full">
                <span className="tax-decl-label">Comment (required for rejection)</span>
                <textarea
                    className="tax-decl-control tax-decl-control--textarea"
                    rows={3}
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="Optional for approval; required if rejecting"
                />
            </label>
            <div className="tax-decl-actions">
                <button
                    type="button"
                    className="tax-decl-btn tax-decl-btn--primary"
                    disabled={reviewing}
                    onClick={() => handleReview("approve")}
                >
                    <Check size={16} aria-hidden />
                    {reviewing ? "Processing…" : "Approve"}
                </button>
                <button
                    type="button"
                    className="tax-decl-btn tax-decl-btn--secondary"
                    disabled={reviewing}
                    onClick={() => handleReview("reject")}
                >
                    <X size={16} aria-hidden />
                    Reject
                </button>
            </div>
        </div>
    ) : null;

    const finalProofFooter = canReviewFinalProof ? (
        <div className="tax-decl-review-actions">
            <h3 className="tax-decl-section-title">Year-end final proof review</h3>
            <p className="tax-decl-muted">
                Compare declared vs actual amounts below. Approving switches payroll TDS to final figures.
            </p>
            <label className="tax-decl-field tax-decl-field--full">
                <span className="tax-decl-label">Comment (required for rejection)</span>
                <textarea
                    className="tax-decl-control tax-decl-control--textarea"
                    rows={3}
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                />
            </label>
            <div className="tax-decl-actions">
                <button
                    type="button"
                    className="tax-decl-btn tax-decl-btn--primary"
                    disabled={reviewing}
                    onClick={() => handleFinalProofReview("approve")}
                >
                    <Check size={16} aria-hidden />
                    {reviewing ? "Processing…" : "Approve final proof"}
                </button>
                <button
                    type="button"
                    className="tax-decl-btn tax-decl-btn--secondary"
                    disabled={reviewing}
                    onClick={() => handleFinalProofReview("reject")}
                >
                    <X size={16} aria-hidden />
                    Reject final proof
                </button>
            </div>
        </div>
    ) : null;

    const amendFooter = canAmendUnlock ? (
        <div className="tax-decl-review-actions">
            <h3 className="tax-decl-section-title">Unlock for amendment</h3>
            <p className="tax-decl-muted">
                Return this approved declaration to draft so the employee can edit and resubmit.
                Payroll TDS will recalculate without declaration until re-approved.
            </p>
            {amendPolicy?.limit > 0 && (
                <p className="tax-decl-muted">
                    Amendments used this FY: <strong>{amendPolicy.used ?? 0}</strong> /{" "}
                    <strong>{amendPolicy.limit}</strong>
                    {amendLimitReached && " — limit reached."}
                </p>
            )}
            <label className="tax-decl-field tax-decl-field--full">
                <span className="tax-decl-label">Reason (required)</span>
                <textarea
                    className="tax-decl-control tax-decl-control--textarea"
                    rows={3}
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    placeholder="e.g. Incorrect 80C amount — employee to resubmit with proofs"
                    disabled={amendLimitReached}
                />
            </label>
            <div className="tax-decl-actions">
                <button
                    type="button"
                    className="tax-decl-btn tax-decl-btn--secondary"
                    disabled={reviewing || amendLimitReached}
                    onClick={handleAmendUnlock}
                >
                    <Unlock size={16} aria-hidden />
                    {reviewing ? "Processing…" : amendLimitReached ? "Amendment limit reached" : "Unlock for amendment"}
                </button>
            </div>
        </div>
    ) : null;

    const combinedFooter = (
        <>
            {reviewFooter}
            {finalProofFooter}
            {amendFooter}
        </>
    );

    return (
        <div className="tax-decl-page tax-decl-review tax-decl-review-detail-page">
            {onBack && (
                <button type="button" className="tax-decl-back" onClick={onBack}>
                    <ArrowLeft size={18} aria-hidden />
                    Back to declarations
                </button>
            )}

            <div className="tax-decl-card">
                <div className="tax-decl-header">
                    <div className="tax-decl-header-icon">
                        <FileText size={22} aria-hidden />
                    </div>
                    <div>
                        <h1>Tax Declaration Detail</h1>
                        <p>
                            {employee?.employee_name || "Employee"}
                            {employee?.employee_id ? ` (${employee.employee_id})` : ""}
                            {decl?.financial_year ? ` — FY ${decl.financial_year}` : ""}
                        </p>
                    </div>
                </div>

                {loading && <p className="tax-decl-muted">Loading declaration…</p>}

                {!loading && decl && (
                    <TaxDeclarationDetailBody
                        decl={decl}
                        schema={schema}
                        employee={employee}
                        history={detail?.history}
                        footer={combinedFooter}
                    />
                )}

                {!loading && !decl && (
                    <p className="tax-decl-muted">Declaration not found.</p>
                )}
            </div>
        </div>
    );
}

export default TaxDeclarationReviewDetail;
