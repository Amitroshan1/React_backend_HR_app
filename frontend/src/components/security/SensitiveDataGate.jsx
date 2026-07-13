import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    clearSensitiveToken,
    isSensitiveSessionValid,
    verifySensitivePassword,
} from "../../utils/sensitiveDataAuth";
import "./SensitiveDataGate.css";

export function SensitiveDataGate({ children, title = "Verify your password" }) {
    const navigate = useNavigate();
    const [verified, setVerified] = useState(() => isSensitiveSessionValid());
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        setVerified(isSensitiveSessionValid());
    }, []);

    const handleCancel = useCallback(() => {
        navigate("/dashboard", { replace: true });
    }, [navigate]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!password.trim()) {
            setError("Please enter your password.");
            return;
        }
        setLoading(true);
        setError("");
        try {
            await verifySensitivePassword(password);
            setPassword("");
            setVerified(true);
        } catch (err) {
            setError(err.message || "Incorrect password");
        } finally {
            setLoading(false);
        }
    };

    if (verified) {
        return children;
    }

    return (
        <div className="sensitive-gate-page">
            <div className="sensitive-gate-card">
                <div className="sensitive-gate-icon" aria-hidden="true">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                </div>
                <h2>{title}</h2>
                <p className="sensitive-gate-desc">
                    Re-enter your login password to view payslip and tax-related information.
                    Access stays unlocked for 10 minutes.
                </p>
                <form onSubmit={handleSubmit} className="sensitive-gate-form">
                    <label htmlFor="sensitive-password">Password</label>
                    <div className="sensitive-gate-password-row">
                        <input
                            id="sensitive-password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                            placeholder="Enter your password"
                            disabled={loading}
                        />
                        <button
                            type="button"
                            className="sensitive-gate-toggle"
                            onClick={() => setShowPassword((v) => !v)}
                            tabIndex={-1}
                        >
                            {showPassword ? "Hide" : "Show"}
                        </button>
                    </div>
                    {error ? <p className="sensitive-gate-error">{error}</p> : null}
                    <div className="sensitive-gate-actions">
                        <button type="button" className="sensitive-gate-btn secondary" onClick={handleCancel} disabled={loading}>
                            Cancel
                        </button>
                        <button type="submit" className="sensitive-gate-btn primary" disabled={loading}>
                            {loading ? "Verifying…" : "Unlock"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export function LockSensitiveDataButton({ className = "" }) {
    const handleLock = () => {
        clearSensitiveToken();
        window.location.reload();
    };

    return (
        <button type="button" className={`sensitive-lock-btn ${className}`.trim()} onClick={handleLock}>
            Lock salary data
        </button>
    );
}
