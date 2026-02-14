

import { Outlet } from "react-router-dom";
import { Headers } from "../../pages/Headers"; // Adjust path as needed
import { useUser } from "./UserContext"; // Import the hook
// import "../../pages/style/Dashboard.css"
import "../../pages/Dashboard/Dashboard.css"
export const AppLayout = () => {
    const { userData, loadingUser } = useUser();
    
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
        <div>
            {/* The Header now gets the username from the centralized context */}
            <Headers username={username} role={empType} /> 
            
            <div className="content-area">
                {/* Outlet renders the child routes: Dashboard, Attendance, etc. */}
                <Outlet />
            </div>
        </div>
    );
};