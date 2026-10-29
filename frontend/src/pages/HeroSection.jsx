import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import { useUser } from "../components/layout/UserContext";
import { setPlanContext } from "../utils/planFeatures";
import { clearLoginNotificationsFlag } from "../hooks/useFloatingNotifications";
import { persistSessionTimeoutMinutes, SESSION_ENDED_KEY, TENANT_SUSPENDED_CODE } from "../utils/sessionTimeout";

import "./style/HeroSection.css";

export const HeroSection = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshUserData } = useUser();

  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("identifier"); // identifier | otp | tenant
  const [selectionToken, setSelectionToken] = useState("");
  const [tenantChoices, setTenantChoices] = useState([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setAnimate(false);
      setTimeout(() => setAnimate(true), 50);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const wasExpired = localStorage.getItem(SESSION_ENDED_KEY);
    if (wasExpired === "1") {
      setShowLogin(true);
      setError("Your session expired. Please login again.");
      localStorage.removeItem(SESSION_ENDED_KEY);
    } else if (wasExpired === TENANT_SUSPENDED_CODE) {
      setShowLogin(true);
      setError("Your company's account is suspended. Please contact your administrator.");
      localStorage.removeItem(SESSION_ENDED_KEY);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    const handlePopState = () => {
      const token = localStorage.getItem("token");
      const path = window.location.pathname || "";
      if (token && (path === "/" || path === "")) {
        navigate("/dashboard", { replace: true });
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [navigate]);

  useEffect(() => {
    const path = location.pathname || "";
    if ((path === "/" || path === "") && localStorage.getItem("token")) {
      navigate("/dashboard", { replace: true });
    }
  }, [location.pathname, navigate]);

  const handleRequestOtp = async () => {
    if (isSubmitting) return;
    const value = identifier.replace(/\s+/g, "").trim();
    if (!value) {
      setError("Please enter your email.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    setInfo("");

    try {
      const res = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: value }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.success) {
        setStep("otp");
        setOtp("");
        setInfo(data.message || "OTP sent. Please check your email.");
        toast.success(data.message || "OTP sent");
        return;
      }

      setError(data.message || "Unable to send OTP. Please try again.");
    } catch (err) {
      console.error(err);
      setError("Unable to send OTP. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (isSubmitting) return;
    const value = identifier.replace(/\s+/g, "").trim();
    const code = otp.trim();
    if (!value || !code) {
      setError("Please enter the OTP sent to you.");
      return;
    }
    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: value, otp: code }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.success && data.token) {
        await completeLogin(data);
        return;
      }

      if (data.success && data.requires_tenant_selection) {
        setSelectionToken(data.selection_token || "");
        setTenantChoices(data.tenants || []);
        setInfo(data.message || "Select the company you want to sign in to.");
        setStep("tenant");
        return;
      }

      setError(data.message || "Invalid OTP. Please try again.");
    } catch (err) {
      console.error(err);
      setError("Unable to verify OTP. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const completeLogin = async (data) => {
    clearLoginNotificationsFlag();
    localStorage.setItem("token", data.token);
    localStorage.setItem("lastActivityAt", String(Date.now()));
    persistSessionTimeoutMinutes(data.session_timeout_minutes);
    setPlanContext(data.plan, data.features, {
      is_platform_super_admin: data.is_platform_super_admin,
    });
    await refreshUserData({ force: true });
    toast.success("Login successful!");
    navigate("/dashboard", { replace: true });
    setError("");
  };

  const handleSelectTenant = async (tenantId) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/auth/select-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection_token: selectionToken, tenant_id: tenantId }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.success && data.token) {
        await completeLogin(data);
        return;
      }

      if (res.status === 401) {
        handleChangeIdentifier();
      }
      setError(data.message || "Unable to sign in to this company. Please try again.");
    } catch (err) {
      console.error(err);
      setError("Unable to sign in to this company. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEnterPress = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (step === "tenant") return;
    if (step === "otp") {
      handleVerifyOtp();
    } else {
      handleRequestOtp();
    }
  };

  const handleChangeIdentifier = () => {
    setStep("identifier");
    setOtp("");
    setSelectionToken("");
    setTenantChoices([]);
    setError("");
    setInfo("");
  };

  if (typeof window !== "undefined" && localStorage.getItem("token")) {
    return null;
  }

  return (
    <div className="index-container">
      <div className="background-elements">
        <div className="bg-circle-1" />
        <div className="bg-circle-2" />
      </div>

      <main className="main-content">
        <div className={`hero-container ${showLogin ? "shift-left" : ""}`}>
          <div className="hero-text-block">
            <h1 className={`hero-title ${animate ? "animate-typewriter" : ""}`}>
              SaffoPeople
            </h1>

            <p className="hero-subtitle animate-reveal" style={{ animationDelay: "1.5s" }}>
              Unlock Your Potential with our Innovative Platform
            </p>

            <p className="hero-description animate-reveal" style={{ animationDelay: "2s" }}>
              Streamline Your Processes and Enhance Your team&apos;s Productivity.
            </p>

            <div className="cta-section animate-fade-in-up">
              <p className="log-text">Ready to get started?</p>

              <button className="cta-button" onClick={() => setShowLogin(true)}>
                Explore
              </button>
            </div>
          </div>

          <div className={`login-card ${showLogin ? "slide-in" : ""}`}>
            <h2 className="login-text">Login</h2>
            <p className="login-hint">
              Enter your registered email. We&apos;ll send a one-time OTP to sign you in.
            </p>

            {step === "identifier" ? (
              <>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="Email"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  onKeyDown={handleEnterPress}
                />
                <p className="login-note">
                  We&apos;ll send an OTP to your email.
                </p>
                {error && <p className="login-error">{error}</p>}
                <button
                  className="login-submit"
                  onClick={handleRequestOtp}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Sending OTP..." : "Send OTP"}
                </button>
              </>
            ) : step === "otp" ? (
              <>
                <p className="login-info">{info || "Enter the OTP sent to your email."}</p>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="Enter OTP"
                  value={otp}
                  maxLength={8}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={handleEnterPress}
                />
                {error && <p className="login-error">{error}</p>}
                <div className="forgot-wrap">
                  <button
                    type="button"
                    className="forgot-btn"
                    onClick={handleChangeIdentifier}
                    disabled={isSubmitting}
                  >
                    Change email
                  </button>
                  <button
                    type="button"
                    className="forgot-btn"
                    onClick={handleRequestOtp}
                    disabled={isSubmitting}
                  >
                    Resend OTP
                  </button>
                </div>
                <button
                  className="login-submit"
                  onClick={handleVerifyOtp}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Verifying..." : "Verify & Login"}
                </button>
              </>
            ) : (
              <>
                <p className="login-info">{info || "Select the company you want to sign in to."}</p>
                <div className="login-tenant-list" role="list">
                  {tenantChoices.map((t) => (
                    <button
                      key={t.tenant_id}
                      type="button"
                      role="listitem"
                      className="login-tenant-option"
                      onClick={() => handleSelectTenant(t.tenant_id)}
                      disabled={isSubmitting}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                {error && <p className="login-error">{error}</p>}
                <div className="forgot-wrap">
                  <button
                    type="button"
                    className="forgot-btn"
                    onClick={handleChangeIdentifier}
                    disabled={isSubmitting}
                  >
                    Use a different email
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="feature-cards">
          <div className="feature-card">
            <div className="feature-icon">⚡</div>
            <h3>Fast & Efficient</h3>
            <p>Streamline your HR processes with our intuitive platform</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">🔒</div>
            <h3>Secure & Reliable</h3>
            <p>Your data is protected with enterprise-grade security</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">📊</div>
            <h3>Insightful Analytics</h3>
            <p>Make data-driven decisions with comprehensive reports</p>
          </div>
        </div>
      </main>
    </div>
  );
};
