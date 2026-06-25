import { useState } from "react";
import { useUser } from "../../components/layout/UserContext";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { hasFeature } from "../../utils/planFeatures";
import "./Payslip.css";
import { formatDateTimeDDMMYYYY, formatMonthYear } from "../../utils/dateFormat";

const API_BASE_URL = "/api/accounts";
const AUTH_API_BASE_URL = "/api/auth";

const formatINRCurrency = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return "0.00";
    return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatISTDateTime = (value) => formatDateTimeDDMMYYYY(value, "N/A");

const formatRupee = (value) => `Rs. ${formatINRCurrency(value)}`;

const formatPtaxMonthLabel = (ptaxMonth) => {
    if (!ptaxMonth) return "—";
    const s = String(ptaxMonth).trim();
    if (/^\d{4}-\d{2}$/.test(s)) {
        const [y, m] = s.split("-");
        const d = new Date(Number(y), Number(m) - 1, 1);
        if (!Number.isNaN(d.getTime())) {
            return formatMonthYear(d);
        }
    }
    return s;
};

export const Payslip = () => {
    const { userData } = useUser();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [downloadingId, setDownloadingId] = useState(null);
    const [downloadingPayrollId, setDownloadingPayrollId] = useState(null);
    const [payrollHistory, setPayrollHistory] = useState([]);
    const [ctcBreakup, setCtcBreakup] = useState(null);
    const [ctcLoading, setCtcLoading] = useState(false);
    const [ctcError, setCtcError] = useState("");

    const userId = userData?.user?.id;
    const displayName =
        userData?.user?.name
        || userData?.user?.first_name
        || userData?.user?.user_name
        || (userData?.user?.email ? userData.user.email.split("@")[0] : null)
        || "User";

    useRefreshOnNavigate(() => {
        if (!userId) {
            setLoading(false);
            setError("User not loaded.");
            return;
        }
        const token = localStorage.getItem("token");
        if (!token) {
            setLoading(false);
            setError("Please log in.");
            return;
        }
        setLoading(true);
        setError("");
        const showPayrollHistory = hasFeature("payslip_payroll_history");
        setCtcLoading(true);
        setCtcError("");
        const requests = [
            fetch(`${API_BASE_URL}/payslip/history/${userId}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
            }).then((res) => res.json()),
            fetch(`${API_BASE_URL}/ctc-breakup/${userId}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
            }).then((res) => res.json()).catch(() => ({ success: false })),
        ];
        if (showPayrollHistory) {
            requests.push(
                fetch(`${AUTH_API_BASE_URL}/employee/homepage`, {
                    method: "GET",
                    headers: { Authorization: `Bearer ${token}` },
                }).then((res) => res.json()).catch(() => ({}))
            );
        }
        Promise.all(requests)
            .then((results) => {
                const result = results[0];
                const ctcResult = results[1];
                const dashboardResult = showPayrollHistory ? results[2] : {};
                if (result.success && Array.isArray(result.history)) {
                    setHistory(result.history);
                } else {
                    setError(result.message || "Failed to load payslips");
                    setHistory([]);
                }

                const payrollRows =
                    showPayrollHistory && Array.isArray(dashboardResult?.my_payroll_history)
                        ? dashboardResult.my_payroll_history
                        : [];
                setPayrollHistory(payrollRows);

                if (ctcResult?.success) {
                    setCtcBreakup(ctcResult.ctc_breakup || null);
                    setCtcError("");
                } else if (ctcResult?.message) {
                    setCtcBreakup(null);
                    setCtcError(ctcResult.message);
                } else {
                    setCtcBreakup(null);
                    setCtcError("");
                }
            })
            .catch((err) => {
                setError(err.message || "Failed to load payslips");
                setHistory([]);
                setPayrollHistory([]);
                setCtcBreakup(null);
            })
            .finally(() => {
                setLoading(false);
                setCtcLoading(false);
            });
    }, [userId]);

    const handleDownload = async (row) => {
        if (!row?.file_path) return;
        const token = localStorage.getItem("token");
        if (!token) {
            alert("Please log in to download.");
            return;
        }
        setDownloadingId(row.id);
        try {
            const res = await fetch(`${API_BASE_URL}/file/${encodeURIComponent(row.file_path)}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || "Download failed");
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `payslip-${row.month}-${row.year}.pdf` || "payslip.pdf";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            alert(err.message || "Download failed");
        } finally {
            setDownloadingId(null);
        }
    };

    const handlePayrollDownload = async (row) => {
        if (!row?.id) return;
        const token = localStorage.getItem("token");
        if (!token) {
            alert("Please log in to download.");
            return;
        }
        setDownloadingPayrollId(row.id);
        try {
            const res = await fetch(`${API_BASE_URL}/payroll/${row.id}/download`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || "Payroll download failed");
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `payroll-slip-${row.month || "month"}-${row.year || "year"}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            alert(err.message || "Payroll download failed");
        } finally {
            setDownloadingPayrollId(null);
        }
    };

    const annualCtcTotal = Number(ctcBreakup?.annual_ctc_computed ?? ctcBreakup?.annual_ctc ?? 0);
    const hasCtcData = ctcBreakup && (annualCtcTotal > 0 || Number(ctcBreakup.basic_salary || 0) > 0);

    const earningsRows = [
        { label: "Basic + DA", value: ctcBreakup?.basic_salary },
        {
            label: ctcBreakup?.hra_pct != null ? `HRA (${Number(ctcBreakup.hra_pct)}%)` : "HRA",
            value: ctcBreakup?.hra,
        },
        { label: "Other Allowance", value: ctcBreakup?.other_allowance },
        { label: "Gross Salary", value: ctcBreakup?.gross_salary, tone: "accent" },
        { label: "Net Salary", value: ctcBreakup?.net_salary, tone: "green" },
    ];

    const deductionRows = [
        { label: "EPF (Employee)", value: ctcBreakup?.epf },
        { label: "ESIC (Employee)", value: ctcBreakup?.esic },
        { label: "Professional Tax", value: ctcBreakup?.ptax },
        { label: "Total Deductions", value: ctcBreakup?.deductions_total, tone: "red" },
    ];

    const annualRows = [
        { label: "Gratuity", value: ctcBreakup?.gratuity_yearly },
        { label: "Employer PF", value: ctcBreakup?.employer_pf_yearly },
        { label: "Employer ESIC", value: ctcBreakup?.employer_esic_yearly },
        { label: "Mediclaim", value: ctcBreakup?.mediclaim_yearly },
    ];

    return (
        <div className="payslip-page">
            <div className="payslip-ctc-card">
                <div className="payslip-ctc-header">
                    <h2 className="payslip-ctc-title">{displayName}'s CTC Breakup</h2>
                </div>
                <div className="payslip-ctc-body">
                    {ctcLoading && <div className="payslip-loading">Loading CTC breakup…</div>}
                    {ctcError && !ctcLoading && <div className="payslip-error">{ctcError}</div>}
                    {!ctcLoading && !ctcError && !hasCtcData && (
                        <div className="payslip-empty">No CTC breakup on file yet. Contact Accounts if this looks wrong.</div>
                    )}
                    {!ctcLoading && hasCtcData && (
                        <>
                            <div className="payslip-ctc-hero">
                                <span className="payslip-ctc-hero-label">Annual CTC (Total)</span>
                                <span className="payslip-ctc-hero-value">{formatRupee(annualCtcTotal)}</span>
                                {ctcBreakup?.updated_at && (
                                    <span className="payslip-ctc-hero-meta">
                                        Updated {formatISTDateTime(ctcBreakup.updated_at)}
                                    </span>
                                )}
                            </div>
                            <div className="payslip-ctc-grid">
                                <section className="payslip-ctc-panel payslip-ctc-panel--earnings">
                                    <h3 className="payslip-ctc-panel-title">Monthly Earnings</h3>
                                    <ul className="payslip-ctc-rows">
                                        {earningsRows.map((row) => (
                                            <li
                                                key={row.label}
                                                className={`payslip-ctc-row${row.tone ? ` payslip-ctc-row--${row.tone}` : ""}`}
                                            >
                                                <span>{row.label}</span>
                                                <span>{formatRupee(row.value)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                                <section className="payslip-ctc-panel payslip-ctc-panel--deductions">
                                    <h3 className="payslip-ctc-panel-title">Monthly Deductions</h3>
                                    <ul className="payslip-ctc-rows">
                                        {deductionRows.map((row) => (
                                            <li
                                                key={row.label}
                                                className={`payslip-ctc-row${row.tone ? ` payslip-ctc-row--${row.tone}` : ""}`}
                                            >
                                                <span>{row.label}</span>
                                                <span>{formatRupee(row.value)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    {ctcBreakup?.ptax_month && (
                                        <p className="payslip-ctc-footnote">
                                            P.Tax month: {formatPtaxMonthLabel(ctcBreakup.ptax_month)}
                                        </p>
                                    )}
                                </section>
                            </div>
                            <section className="payslip-ctc-panel payslip-ctc-panel--annual">
                                <h3 className="payslip-ctc-panel-title">Annual Employer Cost &amp; Benefits</h3>
                                <div className="payslip-ctc-annual-grid">
                                    {annualRows.map((row) => (
                                        <div key={row.label} className="payslip-ctc-stat">
                                            <span className="payslip-ctc-stat-label">{row.label}</span>
                                            <span className="payslip-ctc-stat-value">{formatRupee(row.value)}</span>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </>
                    )}
                </div>
            </div>

            <div className="payslip-card">
                <div className="payslip-card-header">
                    <h2 className="payslip-title">My Payslips</h2>
                </div>
                <div className="payslip-card-body">
                    <p className="payslip-desc">View and download your payslip statements.</p>
                    {loading && <div className="payslip-loading">Loading payslips…</div>}
                    {error && <div className="payslip-error">{error}</div>}
                    {!loading && !error && history.length === 0 && (
                        <div className="payslip-empty">No payslips found.</div>
                    )}
                    {!loading && !error && history.length > 0 && (
                        <>
                            <div className="payslip-table-wrap">
                                <table className="payslip-table">
                                    <thead>
                                        <tr>
                                            <th>Month</th>
                                            <th>Year</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.map((row) => (
                                            <tr key={row.id}>
                                                <td data-label="Month">{row.month}</td>
                                                <td data-label="Year">{row.year}</td>
                                                <td data-label="Action">
                                                    <button
                                                        type="button"
                                                        className="payslip-download-btn"
                                                        onClick={() => handleDownload(row)}
                                                        disabled={downloadingId === row.id}
                                                    >
                                                        {downloadingId === row.id ? "Downloading…" : "Download"}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <ul className="payslip-cards-mobile" aria-hidden="true">
                                {history.map((row) => (
                                    <li key={row.id} className="payslip-row-card">
                                        <div className="payslip-row-card-inner">
                                            <span className="payslip-row-label">Month</span>
                                            <span className="payslip-row-value">{row.month}</span>
                                        </div>
                                        <div className="payslip-row-card-inner">
                                            <span className="payslip-row-label">Year</span>
                                            <span className="payslip-row-value">{row.year}</span>
                                        </div>
                                        <div className="payslip-row-card-action">
                                            <button
                                                type="button"
                                                className="payslip-download-btn"
                                                onClick={() => handleDownload(row)}
                                                disabled={downloadingId === row.id}
                                            >
                                                {downloadingId === row.id ? "Downloading…" : "Download"}
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}

                    {hasFeature("payslip_payroll_history") && (
                    <div className="payroll-history-block">
                        <h3 className="payroll-history-title">Payroll History</h3>
                        {loading ? (
                            <div className="payslip-loading">Loading payroll…</div>
                        ) : payrollHistory.length === 0 ? (
                            <div className="payslip-empty">No payroll records found.</div>
                        ) : (
                            <div className="payroll-cards-grid">
                                {payrollHistory.map((item) => (
                                    <div key={item.id} className="payroll-month-card">
                                        <div className="payroll-month-title">{`${item.month || ""} ${item.year || ""}`.trim() || "Payroll"}</div>
                                        <div className="payroll-month-row">
                                            <span>Working Days</span>
                                            <strong>{Number(item.actual_working_days || 0).toFixed(2)}</strong>
                                        </div>
                                        <div className="payroll-month-row">
                                            <span>Gross</span>
                                            <strong>{`Rs. ${formatINRCurrency(item.gross_salary_for_month)}`}</strong>
                                        </div>
                                        <div className="payroll-month-row">
                                            <span>TDS</span>
                                            <strong>{`Rs. ${formatINRCurrency(item.tds_final)}`}</strong>
                                        </div>
                                        <div className="payroll-month-row">
                                            <span>Deductions</span>
                                            <strong>{`Rs. ${formatINRCurrency(item.deductions_total_final)}`}</strong>
                                        </div>
                                        <div className="payroll-month-row net">
                                            <span>Net Salary</span>
                                            <strong>{`Rs. ${formatINRCurrency(item.net_salary_final)}`}</strong>
                                        </div>
                                        <div className="payroll-month-row">
                                            <span>Created At</span>
                                            <strong>{formatISTDateTime(item.created_at)}</strong>
                                        </div>
                                        <button
                                            type="button"
                                            className="payslip-download-btn payroll-download-btn"
                                            onClick={() => handlePayrollDownload(item)}
                                            disabled={downloadingPayrollId === item.id}
                                        >
                                            {downloadingPayrollId === item.id ? "Downloading…" : "Download"}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    )}
                </div>
            </div>
        </div>
    );
};
