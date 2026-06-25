import { useEffect, useRef } from "react";
import { notifyInfo } from "../utils/notify";

const LOGIN_NOTIF_KEY = "loginNotificationsShown";

export function clearLoginNotificationsFlag() {
    sessionStorage.removeItem(LOGIN_NOTIF_KEY);
}

export function useFloatingNotifications(enabled) {
    const fetchedRef = useRef(false);

    useEffect(() => {
        if (!enabled || fetchedRef.current) return;
        const token = localStorage.getItem("token");
        if (!token) return;
        if (sessionStorage.getItem(LOGIN_NOTIF_KEY) === "1") return;

        let cancelled = false;
        fetchedRef.current = true;

        (async () => {
            try {
                const res = await fetch("/api/notifications?limit=15", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (!data.success || cancelled) return;

                const unread = (data.notifications || []).filter((n) => !n.is_read);
                unread.slice(0, 5).forEach((n, i) => {
                    window.setTimeout(() => {
                        if (cancelled) return;
                        const message = [n.title, n.body].filter(Boolean).join(" — ");
                        notifyInfo(message || "You have a new notification", { autoClose: 5000 });
                    }, i * 450);
                });

                if (unread.length > 5) {
                    window.setTimeout(() => {
                        if (!cancelled) {
                            notifyInfo(`${unread.length - 5} more unread notifications`, { autoClose: 4000 });
                        }
                    }, 5 * 450);
                }

                sessionStorage.setItem(LOGIN_NOTIF_KEY, "1");
            } catch {
                fetchedRef.current = false;
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [enabled]);
}
