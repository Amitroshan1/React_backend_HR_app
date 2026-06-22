import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, FileText, X } from "lucide-react";
import { formatDateTime as formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import {
    defaultFinancialYear,
    financialYearOptions,
    mergeFinancialYears,
} from "../../utils/financialYear";
import "./TaxDeclaration.css";

async function parseApiResponse(res) {
    const text = await res.text();
    if (!text) return { ok: res.ok, data: {} };
    try {
        return { ok: res.ok, data: JSON.parse(text) };
    } catch {
        throw new Error(
            res.status === 404
                ? "Tax declaration API not found. Restart the backend server."
                : "Server returned an invalid response."
        );
    }
}

function authHeaders() {
    const token = localStorage.getItem("token");
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}

function formatAmount(val) {
    const n = Number(val);
    if (!Number.isFinite(n) || n === 0) return "—";
    return `₹${n.toLocaleString("en-IN")}`;
}

function statusBadgeClass(status) {
    const s = (status || "").toLowerCase();
    if (s === "approved") return "tax-decl-status tax-decl-status--approved";
    if (s === "rejected") return "tax-decl-status tax-decl-status--rejected";
    if (s === "submitted") return "tax-decl-status tax-decl-status--submitted";
    return "tax-decl-status tax-decl-status--draft";
}

function itemLabel(schema, sectionCode, itemCode) {
    const sec = (schema?.sections || []).find((s) => s.id === sectionCode);
    const item = (sec?.items || []).find((i) => i.code === itemCode);
    return item?.label || itemCode;
}

export function TaxDeclarationReview({ apiBase = "/api/accounts", onBack }) {
    const [financialYear, setFinancialYear] = useState(defaultFinancialYear);
    const [statusFilter, setStatusFilter] = useState("submitted");
    const [declarations, setDeclarations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedId, setSelectedId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [reviewComment, setReviewComment] = useState("");
    const [reviewing, setReviewing] = useState(false);
    const [success, setSuccess] = useState("");
    const [fyOptions, setFyOptions] = useState(() => financialYearOptions());

    const loadFinancialYears = useCallback(async () => {
        try {
            const res = await fetch(`${apiBase}/tax-declaration/financial-years`, {
                headers: authHeaders(),
            });
            const { ok, data } = await parseApiResponse(res);
            if (ok && data.success && Array.isArray(data.financial_years) && data.financial_years.length) {
                setFyOptions(data.financial_years);
            } else {
                setFyOptions(financialYearOptions());
            }
        } catch {
            setFyOptions(financialYearOptions());
        }
    }, [apiBase]);

    useEffect(() => {
        loadFinancialYears();
    }, [loadFinancialYears]);

    const loadList = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams({
                status: statusFilter,
                financial_year: financialYear,
            });
            const res = await fetch(`${apiBase}/tax-declarations?${params}`, {
                headers: authHeaders(),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Failed to load declarations");
            setDeclarations(data.declarations || []);
            const yearsFromRows = (data.declarations || [])
                .map((row) => row.financial_year)
                .filter(Boolean);
            if (yearsFromRows.length) {
                setFyOptions((prev) => mergeFinancialYears(prev, yearsFromRows));
            }
        } catch (err) {
            setError(err.message || "Unable to load tax declarations");
            setDeclarations([]);
        } finally {
            setLoading(false);
        }
    }, [apiBase, financialYear, statusFilter]);

    const loadDetail = useCallback(
        async (declId) => {
            setDetailLoading(true);
            setError("");
            try {
                const res = await fetch(`${apiBase}/tax-declarations/${declId}`, {
                    headers: authHeaders(),
                });
                const { ok, data } = await parseApiResponse(res);
                if (!ok || !data.success) throw new Error(data.message || "Failed to load declaration");
                setDetail(data);
                setReviewComment("");
            } catch (err) {
                setError(err.message || "Unable to load declaration detail");
                setDetail(null);
            } finally {
                setDetailLoading(false);
            }
        },
        [apiBase]
    );

    useEffect(() => {
        loadList();
    }, [loadList]);

    const openDetail = (declId) => {
        setSelectedId(declId);
        setSuccess("");
        loadDetail(declId);
    };

    const closeDetail = () => {
        setSelectedId(null);
        setDetail(null);
        setReviewComment("");
    };

    const handleReview = async (action) => {
        if (!selectedId) return;
        if (action === "reject" && !reviewComment.trim()) {
            setError("Please enter a reason for rejection.");
            return;
        }
        setReviewing(true);
        setError("");
        setSuccess("");
        try {
            const res = await fetch(`${apiBase}/tax-declarations/${selectedId}/review`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({
                    action,
                    comment: reviewComment.trim() || undefined,
                }),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Review failed");
            setSuccess(data.message || `Declaration ${action}d.`);
            await loadList();
            if (statusFilter === "submitted") {
                closeDetail();
            } else {
                await loadDetail(selectedId);
            }
        } catch (err) {
            setError(err.message || "Review failed");
        } finally {
            setReviewing(false);
        }
    };

    const decl = detail?.declaration;
    const schema = detail?.schema;
    const employee = detail?.employee;
    const canReview = decl?.status === "submitted";

    return (
        <div className="tax-decl-page tax-decl-review">
            {onBack && (
                <button type="button" className="tax-decl-back" onClick={onBack}>
                    <ArrowLeft size={18} aria-hidden />
                    Back to Dashboard
                </button>
            )}

            <div className="tax-decl-card">
                <div className="tax-decl-header">
                    <div className="tax-decl-header-icon">
                        <FileText size={22} aria-hidden />
                    </div>
                    <div>
                        <h1>Tax Declaration Review</h1>
                        <p>Review employee tax saving declarations for payroll / TDS</p>
                    </div>
                </div>

                <div className="tax-decl-review-filters">
                    <label className="tax-decl-field">
                        <span className="tax-decl-label">Financial Year</span>
                        <select
                            className="tax-decl-control"
                            value={financialYear}
                            onChange={(e) => setFinancialYear(e.target.value)}
                        >
                            {fyOptions.map((fy) => (
                                <option key={fy} value={fy}>{fy}</option>
                            ))}
                        </select>
                    </label>
                    <label className="tax-decl-field">
                        <span className="tax-decl-label">Status</span>
                        <select
                            className="tax-decl-control"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="submitted">Submitted (pending)</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                            <option value="draft">Draft</option>
                            <option value="all">All</option>
                        </select>
                    </label>
                </div>

                {error && <div className="tax-decl-alert tax-decl-alert--error" role="alert">{error}</div>}
                {success && <div className="tax-decl-alert tax-decl-alert--success" role="status">{success}</div>}

                {loading ? (
                    <p className="tax-decl-muted">Loading declarations…</p>
                ) : (
                    <div className="tax-decl-review-table-wrap">
                        <table className="tax-decl-review-table">
                            <thead>
                                <tr>
                                    <th>Employee</th>
                                    <th>Emp ID</th>
                                    <th>Department</th>
                                    <th>FY</th>
                                    <th>Regime</th>
                                    <th>Status</th>
                                    <th>Submitted</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {declarations.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="tax-decl-muted tax-decl-review-empty">
                                            No declarations found for the selected filters.
                                        </td>
                                    </tr>
                                )}
                                {declarations.map((row) => {
                                    const emp = row.employee || {};
                                    return (
                                        <tr key={row.id} className={selectedId === row.id ? "tax-decl-review-row--active" : ""}>
                                            <td data-label="Employee">{emp.employee_name || "—"}</td>
                                            <td data-label="Emp ID">{emp.employee_id || "—"}</td>
                                            <td data-label="Department">{emp.department || "—"}</td>
                                            <td data-label="FY">{row.financial_year}</td>
                                            <td data-label="Regime">{(row.tax_regime || "—").replace(/_/g, " ")}</td>
                                            <td data-label="Status">
                                                <span className={statusBadgeClass(row.status)}>{row.status}</span>
                                            </td>
                                            <td data-label="Submitted">
                                                {row.submitted_at
                                                    ? formatDateTimeDDMMYYYY(row.submitted_at)
                                                    : "—"}
                                            </td>
                                            <td data-label="">
                                                <button
                                                    type="button"
                                                    className="tax-decl-btn tax-decl-btn--secondary tax-decl-btn--sm"
                                                    onClick={() => openDetail(row.id)}
                                                >
                                                    {row.status === "submitted" ? "Review" : "View"}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {selectedId && (
                    <div className="tax-decl-review-detail">
                        <div className="tax-decl-review-detail-head">
                            <h2>Declaration detail</h2>
                            <button type="button" className="tax-decl-btn tax-decl-btn--link" onClick={closeDetail}>
                                Close
                            </button>
                        </div>

                        {detailLoading && <p className="tax-decl-muted">Loading detail…</p>}

                        {!detailLoading && decl && (
                            <>
                                <div className="tax-decl-info-grid">
                                    <div><span>Employee</span><strong>{employee?.employee_name || "—"}</strong></div>
                                    <div><span>Emp ID</span><strong>{employee?.employee_id || "—"}</strong></div>
                                    <div><span>PAN</span><strong>{employee?.pan || "—"}</strong></div>
                                    <div><span>Financial Year</span><strong>{decl.financial_year}</strong></div>
                                    <div><span>Tax Regime</span><strong>{(decl.tax_regime || "—").replace(/_/g, " ")}</strong></div>
                                    <div>
                                        <span>Status</span>
                                        <strong><span className={statusBadgeClass(decl.status)}>{decl.status}</span></strong>
                                    </div>
                                    <div><span>Place</span><strong>{decl.declaration_place || "—"}</strong></div>
                                    <div><span>80C (extra)</span><strong>{formatAmount(decl.section_80c_extra)}</strong></div>
                                    <div><span>80D</span><strong>{formatAmount(decl.section_80d)}</strong></div>
                                    <div><span>Rent (annual)</span><strong>{formatAmount(decl.rent_paid_annual)}</strong></div>
                                </div>

                                {decl.rejection_reason && (
                                    <div className="tax-decl-banner tax-decl-banner--warn">
                                        Rejection reason: {decl.rejection_reason}
                                    </div>
                                )}

                                {(decl.items || []).length > 0 && (
                                    <section className="tax-decl-section">
                                        <h3 className="tax-decl-section-title">Declared items</h3>
                                        <div className="tax-decl-review-table-wrap">
                                            <table className="tax-decl-review-table tax-decl-review-table--compact">
                                                <thead>
                                                    <tr>
                                                        <th>Section</th>
                                                        <th>Item</th>
                                                        <th>Amount / Value</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {(decl.items || []).map((it) => (
                                                        <tr key={it.id}>
                                                            <td>{it.section_code}</td>
                                                            <td>{itemLabel(schema, it.section_code, it.item_code)}</td>
                                                            <td>
                                                                {it.amount != null && it.amount !== ""
                                                                    ? formatAmount(it.amount)
                                                                    : it.text_value || "—"}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </section>
                                )}

                                {(decl.documents || []).length > 0 && (
                                    <section className="tax-decl-section">
                                        <h3 className="tax-decl-section-title">Documents</h3>
                                        <ul className="tax-decl-doc-list">
                                            {(decl.documents || []).map((doc) => (
                                                <li key={doc.id}>
                                                    <a href={doc.url} target="_blank" rel="noopener noreferrer">
                                                        {doc.original_name || doc.doc_type}
                                                    </a>
                                                    <span className="tax-decl-muted">
                                                        {doc.section_code && doc.item_code
                                                            ? `${itemLabel(schema, doc.section_code, doc.item_code)} (${doc.doc_type})`
                                                            : doc.doc_type}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </section>
                                )}

                                {canReview && (
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
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default TaxDeclarationReview;
