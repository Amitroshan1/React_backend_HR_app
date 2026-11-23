import { FiRefreshCw, FiShield, FiUser } from "react-icons/fi";
import "./ProfileStatusPanel.css";

export function classifyHomepageFailure(status, body = {}) {
    const code = body.error_code || (
        status === 401 ? "SESSION_EXPIRED"
            : status === 404 ? "USER_NOT_FOUND"
                : status ? "HOMEPAGE_UNAVAILABLE"
                    : "NETWORK_ERROR"
    );
    if (code === "SESSION_EXPIRED") {
        return {
            kind: "load_failed",
            code,
            contact: "admin",
            title: "Your session expired",
            reason: "Sign in again to load your name and employee details.",
            nextStep: "If you still cannot load your profile after signing in, report this to Admin.",
        };
    }
    if (code === "USER_NOT_FOUND") {
        return {
            kind: "load_failed",
            code,
            contact: "admin",
            title: "This account is not on the current system",
            reason: "Your login token does not match an employee in this environment.",
            nextStep: "Report this to Admin so they can check your account setup.",
        };
    }
    return {
        kind: "load_failed",
        code: code || "HOMEPAGE_UNAVAILABLE",
        contact: "admin",
        title: "Couldn’t load your profile",
        reason: "This is a system issue, not missing HR data. Your details could not be fetched.",
        nextStep: "Try again. If it stays blank, report this to Admin.",
    };
}

export function deriveProfileGaps(result) {
    if (Array.isArray(result?.profile_gaps) && result.profile_gaps.length) {
        return result.profile_gaps;
    }
    const user = result?.user || {};
    const leave = result?.leave_balance || {};
    const managers = result?.managers || {};
    const gaps = [];
    if (!(user.emp_id || user.empId || "").toString().trim()) {
        gaps.push({ key: "employee_id", label: "Employee ID" });
    }
    if (!user.doj && !result?.joining_info?.doj) {
        gaps.push({ key: "doj", label: "Date of joining" });
    }
    const pl = leave.pl;
    const cl = leave.cl;
    const leaveMissing = pl == null || cl == null || pl === "N/A" || cl === "N/A";
    if (leaveMissing) {
        gaps.push({ key: "leave_balance", label: "Leave balance" });
    }
    const hasManager = ["l1", "l2", "l3"].some((k) => managers[k]?.name);
    if (!hasManager) {
        gaps.push({ key: "manager", label: "Reporting manager" });
    }
    return gaps;
}

export function ProfileStatusPanel({ status, onRetry, retrying = false }) {
    if (!status || status.kind === "ok") return null;

    const isAdmin = status.contact === "admin";
    const ContactIcon = isAdmin ? FiShield : FiUser;

    return (
        <section
            className={`profile-status-panel profile-status-panel--${status.kind} profile-status-panel--${status.contact}`}
            role="status"
            aria-live="polite"
        >
            <div className="profile-status-panel__visual" aria-hidden="true">
                <span className="profile-status-panel__orb" />
                <span className="profile-status-panel__icon-wrap">
                    <ContactIcon size={26} />
                </span>
            </div>
            <div className="profile-status-panel__copy">
                <p className="profile-status-panel__kicker">
                    {isAdmin ? "System" : "HR setup"}
                </p>
                <h3>{status.title}</h3>
                <p className="profile-status-panel__reason">{status.reason}</p>
                {status.gaps?.length ? (
                    <ul className="profile-status-panel__gaps">
                        {status.gaps.map((gap) => (
                            <li key={gap.key || gap.label}>{gap.label}</li>
                        ))}
                    </ul>
                ) : null}
                <p className="profile-status-panel__next">{status.nextStep}</p>
                {status.kind === "load_failed" && onRetry ? (
                    <button
                        type="button"
                        className="profile-status-panel__retry"
                        onClick={onRetry}
                        disabled={retrying}
                    >
                        <FiRefreshCw className={retrying ? "is-spinning" : ""} size={16} />
                        {retrying ? "Checking again…" : "Try again"}
                    </button>
                ) : null}
            </div>
            <aside className="profile-status-panel__contact">
                <span className="profile-status-panel__contact-label">Report to</span>
                <strong>{isAdmin ? "Admin" : "HR"}</strong>
                <span className="profile-status-panel__contact-hint">
                    {isAdmin
                        ? "They can check your login and system access."
                        : "They can complete your employee record."}
                </span>
            </aside>
        </section>
    );
}
