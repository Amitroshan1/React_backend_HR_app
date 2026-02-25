import { useEffect, useState } from "react";
import { useUser } from "../../components/layout/UserContext";
import "./Payslip.css";

const API_BASE_URL = "/api/accounts";

export const Payslip = () => {
    const { userData } = useUser();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [downloadingId, setDownloadingId] = useState(null);

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
        fetch(`${API_BASE_URL}/payslip/history/${userId}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((res) => res.json())
            .then((result) => {
                if (result.success && Array.isArray(result.history)) {
                    setHistory(result.history);
                } else {
                    setError(result.message || "Failed to load payslips");
                    setHistory([]);
                }
            })
            .catch((err) => {
                setError(err.message || "Failed to load payslips");
                setHistory([]);
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
                </div>
            </div>
        </div>
    );
};
