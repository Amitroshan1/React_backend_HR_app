import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import { useUser } from "../components/layout/UserContext";
import { setPlanContext } from "../utils/planFeatures";
import { clearLoginNotificationsFlag } from "../hooks/useFloatingNotifications";

import "./style/HeroSection.css";

export const HeroSection = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshUserData } = useUser();

  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState("identifier"); // identifier | otp
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [showLogin, setShowLogin] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const resendTimerRef = useRef(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setAnimate(false);
      setTimeout(() => setAnimate(true), 50);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const wasExpired = localStorage.getItem("sessionExpired");
    if (wasExpired === "1") {
      setShowLogin(true);
      setError("Session expired due to inactivity. Please login again.");
      localStorage.removeItem("sessionExpired");
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

  const startResendCooldown = (seconds = 60) => {
    setResendIn(seconds);
  };

  const handleRequestOtp = async () => {
    if (isSubmitting) return;
    const value = identifier.trim();
    if (!value) {
      setError("Please enter your email or phone number.");
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
        startResendCooldown(data.resend_after || 60);
        toast.success(data.message || "OTP sent");
        return;
      }

      setError(data.message || "Unable to send OTP. Please try again.");
      if (typeof data.retry_after === "number" && data.retry_after > 0) {
        startResendCooldown(data.retry_after);
      }
    } catch (err) {
      console.error(err);
      setError("Unable to send OTP. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (isSubmitting) return;
    const value = identifier.trim();
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
        clearLoginNotificationsFlag();
        localStorage.setItem("token", data.token);
        localStorage.setItem("lastActivityAt", String(Date.now()));
        setPlanContext(data.plan, data.features);
        await refreshUserData();
        toast.success("Login successful!");
        navigate("/dashboard", { replace: true });
        setError("");
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

  const handleEnterPress = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (step === "otp") {
      handleVerifyOtp();
    } else {
      handleRequestOtp();
    }
  };

  const handleChangeIdentifier = () => {
    setStep("identifier");
    setOtp("");
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
              Streamline Your Processes and Enhance Your team's Productivity.
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
              Enter your email or phone. We&apos;ll send a one-time OTP to sign you in.
            </p>

            {step === "identifier" ? (
              <>
                <input
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  placeholder="Email or phone"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  onKeyDown={handleEnterPress}
                />
                <p className="login-note">
                  Email OTP is available now. Phone OTP (SMS) is coming soon.
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
            ) : (
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
                    Change email / phone
                  </button>
                  <button
                    type="button"
                    className="forgot-btn"
                    onClick={handleRequestOtp}
                    disabled={isSubmitting || resendIn > 0}
                  >
                    {resendIn > 0 ? `Resend OTP in ${resendIn}s` : "Resend OTP"}
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
