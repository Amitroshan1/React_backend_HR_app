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
                // Trailing slash required: Flask redirects /api/notifications → /api/notifications/
                // and the redirect to :5000 drops Authorization (401).
                const res = await fetch("/api/notifications/?limit=15", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (!data.success || cancelled) return;

                const unread = (data.notifications || []).filter((n) => !n.is_read);
                // Query replies use inline Chat badges + header count — no login toasts.
                const otherUnread = unread.filter((n) => n.type !== "query");

                let toastIndex = 0;
                const scheduleToast = (message, autoClose = 5000) => {
                    window.setTimeout(() => {
                        if (cancelled) return;
                        notifyInfo(message, { autoClose });
                    }, toastIndex * 450);
                    toastIndex += 1;
                };

                otherUnread.slice(0, 3).forEach((n) => {
                    const message = [n.title, n.body].filter(Boolean).join(" — ");
                    scheduleToast(message || "You have a new notification");
                });

                const otherBeyond = otherUnread.length - 3;
                if (otherBeyond > 0) {
                    scheduleToast(`${otherBeyond} more unread notifications`, 4000);
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
