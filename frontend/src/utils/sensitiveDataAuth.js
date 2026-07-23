const SENSITIVE_TOKEN_KEY = "sensitive_token";
const SENSITIVE_EXPIRES_KEY = "sensitive_token_expires";
const SENSITIVE_AUTH_CODE = "SENSITIVE_AUTH_REQUIRED";
const AUTH_API = "/api/auth";

export function getSensitiveToken() {
    const token = sessionStorage.getItem(SENSITIVE_TOKEN_KEY);
    if (!token) return null;
    const expiresRaw = sessionStorage.getItem(SENSITIVE_EXPIRES_KEY);
    const expiresAt = Number(expiresRaw);
    if (!expiresRaw || Number.isNaN(expiresAt) || Date.now() >= expiresAt) {
        clearSensitiveToken();
        return null;
    }
    return token;
}

export function setSensitiveToken(token, expiresInSeconds = 600) {
    if (!token) {
        clearSensitiveToken();
        return;
    }
    const ttlMs = Math.max(60, Number(expiresInSeconds) || 900) * 1000;
    sessionStorage.setItem(SENSITIVE_TOKEN_KEY, token);
    sessionStorage.setItem(SENSITIVE_EXPIRES_KEY, String(Date.now() + ttlMs));
}

export function clearSensitiveToken() {
    sessionStorage.removeItem(SENSITIVE_TOKEN_KEY);
    sessionStorage.removeItem(SENSITIVE_EXPIRES_KEY);
}

export function isSensitiveSessionValid() {
    return Boolean(getSensitiveToken());
}

export function authHeaders(extra = {}) {
    const headers = { ...extra };
    const token = localStorage.getItem("token");
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const sensitiveToken = getSensitiveToken();
    if (sensitiveToken) {
        headers["X-Sensitive-Token"] = sensitiveToken;
    }
    return headers;
}

function applySensitiveSession(data) {
    if (data?.sensitive_token) {
        setSensitiveToken(data.sensitive_token, data.expires_in);
    }
    return data;
}

/** Request email OTP to unlock payslip/tax. All roles must verify OTP. */
export async function requestSensitiveOtp() {
    const res = await fetch(`${AUTH_API}/sensitive/request-otp`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
        const err = new Error(data.message || "Could not send OTP");
        err.retryAfter = data.retry_after;
        throw err;
    }
    return data;
}

/** Verify OTP and store sensitive session token. */
export async function verifySensitiveOtp(otp) {
    const res = await fetch(`${AUTH_API}/sensitive/verify-otp`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ otp }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
        throw new Error(data.message || "OTP verification failed");
    }
    return applySensitiveSession(data);
}

export async function revokeSensitiveSession() {
    clearSensitiveToken();
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
        await fetch(`${AUTH_API}/sensitive/revoke`, {
            method: "POST",
            headers: authHeaders(),
        });
    } catch {
        /* ignore */
    }
}

export function isSensitiveAuthError(payload) {
    return payload?.code === SENSITIVE_AUTH_CODE;
}

export { SENSITIVE_AUTH_CODE };
