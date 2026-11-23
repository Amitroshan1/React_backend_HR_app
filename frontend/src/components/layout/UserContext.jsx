import { createContext, useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react'
import { setPlanContext, clearPlanContext } from '../../utils/planFeatures';
import {
    endSession,
    noteSessionEnded,
    shouldEndSessionFor401,
    TENANT_SUSPENDED_CODE,
} from '../../utils/sessionTimeout';
import { getAccessToken, hasSignedInHint } from '../../utils/authSession';
import { classifyHomepageFailure, deriveProfileGaps } from '../dashboard/ProfileStatusPanel';

const API_BASE_URL = "/api/auth";
/** Skip refetching homepage shell data if fetched within this window. */
export const USER_DATA_TTL_MS = 5 * 60 * 1000;

const UserContext = createContext();
export const useUser = () => useContext(UserContext);

const emptyUserData = {
    user: {},
    employee: {},
    leave_balance: { pl: 'N/A', cl: 'N/A' },
    managers: {},
};

export const UserProvider = ({ children }) => {
    const [userData, setUserData] = useState(emptyUserData);
    const [loadingUser, setLoadingUser] = useState(true);
    const [profileStatus, setProfileStatus] = useState(null);
    const [photoVersion, setPhotoVersion] = useState(0);
    const lastFetchedAtRef = useRef(0);
    const inFlightRef = useRef(null);

    const fetchCoreUserData = useCallback(async (options = {}) => {
        const force = options === true || options?.force === true;
        const token = getAccessToken();
        if (!token && !hasSignedInHint()) {
            clearPlanContext();
            lastFetchedAtRef.current = 0;
            setProfileStatus(null);
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
                    credentials: 'include',
                    headers: token
                      ? { Authorization: `Bearer ${token}` }
                      : {},
                });
                let body = {};
                try {
                    body = await response.json();
                } catch {
                    body = {};
                }
                if (response.status === 401) {
                    setProfileStatus(classifyHomepageFailure(401, body));
                    if (shouldEndSessionFor401(body)) {
                        const reason = await noteSessionEnded(response);
                        endSession(reason === TENANT_SUSPENDED_CODE ? TENANT_SUSPENDED_CODE : reason);
                    }
                    throw new Error("Unauthorized (token invalid or expired).");
                }
                if (!response.ok || !body.success) {
                    setProfileStatus(classifyHomepageFailure(response.status, body));
                    return;
                }
                setPlanContext(body.plan, body.features, {
                    is_platform_super_admin: body.is_platform_super_admin,
                });
                setUserData({
                    user: body.user || {},
                    employee: body.employee || {},
                    leave_balance: body.leave_balance || { pl: 'N/A', cl: 'N/A' },
                    managers: body.managers || {},
                    plan: body.plan || 'essential',
                    plan_label: body.plan_label || '',
                    features: body.features || [],
                    profile_gaps: body.profile_gaps || [],
                });
                const gaps = deriveProfileGaps(body);
                setProfileStatus(
                    gaps.length
                        ? {
                            kind: "incomplete",
                            code: "PROFILE_INCOMPLETE",
                            contact: "hr",
                            title: "Your profile is incomplete",
                            reason: "Your login works, but some employee details are not set up yet.",
                            nextStep: "Contact HR to complete these fields. This is not a system outage.",
                            gaps,
                        }
                        : { kind: "ok" }
                );
                lastFetchedAtRef.current = Date.now();
            } catch (err) {
                console.error("User Context Fetch error:", err);
                setProfileStatus((prev) => (
                    prev?.kind === "load_failed" ? prev : classifyHomepageFailure(0, {})
                ));
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
        profileStatus,
        refreshUserData: fetchCoreUserData,
        photoVersion,
        bumpPhotoVersion,
    }), [userData, loadingUser, profileStatus, fetchCoreUserData, photoVersion, bumpPhotoVersion]);

    return (
        <UserContext.Provider value={value}>
            {children}
        </UserContext.Provider>
    );
};
