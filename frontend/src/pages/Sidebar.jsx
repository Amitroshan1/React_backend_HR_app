// import { useState } from "react";
// import {
//   FiGrid,
//   FiClock,
//   FiDollarSign,
//   FiCalendar,
//   FiUser,
//   FiLogOut,
//   FiChevronLeft,
//   FiChevronRight,
// } from "react-icons/fi";
// import "./style/Sidebar.css"
// import { Dashboard } from "./Dashboard";

// export const Sidebar = () => {
//   const [collapsed, setCollapsed] = useState(false);

//   return (
//     <div className={collapsed ? "sidebar collapsed" : "sidebar"}>
//       {/* Toggle Button */}
//       <div className="toggle-btn" onClick={() => setCollapsed(!collapsed)}>
//         {collapsed ? <FiChevronRight /> : <FiChevronLeft />}
//       </div>

//       <div className="menu">
//         <div className="menu-heading">{!collapsed && "EMPLOYEE"}</div>

//         <ul>
//           <li>
//             <FiGrid className="icon" />
//             {!collapsed && <span>Dashboard</span>}
//           </li>

//           <li>
//             <FiClock className="icon" />
//             {!collapsed && <span>Attendance</span>}
//           </li>

//           <li>
//             <FiDollarSign className="icon" />
//             {!collapsed && <span>Salary</span>}
//           </li>

//           <li>
//             <FiCalendar className="icon" />
//             {!collapsed && <span>Leaves</span>}
//           </li>

//           <li>
//             <FiUser className="icon" />
//             {!collapsed && <span>Profile</span>}
//           </li>
//         </ul>
//       </div>

//       {/* Footer */}
//       <div className="bottom-user">
//         {!collapsed && (
//           <>
//             <div className="user-name">John Employee</div>
//             <div className="user-role">Employee</div>
//           </>
//         )}
//       </div>

//       <div className="logout">
//         <FiLogOut className="icon" />
//         {!collapsed && <span>Logout</span>}
//       </div>
//     </div>
//   );
// }








// import { useState } from "react";
// import {
//   FiGrid,
//   FiClock,
//   FiDollarSign,
//   FiCalendar,
//   FiUser,
//   FiLogOut,
//   FiChevronLeft,
//   FiChevronRight,
// } from "react-icons/fi";
// import { NavLink } from "react-router-dom";
// import "./style/Sidebar.css";

// export const Sidebar = () => {
//   const [collapsed, setCollapsed] = useState(false);

//   return (
//     <div className={collapsed ? "sidebar collapsed" : "sidebar"}>
      
//       {/* Toggle Button */}
//       <div className="toggle-btn" onClick={() => setCollapsed(!collapsed)}>
//         {collapsed ? <FiChevronRight /> : <FiChevronLeft />}
//       </div>

//       <div className="menu">
//         <div className="menu-heading">{!collapsed && "EMPLOYEE"}</div>

//         <ul>

//           {/* DASHBOARD */}
//           <NavLink 
//             to="/dashboard"
//             className="menu-link"
//           >
//             <li className={({ isActive }) => isActive ? "active" : ""}>
//               <FiGrid className="icon" />
//               {!collapsed && <span>Dashboard</span>}
//             </li>
//           </NavLink>

//           {/* ATTENDANCE */}
//           <NavLink to="/attendance" className="menu-link">
//             <li>
//               <FiClock className="icon" />
//               {!collapsed && <span>Attendance</span>}
//             </li>
//           </NavLink>

//           {/* SALARY */}
//           <NavLink to="/salary" className="menu-link">
//             <li>
//               <FiDollarSign className="icon" />
//               {!collapsed && <span>Salary</span>}
//             </li>
//           </NavLink>

//           {/* LEAVES */}
//           <NavLink to="/leaves" className="menu-link">
//             <li>
//               <FiCalendar className="icon" />
//               {!collapsed && <span>Leaves</span>}
//             </li>
//           </NavLink>

//           {/* PROFILE */}
//           <NavLink to="/profile" className="menu-link">
//             <li>
//               <FiUser className="icon" />
//               {!collapsed && <span>Profile</span>}
//             </li>
//           </NavLink>

//         </ul>
//       </div>

//       {/* Footer */}
//       <div className="bottom-user">
//         {!collapsed && (
//           <>
//             <div className="user-name">John Employee</div>
//             <div className="user-role">Employee</div>
//           </>
//         )}
//       </div>

//       <div className="logout">
//         <FiLogOut className="icon" />
//         {!collapsed && <span>Logout</span>}
//       </div>
//     </div>
//   );
// };








// import { FiHome, FiClock, FiDollarSign, FiLogOut, FiUser } from 'react-icons/fi';
// import { FaRegHandPaper } from "react-icons/fa";
// import './style/Sidebar.css'; 

// export const Sidebar = ({ username, designation }) => {
//     return (
//         <div className="sidebar">
//             <div className="logo-section">
//                 <span className="logo-text">HRMS Pro</span>
//             </div>
            
//             <nav className="nav-menu">
//                 <div className="menu-group">
//                     <p className="group-title">EMPLOYEE</p>
//                     <ul>
//                         <li className="nav-item active">
//                             <FiHome />
//                             <span>Dashboard</span>
//                         </li>
//                         <li className="nav-item">
//                             <FiClock />
//                             <span>Attendance</span>
//                         </li>
//                         <li className="nav-item">
//                             <FiDollarSign />
//                             <span>Salary</span>
//                         </li>
//                         <li className="nav-item">
//                             <FaRegHandPaper />
//                             <span>Leaves</span>
//                         </li>
//                         <li className="nav-item">
//                             <FiUser />
//                             <span>Profile</span>
//                         </li>
//                     </ul>
//                 </div>
//             </nav>

//             <div className="sidebar-footer">
//                 <div className="footer-user-info">
//                     <img 
//                         src="https://via.placeholder.com/40" 
//                         alt="User Avatar" 
//                         className="footer-avatar"
//                     />
//                     <div className="user-text">
//                         <p className="user-name">{username || 'John Employee'}</p>
//                         <p className="user-role">{designation || 'Employee'}</p>
//                     </div>
//                 </div>
//                 <div className="logout-btn">
//                     <FiLogOut />
//                     <span>Logout</span>
//                 </div>
//             </div>
//         </div>
//     );
// };





import { useState } from "react";
// Using FiGrid for Dashboard, FiCalendar for Leaves, and FiLogOut, FiUser, FiClock, FiDollarSign
import { FiGrid, FiClock, FiDollarSign, FiCalendar, FiUser, FiLogOut, FiChevronLeft } from 'react-icons/fi';
// Assuming you have 'react-router-dom' installed
import { NavLink } from "react-router-dom";
import './style/Sidebar.css'; 

export const Sidebar = ({ username, designation }) => {
    // State to handle collapsed/expanded state
    const [isCollapsed, setIsCollapsed] = useState(false);
    
    // Fallback for user info
    const userNameDisplay = username || 'John Employee';
    const designationDisplay = designation || 'Employee';
    const userFirstName = userNameDisplay.split(' ')[0];

    return (
        // Apply is-collapsed class directly to the sidebar element
        <div className={`sidebar ${isCollapsed ? 'is-collapsed' : ''}`}>
            
            {/* Collapse Button (Only visible on large screens) */}
            <button 
                className="collapse-btn" 
                onClick={() => setIsCollapsed(!isCollapsed)}
                title={isCollapsed ? "Expand" : "Collapse"}
            >
                {/* Rotate icon based on state */}
                <FiChevronLeft className={isCollapsed ? 'rotate' : ''} />
            </button>

            {/* Logo Section */}
            <div className="logo-section">
                {/* FiGrid or a custom icon can be used here for the logo, using a standard icon for now */}
                <FiGrid className="logo-icon" /> 
                <span className="logo-text">HRMS Pro</span>
            </div>
            
            <nav className="nav-menu">
                <div className="menu-group">
                    {/* Hide title when collapsed */}
                    {!isCollapsed && <p className="group-title">EMPLOYEE</p>}
                    <ul>
                        
                        {/* DASHBOARD */}
                        <NavLink 
                            to="/dashboard" 
                            className={({ isActive }) => `menu-link ${isActive ? 'active-link' : ''}`}
                            // Use end={true} if /dashboard is the exact match
                        >
                            <li className="nav-item">
                                <FiGrid />
                                <span>Dashboard</span>
                            </li>
                        </NavLink>

                        {/* ATTENDANCE */}
                        <NavLink 
                            to="/attendance" 
                            className={({ isActive }) => `menu-link ${isActive ? 'active-link' : ''}`}
                        >
                            <li className="nav-item">
                                <FiClock />
                                <span>Attendance</span>
                            </li>
                        </NavLink>

                        {/* SALARY */}
                        <NavLink 
                            to="/salary" 
                            className={({ isActive }) => `menu-link ${isActive ? 'active-link' : ''}`}
                        >
                            <li className="nav-item">
                                <FiDollarSign />
                                <span>Salary</span>
                            </li>
                        </NavLink>

                        {/* LEAVES - Using FiCalendar (common) or FaRegHandPaper (from your previous code) */}
                        <NavLink 
                            to="/leaves" 
                            className={({ isActive }) => `menu-link ${isActive ? 'active-link' : ''}`}
                        >
                            <li className="nav-item">
                                <FiCalendar />
                                <span>Leaves</span>
                            </li>
                        </NavLink>

                        {/* PROFILE */}
                        <NavLink 
                            to="/profile" 
                            className={({ isActive }) => `menu-link ${isActive ? 'active-link' : ''}`}
                        >
                            <li className="nav-item">
                                <FiUser />
                                <span>Profile</span>
                            </li>
                        </NavLink>

                    </ul>
                </div>
            </nav>

            <div className="sidebar-footer">
                <div className="footer-user-info">
                    {/* Custom placeholder avatar */}
                    <div className="footer-avatar-placeholder">
                        {userFirstName[0]}{designationDisplay[0] || ''}
                    </div>
                    {/* Hide user text when collapsed */}
                    {!isCollapsed && (
                        <div className="user-text">
                            <p className="user-name">{userNameDisplay}</p>
                            <p className="user-role">{designationDisplay}</p>
                        </div>
                    )}
                </div>
                <div className="logout-btn">
                    <FiLogOut />
                    {/* Hide logout text when collapsed */}
                    {!isCollapsed && <span>Logout</span>}
                </div>
            </div>
        </div>
    );
};