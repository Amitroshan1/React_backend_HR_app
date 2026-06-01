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
import { FaChevronDown, FaUser, FaSignOutAlt, FaBriefcase, FaHandshake, FaHome, FaChartLine, FaCalendarAlt } from "react-icons/fa";
import "./style/Headers.css";
import { hasFeature, clearPlanContext, canAccessItPanel } from "../utils/planFeatures";

const getPageInfo = (pathname, firstName) => {
    const normalizedPath = (pathname || "").toLowerCase().replace(/\/$/, "") || "/";

    if (normalizedPath.startsWith("/it/inventory")) {
        const segment = normalizedPath.replace(/^\/it\/inventory\/?/, "").split("/")[0] || "";
        const inventorySubtitles = {
            "not-working": "Not Working",
            "in-repair": "In Repair",
            "removed-it": "Removed From IT",
            "removed-assets": "Dead Assets",
            parcels: "Parcels",
            "add-assets": "Add Assets",
            "add-import": "Import Parcels",
            "ready-export": "Export Parcels",
            total: "All Assets",
        };
        return {
            title: "Inventory",
            subtitle: inventorySubtitles[segment] || "Asset Management",
        };
    }

    const pathMap = {
        '/dashboard': { title: `Welcome, ${firstName}!`, subtitle: "Overview", isDashboard: true },
        '/attendance': { title: 'Attendance', subtitle: 'Manage records' },
        '/leaves': { title: 'Leaves', subtitle: 'Apply/Check balance' },
        '/queries': { title: 'Raise a Query', subtitle: 'Track and manage your support requests' },
        '/queries/inbox': { title: 'Department Query Inbox', subtitle: 'Reply to queries assigned to your department' },
        '/claims': { title: 'Expense Claims', subtitle: 'Submit and track your claims' },
        '/separation': { title: 'Separation', subtitle: 'Resignation and clearance process' },
        '/payslip': { title: 'Payslip', subtitle: 'View and download payslips' },
        '/profile': { title: 'Profile', subtitle: 'Your personal and employment details' },
        '/holiday-calendar': { title: 'Holiday Calendar', subtitle: 'Company holiday list by year' },
        '/performance': { title: 'Performance', subtitle: 'Self review and manager feedback' },
        '/wfh': { title: 'Work From Home', subtitle: 'WFH requests and approvals' },
        '/hr': { title: 'HR Panel', subtitle: 'Administration' },
        '/account': { title: 'Accounts Panel', subtitle: 'Financial Management' },
        '/admin': { title: 'Admin Panel', subtitle: 'Admin Management' },
        '/admin/leaves': { title: 'All Leave Applications', subtitle: 'Admin' },
        '/admin/queries': { title: 'All Queries', subtitle: 'Admin' },
        '/admin/claims': { title: 'All Expense Claims', subtitle: 'Admin' },
        '/admin/resignations': { title: 'All Resignations', subtitle: 'Admin' },
        '/it/inventory': { title: 'Inventory', subtitle: 'Asset Management' },
        '/manager': { title: 'Manager Panel', subtitle: 'Team Management' },
        '/manager/performance-reviews': { title: 'Performance Review Queue', subtitle: 'Review team self-assessments' },
        '/it': { title: 'IT Panel', subtitle: 'IT Management' },
        '/change-password': { title: 'Change Password', subtitle: '' },
    };

    if (pathMap[normalizedPath]) return pathMap[normalizedPath];

    if (normalizedPath.startsWith("/it/")) {
        return { title: "IT Panel", subtitle: "IT Management" };
    }

    return { title: "Portal", subtitle: "" };
};

export const Headers = ({ username, role, profilePic, hasManagerAccess, user }) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [queryUnreadCount, setQueryUnreadCount] = useState(0);
    const [noticeInfo, setNoticeInfo] = useState({
        notice_active: false,
        days_left: 0,
        can_revoke: false,
    });
    const [revokingNotice, setRevokingNotice] = useState(false);
    const dropdownRef = useRef(null);
    const location = useLocation();
    const navigate = useNavigate();
    
    // Normalize Data
    const firstName = username ? username.split(' ')[0] : 'User';
    const rawRole = role || "Employee";
    const roleKey = rawRole.toLowerCase().trim();

    const { title, subtitle, isDashboard } = getPageInfo(location.pathname, firstName);

    // Map role variations to standardized format and route. Uses emp_type, designation, department, etc.
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

            it: { display: "IT", route: "/it", hasPanel: true },
            "information technology": { display: "IT", route: "/it", hasPanel: true },

            admin: { display: "Admin", route: "/admin", hasPanel: true },
            administrator: { display: "Admin", route: "/admin", hasPanel: true },
            administration: { display: "Admin", route: "/admin", hasPanel: true },
        };

        /** When emp_type is generic (Super Admin), infer HR / IT / Accounts from title text. */
        const inferPanelFromKeywords = (raw) => {
            const s = String(raw ?? "").trim();
            if (!s) return null;
            const n = s.toLowerCase();
            if (/\bhuman\s+resources?\b|\bhr\b/i.test(s)) {
                return { display: "HR", route: "/hr", hasPanel: true };
            }
            if (/\bit\s+department\b|\binformation\s+technology\b|(^|\s)it(\s|$)/i.test(n)) {
                return { display: "IT", route: "/it", hasPanel: true };
            }
            if (/\baccounts\b|\baccountant\b|(^|\s)account(\s|$)/i.test(s)) {
                return { display: "Account", route: "/account", hasPanel: true };
            }
            return null;
        };

        const orderedCandidates = [];
        const push = (v) => {
            if (v == null || v === "") return;
            const t = String(v).trim();
            if (!t || orderedCandidates.includes(t)) return;
            orderedCandidates.push(t);
        };

        push(role);
        if (user) {
            push(user.emp_type);
            push(user.designation);
            push(user.department);
            push(user.role);
            push(user.title);
            if (Array.isArray(user.roles)) user.roles.forEach((r) => push(r));
            else if (user.roles) push(String(user.roles));
        }

        let result = { display: role || "Employee", route: null, hasPanel: false };

        for (const cand of orderedCandidates) {
            const normalized = String(cand).toLowerCase().trim();
            const exact = roleMap[normalized];
            if (exact?.hasPanel) {
                result = exact;
                break;
            }
            const inferred = inferPanelFromKeywords(cand);
            if (inferred?.hasPanel) {
                result = inferred;
                break;
            }
        }

        const primaryNorm = String(orderedCandidates[0] ?? "").toLowerCase().trim();
        if (!result.hasPanel && primaryNorm) {
            if (primaryNorm.includes("it") || primaryNorm.includes("tech") || primaryNorm.includes("information")) {
                result = { display: "IT", route: "/it", hasPanel: true };
            }
        }

        if (!result.hasPanel && user) {
            try {
                const rolesArr = Array.isArray(user.roles) ? user.roles : user.roles ? String(user.roles).split(",") : [];
                const permsArr = Array.isArray(user.permissions) ? user.permissions : user.permissions ? String(user.permissions).split(",") : [];
                const combined = [...rolesArr, ...permsArr].map(String).join(" ").toLowerCase();
                if (combined.includes("it") || combined.includes("information") || combined.includes("tech")) {
                    result = { display: "IT", route: "/it", hasPanel: true };
                }
                if (!result.hasPanel && (combined.includes("human resource") || combined.includes(" hr"))) {
                    result = { display: "HR", route: "/hr", hasPanel: true };
                }
            } catch (e) {
                /* ignore */
            }
        }

        if (!result.hasPanel) {
            result = { display: role || "Employee", route: null, hasPanel: false };
        }

        console.log("Header Role Debug:", {
            receivedRole: role,
            candidates: orderedCandidates,
            roleInfo: result,
            userFields: { emp_type: user?.emp_type, designation: user?.designation, department: user?.department },
        });

        return result;
    };

    const roleInfo = getRoleInfo(rawRole, user);
    const queryShortcutAllowed = ["hr", "account", "accounts", "it"].includes(roleInfo.display?.toLowerCase());
    const showManagerPanel = hasManagerAccess === true || ["manager", "managers"].includes(roleKey);
    const isAdminRole =
        ["admin", "administrator", "administration"].includes(roleKey) ||
        roleKey.includes("super");

    const panelRouteAllowed = (route) => {
        if (isAdminRole) return true;
        if (route === "/hr") return hasFeature("hr_panel");
        if (route === "/account") return hasFeature("account_panel");
        if (route === "/it" || route === "/it/inventory") return canAccessItPanel(user);
        return true;
    };

    const panelLinks = [];
    if (isAdminRole) {
        panelLinks.push({ display: "Admin Panel", route: "/admin" });
    } else {
        if (roleInfo.hasPanel && roleInfo.route && panelRouteAllowed(roleInfo.route)) {
            panelLinks.push({ display: roleInfo.display, route: roleInfo.route });
        }
        if (
            canAccessItPanel(user) &&
            !panelLinks.some((p) => p.route === "/it" || p.route === "/it/inventory")
        ) {
            panelLinks.push({ display: "IT / Inventory", route: "/it/inventory" });
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
        const token = localStorage.getItem("token");

        const fetchUnreadCount = async () => {
            if (!token) return;
            try
             {
                const response = await fetch("/api/notifications/unread-count",
                     {
                    method: "GET",
                    headers: { Authorization: `Bearer ${token}` },
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
        return () => {
            isMounted = false;
            if (timerId) window.clearInterval(timerId);
        };
    }, []);

    useEffect(() => {
        let isMounted = true;
        let timerId = null;
        const token = localStorage.getItem("token");

        const fetchNoticeInfo = async () => {
            if (!token) return;
            try {
                const response = await fetch("/api/leave/seperation", {
                    method: "GET",
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!response.ok) {
                    const body = await response.text();
                    console.error("Notice fetch failed:", response.status, body);
                    return;
                }
                let result;
                try {
                    result = await response.json();
                } catch (err) {
                    console.error("Notice parse error:", err);
                    return;
                }
                if (isMounted && result && result.success) {
                    const notice = result.notice || {};
                    setNoticeInfo({
                        notice_active: Boolean(notice.notice_active),
                        days_left: Number(notice.days_left || 0),
                        can_revoke: Boolean(notice.can_revoke),
                    });
                }
            } catch (error) {
                console.error("Notice period fetch error:", error);
            }
        };

        fetchNoticeInfo();
        timerId = window.setInterval(fetchNoticeInfo, 60000);
        return () => {
            isMounted = false;
            if (timerId) window.clearInterval(timerId);
        };
    }, []);

    const handleLogout = () => {
        toast.info("Logged out successfully");
        localStorage.removeItem('token');
        localStorage.removeItem('lastActivityAt');
        clearPlanContext();
        navigate('/');
    };

const defaultAvatar = `https://ui-avatars.com/api/?name=${username}&background=2563eb&color=fff`;
    const userAvatar = profilePic || defaultAvatar;

    const isBellDisabled = queryUnreadCount === 0;

    const isITRole = roleInfo.display?.toLowerCase() === "it";
    const handleQueryShortcutClick = () => {
        if (!queryShortcutAllowed) return;
        if (isITRole) {
            navigate("/it/OpenTicket");
            return;
        }
        navigate("/queries/inbox?from=notification");
    };

    const handleRevokeNotice = async () => {
        if (revokingNotice) return;
        const token = localStorage.getItem("token");
        if (!token) return;
        const ok = window.confirm("Revoke your resignation request?");
        if (!ok) return;

        setRevokingNotice(true);
        try {
            const response = await fetch("/api/leave/seperation/revoke", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.message || "Failed to revoke resignation");
            }
            const notice = result.notice || {};
            setNoticeInfo({
                notice_active: Boolean(notice.notice_active),
                days_left: Number(notice.days_left || 0),
                can_revoke: Boolean(notice.can_revoke),
            });
        } catch (error) {
            console.error("Revoke resignation error:", error);
            window.alert(error.message || "Unable to revoke resignation");
        } finally {
            setRevokingNotice(false);
        }
    };

    return (
        <header className="header-container">
            <div className="header-content">
                <div className="header-left">
                    {!isDashboard && (
                        <button
                            className="home-logo-btn"
                            onClick={() => navigate('/dashboard')}
                            title="Go to Dashboard"
                            aria-label="Go to Dashboard"
                        >
                            <FaHome />
                        </button>
                    )}
                    <h1 className={`welcome-title ${!isDashboard ? 'page-heading' : ''}`}>{title}</h1>
                </div>

                <div className="header-right">
                    {noticeInfo.notice_active && (
                        <div className="notice-chip" title="90-day notice period countdown">
                            <span className="notice-chip-text">Notice: {noticeInfo.days_left}d left</span>
                            {noticeInfo.can_revoke && (
                                <button
                                    className="notice-revoke-btn"
                                    onClick={handleRevokeNotice}
                                    disabled={revokingNotice}
                                    title="Revoke resignation"
                                >
                                    {revokingNotice ? "..." : "Revoke"}
                                </button>
                            )}
                        </div>
                    )}

                    {queryShortcutAllowed && (
                        <button
                            type="button"
                            className={`query-shortcut-btn ${isBellDisabled ? "disabled" : ""}`}
                            title={isITRole ? "IT Queries" : "Department Queries"}
                            onClick={handleQueryShortcutClick}
                        >
                            Query
                            {queryUnreadCount > 0 && (
                                <span className="badge">{queryUnreadCount > 99 ? "99+" : queryUnreadCount}</span>
                            )}
                        </button>
                    )}
                    
                    <div className="divider"></div>

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
                                <p className="user-name">{firstName}</p>
                                <p className="user-role">{roleInfo.display || rawRole}</p> 
                            </div>
                            <FaChevronDown className={`dropdown-arrow ${isDropdownOpen ? 'open' : ''}`} />
                        </div>

                        {isDropdownOpen && (
                            <div className="profile-dropdown-card">
                                <div className="dropdown-header">
                                    <p className="d-full-name">{username || 'Full Name'}</p>
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
                                        <FaBriefcase className="d-icon" /> <span>{item.display} Panel</span>
                                    </NavLink>
                                ))}

                                {/* Separation - Always shown */}
                                <Link to="/performance" className="dropdown-item" onClick={() => setIsDropdownOpen(false)}>
                                    <FaChartLine className="d-icon" /> <span>Performance</span>
                                </Link>
                                <Link to="/separation" className="dropdown-item" onClick={() => setIsDropdownOpen(false)}>
                                    <FaHandshake className="d-icon" /> <span>Separation</span>
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
                </div>
            </div>
        </header>
    );
};