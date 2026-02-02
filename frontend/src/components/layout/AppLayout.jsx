// import { Outlet } from "react-router-dom";
// import { Headers } from "../../pages/Headers";

// export const AppLayout = () => {
//   return (
//     <>
//       <Headers/>
//       <Outlet />
//     </>
//   );
// };



// src/components/layout/AppLayout.jsx (This is the file for your Layout)

import { Outlet } from "react-router-dom";
import { Headers } from "../../pages/Headers"; // Adjust path as needed
import { useUser } from "./UserContext"; // Import the hook
import "../../pages/style/Dashboard.css"
export const AppLayout = () => {
    const { userData, loadingUser } = useUser();
    
    if (loadingUser) {
        return (
           <div className="full-height-center">
            <h2 className="loader"></h2>
        </div>
        );
    }
    
    // Safely get the username for the Headers
    const username = userData.user.name;

    return (
        <div>
            {/* The Header now gets the username from the centralized context */}
            <Headers username={username} /> 
            
            <div className="content-area">
                {/* Outlet renders the child routes: Dashboard, Attendance, etc. */}
                <Outlet />
            </div>
        </div>
    );
};