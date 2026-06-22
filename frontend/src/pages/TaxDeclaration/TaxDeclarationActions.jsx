import { useNavigate } from "react-router-dom";
import { FileText, Receipt } from "lucide-react";

export function TaxDeclarationActions({ hasCtcData }) {
    const navigate = useNavigate();

    return (
        <div className="tax-decl-quick-actions">
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
