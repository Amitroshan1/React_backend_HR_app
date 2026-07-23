import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    clearSensitiveToken,
    isSensitiveSessionValid,
    requestSensitiveOtp,
    verifySensitiveOtp,
} from "../../utils/sensitiveDataAuth";
import "./SensitiveDataGate.css";

export function SensitiveDataGate({ children, title = "Verify with OTP" }) {
    const navigate = useNavigate();
    const [verified, setVerified] = useState(() => isSensitiveSessionValid());
    const [step, setStep] = useState("request"); // request | otp
    const [otp, setOtp] = useState("");
    const [info, setInfo] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [resendIn, setResendIn] = useState(0);
    const resendTimerRef = useRef(null);

    useEffect(() => {
        setVerified(isSensitiveSessionValid());
    }, []);

    useEffect(() => {
        if (resendIn <= 0) {
            if (resendTimerRef.current) {
                clearInterval(resendTimerRef.current);
                resendTimerRef.current = null;
            }
            return undefined;
        }
        resendTimerRef.current = setInterval(() => {
            setResendIn((s) => (s <= 1 ? 0 : s - 1));
        }, 1000);
        return () => {
            if (resendTimerRef.current) {
                clearInterval(resendTimerRef.current);
                resendTimerRef.current = null;
            }
        };
    }, [resendIn > 0]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleCancel = useCallback(() => {
        navigate("/dashboard", { replace: true });
    }, [navigate]);

    const handleRequestOtp = async () => {
        if (loading) return;
        setLoading(true);
        setError("");
        setInfo("");
        try {
            const data = await requestSensitiveOtp();
            setStep("otp");
            setOtp("");
            setInfo(data.message || "OTP sent to your registered email.");
            setResendIn(data.resend_after || 60);
        } catch (err) {
            setError(err.message || "Could not send OTP");
            if (typeof err.retryAfter === "number" && err.retryAfter > 0) {
                setResendIn(err.retryAfter);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async (event) => {
        event.preventDefault();
        if (!otp.trim()) {
            setError("Please enter the OTP sent to your email.");
            return;
        }
        setLoading(true);
        setError("");
        try {
            await verifySensitiveOtp(otp.trim());
            setOtp("");
            setVerified(true);
        } catch (err) {
            setError(err.message || "Invalid OTP");
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
                    We&apos;ll send a one-time OTP to your registered email to unlock payslip and tax-related information.
                    Access stays unlocked for 10 minutes.
                </p>

                {step === "request" ? (
                    <div className="sensitive-gate-form">
                        {error ? <p className="sensitive-gate-error">{error}</p> : null}
                        <div className="sensitive-gate-actions">
                            <button type="button" className="sensitive-gate-btn secondary" onClick={handleCancel} disabled={loading}>
                                Cancel
                            </button>
                            <button type="button" className="sensitive-gate-btn primary" onClick={handleRequestOtp} disabled={loading}>
                                {loading ? "Sending…" : "Send OTP"}
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleVerifyOtp} className="sensitive-gate-form">
                        {info ? <p className="sensitive-gate-info">{info}</p> : null}
                        <label htmlFor="sensitive-otp">OTP</label>
                        <input
                            id="sensitive-otp"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            value={otp}
                            maxLength={8}
                            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                            placeholder="Enter OTP"
                            disabled={loading}
                        />
                        {error ? <p className="sensitive-gate-error">{error}</p> : null}
                        <div className="sensitive-gate-resend-row">
                            <button
                                type="button"
                                className="sensitive-gate-link"
                                onClick={handleRequestOtp}
                                disabled={loading || resendIn > 0}
                            >
                                {resendIn > 0 ? `Resend OTP in ${resendIn}s` : "Resend OTP"}
                            </button>
                        </div>
                        <div className="sensitive-gate-actions">
                            <button type="button" className="sensitive-gate-btn secondary" onClick={handleCancel} disabled={loading}>
                                Cancel
                            </button>
                            <button type="submit" className="sensitive-gate-btn primary" disabled={loading}>
                                {loading ? "Verifying…" : "Unlock"}
                            </button>
                        </div>
                    </form>
                )}
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
