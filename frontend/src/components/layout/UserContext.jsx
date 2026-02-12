import { createContext, useState, useEffect, useContext } from 'react'
const API_BASE_URL = "/api/auth";
const UserContext = createContext();
export const useUser = () => useContext(UserContext);
export const UserProvider = ({ children }) => {
    const [userData, setUserData] = useState({
        user: {},
        employee: {},
        leave_balance: { pl: 'N/A', cl: 'N/A' },
        managers: {},
    });
    const [loadingUser, setLoadingUser] = useState(true);
    const fetchCoreUserData = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            setLoadingUser(false);
            return;
        }
        try {
            const response = await fetch(`${API_BASE_URL}/employee/homepage`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (response.status === 401) {
                // Token missing/expired/invalid: clear it so app can re-login cleanly.
                localStorage.removeItem('token');
                throw new Error("Unauthorized (token invalid or expired).");
            }
            if (!response.ok) throw new Error("Failed to fetch user data.");
            const result = await response.json();
            if (result.success) {
                setUserData({
                    user: result.user || {},
                    employee: result.employee || {},
                    leave_balance: result.leave_balance || { pl: 'N/A', cl: 'N/A' },
                    managers: result.managers || {},
                });
            }
        } catch (err) {
            console.error("User Context Fetch error:", err);
        } finally {
            setLoadingUser(false);
        }
    };
    useEffect(() => {
        fetchCoreUserData();
    }, []);
    const value = {
        userData,
        loadingUser,
        refreshUserData: fetchCoreUserData
    };
    return (
        <UserContext.Provider value={value}>
            {children}
        </UserContext.Provider>
    );
};








// import { createContext, useState, useEffect, useContext, useCallback } from 'react';

// const UserContext = createContext();
// export const useUser = () => useContext(UserContext);

// export const UserProvider = ({ children }) => {
//     const [userData, setUserData] = useState(null);
//     const [loadingUser, setLoadingUser] = useState(true);

//     const fetchCoreUserData = useCallback(async () => {
//         const token = localStorage.getItem('token');
//         if (!token) {
//             setLoadingUser(false);
//             return;
//         }

//         try {
//             const response = await fetch("http://localhost:5000/api/auth/employee/homepage", {
//                 method: 'GET',
//                 headers: { 'Authorization': `Bearer ${token}` }
//             });
//             const result = await response.json();
//             if (result.success) {
//                 setUserData(result);
//             }
//         } catch (err) {
//             console.error("Context Fetch error:", err);
//         } finally {
//             setLoadingUser(false);
//         }
//     }, []);

//     useEffect(() => {
//         fetchCoreUserData();
//     }, [fetchCoreUserData]);

//     return (
//         <UserContext.Provider value={{ userData, loadingUser, refreshUserData: fetchCoreUserData }}>
//             {children}
//         </UserContext.Provider>
//     );
// };