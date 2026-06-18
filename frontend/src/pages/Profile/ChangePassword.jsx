import React, { useState, useMemo } from "react";
import { Eye, EyeOff } from "lucide-react";
import "./ChangePassword.css";
import PasswordRequirements from "../../components/PasswordRequirements";
import {
  canSubmitPasswordForm,
  passwordsMatch,
  validatePasswordStrength,
} from "../../utils/passwordValidation";

const HR_API_BASE = "/api/HumanResource";

const ChangePassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const formReady = useMemo(
    () => canSubmitPasswordForm(password, confirmPassword),
    [password, confirmPassword]
  );

  const confirmBorderClass = useMemo(() => {
    if (!confirmPassword) return "";
    return passwordsMatch(password, confirmPassword)
      ? "cp-input-match"
      : "cp-input-mismatch";
  }, [password, confirmPassword]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");

    if (!password || !confirmPassword) {
      setError("Please fill both password fields.");
      return;
    }
    if (!passwordsMatch(password, confirmPassword)) {
      setError("Passwords do not match.");
      return;
    }

    const strengthError = validatePasswordStrength(password);
    if (strengthError) {
      setError(strengthError);
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      setError("Please log in again to change your password.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${HR_API_BASE}/reset-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password, confirm_password: confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to update password");
      }
      setMessage("Password updated successfully.");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cp-dashboard-container">
      {message && <div className="cp-success">{message}</div>}
      {error && <div className="cp-error">{error}</div>}

      <div className="cp-card cp-form-card">
        <div className="cp-card-header">
          <h2 className="cp-section-title">Change Password</h2>
        </div>
        <div className="cp-card-body">
          <p className="cp-subtext">
            Enter your new password below. Requirements update as you type.
          </p>
          <form onSubmit={handleSubmit} className="cp-form">
            <div className="cp-form-group">
              <label className="cp-label" htmlFor="newPassword">New Password</label>
              <div className="cp-input-wrap">
                <input
                  id="newPassword"
                  className="cp-input"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Enter new password"
                />
                <button
                  type="button"
                  className="cp-eye-btn"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <Eye size={20} /> : <EyeOff size={20} />}
                </button>
              </div>
              <PasswordRequirements
                password={password}
                confirmPassword={confirmPassword}
                showMatch={false}
              />
            </div>
            <div className="cp-form-group">
              <label className="cp-label" htmlFor="confirmPassword">Confirm New Password</label>
              <div className="cp-input-wrap">
                <input
                  id="confirmPassword"
                  className={`cp-input ${confirmBorderClass}`.trim()}
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Confirm new password"
                />
                <button
                  type="button"
                  className="cp-eye-btn"
                  onClick={() => setShowConfirmPassword((s) => !s)}
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <Eye size={20} /> : <EyeOff size={20} />}
                </button>
              </div>
              {confirmPassword.length > 0 && (
                <PasswordRequirements
                  password={password}
                  confirmPassword={confirmPassword}
                  showRequirements={false}
                  showMatch
                />
              )}
            </div>
            <button type="submit" className="cp-btn-submit" disabled={loading || !formReady}>
              {loading ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChangePassword;
