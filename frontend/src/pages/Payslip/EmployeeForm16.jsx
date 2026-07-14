import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, Download } from "lucide-react";
import { useUser } from "../../components/layout/UserContext";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import { defaultFinancialYear, financialYearOptions } from "../../utils/financialYear";
import { authHeaders } from "../../utils/sensitiveDataAuth";
import { LockSensitiveDataButton } from "../../components/security/SensitiveDataGate";
import "./EmployeeForm16.css";

const ACCOUNTS_API_URL = "/api/accounts";
const AUTH_API_URL = "/api/auth";

const formatINR = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return "0.00";
    return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function certificateLabel(row) {
    if (row.is_official_traces || row.certificate_type === "official_traces") {
        return "Official TRACES";
    }
    if (row.data_source === "traces") return "TRACES import";
    return "Manual upload";
}

function partLabel(partType) {
    if (partType === "part_a") return "Part A";
    if (partType === "part_b") return "Part B";
    if (partType === "combined") return "Combined";
    return "—";
}

export const EmployeeForm16 = () => {
    const navigate = useNavigate();
    const { userData } = useUser();
    const userId = userData?.user?.id;
    const displayName =
        userData?.user?.name
        || userData?.user?.first_name
        || userData?.user?.user_name
        || (userData?.user?.email ? userData.user.email.split("@")[0] : null)
        || "User";

    const [history, setHistory] = useState([]);
    const [summary, setSummary] = useState(null);
    const [financialYear, setFinancialYear] = useState(defaultFinancialYear);
    const [fyOptions] = useState(() => financialYearOptions());
    const [loading, setLoading] = useState(true);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [error, setError] = useState("");
    const [summaryError, setSummaryError] = useState("");
    const [downloadingPath, setDownloadingPath] = useState(null);
    const [downloadingSummary, setDownloadingSummary] = useState(false);

    const loadSummary = async (fy) => {
        if (!userId) return;
        setSummaryLoading(true);
        setSummaryError("");
        try {
            const res = await fetch(
                `${AUTH_API_URL}/form16/summary?financial_year=${encodeURIComponent(fy)}`,
                { headers: authHeaders() }
            );
            const result = await res.json();
            if (!res.ok || !result.success) {
                throw new Error(result.message || "Failed to load Form 16 summary");
            }
            setSummary(result.summary || null);
        } catch (err) {
            setSummaryError(err.message || "Unable to load computed summary");
            setSummary(null);
        } finally {
            setSummaryLoading(false);
        }
    };

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
        const fy = defaultFinancialYear();
        setFinancialYear(fy);
        setLoading(true);
        setError("");
        fetch(`${ACCOUNTS_API_URL}/form16/history/${userId}`, { headers: authHeaders() })
            .then((res) => res.json())
            .then((result) => {
                if (!result.success) {
                    throw new Error(result.message || "Failed to load Form 16");
                }
                setHistory(result.history || []);
            })
            .catch((err) => {
                setError(err.message || "Unable to load Form 16");
                setHistory([]);
            })
            .finally(() => setLoading(false));
        loadSummary(fy);
    }, [userId]);

    const downloadFile = async (filePath, downloadName) => {
        if (!filePath) return;
        const token = localStorage.getItem("token");
        if (!token) {
            alert("Please log in to download.");
            return;
        }
        setDownloadingPath(filePath);
        try {
            const fileUrlPath = String(filePath)
                .replace(/\\/g, "/")
                .split("/")
                .filter(Boolean)
                .map(encodeURIComponent)
                .join("/");
            const res = await fetch(`${ACCOUNTS_API_URL}/file/${fileUrlPath}`, {
                method: "GET",
                headers: authHeaders(),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || "Download failed");
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = downloadName || filePath.split("/").pop() || "form16.pdf";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            alert(err.message || "Download failed");
        } finally {
            setDownloadingPath(null);
        }
    };

    const downloadSummaryPdf = async () => {
        const token = localStorage.getItem("token");
        if (!token) {
            alert("Please log in to download.");
            return;
        }
        setDownloadingSummary(true);
        try {
            const res = await fetch(
                `${AUTH_API_URL}/form16/summary/download?financial_year=${encodeURIComponent(financialYear)}`,
                { headers: authHeaders() }
            );
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.message || "Download failed");
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `form16-summary-${financialYear}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            alert(err.message || "Download failed");
        } finally {
            setDownloadingSummary(false);
        }
    };

    const handleFyChange = (fy) => {
        setFinancialYear(fy);
        loadSummary(fy);
    };

    return (
        <div className="employee-form16-page">
            <button type="button" className="employee-form16-back" onClick={() => navigate("/tax-declaration")}>
                <ArrowLeft size={18} aria-hidden />
                Back to Tax Declaration
            </button>

            <div className="sensitive-lock-row">
                <LockSensitiveDataButton />
            </div>

            <div className="employee-form16-card">
                <div className="employee-form16-header">
                    <div className="employee-form16-header-icon">
                        <FileText size={22} aria-hidden />
                    </div>
                    <div>
                        <h1>Form 16</h1>
                        <p>Official uploads and computed summary for {displayName}</p>
                    </div>
                </div>

                <div className="employee-form16-summary-block">
                    <div className="employee-form16-summary-toolbar">
                        <label>
                            <span>Financial year</span>
                            <select
                                value={financialYear}
                                onChange={(e) => handleFyChange(e.target.value)}
                                disabled={summaryLoading}
                            >
                                {fyOptions.map((fy) => (
                                    <option key={fy} value={fy}>{fy}</option>
                                ))}
                            </select>
                        </label>
                        <button
                            type="button"
                            className="employee-form16-download-btn"
                            onClick={downloadSummaryPdf}
                            disabled={summaryLoading || downloadingSummary}
                        >
                            <Download size={14} aria-hidden />
                            {downloadingSummary ? "Downloading…" : "Download summary PDF"}
                        </button>
                    </div>
                    {summaryLoading && <p className="employee-form16-muted">Loading computed summary…</p>}
                    {summaryError && !summaryLoading && (
                        <p className="employee-form16-error">{summaryError}</p>
                    )}
                    {!summaryLoading && summary && (
                        <div className="employee-form16-summary-content">
                            <div className="employee-form16-summary-grid">
                                <div>
                                    <span>Gross (YTD payroll)</span>
                                    <strong>Rs. {formatINR(summary.part_a?.gross_salary_ytd)}</strong>
                                </div>
                                <div>
                                    <span>TDS deducted (YTD)</span>
                                    <strong>Rs. {formatINR(summary.part_a?.tds_deducted_ytd)}</strong>
                                </div>
                                <div>
                                    <span>Taxable income (projected)</span>
                                    <strong>Rs. {formatINR(summary.part_b?.taxable_income)}</strong>
                                </div>
                                <div>
                                    <span>Annual tax (projected)</span>
                                    <strong>Rs. {formatINR(summary.part_b?.annual_tax)}</strong>
                                </div>
                            </div>

                            {(summary.part_a?.quarterly_schedule?.length > 0
                                || summary.part_b?.chapter_via_schedule?.length > 0) && (
                                <div className="employee-form16-detail-grid">
                                    {summary.part_a?.quarterly_schedule?.length > 0 && (
                                        <div className="employee-form16-panel">
                                            <h3>Part A — Quarterly TDS</h3>
                                            <ul>
                                                {summary.part_a.quarterly_schedule.map((q) => (
                                                    <li key={q.quarter}>
                                                        <span className="employee-form16-panel-label">
                                                            {q.quarter}
                                                            <small>{q.period}</small>
                                                        </span>
                                                        <span className="employee-form16-panel-amounts">
                                                            <span>
                                                                Gross <strong>Rs. {formatINR(q.gross_salary)}</strong>
                                                            </span>
                                                            <span>
                                                                TDS <strong>Rs. {formatINR(q.tds_deducted)}</strong>
                                                            </span>
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                    {summary.part_b?.chapter_via_schedule?.length > 0 && (
                                        <div className="employee-form16-panel">
                                            <h3>Part B — Chapter VI-A</h3>
                                            <ul>
                                                {summary.part_b.chapter_via_schedule.map((row) => (
                                                    <li key={row.section}>
                                                        <span className="employee-form16-panel-label">{row.section}</span>
                                                        <strong>Rs. {formatINR(row.amount)}</strong>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {!summaryLoading && summary?.reconciliation?.has_uploaded_figures && (
                        <div className={`employee-form16-recon employee-form16-recon--${summary.reconciliation.match_status}`}>
                            <div className="employee-form16-recon-header">
                                <h3>Uploaded vs computed</h3>
                                <span className="employee-form16-recon-status">
                                    {summary.reconciliation.match_status}
                                </span>
                            </div>
                            <ul>
                                {Object.entries(summary.reconciliation.differences || {}).map(([key, diff]) => (
                                    <li key={key}>
                                        <span>{key.replace(/_/g, " ")}</span>
                                        <strong>Rs. {formatINR(diff)}</strong>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {summary?.disclaimer && (
                        <p className="employee-form16-muted employee-form16-disclaimer">{summary.disclaimer}</p>
                    )}
                </div>

                <h2 className="employee-form16-subtitle">Uploaded certificates</h2>
                {loading && <p className="employee-form16-muted">Loading Form 16 records…</p>}
                {error && <p className="employee-form16-error">{error}</p>}
                {!loading && !error && history.length === 0 && (
                    <p className="employee-form16-muted">
                        No Form 16 uploaded yet. Use the computed summary above or contact Accounts.
                    </p>
                )}

                {!loading && history.length > 0 && (
                    <div className="employee-form16-table-wrap">
                        <table className="employee-form16-table">
                            <thead>
                                <tr>
                                    <th>Financial Year</th>
                                    <th>Certificate</th>
                                    <th>Part</th>
                                    <th>Uploaded On</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((row) => (
                                    <tr key={row.id}>
                                        <td data-label="Financial Year">{row.financial_year || "—"}</td>
                                        <td data-label="Certificate">
                                            <span
                                                className={
                                                    row.is_official_traces || row.certificate_type === "official_traces"
                                                        ? "employee-form16-badge employee-form16-badge--official"
                                                        : "employee-form16-badge"
                                                }
                                            >
                                                {certificateLabel(row)}
                                            </span>
                                        </td>
                                        <td data-label="Part">{partLabel(row.part_type)}</td>
                                        <td data-label="Uploaded On">
                                            {formatDateTimeDDMMYYYY(row.created_at, "—")}
                                        </td>
                                        <td data-label="Action">
                                            <button
                                                type="button"
                                                className="employee-form16-download-btn"
                                                disabled={!row.file_path || downloadingPath === row.file_path}
                                                onClick={() =>
                                                    downloadFile(
                                                        row.file_path,
                                                        `form16-${row.financial_year || "file"}.pdf`
                                                    )
                                                }
                                            >
                                                {downloadingPath === row.file_path ? "Downloading…" : "Download"}
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
};
