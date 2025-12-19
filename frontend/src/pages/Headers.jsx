// import "./style/Headers.css"
// import { FaSearch, FaBell } from "react-icons/fa";

// export const Headers = ({username}) => {
//   return (
//     <div className="header-container">

//       {/* Left Section */}
//       <div className="header-left">
//         <h2>Welcome,{username}</h2>
//         <p>Here’s an overview of your work status</p>
//       </div>

//       {/* Right Section */}
//       <div className="header-right">

//         {/* Notification Bell + Badge */}
//         <div className="notification">
//           <FaBell className="bell-icon" />
//           <span className="badge">3</span>
//         </div>

//         {/* Vertical Divider */}
//         <div className="divider"></div>

//         {/* User Profile */}
//         <div className="user-profile">
//           <div className="user-avatar">JE</div>
//           <div className="user-info">
//             <p className="user-name">John Employee</p>
//             <p className="user-role">Employee</p>
//           </div>
//         </div>

//       </div>
//     </div>
//   );
// };

import "./style/Headers.css"
// import { FaSearch, FaBell } from "react-icons/fa";

// export const Headers = ({username}) => {
//  return (
//  <div className="header-container">

//  {/* The Dashboard welcome text is handled in Dashboard.jsx, so this header will only contain Search and Profile/Notifications. */}

// {/* Left/Center Section - Search Box */}
//  <div className="header-search">
// <div className="search-box">
//  <FaSearch className="search-icon" />
//  <input type="text" placeholder="Search..." />
//  </div>
//  </div>

//  {/* Right Section - Notifications and Profile */}
//  <div className="header-right">

//  {/* Notification Bell + Badge */}
//  <div className="notification">
//  <FaBell className="bell-icon" />
//  <span className="badge">3</span>
//  </div>

//  {/* Vertical Divider */}
//  <div className="divider"></div>

//  {/* User Profile */}
//  <div className="user-profile">
//  {/* Note: The image shows the full name, not just initials */}
// <img 
// src="https://picsum.photos/id/1005/38/38" 
//  alt="User Avatar" 
// className="user-avatar-img"
//  />
//  <div className="user-info">
//  <p className="user-name">John Employee</p>
//  <p className="user-role">Employee</p>
// </div>
//  </div>

// </div>
// </div>
// );
// };





// import "./style/Headers.css"
// import { FaBell } from "react-icons/fa";

// export const Headers = () => {
//  return (
//  <div className="header-container">
//  <div className="header-spacer"></div>

// <div className="header-right">

// <div className="notification">
//  <FaBell className="bell-icon" />
//  <span className="badge">3</span>
// </div>
//  <div className="divider"></div>

//  <div className="user-profile">
// {/* Using an image element for the avatar to match the homepage.png style */}
//  <img 
//  src="https://picsum.photos/id/1005/38/38" 
//  alt="User Avatar" 
//  className="user-avatar-img"/>
//  <div className="user-info">
//  <p className="user-name">John Employee</p>
//  <p className="user-role">Employee</p>
//  </div>
//  </div>

// </div>
//  </div>
// );
// };



// import "./style/Headers.css"
// import { FaBell } from "react-icons/fa";

// // Ensure Headers accepts the username prop
// export const Headers = ({ username }) => {
//  // Extract first name for "Welcome, John!"
//  const firstName = username ? username.split(' ')[0] : 'User';

//  return (
//   <div className="header-container">

//    {/* NEW: Left Section for Welcome Message */}
//    <div className="header-left">
//     <h1 className="welcome-title">Welcome, {firstName}!</h1>
//     <p className="overview-text">Here's an overview of your work status</p>
//    </div>

//    {/* Right Section: Notification and Profile */}
//    <div className="header-right">

//     {/* Notification Bell + Badge */}
//     <div className="notification">
//      <FaBell className="bell-icon" />
//      <span className="badge">3</span>
//     </div>

//     {/* Vertical Divider */}
//     <div className="divider"></div>

//     {/* User Profile */}
//     <div className="user-profile">
//      <img 
//       src="https://picsum.photos/id/1005/38/38" 
//       alt="User Avatar" 
//       className="user-avatar-img"
//      />
//      <div className="user-info">
//       <p className="user-name">{firstName}</p>
//       <p className="user-role">Employee</p>
//      </div>
//     </div>

//    </div>
//   </div>
//  );
// };









// src/components/Header/Headers.jsx


import { useLocation } from 'react-router-dom'; 
import { FaBell } from "react-icons/fa";
import "./style/Headers.css";
const getPageInfo = (pathname, firstName) => {
    const normalizedPath = pathname.toLowerCase();
    if (normalizedPath === '/dashboard' || normalizedPath === '/') {
        return {
            title: `Welcome, ${firstName}!`,
            subtitle: "Here's an overview of your work status",
            isDashboard: true
        };
    }
    const pathMap = {
        '/attendance': { title: 'Attendance', subtitle: 'View and manage your attendance records' },
        '/leaves': { title: 'Leaves', subtitle: 'Apply for leave or check your leave balance' },
        '/salary': { title: 'Salary', subtitle: 'View payslips and salary details' },
    };
    return pathMap[normalizedPath] || {
        title: normalizedPath.substring(1) || 'Page', 
        subtitle: 'Viewing details for this page'
    };
};
export const Headers = ({ username }) => {
    const location = useLocation();
    const firstName = username ? username.split(' ')[0] : 'User';
    const { title, subtitle, isDashboard } = getPageInfo(location.pathname, firstName);
    return (
        <div className="header-container">
            <div className="header-left">
                 <h1 className={`welcome-title ${!isDashboard ? 'page-title-style' : ''}`}>
                    {title}
                </h1>
                {isDashboard && (
                    <p className="overview-text">
                        {subtitle}
                    </p>
                )}
            </div>
            <div className="header-right">
                <div className="notification">
                    <FaBell className="bell-icon" />
                    <span className="badge">3</span>
                </div>
                <div className="divider"></div>
                <div className="user-profile">
                    <img 
                    src="https://picsum.photos/id/1005/38/38" 
                    alt="User Avatar" 
                    className="user-avatar-img"
                    />
                    <div className="user-info">
                        <p className="user-name">{firstName}</p>
                        <p className="user-role">Employee</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
