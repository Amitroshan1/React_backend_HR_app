import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, FileText } from "lucide-react";
import { formatDateTime as formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import { notifyError } from "../../utils/notify";
import {
    authHeaders,
    formatAmount,
    parseApiResponse,
    statusBadgeClass,
} from "./taxDeclarationReviewUtils";
import "./TaxDeclaration.css";

const AUTH_API = "/api/auth";

export function TaxDeclarationHistory() {
    const navigate = useNavigate();
    const [declarations, setDeclarations] = useState([]);
    const [loading, setLoading] = useState(true);

    const loadHistory = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${AUTH_API}/tax-declaration/self/history`, {
                headers: authHeaders(),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Failed to load history");
            setDeclarations(data.declarations || []);
        } catch (err) {
            notifyError(err.message || "Unable to load declaration history");
            setDeclarations([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const hasDeclarations = declarations.length > 0;

    return (
        <div className="tax-decl-page tax-decl-history">
            <button
                type="button"
                className="tax-decl-back"
                onClick={() => navigate("/tax-declaration")}
            >
                <ArrowLeft size={18} aria-hidden />
                Back to Tax Declaration
            </button>

            <div className="tax-decl-card">
                <div className="tax-decl-header">
                    <div className="tax-decl-header-icon tax-decl-header-icon--history">
                        <Clock size={22} aria-hidden />
                    </div>
                    <div>
                        <h1>Declaration History</h1>
                        <p>View all your tax saving declarations across financial years</p>
                    </div>
                </div>

                {loading && <p className="tax-decl-muted">Loading your declarations…</p>}

                {!loading && !hasDeclarations && (
                    <div className="tax-decl-history-empty">
                        <FileText size={40} aria-hidden className="tax-decl-history-empty-icon" />
                        <p>No declarations found yet.</p>
                        <p className="tax-decl-muted">
                            Once you save or submit a tax declaration, it will appear here.
                        </p>
                        <button
                            type="button"
                            className="tax-decl-btn tax-decl-btn--primary"
                            onClick={() => navigate("/tax-declaration")}
                        >
                            Go to Tax Declaration
                        </button>
                    </div>
                )}

                {!loading && hasDeclarations && (
                    <div className="tax-decl-review-table-wrap">
                        <table className="tax-decl-review-table tax-decl-history-table">
                            <thead>
                                <tr>
                                    <th>Financial Year</th>
                                    <th>Tax Regime</th>
                                    <th>Status</th>
                                    <th>Total Declared</th>
                                    <th>Items</th>
                                    <th>Documents</th>
                                    <th>Submitted</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {declarations.map((row) => (
                                    <tr key={row.id}>
                                        <td data-label="Financial Year">
                                            <strong>{row.financial_year}</strong>
                                        </td>
                                        <td data-label="Tax Regime">
                                            {(row.tax_regime || "—").replace(/_/g, " ")}
                                        </td>
                                        <td data-label="Status">
                                            <span className={statusBadgeClass(row.status)}>
                                                {row.status}
                                            </span>
                                        </td>
                                        <td data-label="Total Declared">
                                            {formatAmount(row.total_declared_amount)}
                                        </td>
                                        <td data-label="Items">{row.item_count ?? 0}</td>
                                        <td data-label="Documents">{row.document_count ?? 0}</td>
                                        <td data-label="Submitted">
                                            {row.submitted_at
                                                ? formatDateTimeDDMMYYYY(row.submitted_at)
                                                : "—"}
                                        </td>
                                        <td data-label="">
                                            <button
                                                type="button"
                                                className="tax-decl-btn tax-decl-btn--secondary tax-decl-btn--sm"
                                                onClick={() => navigate(`/tax-declaration/history/${row.id}`)}
                                            >
                                                View details
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

export default TaxDeclarationHistory;
