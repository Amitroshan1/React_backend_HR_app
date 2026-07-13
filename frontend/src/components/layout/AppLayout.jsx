import { useEffect, useMemo, useRef } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
    hasFeature,
    clearPlanContext,
    isAdminUser,
    canAccessAccountPanel,
    canAccessItPanel,
    canAccessHrPanel,
} from "../../utils/planFeatures";
import { clearPersistedPanelViews } from "../../hooks/usePersistedView";
import { clearSensitiveToken } from "../../utils/sensitiveDataAuth";
import { AdminReturnBar } from "./AdminReturnBar";
import { Headers } from "../../pages/Headers"; // Adjust path as needed
import { useUser } from "./UserContext"; // Import the hook
import { AppFooter } from "./AppFooter";
import { useFloatingNotifications } from "../../hooks/useFloatingNotifications";
// import "../../pages/style/Dashboard.css"
import "../../pages/Dashboard/Dashboard.css"

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const ACTIVITY_KEY = "lastActivityAt";

// Normalize photo URL: strip /public prefix if present (Vite serves public files at root)
const normalizePhotoUrl = (url) => {
    if (!url) return url;
    return url.startsWith('/public/') ? url.replace('/public/', '/') : url;
};

export const AppLayout = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { userData, loadingUser, photoVersion, refreshUserData } = useUser();
    const prevPathRef = useRef(null);
    const hasToken = typeof window !== "undefined" && !!localStorage.getItem("token");

    useFloatingNotifications(hasToken && !loadingUser);

    /* Refresh shared user/leave balance when navigating between pages (skip initial load). */
    useEffect(() => {
        if (!hasToken) return;
        const path = location.pathname || "";
        const search = location.search || "";
        const routeKey = `${path}${search}`;
        if (prevPathRef.current !== null && prevPathRef.current !== routeKey) {
            refreshUserData();
        }
        prevPathRef.current = routeKey;
    }, [location.pathname, location.search, refreshUserData, hasToken]);

    useEffect(() => {
        const path = location.pathname || "";
        const user = userData?.user;
        if (path.startsWith("/account") && !canAccessAccountPanel(user)) {
            navigate("/dashboard", { replace: true });
            return;
        }
        if (path.startsWith("/it") && !canAccessItPanel(user)) {
            navigate("/dashboard", { replace: true });
            return;
        }
        if (path.startsWith("/hr") && !canAccessHrPanel(user)) {
            navigate("/dashboard", { replace: true });
            return;
        }
        if (
            (path === "/payslip"
                || path === "/tax-declaration"
                || path.startsWith("/tax-declaration/"))
            && !hasFeature("dashboard_payslip")
        ) {
            navigate("/dashboard", { replace: true });
        }
        if (path === "/claims" && !hasFeature("dashboard_claims")) {
            navigate("/dashboard", { replace: true });
        }
    }, [location.pathname, navigate, userData?.user]);

    /* No token: redirect to login immediately (direct URL, Back after logout) – no dashboard or loading state */
    useEffect(() => {
        if (!hasToken) {
            navigate("/", { replace: true });
        }
    }, [hasToken, navigate]);

    /* After login: if user presses Back and lands on login, performance, holiday, etc., send them to dashboard */
    useEffect(() => {
        const handlePopState = () => {
            const token = localStorage.getItem("token");
            if (!token) return;
            const path = window.location.pathname || "";
            const disallowedBackTargets = ["/", "", "/select_role", "/performance", "/holiday-calendar"];
            if (disallowedBackTargets.includes(path)) {
                navigate("/dashboard", { replace: true });
            }
        };
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, [navigate]);

    useEffect(() => {
        const logoutForInactivity = () => {
            localStorage.setItem("sessionExpired", "1");
            localStorage.removeItem("token");
            localStorage.removeItem(ACTIVITY_KEY);
            clearSensitiveToken();
            clearPlanContext();
            clearPersistedPanelViews();
            navigate("/");
        };

        const markActivity = () => {
            if (!localStorage.getItem("token")) return;
            localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
        };

        const checkInactivity = () => {
            const token = localStorage.getItem("token");
            if (!token) return;
            const raw = localStorage.getItem(ACTIVITY_KEY);
            const lastActivity = Number(raw);
            if (!raw || Number.isNaN(lastActivity) || Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS) {
                logoutForInactivity();
            }
        };

        // Enforce timeout immediately on refresh/open.
        checkInactivity();

        const activityEvents = ["click", "keydown", "mousemove", "scroll", "touchstart"];
        activityEvents.forEach((eventName) => {
            window.addEventListener(eventName, markActivity, { passive: true });
        });

        const intervalId = window.setInterval(checkInactivity, 15000);

        return () => {
            activityEvents.forEach((eventName) => {
                window.removeEventListener(eventName, markActivity);
            });
            window.clearInterval(intervalId);
        };
    }, [navigate]);

    // Safely get the username and emp_type from admins table data
    // Backend returns: user.name (display name: first_name / user_name / email prefix) and user.emp_type
    const username = userData.user?.name || userData.user?.first_name || userData.user?.user_name
        || (userData.user?.email ? userData.user.email.split("@")[0] : null) || "User";
    // Get emp_type from admins table (from backend /employee/homepage response)
    const empType = userData.user?.emp_type || userData.user?.department || "Employee";
    
    // Cache-bust profile picture URL when photo_url or photoVersion changes (photoVersion bumps on profile upload)
    const profilePicWithCache = useMemo(() => {
        const url = normalizePhotoUrl(userData.user?.photo_url);
        return url ? `${url}?v=${photoVersion}&t=${Date.now()}` : null;
    }, [userData.user?.photo_url, photoVersion]);

    /** Merge employee profile fields used by Headers for panel routing (emp_type alone may be "Super Admin"). */
    const headerUser = useMemo(
        () => ({
            ...userData.user,
            designation: userData.user?.designation ?? userData.employee?.designation ?? null,
        }),
        [userData.user, userData.employee]
    );

    /* Don't show any protected UI or loading when not authenticated */
    if (!hasToken) {
        return null;
    }

    if (loadingUser) {
        return (
           <div className="full-height-center">
            <h2 className="loader"></h2>
        </div>
        );
    }
    
    // Debug logging
    console.log("AppLayout Debug:", {
        userData: userData.user,
        username: username,
        empType: empType
    });
    const isInventoryPage = (location.pathname || "")
        .toLowerCase()
        .startsWith("/it/inventory");
    const isAdminShell = (location.pathname || "").startsWith("/admin");
    const adminDeptVisit =
        typeof sessionStorage !== "undefined"
        && sessionStorage.getItem("adminDeptVisit") === "1";
    const showAdminReturnBar =
        isAdminUser(headerUser) && adminDeptVisit && !isAdminShell;

    return (
        <div className="main-layout app-layout">
            {/* The Header now gets the username and full user object from the centralized context */}
            <Headers username={username} role={empType} user={headerUser} hasManagerAccess={userData.user?.has_manager_access} profilePic={profilePicWithCache} /> 
            
            <div className={`content-area${isInventoryPage ? " content-area--inventory" : ""}`}>
                <AdminReturnBar visible={showAdminReturnBar} />
                {/* Outlet renders the child routes: Dashboard, Attendance, etc. */}
                <Outlet />
                <AppFooter />
            </div>
        </div>
    );
};