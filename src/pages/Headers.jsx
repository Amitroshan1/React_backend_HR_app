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
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { FaBell, FaChevronDown, FaUser, FaSignOutAlt, FaBriefcase } from "react-icons/fa";
import "./style/Headers.css";

const getPageInfo = (pathname, firstName) => {
    const normalizedPath = pathname.toLowerCase();
    const pathMap = {
        '/dashboard': { title: `Welcome, ${firstName}!`, subtitle: "Overview", isDashboard: true },
        '/attendance': { title: 'Attendance', subtitle: 'Manage records' },
        '/leaves': { title: 'Leaves', subtitle: 'Apply/Check balance' },
        '/hr': { title: 'HR Panel', subtitle: 'Administration' },
        '/account': { title: 'Accounts Panel', subtitle: 'Financial Management' },
        '/admin': { title: 'Admin Panel', subtitle: 'Admin Management' },
    };
    return pathMap[normalizedPath] || { title: 'Portal', subtitle: '' };
};

export const Headers = ({ username, role, profilePic }) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);
    const location = useLocation();
    const navigate = useNavigate();
    
    // Normalize Data
    const firstName = username ? username.split(' ')[0] : 'User';
    const rawRole = role || "Employee";
    const roleKey = rawRole.toLowerCase().trim();

    const { title, subtitle, isDashboard } = getPageInfo(location.pathname, firstName);

    // Roles that get a special panel in dropdown
    const specialRoles = ["human resource", "manager", "account", "it", "pmp", "admin"];
    const isSpecialRole = specialRoles.includes(roleKey);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsDropdownOpen(false);
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleLogout = () => {
        localStorage.removeItem('token');
        navigate('/');
    };

const defaultAvatar = `https://ui-avatars.com/api/?name=${username}&background=2563eb&color=fff`;
    const userAvatar = profilePic || defaultAvatar;

    return (
        <header className="header-container">
            <div className="header-content">
                <div className="header-left">
                    <h1 className={`welcome-title ${!isDashboard ? 'page-heading' : ''}`}>{title}</h1>
                    {isDashboard && <p className="overview-text">{subtitle}</p>}
                </div>

                <div className="header-right">
                    <div className="notification-wrapper" title="Notifications">
                        <FaBell className="bell-icon" />
                        <span className="badge">3</span>
                    </div>
                    
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
                                <p className="user-role">{rawRole}</p> 
                            </div>
                            <FaChevronDown className={`dropdown-arrow ${isDropdownOpen ? 'open' : ''}`} />
                        </div>

                        {isDropdownOpen && (
                            <div className="profile-dropdown-card">
                                <div className="dropdown-header">
                                    <p className="d-full-name">{username || 'Full Name'}</p>
                                    <p className="d-role-label">{rawRole}</p>
                                </div>
                                <div className="dropdown-divider"></div>
                                
                                <Link to="/profile" className="dropdown-item" onClick={() => setIsDropdownOpen(false)}>
                                    <FaUser className="d-icon" /> <span>Profile</span>
                                </Link>

                                {isSpecialRole && (
                                    <Link 
                                        to={roleKey === "human resource" ? "/hr" : `/${roleKey.replace(/\s+/g, '-')}`} 
                                        className="dropdown-item panel-link"
                                        onClick={() => setIsDropdownOpen(false)}
                                    >
                                        <FaBriefcase className="d-icon" /> <span>{rawRole} Panel</span>
                                    </Link>
                                )}

                                <div className="dropdown-divider"></div>
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