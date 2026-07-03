import { useCallback, useState } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { formatDateTime as formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import {
    defaultFinancialYear,
    financialYearOptions,
    mergeFinancialYears,
} from "../../utils/financialYear";
import {
    authHeaders,
    parseApiResponse,
    statusBadgeClass,
} from "./taxDeclarationReviewUtils";
import { notifyError, notifySuccess } from "../../utils/notify";
import "./TaxDeclaration.css";

export function TaxDeclarationReview({ apiBase = "/api/accounts", onBack, onOpenDetail }) {
    const [financialYear, setFinancialYear] = useState(defaultFinancialYear);
    const [statusFilter, setStatusFilter] = useState("all");
    const [declarations, setDeclarations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [fyOptions, setFyOptions] = useState(() => financialYearOptions());
    const [backfillLoading, setBackfillLoading] = useState(false);
    const [submissionDeadline, setSubmissionDeadline] = useState(null);
    const [deadlineDate, setDeadlineDate] = useState("");
    const [deadlineLoading, setDeadlineLoading] = useState(false);
    const [deadlineSaving, setDeadlineSaving] = useState(false);

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

    useRefreshOnNavigate(loadFinancialYears);

    const loadList = useCallback(async () => {
        setLoading(true);
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
            notifyError(err.message || "Unable to load tax declarations");
            setDeclarations([]);
        } finally {
            setLoading(false);
        }
    }, [apiBase, financialYear, statusFilter]);

    useRefreshOnNavigate(loadList, [financialYear, statusFilter]);

    const loadDeadline = useCallback(async () => {
        setDeadlineLoading(true);
        try {
            const params = new URLSearchParams({ financial_year: financialYear });
            const res = await fetch(`${apiBase}/tax-declaration/deadline?${params}`, {
                headers: authHeaders(),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) {
                throw new Error(data.message || "Failed to load submission deadline");
            }
            const info = data.submission_deadline || null;
            setSubmissionDeadline(info);
            setDeadlineDate(info?.deadline || "");
        } catch (err) {
            notifyError(err.message || "Unable to load submission deadline");
            setSubmissionDeadline(null);
        } finally {
            setDeadlineLoading(false);
        }
    }, [apiBase, financialYear]);

    useRefreshOnNavigate(loadDeadline, [financialYear]);

    const saveDeadline = async () => {
        if (!deadlineDate) {
            notifyError("Choose a submission deadline date.");
            return;
        }
        setDeadlineSaving(true);
        try {
            const res = await fetch(`${apiBase}/tax-declaration/deadline`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                    financial_year: financialYear,
                    deadline_date: deadlineDate,
                }),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) {
                throw new Error(data.message || "Failed to update deadline");
            }
            setSubmissionDeadline(data.submission_deadline || null);
            if (data.submission_deadline?.deadline) {
                setDeadlineDate(data.submission_deadline.deadline);
            }
            notifySuccess(data.message || "Deadline updated.");
        } catch (err) {
            notifyError(err.message || "Unable to update deadline");
        } finally {
            setDeadlineSaving(false);
        }
    };

    const resetDeadline = async () => {
        setDeadlineSaving(true);
        try {
            const res = await fetch(`${apiBase}/tax-declaration/deadline`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                    financial_year: financialYear,
                    clear: true,
                }),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) {
                throw new Error(data.message || "Failed to reset deadline");
            }
            setSubmissionDeadline(data.submission_deadline || null);
            setDeadlineDate(data.submission_deadline?.deadline || "");
            notifySuccess(data.message || "Deadline reset to default.");
        } catch (err) {
            notifyError(err.message || "Unable to reset deadline");
        } finally {
            setDeadlineSaving(false);
        }
    };

    const handleOpenDetail = (declId) => {
        if (onOpenDetail) {
            onOpenDetail(declId);
        }
    };

    const handleBackfillRegime = async () => {
        setBackfillLoading(true);
        try {
            const res = await fetch(`${apiBase}/tax-declaration/backfill-regime`, {
                method: "POST",
                headers: authHeaders(),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) {
                throw new Error(data.message || "Backfill failed");
            }
            alert(
                `Tax regime backfill complete.\nProfiles updated: ${data.profiles_updated || 0}\nEmployees considered: ${data.employees_considered || 0}`
            );
        } catch (err) {
            notifyError(err.message || "Unable to backfill tax regime");
        } finally {
            setBackfillLoading(false);
        }
    };

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
                            <option value="all">All</option>
                            <option value="submitted">Submitted (pending)</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                            <option value="draft">Draft</option>
                        </select>
                    </label>
                    <button
                        type="button"
                        className="tax-decl-btn tax-decl-btn--secondary"
                        onClick={handleBackfillRegime}
                        disabled={backfillLoading}
                        title="Sync Employee Accounts tax regime from approved declarations"
                    >
                        {backfillLoading ? "Syncing…" : "Sync regime from approved"}
                    </button>
                </div>

                <section className="tax-decl-review-deadline">
                    <h3>Declaration submission deadline</h3>
                    <p>
                        Default is 25 February (FY end year). Employees see a scrolling notice on the
                        tax declaration page. Extend the date below to allow submissions later.
                    </p>
                    {deadlineLoading && <p className="tax-decl-muted">Loading deadline…</p>}
                    {!deadlineLoading && submissionDeadline && (
                        <p className="tax-decl-muted">
                            Current: <strong>{submissionDeadline.deadline_display}</strong>
                            {submissionDeadline.is_extended ? " (extended)" : " (default)"}
                            {" · "}
                            {submissionDeadline.is_open ? "Submissions open" : "Submissions closed"}
                        </p>
                    )}
                    <div className="tax-decl-review-deadline-row">
                        <label className="tax-decl-field">
                            <span className="tax-decl-label">Allow submissions until</span>
                            <input
                                type="date"
                                className="tax-decl-control"
                                value={deadlineDate}
                                onChange={(e) => setDeadlineDate(e.target.value)}
                                disabled={deadlineSaving}
                            />
                        </label>
                        <div className="tax-decl-review-deadline-actions">
                            <button
                                type="button"
                                className="tax-decl-btn tax-decl-btn--primary"
                                onClick={saveDeadline}
                                disabled={deadlineSaving || deadlineLoading}
                            >
                                {deadlineSaving ? "Saving…" : "Save deadline"}
                            </button>
                            <button
                                type="button"
                                className="tax-decl-btn tax-decl-btn--secondary"
                                onClick={resetDeadline}
                                disabled={deadlineSaving || deadlineLoading}
                            >
                                Reset to 25 Feb
                            </button>
                        </div>
                    </div>
                </section>

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
                                    <th>Final proof</th>
                                    <th>Submitted</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {declarations.length === 0 && (
                                    <tr>
                                        <td colSpan={9} className="tax-decl-muted tax-decl-review-empty">
                                            No declarations found for the selected filters.
                                        </td>
                                    </tr>
                                )}
                                {declarations.map((row) => {
                                    const emp = row.employee || {};
                                    return (
                                        <tr key={row.id}>
                                            <td data-label="Employee">{emp.employee_name || "—"}</td>
                                            <td data-label="Emp ID">{emp.employee_id || "—"}</td>
                                            <td data-label="Department">{emp.department || "—"}</td>
                                            <td data-label="FY">{row.financial_year}</td>
                                            <td data-label="Regime">{(row.tax_regime || "—").replace(/_/g, " ")}</td>
                                            <td data-label="Status">
                                                <span className={statusBadgeClass(row.status)}>{row.status}</span>
                                            </td>
                                            <td data-label="Final proof">
                                                {row.final_proof_status || "—"}
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
                                                    onClick={() => handleOpenDetail(row.id)}
                                                >
                                                    {row.status === "submitted"
                                                        ? "Review"
                                                        : row.final_proof_status === "submitted"
                                                          ? "Review final"
                                                          : row.status === "approved"
                                                            ? "Amend"
                                                            : "View"}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

export default TaxDeclarationReview;
