// import { useState, useRef, useEffect } from "react";
// import { useLocation, Link, useNavigate } from 'react-router-dom';
// import { FaBell, FaChevronDown, FaUser, FaSignOutAlt, FaBriefcase } from "react-icons/fa";
// import "./style/Headers.css";

// const getPageInfo = (pathname, firstName) => {
//     const normalizedPath = pathname.toLowerCase();
//     const pathMap = {
//         '/dashboard': { title: `Welcome, ${firstName}!`, subtitle: "Overview", isDashboard: true },
//         '/attendance': { title: 'Attendance', subtitle: 'Manage records' },
//         '/leaves': { title: 'Leaves', subtitle: 'Apply/Check balance' },
//         '/hr': { title: 'HR Panel', subtitle: 'Administration' },
//         '/account': { title: 'Accounts Panel', subtitle: 'Financial Management' },
//         '/admin': { title: 'Admin Panel', subtitle: 'Admin Management' },
//     };
//     return pathMap[normalizedPath] || { title: 'Page', subtitle: '' };
// };

// export const Headers = ({ username, role }) => {
//     const [isDropdownOpen, setIsDropdownOpen] = useState(false);
//     const dropdownRef = useRef(null);
//     const location = useLocation();
//     const navigate = useNavigate();
    
//     const firstName = username ? username.split(' ')[0] : 'User';

//     // 1. Normalize role for logic comparison
//     // This ensures "Human Resource" from DB matches "human resource" in code
//     const rawRole = role ? role.trim() : "Employee";
//     const roleKey = rawRole.toLowerCase();

//     const { title, subtitle, isDashboard } = getPageInfo(location.pathname, firstName);

//     // 2. Define special roles (must be lowercase to match roleKey)
//     const specialRoles = ["human resource", "manager", "account", "it", "pmp", "admin"];
//     const isSpecialRole = specialRoles.includes(roleKey);

//     useEffect(() => {
//         const handleClickOutside = (e) => {
//             if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsDropdownOpen(false);
//         };
//         document.addEventListener("mousedown", handleClickOutside);
//         return () => document.removeEventListener("mousedown", handleClickOutside);
//     }, []);

//     return (
//         <div className="header-container">
//             <div className="header-left">
//                 <h1 className={`welcome-title ${!isDashboard ? 'page-title-style' : ''}`}>{title}</h1>
//                 {isDashboard && <p className="overview-text">{subtitle}</p>}
//             </div>

//             <div className="header-right">
//                 <div className="notification">
//                     <FaBell className="bell-icon" />
//                     <span className="badge">3</span>
//                 </div>
//                 <div className="divider"></div>

//                 <div className="user-profile-wrapper" ref={dropdownRef}>
//                     <div className="user-profile" onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
//                         <img src="https://picsum.photos/id/1005/38/38" alt="User" className="user-avatar-img" />
//                         <div className="user-info">
//                             <p className="user-name">{firstName}</p>
//                             {/* Dynamically shows "Human Resource" exactly as in DB */}
//                             <p className="user-role">{rawRole}</p> 
//                         </div>
//                         <FaChevronDown className={`dropdown-arrow ${isDropdownOpen ? 'open' : ''}`} />
//                     </div>

//                     {isDropdownOpen && (
//                         <div className="profile-dropdown-card">
//                             <div className="dropdown-header">
//                                 <p className="d-name">{username}</p>
//                                 <p className="d-role">{rawRole}</p>
//                             </div>
//                             <div className="dropdown-divider"></div>
                            
//                             <Link to="/profile" className="dropdown-item" onClick={() => setIsDropdownOpen(false)}>
//                                 <FaUser className="d-icon" /> Profile
//                             </Link>

//                             {/* DYNAMIC PANEL LINK */}
//                             {isSpecialRole && (
//                                 <Link 
//                                     to={roleKey === "human resource" ? "/hr" : `/${roleKey.replace(/\s+/g, '-')}`} 
//                                     className="dropdown-item"
//                                     onClick={() => setIsDropdownOpen(false)}
//                                 >
//                                     <FaBriefcase className="d-icon" /> {rawRole} Panel
//                                 </Link>
//                             )}

//                             <div className="dropdown-divider"></div>
//                             <button onClick={() => { localStorage.removeItem('token'); navigate('/login'); }} className="dropdown-item logout-btn">
//                                 <FaSignOutAlt className="d-icon" /> Logout
//                             </button>
//                         </div>
//                     )}
//                 </div>
//             </div>
//         </div>
//     );
// };














import { useState, useRef, useEffect } from "react";
import { useLocation, Link, NavLink, useNavigate } from 'react-router-dom';
import { toast } from "react-toastify";
import { clearLoginNotificationsFlag } from "../hooks/useFloatingNotifications";
import { FaChevronDown, FaUser, FaSignOutAlt, FaBriefcase, FaHandshake, FaHome, FaChartLine, FaCalendarAlt, FaFileAlt } from "react-icons/fa";
import "./style/Headers.css";
import { clearPlanContext, canAccessItPanel, canAccessHrPanel, canAccessAccountPanel, canAccessFinancePanel, isAdminUser, isCompanyAdmin, isPlatformSuperAdmin } from "../utils/planFeatures";
import { clearPersistedPanelViews } from "../hooks/usePersistedView";
import { clearSensitiveToken } from "../utils/sensitiveDataAuth";
import { clearClientPrivacyCaches } from "../utils/clientPrivacy";
import { clearAccessCookie, clearAccessToken, getAccessToken, hasSignedInHint } from "../utils/authSession";
import { DEPARTMENT_TITLES, getPanelLinkLabel } from "../utils/departmentLabels";
import { isAdminDepartmentPath } from "./Admin/adminVisit";

const getPageInfo = (pathname, firstName) => {
    const normalizedPath = (pathname || "").toLowerCase().replace(/\/$/, "") || "/";

    if (normalizedPath.startsWith("/it/inventory")) {
        const segment = normalizedPath.replace(/^\/it\/inventory\/?/, "").split("/")[0] || "";
        const inventorySubtitles = {
            "not-working": "Not Working",
            "in-repair": "In Repair",
            "removed-it": "Removed From IT",
            "removed-assets": "Dead Assets",
            parcels: "Import/Export",
            "add-assets": "Add Assets",
            "add-import": "Import",
            "ready-export": "Export",
            total: "All Assets",
        };
        return {
            title: DEPARTMENT_TITLES.inventory,
            subtitle: inventorySubtitles[segment] || "Asset Management",
        };
    }

    if (normalizedPath.startsWith("/tax-declaration/history/")) {
        return {
            title: "Declaration Details",
            subtitle: "Full view of your submitted tax saving declaration",
        };
    }

    const pathMap = {
        '/dashboard': { title: firstName ? `Welcome, ${firstName}!` : 'Welcome', subtitle: "Overview", isDashboard: true },
        '/attendance': { title: 'Attendance', subtitle: 'Manage records' },
        '/leaves': { title: 'Leaves', subtitle: 'Apply/Check balance' },
        '/leaves/comp-off': { title: 'Comp Off Details', subtitle: 'Credits, expiry and usage history' },
        '/queries': { title: 'Raise a Query', subtitle: 'Track and manage your support requests' },
        '/queries/inbox': { title: 'Department Query Inbox', subtitle: 'Reply to queries assigned to your department' },
        '/claims': { title: 'Expense Claims', subtitle: 'Submit and track your claims' },
        '/separation': { title: 'Separation', subtitle: 'Resignation and clearance process' },
        '/noc-application': { title: 'Apply for NOC', subtitle: 'Request exit clearance or a bonafide letter' },
        '/payslip': { title: 'Payslip', subtitle: 'View and download payslips' },
        '/tax-declaration': { title: 'Tax Declaration', subtitle: 'Submit your tax investment declaration for the financial year' },
        '/tax-declaration/final-proof': { title: 'Year-end Final Proof', subtitle: 'Enter actual amounts and upload proof documents' },
        '/tax-declaration/history': { title: 'Declaration History', subtitle: 'View your past tax saving declarations' },
        '/tax-declaration/form16': { title: 'Form 16', subtitle: 'Download your Form 16 certificates' },
        '/tax-declaration/tax-projection': { title: 'Tax Projection', subtitle: 'Estimated TDS for the financial year' },
        '/profile': { title: 'Profile', subtitle: 'Your personal and employment details' },
        '/holiday-calendar': { title: 'Holiday Calendar', subtitle: 'Company holiday list by year' },
        '/performance': { title: 'Performance', subtitle: 'Self review and manager feedback' },
        '/wfh': { title: 'Work From Home', subtitle: 'WFH requests and approvals' },
        '/hr': { title: DEPARTMENT_TITLES.hr, subtitle: 'Administration' },
        '/account': { title: DEPARTMENT_TITLES.account, subtitle: 'Financial Management' },
        '/finance': { title: DEPARTMENT_TITLES.finance, subtitle: 'Payroll control and payouts' },
        '/admin': { title: DEPARTMENT_TITLES.admin, subtitle: 'Organization Control' },
        '/admin/leaves': { title: 'All Leave Applications', subtitle: DEPARTMENT_TITLES.admin },
        '/admin/queries': { title: 'All Queries', subtitle: DEPARTMENT_TITLES.admin },
        '/admin/claims': { title: 'All Expense Claims', subtitle: DEPARTMENT_TITLES.admin },
        '/admin/resignations': { title: 'All Resignations', subtitle: DEPARTMENT_TITLES.admin },
        '/it/inventory': { title: DEPARTMENT_TITLES.inventory, subtitle: 'Asset Management' },
        '/manager': { title: 'Manager Panel', subtitle: 'Team Management' },
        '/manager/performance-reviews': { title: 'Performance Review Queue', subtitle: 'Review team self-assessments' },
        '/it': { title: DEPARTMENT_TITLES.it, subtitle: 'System Administration & Support' },
        '/it/daily-checkout': { title: 'Loan assets', subtitle: 'Hardware loan checkout' },
        '/it/repair-bills': { title: 'Repair Bill', subtitle: 'Repair work and bills' },
        '/daily-assets': { title: 'Loan assets', subtitle: 'Request hardware on loan' },
    };

    if (pathMap[normalizedPath]) return pathMap[normalizedPath];

    if (normalizedPath.startsWith("/it/employee/")) {
        return { title: "" };
    }

    if (normalizedPath.startsWith("/it/")) {
        return { title: DEPARTMENT_TITLES.it, subtitle: "System Administration & Support" };
    }

    if (normalizedPath.startsWith("/hr/")) {
        return { title: DEPARTMENT_TITLES.hr, subtitle: "Administration" };
    }

    if (normalizedPath.startsWith("/account/")) {
        return { title: DEPARTMENT_TITLES.account, subtitle: "Financial Management" };
    }

    if (normalizedPath.startsWith("/finance")) {
        return { title: DEPARTMENT_TITLES.finance, subtitle: "Payroll control and payouts" };
    }

    if (normalizedPath.startsWith("/admin/")) {
        return { title: DEPARTMENT_TITLES.admin, subtitle: "Organization Control" };
    }

    if (normalizedPath === "/employees" || normalizedPath.startsWith("/employees/")) {
        return { title: DEPARTMENT_TITLES.admin, subtitle: "Employee directory" };
    }

    if (normalizedPath.startsWith("/employee/")) {
        return { title: DEPARTMENT_TITLES.admin, subtitle: "Employee details" };
    }

    if (normalizedPath.startsWith("/archive-employees")) {
        return { title: DEPARTMENT_TITLES.admin, subtitle: "Employee archive" };
    }

    if (normalizedPath.startsWith("/exit-employees")) {
        return { title: DEPARTMENT_TITLES.admin, subtitle: "Exit employees" };
    }

    return { title: "Portal", subtitle: "" };
};

export const Headers = ({ username, role, profilePic, hasManagerAccess, user, profileUnavailable }) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [queryUnreadCount, setQueryUnreadCount] = useState(0);
    const dropdownRef = useRef(null);
    const location = useLocation();
    const navigate = useNavigate();
    
    // Normalize Data
    const firstName = username ? username.split(' ')[0] : (profileUnavailable ? '' : 'there');
    const rawRole = role || "Employee";
    const roleKey = rawRole.toLowerCase().trim();

    const pageInfo = getPageInfo(location.pathname, firstName);
    const pathLower = (location.pathname || "").toLowerCase();
    let adminDeptVisit = false;
    try {
        adminDeptVisit = sessionStorage.getItem("adminDeptVisit") === "1";
    } catch {
        adminDeptVisit = false;
    }
    const isAccountPath = pathLower === "/account" || pathLower.startsWith("/account/");
    // Any page opened via Admin / Command Center uses Admin Management (not "Portal")
    // Account workspace always keeps Accounts Management, even after an Admin visit.
    const forceAdminManagementTitle =
        !isAccountPath
        && (
            pathLower.startsWith("/admin")
            || pathLower.startsWith("/employees")
            || pathLower.startsWith("/employee/")
            || pathLower.startsWith("/archive-employees")
            || pathLower.startsWith("/exit-employees")
            || (adminDeptVisit && isAdminDepartmentPath(location.pathname))
        );

    const title = forceAdminManagementTitle
        ? DEPARTMENT_TITLES.admin
        : pageInfo.title;
    const { subtitle, isDashboard } = pageInfo;

    // Badge + primary panel from emp_type only. Job title must not relabel Super Admin as Account.
    const getRoleInfo = (role, user) => {
        const roleMap = {
            hr: { display: "HR", route: "/hr", hasPanel: true },
            "human resource": { display: "HR", route: "/hr", hasPanel: true },
            "human resources": { display: "HR", route: "/hr", hasPanel: true },

            manager: { display: "Manager", route: "/manager", hasPanel: true },
            managers: { display: "Manager", route: "/manager", hasPanel: true },

            account: { display: "Account", route: "/account", hasPanel: true },
            accounts: { display: "Account", route: "/account", hasPanel: true },
            accountant: { display: "Account", route: "/account", hasPanel: true },

            finance: { display: "Finance", route: "/finance", hasPanel: true },
            "finance department": { display: "Finance", route: "/finance", hasPanel: true },
            "finance team": { display: "Finance", route: "/finance", hasPanel: true },

            it: { display: "IT", route: "/it", hasPanel: true },
            "information technology": { display: "IT", route: "/it", hasPanel: true },

            admin: { display: "Admin", route: "/admin", hasPanel: true },
            administrator: { display: "Admin", route: "/admin", hasPanel: true },
            administration: { display: "Admin", route: "/admin", hasPanel: true },
            "super admin": { display: "Super Admin", route: "/admin", hasPanel: true },
            superadmin: { display: "Super Admin", route: "/admin", hasPanel: true },
            "platform super admin": { display: "Super Admin", route: "/admin", hasPanel: true },
        };

        const primary = String(user?.emp_type || role || "").trim();
        const normalized = primary.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

        if (normalized.includes("super admin") || normalized === "superadmin") {
            return { display: "Super Admin", route: "/admin", hasPanel: true };
        }
        if (["admin", "administrator", "administration"].includes(normalized)) {
            return { display: "Admin", route: "/admin", hasPanel: true };
        }

        const exact = roleMap[normalized];
        if (exact) return exact;

        if (/\bhuman\s+resources?\b/.test(normalized) || normalized === "hr" || normalized.startsWith("hr ")) {
            return { display: "HR", route: "/hr", hasPanel: true };
        }
        if (normalized === "it" || normalized === "it department" || normalized === "information technology") {
            return { display: "IT", route: "/it", hasPanel: true };
        }
        if (normalized === "account" || normalized.startsWith("account")) {
            return { display: "Account", route: "/account", hasPanel: true };
        }
        if (normalized === "finance" || normalized.startsWith("finance ") || normalized.includes("finance")) {
            return { display: "Finance", route: "/finance", hasPanel: true };
        }

        return { display: primary || "Employee", route: null, hasPanel: false };
    };

    const roleInfo = getRoleInfo(rawRole, user);
    // Header "Query" opens the department inbox for HR / Accounts / IT.
    const queryShortcutAllowed = (() => {
        const display = roleInfo.display?.toLowerCase();
        if (["hr", "account", "accounts", "it"].includes(display)) return true;
        const candidates = [user?.emp_type, user?.designation, user?.department, rawRole].filter(Boolean);
        return candidates.some((c) =>
            /\bhuman\s+resources?\b|\bhr\b|\baccounts?\b|\baccountant\b|\bit\s+department\b|\binformation\s+technology\b|(^|\s)it(\s|$)|inventory/i.test(
                String(c)
            )
        );
    })();
    const showManagerPanel = hasManagerAccess === true || ["manager", "managers"].includes(roleKey);
    const isOrgWideAdmin = isCompanyAdmin(user) || isPlatformSuperAdmin(user);
    const isSuperAdmin = isPlatformSuperAdmin(user);

    const panelRouteAllowed = (route) => {
        if (isOrgWideAdmin) return true;
        if (route === "/hr") return canAccessHrPanel(user);
        if (route === "/account") return canAccessAccountPanel(user);
        if (route === "/finance") return canAccessFinancePanel(user);
        if (route === "/it" || route === "/it/inventory") return canAccessItPanel(user);
        return true;
    };

    const panelLinks = [];
    const isItPrimaryRole = roleInfo.display?.toLowerCase() === "it";
    if (isAdminUser(user)) {
        panelLinks.push({ display: "Admin", route: "/admin" });
    }
    if (!isOrgWideAdmin) {
        if (roleInfo.hasPanel && roleInfo.route && roleInfo.route !== "/admin" && panelRouteAllowed(roleInfo.route)) {
            panelLinks.push({ display: roleInfo.display, route: roleInfo.route });
        }
        // Inventory Management — IT only, directly below IT Management
        if (
            canAccessItPanel(user) &&
            !panelLinks.some((p) => p.route === "/it/inventory")
        ) {
            const invLink = { display: "Inventory", route: "/it/inventory" };
            const itIdx = panelLinks.findIndex((p) => p.route === "/it");
            if (itIdx >= 0) {
                panelLinks.splice(itIdx + 1, 0, invLink);
            } else if (isItPrimaryRole) {
                panelLinks.push(invLink);
            }
        }
        if (showManagerPanel && !panelLinks.some((p) => p.route === "/manager")) {
            panelLinks.push({ display: "Manager", route: "/manager" });
        }
    }
    const isSpecialRole = panelLinks.length > 0;

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsDropdownOpen(false);
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        let isMounted = true;
        let timerId = null;
        const fetchUnreadCount = async () => {
            const token = getAccessToken();
            if (!token && !hasSignedInHint()) return;
            if (typeof document !== "undefined" && document.visibilityState !== "visible") {
                return;
            }
            try
             {
                const response = await fetch("/api/notifications/unread-count",
                     {
                    method: "GET",
                    credentials: "include",
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                if (!response.ok) {
                    const body = await response.text();
                    console.error("Notification count fetch failed:", response.status, body);
                    return;
                }
                let result;
                try {
                    result = await response.json();
                } catch (err) {
                    console.error("Notification count parse error:", err);
                    return;
                }
                if (isMounted && result && result.success) {
                    setQueryUnreadCount(Number(result.query_unread_count || 0));
                }
            } catch (error) {
                console.error("Notification count error:", error);
            }
        };

        fetchUnreadCount();
        timerId = window.setInterval(fetchUnreadCount, 30000);
        const onQueryNotificationsUpdated = () => {
            fetchUnreadCount();
        };
        const onVisibility = () => {
            if (document.visibilityState === "visible") fetchUnreadCount();
        };
        window.addEventListener("queryNotificationsUpdated", onQueryNotificationsUpdated);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            isMounted = false;
            if (timerId) window.clearInterval(timerId);
            window.removeEventListener("queryNotificationsUpdated", onQueryNotificationsUpdated);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, []);

    const handleLogout = () => {
        toast.info("Logged out successfully");
        clearLoginNotificationsFlag();
        localStorage.removeItem('token');
        localStorage.removeItem('lastActivityAt');
        clearAccessToken();
        clearSensitiveToken();
        clearPlanContext();
        clearClientPrivacyCaches();
        clearPersistedPanelViews();
        void clearAccessCookie();
        navigate('/');
    };

const defaultAvatar = `https://ui-avatars.com/api/?name=${username}&background=2563eb&color=fff`;
    const userAvatar = profilePic || defaultAvatar;

    const isBellDisabled = queryUnreadCount === 0;

    const handleQueryShortcutClick = () => {
        if (!queryShortcutAllowed) return;
        navigate("/queries/inbox?from=notification");
    };

    return (
        <header className="header-container">
            <div className="header-content">
                <div className="header-left">
                    {!isDashboard && !isOrgWideAdmin && (
                        <button
                            className="home-logo-btn"
                            onClick={() => navigate('/dashboard')}
                            title="Go to Dashboard"
                            aria-label="Go to Dashboard"
                        >
                            <FaHome />
                        </button>
                    )}
                    {isDashboard ? (
                        <h1 className="welcome-title welcome-title--dash" title={firstName || undefined}>
                            <span className="welcome-title__prefix">Welcome{firstName ? ',' : ''}</span>
                            {firstName ? <span className="welcome-title__name">{firstName}</span> : null}
                            {firstName ? <span className="welcome-title__bang">!</span> : null}
                        </h1>
                    ) : title ? (
                        <h1 className="welcome-title page-heading" title={title}>{title}</h1>
                    ) : null}
                </div>

                <div className="header-right">
                    {queryShortcutAllowed && (
                        <button
                            type="button"
                            className={`query-shortcut-btn ${isBellDisabled ? "disabled" : ""}`}
                            title="New queries awaiting your department's first response"
                            onClick={handleQueryShortcutClick}
                        >
                            Query
                            {queryUnreadCount > 0 && (
                                <span className="badge">{queryUnreadCount > 99 ? "99+" : queryUnreadCount}</span>
                            )}
                        </button>
                    )}
                    
                    {queryShortcutAllowed && (
                        <div className="divider"></div>
                    )}

                    {isSuperAdmin ? (
                        <button type="button" className="header-logout-btn" onClick={handleLogout}>
                            <FaSignOutAlt /> <span>Logout</span>
                        </button>
                    ) : (
                    <div className="user-profile-wrapper" ref={dropdownRef}>
                        <div className="user-profile" onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
                            <div className="avatar-container">
                                {/* <img src="" alt="User" className="user-avatar-img" /> */}
                                <img 
                                    src={userAvatar} 
                                    alt="User Profile" 
                                    className="user-avatar-img"
                                    onError={(e) => { e.target.src = defaultAvatar; }} // Extra safety
                                />
                            </div>
                            <div className="user-info hide-mobile">
                                <p className="user-name" title={username || firstName || 'Profile'}>{firstName || 'Profile'}</p>
                                <p className="user-role" title={roleInfo.display || rawRole}>{roleInfo.display || rawRole}</p> 
                            </div>
                            <FaChevronDown className={`dropdown-arrow ${isDropdownOpen ? 'open' : ''}`} />
                        </div>

                        {isDropdownOpen && (
                            <div className="profile-dropdown-card">
                                <div className="dropdown-header">
                                    <p className="d-full-name">{username || (profileUnavailable ? 'Profile' : 'Full Name')}</p>
                                    <p className="d-role-label">{roleInfo.display || rawRole}</p>
                                </div>
                                <div className="dropdown-divider"></div>
                                
                                {/* Role-specific Panel Links - HR, Manager, Account, IT, Admin (all that apply) */}
                                {isSpecialRole && panelLinks.map((item) => (
                                    <NavLink
                                        key={item.route}
                                        to={item.route}
                                        className={({ isActive }) => "dropdown-item" + (isActive ? " active" : "")}
                                        onClick={() => setIsDropdownOpen(false)}
                                    >
                                        <FaBriefcase className="d-icon" />{" "}
                                        <span>{getPanelLinkLabel(item)}</span>
                                    </NavLink>
                                ))}

                                {/* Separation - Always shown */}
                                <Link to="/performance" className="dropdown-item" onClick={() => setIsDropdownOpen(false)}>
                                    <FaChartLine className="d-icon" /> <span>Performance</span>
                                </Link>
                                <Link to="/separation" className="dropdown-item" onClick={() => setIsDropdownOpen(false)}>
                                    <FaHandshake className="d-icon" /> <span>Separation</span>
                                </Link>
                                <Link to="/noc-application" className="dropdown-item" onClick={() => setIsDropdownOpen(false)}>
                                    <FaFileAlt className="d-icon" /> <span>Apply NOC</span>
                                </Link>

                                {/* Divider before Logout */}
                                <div className="dropdown-divider"></div>
                                
                                {/* Logout - Always shown */}
                                <button onClick={handleLogout} className="dropdown-item logout-btn">
                                    <FaSignOutAlt className="d-icon" /> <span>Logout</span>
                                </button>
                            </div>
                        )}
                    </div>
                    )}
                </div>
            </div>
        </header>
    );
};
