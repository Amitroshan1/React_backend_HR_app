import { useEffect, useState } from "react";
import { useUser } from "../../components/layout/UserContext";
import "./Payslip.css";

const API_BASE_URL = "/api/accounts";
const AUTH_API_BASE_URL = "/api/auth";

const formatINRCurrency = (value) => {
    const num = Number(value);
    if (Number.isNaN(num)) return "0.00";
    return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatISTDateTime = (value) => {
    if (!value) return "N/A";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "N/A";
    return d.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });
};

export const Payslip = () => {
    const { userData } = useUser();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [downloadingId, setDownloadingId] = useState(null);
    const [downloadingPayrollId, setDownloadingPayrollId] = useState(null);
    const [payrollHistory, setPayrollHistory] = useState([]);

    const userId = userData?.user?.id;

    useEffect(() => {
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
        Promise.all([
            fetch(`${API_BASE_URL}/payslip/history/${userId}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
            }).then((res) => res.json()),
            fetch(`${AUTH_API_BASE_URL}/employee/homepage`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
            }).then((res) => res.json()).catch(() => ({})),
        ])
            .then(([result, dashboardResult]) => {
                if (result.success && Array.isArray(result.history)) {
                    setHistory(result.history);
                } else {
                    setError(result.message || "Failed to load payslips");
                    setHistory([]);
                }

                const payrollRows = Array.isArray(dashboardResult?.my_payroll_history)
                    ? dashboardResult.my_payroll_history
                    : [];
                setPayrollHistory(payrollRows);
            })
            .catch((err) => {
                setError(err.message || "Failed to load payslips");
                setHistory([]);
                setPayrollHistory([]);
            })
            .finally(() => setLoading(false));
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

    return (
        <div className="payslip-page">
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
                </div>
            </div>
        </div>
    );
};
