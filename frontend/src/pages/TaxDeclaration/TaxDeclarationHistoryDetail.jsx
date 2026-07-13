import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { TaxDeclarationDetailBody } from "./TaxDeclarationDetailBody";
import { notifyError } from "../../utils/notify";
import { authHeaders, parseApiResponse } from "./taxDeclarationReviewUtils";
import { LockSensitiveDataButton } from "../../components/security/SensitiveDataGate";
import "./TaxDeclaration.css";

const AUTH_API = "/api/auth";

export function TaxDeclarationHistoryDetail() {
    const navigate = useNavigate();
    const { declId } = useParams();
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);

    const loadDetail = useCallback(async () => {
        if (!declId) return;
        setLoading(true);
        try {
            const res = await fetch(`${AUTH_API}/tax-declaration/${declId}`, {
                headers: authHeaders(),
            });
            const { ok, data } = await parseApiResponse(res);
            if (!ok || !data.success) throw new Error(data.message || "Failed to load declaration");
            setDetail(data);
        } catch (err) {
            notifyError(err.message || "Unable to load declaration details");
            setDetail(null);
        } finally {
            setLoading(false);
        }
    }, [declId]);

    useEffect(() => {
        loadDetail();
    }, [loadDetail]);

    const decl = detail?.declaration;
    const schema = detail?.schema;
    const employee = detail?.employee;

    return (
        <div className="tax-decl-page tax-decl-history tax-decl-review-detail-page">
            <button
                type="button"
                className="tax-decl-back"
                onClick={() => navigate("/tax-declaration/history")}
            >
                <ArrowLeft size={18} aria-hidden />
                Back to History
            </button>

            <div className="sensitive-lock-row">
                <LockSensitiveDataButton />
            </div>

            <div className="tax-decl-card">
                <div className="tax-decl-header">
                    <div className="tax-decl-header-icon tax-decl-header-icon--history">
                        <FileText size={22} aria-hidden />
                    </div>
                    <div>
                        <h1>Declaration Details</h1>
                        <p>
                            FY {decl?.financial_year || "—"}
                            {decl?.status ? ` · ${decl.status}` : ""}
                            {employee?.employee_name ? ` · ${employee.employee_name}` : ""}
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
                    />
                )}

                {!loading && !decl && (
                    <p className="tax-decl-muted">Declaration not found.</p>
                )}
            </div>
        </div>
    );
}

export default TaxDeclarationHistoryDetail;
