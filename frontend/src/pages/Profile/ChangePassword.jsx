import React, { useState } from "react";

const HR_API_BASE = "/api/HumanResource";

const ChangePassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const validatePasswordStrength = (pwd) => {
    if (!pwd || pwd.length < 8) return "Password must be at least 8 characters long.";
    if (!/[A-Z]/.test(pwd)) return "Password must contain at least one uppercase letter.";
    if (!/[a-z]/.test(pwd)) return "Password must contain at least one lowercase letter.";
    if (!/[0-9]/.test(pwd)) return "Password must contain at least one number.";
    if (!/[!@#$%^&*()_\-+\[\]{};:'",.<>/?\\|]/.test(pwd))
      return "Password must contain at least one special character.";
    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setError("");

    if (!password || !confirmPassword) {
      setError("Please fill both password fields.");
      return;
    }
    if (password !== confirmPassword) {
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
    <div className="page-container">
      <h2>Change Password</h2>
      {message && <p style={{ color: "green" }}>{message}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      <form onSubmit={handleSubmit} className="simple-form">
        <div className="form-group">
          <label>New Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="form-group">
          <label>Confirm New Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? "Updating..." : "Update Password"}
        </button>
      </form>
    </div>
  );
};

export default ChangePassword;

