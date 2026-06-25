import { useEffect, useRef } from "react";
import { notifyInfo } from "../utils/notify";

const LOGIN_NOTIF_KEY = "loginNotificationsShown";

export function clearLoginNotificationsFlag() {
    sessionStorage.removeItem(LOGIN_NOTIF_KEY);
}

function countUniqueQueryThreads(notifications) {
    const ids = new Set();
    notifications.forEach((n) => {
        if (n.entity_id != null) {
            ids.add(n.entity_id);
        }
    });
    return ids.size || notifications.length;
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
                const queryUnread = unread.filter((n) => n.type === "query");
                const otherUnread = unread.filter((n) => n.type !== "query");

                let toastIndex = 0;
                const scheduleToast = (message, autoClose = 5000) => {
                    window.setTimeout(() => {
                        if (cancelled) return;
                        notifyInfo(message, { autoClose });
                    }, toastIndex * 450);
                    toastIndex += 1;
                };

                if (queryUnread.length > 0) {
                    const threadCount = countUniqueQueryThreads(queryUnread);
                    scheduleToast(
                        threadCount === 1
                            ? "You have a new reply on your query. Open Queries to view."
                            : `${threadCount} queries have new replies. Open Queries to view.`,
                        6000
                    );
                }

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
