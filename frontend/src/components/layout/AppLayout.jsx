import { useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Headers } from "../../pages/Headers"; // Adjust path as needed
import { useUser } from "./UserContext"; // Import the hook
// import "../../pages/style/Dashboard.css"
import "../../pages/Dashboard/Dashboard.css"

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const ACTIVITY_KEY = "lastActivityAt";

/* Scroll to top when route changes so each page opens from the beginning */
const ScrollToTop = () => {
    const { pathname } = useLocation();
    useEffect(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }, [pathname]);
    return null;
};

export const AppLayout = () => {
    const navigate = useNavigate();
    const { userData, loadingUser } = useUser();

    /* After login: disable Back – if user presses Back and lands on login, performance, holiday, etc., send them to dashboard */
    useEffect(() => {
        const handlePopState = () => {
            const token = localStorage.getItem("token");
            if (!token) return;
            const path = window.location.pathname || "";
            const disallowedBackTargets = ["/", "", "/select_role", "/performance", "/holiday-calendar", "/payslip"];
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
    
    if (loadingUser) {
        return (
           <div className="full-height-center">
            <h2 className="loader"></h2>
        </div>
        );
    }
    
    // Safely get the username and emp_type from admins table data
    // Backend returns: user.name (display name: first_name / user_name / email prefix) and user.emp_type
    const username = userData.user?.name || userData.user?.first_name || userData.user?.user_name
        || (userData.user?.email ? userData.user.email.split("@")[0] : null) || "User";
    // Get emp_type from admins table (from backend /employee/homepage response)
    const empType = userData.user?.emp_type || userData.user?.department || "Employee";
    
    // Debug logging
    console.log("AppLayout Debug:", {
        userData: userData.user,
        username: username,
        empType: empType
    });
    return (
        <div className="main-layout">
            <ScrollToTop />
            {/* The Header now gets the username from the centralized context */}
            <Headers username={username} role={empType} hasManagerAccess={userData.user?.has_manager_access} /> 
            
            <div className="content-area" style={{ paddingTop: "24px" }}>
                {/* Outlet renders the child routes: Dashboard, Attendance, etc. */}
                <Outlet />
            </div>
        </div>
    );
};