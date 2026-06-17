import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { useUser } from "../../components/layout/UserContext";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import "./EmployeeForm16.css";

const API_BASE_URL = "/api/accounts";

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
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [downloadingPath, setDownloadingPath] = useState(null);

    const authHeaders = () => {
        const token = localStorage.getItem("token");
        return token ? { Authorization: `Bearer ${token}` } : {};
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
        setLoading(true);
        setError("");
        fetch(`${API_BASE_URL}/form16/history/${userId}`, { headers: authHeaders() })
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
            const res = await fetch(`${API_BASE_URL}/file/${encodeURIComponent(filePath)}`, {
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

    return (
        <div className="employee-form16-page">
            <button type="button" className="employee-form16-back" onClick={() => navigate("/payslip")}>
                <ArrowLeft size={18} aria-hidden />
                Back to Payslip
            </button>

            <div className="employee-form16-card">
                <div className="employee-form16-header">
                    <div className="employee-form16-header-icon">
                        <FileText size={22} aria-hidden />
                    </div>
                    <div>
                        <h1>Form 16</h1>
                        <p>Download Form 16 certificates uploaded by Accounts for {displayName}</p>
                    </div>
                </div>

                {loading && <p className="employee-form16-muted">Loading Form 16 records…</p>}
                {error && <p className="employee-form16-error">{error}</p>}
                {!loading && !error && history.length === 0 && (
                    <p className="employee-form16-muted">
                        No Form 16 uploaded yet. Contact Accounts if you need your certificate.
                    </p>
                )}

                {!loading && history.length > 0 && (
                    <div className="employee-form16-table-wrap">
                        <table className="employee-form16-table">
                            <thead>
                                <tr>
                                    <th>Financial Year</th>
                                    <th>Uploaded On</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((row) => (
                                    <tr key={row.id}>
                                        <td data-label="Financial Year">{row.financial_year || "—"}</td>
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
