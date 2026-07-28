import { createContext, useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react'
import { setPlanContext, clearPlanContext } from '../../utils/planFeatures';
import { clearSensitiveToken } from '../../utils/sensitiveDataAuth';

const API_BASE_URL = "/api/auth";
/** Skip refetching homepage shell data if fetched within this window. */
export const USER_DATA_TTL_MS = 5 * 60 * 1000;

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
    const [photoVersion, setPhotoVersion] = useState(0);
    const lastFetchedAtRef = useRef(0);
    const inFlightRef = useRef(null);

    const fetchCoreUserData = useCallback(async (options = {}) => {
        const force = options === true || options?.force === true;
        const token = localStorage.getItem('token');
        if (!token) {
            clearPlanContext();
            lastFetchedAtRef.current = 0;
            setLoadingUser(false);
            return;
        }

        const now = Date.now();
        if (
            !force
            && lastFetchedAtRef.current > 0
            && now - lastFetchedAtRef.current < USER_DATA_TTL_MS
        ) {
            setLoadingUser(false);
            return;
        }

        if (inFlightRef.current) {
            return inFlightRef.current;
        }

        const run = (async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/employee/homepage`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (response.status === 401) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('lastActivityAt');
                    clearSensitiveToken();
                    clearPlanContext();
                    throw new Error("Unauthorized (token invalid or expired).");
                }
                if (!response.ok) throw new Error("Failed to fetch user data.");
                const result = await response.json();
                if (result.success) {
                    setPlanContext(result.plan, result.features);
                    setUserData({
                        user: result.user || {},
                        employee: result.employee || {},
                        leave_balance: result.leave_balance || { pl: 'N/A', cl: 'N/A' },
                        managers: result.managers || {},
                        plan: result.plan || 'essential',
                        plan_label: result.plan_label || '',
                        features: result.features || [],
                    });
                    lastFetchedAtRef.current = Date.now();
                }
            } catch (err) {
                console.error("User Context Fetch error:", err);
            } finally {
                setLoadingUser(false);
                inFlightRef.current = null;
            }
        })();

        inFlightRef.current = run;
        return run;
    }, []);

    const bumpPhotoVersion = useCallback(() => {
        setPhotoVersion((v) => v + 1);
    }, []);

    useEffect(() => {
        fetchCoreUserData({ force: true });
    }, [fetchCoreUserData]);

    const value = useMemo(() => ({
        userData,
        loadingUser,
        refreshUserData: fetchCoreUserData,
        photoVersion,
        bumpPhotoVersion,
    }), [userData, loadingUser, fetchCoreUserData, photoVersion, bumpPhotoVersion]);

    return (
        <UserContext.Provider value={value}>
            {children}
        </UserContext.Provider>
    );
};
