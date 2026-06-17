import { useNavigate } from "react-router-dom";
import { FileText, Receipt } from "lucide-react";
import "./PayslipCtcActions.css";

export const PayslipCtcActions = ({ hasCtcData }) => {
    const navigate = useNavigate();

    return (
        <div className="payslip-ctc-actions">
            <button
                type="button"
                className="payslip-ctc-action-btn payslip-ctc-action-btn--form16"
                onClick={() => navigate("/payslip/form16")}
            >
                <FileText size={16} aria-hidden />
                Form 16
            </button>
            <button
                type="button"
                className="payslip-ctc-action-btn payslip-ctc-action-btn--tds"
                onClick={() => navigate("/payslip/tax-projection")}
                disabled={!hasCtcData}
                title={hasCtcData ? "View tax projection" : "CTC breakup required for tax projection"}
            >
                <Receipt size={16} aria-hidden />
                Tax Projection
            </button>
        </div>
    );
};
