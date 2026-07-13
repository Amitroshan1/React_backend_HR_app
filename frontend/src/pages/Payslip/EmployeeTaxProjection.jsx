import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Receipt } from "lucide-react";
import { useUser } from "../../components/layout/UserContext";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import {
    defaultFinancialYear,
    financialYearOptions,
} from "../../utils/financialYear";
import { authHeaders } from "../../utils/sensitiveDataAuth";
import { LockSensitiveDataButton } from "../../components/security/SensitiveDataGate";
import "./EmployeeTaxProjection.css";

const API_BASE_URL = "/api/auth";
const ACCOUNTS_API_URL = "/api/accounts";

const formatINRCurrency = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return "0.00";
    return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatCurrency = (value) => `Rs. ${formatINRCurrency(value)}`;

const BASIS_LABELS = {
    provisional: "Provisional (submitted)",
    final: "Final (approved)",
};

const EXTENDED_DECL_FIELDS = [
    { key: "section_80ccd1b", label: "80CCD(1B)" },
    { key: "section_24_interest", label: "Sec 24(b) interest" },
    { key: "lta_exemption", label: "LTA" },
    { key: "section_80e", label: "80E" },
    { key: "section_80g", label: "80G" },
    { key: "other_deductions", label: "Other deductions" },
    { key: "other_income", label: "Other income" },
    { key: "new_regime_deductions", label: "New regime deductions" },
];

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
    const [fyOptions] = useState(() => financialYearOptions());
    const [financialYear, setFinancialYear] = useState(defaultFinancialYear);

    const fetchTdsProjection = useCallback(
        async (fy) => {
            if (!userId) return;
            const year = fy || financialYear || defaultFinancialYear();
            setTdsLoading(true);
            setTdsError("");
            try {
                const res = await fetch(`${API_BASE_URL}/tds/projection`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...authHeaders() },
                    body: JSON.stringify({
                        admin_id: userId,
                        financial_year: year,
                        use_ytd_gross: true,
                        use_declaration: true,
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
        [userId, financialYear]
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
        setFinancialYear(fy);
        setCtcLoading(true);
        setTdsError("");
        setTdsProjection(null);

        try {
            const ctcRes = await fetch(`${ACCOUNTS_API_URL}/ctc-breakup/${userId}`, {
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
            await fetchTdsProjection(fy);
        } catch (err) {
            setTdsError(err.message || "Unable to load tax projection");
            setHasCtcData(false);
        } finally {
            setCtcLoading(false);
        }
    }, [userId, fetchTdsProjection]);

    useRefreshOnNavigate(() => {
        loadInitial();
    }, [userId, loadInitial]);

    const handleFyChange = (fy) => {
        setFinancialYear(fy);
        fetchTdsProjection(fy);
    };

    const p = tdsProjection;
    const isOldRegime = p?.regime === "old";
    const declSource = p?.declaration_source;
    const inputsUsed = p?.inputs_used || {};
    const warnings = p?.warnings || [];
    const variance = p?.variance;
    const schedule = p?.tds?.schedule || [];
    const taxSavings = p?.tax_savings;
    const tdsBasis = declSource?.tds_basis || inputsUsed.tds_basis;

    const declBannerClass = declSource?.found
        ? declSource.payroll_ready
            ? "employee-tax-decl-banner--approved"
            : declSource.status === "submitted"
                ? "employee-tax-decl-banner--submitted"
                : declSource.status === "rejected"
                    ? "employee-tax-decl-banner--rejected"
                    : "employee-tax-decl-banner--draft"
        : "employee-tax-decl-banner--missing";

    return (
        <div className="employee-tax-page">
            <button type="button" className="employee-tax-back" onClick={() => navigate("/tax-declaration")}>
                <ArrowLeft size={18} aria-hidden />
                Back to Tax Declaration
            </button>

            <div className="sensitive-lock-row">
                <LockSensitiveDataButton />
            </div>

            <div className="employee-tax-card">
                <div className="employee-tax-header">
                    <div className="employee-tax-header-icon">
                        <Receipt size={22} aria-hidden />
                    </div>
                    <div>
                        <h1>Tax Projection</h1>
                        <p>
                            Estimated TDS for {displayName}
                            {p?.financial_year || financialYear
                                ? ` · FY ${p?.financial_year || financialYear}`
                                : ""}
                            {p?.regime_label ? ` · ${p.regime_label}` : ""}
                        </p>
                    </div>
                </div>

                {ctcLoading && <p className="employee-tax-muted">Loading tax projection…</p>}

                {!ctcLoading && hasCtcData && (
                    <>
                        <div className="employee-tax-adjust">
                            <div className="employee-tax-adjust-toolbar">
                                <label className="employee-tax-field employee-tax-field--fy">
                                    <span className="employee-tax-label">Financial Year</span>
                                    <select
                                        className="employee-tax-control"
                                        value={financialYear}
                                        onChange={(e) => handleFyChange(e.target.value)}
                                        disabled={tdsLoading}
                                    >
                                        {fyOptions.map((fy) => (
                                            <option key={fy} value={fy}>{fy}</option>
                                        ))}
                                    </select>
                                </label>
                                <button
                                    type="button"
                                    className="employee-tax-recalc"
                                    disabled={tdsLoading}
                                    onClick={() => fetchTdsProjection(financialYear)}
                                >
                                    {tdsLoading ? "Calculating…" : "Recalculate"}
                                </button>
                            </div>
                        </div>

                        <div className={`employee-tax-decl-banner ${declBannerClass}`}>
                            <div className="employee-tax-decl-banner-text">
                                <strong>Data source</strong>
                                <span>{declSource?.label || "Loading declaration status…"}</span>
                                {tdsBasis && (
                                    <span className={`employee-tax-basis employee-tax-basis--${tdsBasis}`}>
                                        {BASIS_LABELS[tdsBasis] || tdsBasis}
                                    </span>
                                )}
                            </div>
                        </div>

                        {warnings.length > 0 && (
                            <ul className="employee-tax-warnings">
                                {warnings.map((msg) => (
                                    <li key={msg}>{msg}</li>
                                ))}
                            </ul>
                        )}

                        {inputsUsed.from_declaration && (
                            <div className="employee-tax-decl-readonly">
                                <h3 className="employee-tax-decl-readonly-title">
                                    Values from your tax declaration
                                </h3>
                                <div className="employee-tax-decl-readonly-grid">
                                    {isOldRegime && (
                                        <>
                                            <div>
                                                <span>Annual rent (HRA)</span>
                                                <strong>{formatCurrency(inputsUsed.rent_paid_annual)}</strong>
                                            </div>
                                            <div>
                                                <span>Metro city</span>
                                                <strong>{inputsUsed.is_metro ? "Yes" : "No"}</strong>
                                            </div>
                                            <div>
                                                <span>80C (excl. EPF)</span>
                                                <strong>{formatCurrency(inputsUsed.section_80c_extra)}</strong>
                                            </div>
                                            <div>
                                                <span>80D</span>
                                                <strong>{formatCurrency(inputsUsed.section_80d)}</strong>
                                            </div>
                                            {EXTENDED_DECL_FIELDS.map(({ key, label }) => (
                                                Number(inputsUsed[key] || 0) > 0 && (
                                                    <div key={key}>
                                                        <span>{label}</span>
                                                        <strong>{formatCurrency(inputsUsed[key])}</strong>
                                                    </div>
                                                )
                                            ))}
                                        </>
                                    )}
                                    {!isOldRegime && EXTENDED_DECL_FIELDS.filter(
                                        ({ key }) => Number(inputsUsed[key] || 0) > 0
                                    ).map(({ key, label }) => (
                                        <div key={key}>
                                            <span>{label}</span>
                                            <strong>{formatCurrency(inputsUsed[key])}</strong>
                                        </div>
                                    ))}
                                    <div>
                                        <span>Previous employer TDS</span>
                                        <strong>{formatCurrency(inputsUsed.previous_employer_tds)}</strong>
                                    </div>
                                </div>
                                <p className="employee-tax-muted employee-tax-decl-readonly-note">
                                    Projection uses your saved declaration. Update the declaration to change these values.
                                </p>
                            </div>
                        )}

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
                                                <span>{formatCurrency(p.income?.projected_annual_gross)}</span>
                                            </li>
                                            <li>
                                                <span>YTD gross</span>
                                                <span>{formatCurrency(p.income?.ytd_gross)}</span>
                                            </li>
                                            <li>
                                                <span>Basic (annual)</span>
                                                <span>{formatCurrency(p.income?.basic_annual)}</span>
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
                                            {isOldRegime && (
                                                <>
                                                    <li>
                                                        <span>HRA exemption</span>
                                                        <span>{formatCurrency(p.deductions?.hra_exemption)}</span>
                                                    </li>
                                                    <li>
                                                        <span>Section 80C</span>
                                                        <span>{formatCurrency(p.deductions?.section_80c)}</span>
                                                    </li>
                                                    <li>
                                                        <span>Section 80D</span>
                                                        <span>{formatCurrency(p.deductions?.section_80d)}</span>
                                                    </li>
                                                    <li>
                                                        <span>80CCD(1B)</span>
                                                        <span>{formatCurrency(p.deductions?.section_80ccd1b)}</span>
                                                    </li>
                                                    <li>
                                                        <span>Sec 24(b)</span>
                                                        <span>{formatCurrency(p.deductions?.section_24_interest)}</span>
                                                    </li>
                                                    <li>
                                                        <span>LTA exemption</span>
                                                        <span>{formatCurrency(p.deductions?.lta_exemption)}</span>
                                                    </li>
                                                    <li>
                                                        <span>Other Chapter VI-A</span>
                                                        <span>{formatCurrency(
                                                            Number(p.deductions?.section_80e || 0)
                                                            + Number(p.deductions?.section_80g || 0)
                                                            + Number(p.deductions?.other_deductions || 0)
                                                        )}</span>
                                                    </li>
                                                </>
                                            )}
                                            {!isOldRegime && Number(p.deductions?.new_regime_deductions || 0) > 0 && (
                                                <li>
                                                    <span>New regime deductions</span>
                                                    <span>{formatCurrency(p.deductions?.new_regime_deductions)}</span>
                                                </li>
                                            )}
                                            {Number(p.deductions?.other_income || 0) > 0 && (
                                                <li>
                                                    <span>Other income (added)</span>
                                                    <span>{formatCurrency(p.deductions?.other_income)}</span>
                                                </li>
                                            )}
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

                                {taxSavings && (
                                    <div className="employee-tax-panel employee-tax-panel--full employee-tax-savings">
                                        <h4>Tax saved with declaration</h4>
                                        <div className="employee-tax-savings-grid">
                                            <div>
                                                <span>Without declaration</span>
                                                <strong>{formatCurrency(taxSavings.without_declaration?.annual_tax)}</strong>
                                                <small>Annual tax</small>
                                            </div>
                                            <div>
                                                <span>With declaration</span>
                                                <strong>{formatCurrency(taxSavings.with_declaration?.annual_tax)}</strong>
                                                <small>Annual tax</small>
                                            </div>
                                            <div className="employee-tax-savings-highlight">
                                                <span>You save (annual)</span>
                                                <strong>{formatCurrency(taxSavings.tax_saved_annual)}</strong>
                                                <small>
                                                    ~{formatCurrency(taxSavings.monthly_tds_saved)}/month TDS
                                                </small>
                                            </div>
                                        </div>
                                        {taxSavings.note && (
                                            <p className="employee-tax-muted">{taxSavings.note}</p>
                                        )}
                                    </div>
                                )}

                                {variance && (
                                    <div className="employee-tax-panel employee-tax-panel--full">
                                        <h4>TDS reconciliation</h4>
                                        <ul>
                                            <li>
                                                <span>YTD TDS deducted (payroll)</span>
                                                <span>{formatCurrency(variance.ytd_tds_deducted)}</span>
                                            </li>
                                            <li>
                                                <span>Remaining tax liability</span>
                                                <span>{formatCurrency(variance.remaining_tax_liability)}</span>
                                            </li>
                                            <li>
                                                <span>Projected monthly TDS</span>
                                                <span>{formatCurrency(variance.projected_monthly_tds)}</span>
                                            </li>
                                            <li className="accent">
                                                <span>Catch-up TDS needed</span>
                                                <span>{formatCurrency(variance.catch_up_tds_needed)}</span>
                                            </li>
                                        </ul>
                                    </div>
                                )}

                                {schedule.length > 0 && (
                                    <div className="employee-tax-panel employee-tax-panel--full">
                                        <h4>Month-wise TDS schedule</h4>
                                        <div className="employee-tax-schedule-grid">
                                            {schedule.map((row) => (
                                                <div
                                                    key={row.month}
                                                    className={`employee-tax-schedule-item employee-tax-schedule-item--${row.status || row.source}`}
                                                >
                                                    <span>{row.month_label}</span>
                                                    <strong>{formatCurrency(row.tds)}</strong>
                                                    <small>
                                                        {row.status === "actual" ? "Payroll" : "Projected"}
                                                    </small>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
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
