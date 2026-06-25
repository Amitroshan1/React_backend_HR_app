import { useNavigate } from "react-router-dom";
import { Clock, FileCheck, FileText, Receipt } from "lucide-react";

export function TaxDeclarationActions({
    hasCtcData,
    declarationApproved = false,
    finalProofEditable = false,
    finalProofNeedsAction = false,
}) {
    const navigate = useNavigate();

    return (
        <div className="tax-decl-quick-actions">
            <button
                type="button"
                className="tax-decl-quick-btn tax-decl-quick-btn--history"
                onClick={() => navigate("/tax-declaration/history")}
            >
                <Clock size={16} aria-hidden />
                History
            </button>
            {declarationApproved && (
                <button
                    type="button"
                    className={`tax-decl-quick-btn tax-decl-quick-btn--final-proof${
                        finalProofNeedsAction ? " tax-decl-quick-btn--attention" : ""
                    }`}
                    onClick={() => navigate("/tax-declaration/final-proof")}
                    title={
                        finalProofEditable
                            ? "Enter year-end actual amounts and upload proof"
                            : "View year-end final proof"
                    }
                >
                    <FileCheck size={16} aria-hidden />
                    Final proof
                    {finalProofNeedsAction && (
                        <span className="tax-decl-quick-btn-badge">Action needed</span>
                    )}
                </button>
            )}
            <button
                type="button"
                className="tax-decl-quick-btn tax-decl-quick-btn--form16"
                onClick={() => navigate("/tax-declaration/form16")}
            >
                <FileText size={16} aria-hidden />
                Form 16
            </button>
            <button
                type="button"
                className="tax-decl-quick-btn tax-decl-quick-btn--projection"
                onClick={() => navigate("/tax-declaration/tax-projection")}
                disabled={!hasCtcData}
                title={hasCtcData ? "View tax projection" : "CTC breakup required for tax projection"}
            >
                <Receipt size={16} aria-hidden />
                Tax Projection
            </button>
        </div>
    );
}
