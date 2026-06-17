import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Receipt } from "lucide-react";
import { useUser } from "../../components/layout/UserContext";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import "./EmployeeTaxProjection.css";

const API_BASE_URL = "/api/accounts";

const formatFinancialYearInput = (value) => {
    const digits = String(value ?? "").replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 4) return digits;
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
};

const defaultFinancialYear = () => {
    const y = new Date().getFullYear();
    const m = new Date().getMonth() + 1;
    const start = m >= 4 ? y : y - 1;
    return formatFinancialYearInput(`${start}${start + 1}`);
};

const formatINRCurrency = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return "0.00";
    return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatCurrency = (value) => `Rs. ${formatINRCurrency(value)}`;

export const EmployeeTaxProjection = () => {
    const navigate = useNavigate();
    const { userData } = useUser();
    const userId = userData?.user?.id;
    const displayName =
        userData?.user?.name
        || userData?.user?.first_name
        || userData?.user?.user_name
        || (userData?.user?.email ? userData.user.email.split("@")[0] : null)
        || "User";

    const [hasCtcData, setHasCtcData] = useState(false);
    const [ctcLoading, setCtcLoading] = useState(true);
    const [tdsProjection, setTdsProjection] = useState(null);
    const [tdsLoading, setTdsLoading] = useState(false);
    const [tdsError, setTdsError] = useState("");
    const [tdsForm, setTdsForm] = useState({
        financial_year: defaultFinancialYear(),
        rent_paid_annual: "",
        is_metro: false,
        section_80c_extra: "",
        section_80d: "",
        previous_employer_tds: "",
    });

    const authHeaders = () => {
        const token = localStorage.getItem("token");
        return token ? { Authorization: `Bearer ${token}` } : {};
    };

    const fetchTdsProjection = useCallback(
        async (formOverrides = {}) => {
            if (!userId) return;
            const form = { ...tdsForm, ...formOverrides };
            setTdsLoading(true);
            setTdsError("");
            try {
                const res = await fetch(`${API_BASE_URL}/tds/projection`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...authHeaders() },
                    body: JSON.stringify({
                        admin_id: userId,
                        financial_year: form.financial_year || defaultFinancialYear(),
                        rent_paid_annual: form.rent_paid_annual || 0,
                        is_metro: form.is_metro,
                        section_80c_extra: form.section_80c_extra || 0,
                        section_80d: form.section_80d || 0,
                        previous_employer_tds: form.previous_employer_tds || 0,
                        use_ytd_gross: true,
                    }),
                });
                const result = await res.json();
                if (!res.ok || !result.success) {
                    throw new Error(result.message || "Failed to load TDS projection");
                }
                setTdsProjection(result.projection || null);
            } catch (err) {
                setTdsError(err.message || "Unable to calculate TDS projection");
                setTdsProjection(null);
            } finally {
                setTdsLoading(false);
            }
        },
        [userId, tdsForm]
    );

    const loadInitial = useCallback(async () => {
        if (!userId) {
            setCtcLoading(false);
            setTdsError("User not loaded.");
            return;
        }
        const token = localStorage.getItem("token");
        if (!token) {
            setCtcLoading(false);
            setTdsError("Please log in.");
            return;
        }

        const fy = defaultFinancialYear();
        setTdsForm((prev) => ({ ...prev, financial_year: fy }));
        setCtcLoading(true);
        setTdsError("");
        setTdsProjection(null);

        try {
            const ctcRes = await fetch(`${API_BASE_URL}/ctc-breakup/${userId}`, {
                headers: authHeaders(),
            });
            const ctcResult = await ctcRes.json();
            const ctc = ctcResult?.ctc_breakup;
            const annual = Number(ctc?.annual_ctc_computed ?? ctc?.annual_ctc ?? 0);
            const hasCtc = ctcResult?.success && (annual > 0 || Number(ctc?.basic_salary || 0) > 0);
            setHasCtcData(hasCtc);
            if (!hasCtc) {
                setTdsError("CTC breakup is not available. Contact Accounts if this looks wrong.");
                return;
            }

            setTdsLoading(true);
            const projRes = await fetch(`${API_BASE_URL}/tds/projection`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                    admin_id: userId,
                    financial_year: fy,
                    use_ytd_gross: true,
                }),
            });
            const projResult = await projRes.json();
            if (!projRes.ok || !projResult.success) {
                throw new Error(projResult.message || "Failed to load TDS projection");
            }
            setTdsProjection(projResult.projection || null);
        } catch (err) {
            setTdsError(err.message || "Unable to load tax projection");
            setHasCtcData(false);
        } finally {
            setCtcLoading(false);
            setTdsLoading(false);
        }
    }, [userId]);

    useRefreshOnNavigate(() => {
        loadInitial();
    }, [userId, loadInitial]);

    const p = tdsProjection;
    const isOldRegime = p?.regime === "old";

    return (
        <div className="employee-tax-page">
            <button type="button" className="employee-tax-back" onClick={() => navigate("/payslip")}>
                <ArrowLeft size={18} aria-hidden />
                Back to Payslip
            </button>

            <div className="employee-tax-card">
                <div className="employee-tax-header">
                    <div className="employee-tax-header-icon">
                        <Receipt size={22} aria-hidden />
                    </div>
                    <div>
                        <h1>Tax Projection</h1>
                        <p>
                            Estimated TDS for {displayName}
                            {p?.financial_year || tdsForm.financial_year
                                ? ` · FY ${p?.financial_year || tdsForm.financial_year}`
                                : ""}
                            {p?.regime_label ? ` · ${p.regime_label}` : ""}
                        </p>
                    </div>
                </div>

                {ctcLoading && <p className="employee-tax-muted">Loading tax projection…</p>}

                {!ctcLoading && hasCtcData && (
                    <>
                        <div className="employee-tax-adjust">
                            <label>
                                Financial Year
                                <input
                                    value={tdsForm.financial_year}
                                    onChange={(e) =>
                                        setTdsForm((prev) => ({
                                            ...prev,
                                            financial_year: formatFinancialYearInput(e.target.value),
                                        }))
                                    }
                                    placeholder="2025-2026"
                                />
                            </label>
                            {isOldRegime && (
                                <>
                                    <label>
                                        Annual Rent (HRA)
                                        <input
                                            type="number"
                                            min="0"
                                            value={tdsForm.rent_paid_annual}
                                            onChange={(e) =>
                                                setTdsForm((prev) => ({ ...prev, rent_paid_annual: e.target.value }))
                                            }
                                        />
                                    </label>
                                    <label className="employee-tax-check">
                                        <input
                                            type="checkbox"
                                            checked={tdsForm.is_metro}
                                            onChange={(e) =>
                                                setTdsForm((prev) => ({ ...prev, is_metro: e.target.checked }))
                                            }
                                        />
                                        Metro city
                                    </label>
                                    <label>
                                        80C extra
                                        <input
                                            type="number"
                                            min="0"
                                            value={tdsForm.section_80c_extra}
                                            onChange={(e) =>
                                                setTdsForm((prev) => ({ ...prev, section_80c_extra: e.target.value }))
                                            }
                                        />
                                    </label>
                                    <label>
                                        80D
                                        <input
                                            type="number"
                                            min="0"
                                            value={tdsForm.section_80d}
                                            onChange={(e) =>
                                                setTdsForm((prev) => ({ ...prev, section_80d: e.target.value }))
                                            }
                                        />
                                    </label>
                                </>
                            )}
                            <label>
                                Previous employer TDS
                                <input
                                    type="number"
                                    min="0"
                                    value={tdsForm.previous_employer_tds}
                                    onChange={(e) =>
                                        setTdsForm((prev) => ({ ...prev, previous_employer_tds: e.target.value }))
                                    }
                                />
                            </label>
                            <button
                                type="button"
                                className="employee-tax-recalc"
                                disabled={tdsLoading}
                                onClick={() => fetchTdsProjection()}
                            >
                                {tdsLoading ? "Calculating…" : "Recalculate"}
                            </button>
                        </div>

                        {tdsLoading && <p className="employee-tax-muted">Calculating TDS projection…</p>}
                        {tdsError && !tdsLoading && <p className="employee-tax-error">{tdsError}</p>}

                        {!tdsLoading && p && (
                            <div className="employee-tax-results">
                                <div className="employee-tax-hero">
                                    <span>Projected Monthly TDS</span>
                                    <strong>{formatCurrency(p.tds?.monthly_tds)}</strong>
                                    <small>
                                        Annual tax {formatCurrency(p.tax?.annual_tax)} ·{" "}
                                        {p.tds?.remaining_months} month(s) left in FY
                                    </small>
                                </div>
                                <div className="employee-tax-grid">
                                    <div className="employee-tax-panel">
                                        <h4>Income</h4>
                                        <ul>
                                            <li>
                                                <span>Projected gross (FY)</span>
                                                <span>{formatCurrency(p.income?.projected_gross_fy)}</span>
                                            </li>
                                            <li>
                                                <span>YTD gross</span>
                                                <span>{formatCurrency(p.income?.ytd_gross)}</span>
                                            </li>
                                        </ul>
                                    </div>
                                    <div className="employee-tax-panel">
                                        <h4>Deductions &amp; tax</h4>
                                        <ul>
                                            <li>
                                                <span>Standard deduction</span>
                                                <span>{formatCurrency(p.deductions?.standard_deduction)}</span>
                                            </li>
                                            <li>
                                                <span>Total exemptions</span>
                                                <span>{formatCurrency(p.deductions?.total_exemptions)}</span>
                                            </li>
                                            <li className="accent">
                                                <span>Taxable income</span>
                                                <span>{formatCurrency(p.taxable_income)}</span>
                                            </li>
                                            <li className="green">
                                                <span>Annual tax</span>
                                                <span>{formatCurrency(p.tax?.annual_tax)}</span>
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {!ctcLoading && !hasCtcData && tdsError && (
                    <p className="employee-tax-error">{tdsError}</p>
                )}
            </div>
        </div>
    );
};
