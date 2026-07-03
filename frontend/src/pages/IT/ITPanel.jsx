import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import "./ITPanel.css";

const OPEN_TICKETS_ROUTE = "/it/OpenTicket";

const authHeaders = () => {
  const token = localStorage.getItem("token");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const countUnreadTicketReplies = (queries) =>
  (queries || []).filter((q) => {
    const closed = String(q.status || "").trim().toLowerCase() === "closed";
    if (closed) return false;
    return Boolean(q.has_unread_reply) || Number(q.unread_reply_count || 0) > 0;
  }).length;

export const ITPanel = () => {
  const navigate = useNavigate();
  const [unreadTicketCount, setUnreadTicketCount] = useState(0);

  const cards = [
    { title: "Active Devices", route: "/it/ActiveDevices" },
    { title: "Open Tickets", route: OPEN_TICKETS_ROUTE },
    { title: "Assets", route: "/it/Assets" },
    { title: "Inventory Management", route: "/it/inventory" },
    { title: "Return Requests", route: "/it/return-requests" },
    { title: "NOC Request", route: "/it/noc-requests" },
  ];

  const refreshUnreadTicketCount = useCallback(async () => {
    try {
      const res = await fetch("/api/query/queries", {
        method: "GET",
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setUnreadTicketCount(0);
        return;
      }
      setUnreadTicketCount(countUnreadTicketReplies(data.queries));
    } catch {
      setUnreadTicketCount(0);
    }
  }, []);

  useRefreshOnNavigate(refreshUnreadTicketCount);

  useEffect(() => {
    const onFocus = () => refreshUnreadTicketCount();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshUnreadTicketCount]);

  useEffect(() => {
    const onUpdated = () => refreshUnreadTicketCount();
    window.addEventListener("it-open-tickets-updated", onUpdated);
    return () => window.removeEventListener("it-open-tickets-updated", onUpdated);
  }, [refreshUnreadTicketCount]);

  return (
    <div className="it-panel-container">
      <div className="it-panel-header">
        <p className="it-panel-lead">System Administration &amp; Support Management</p>
      </div>
      <div className="it-panel-content">
        <div className="it-stats-grid">
          {cards.map((c) => (
            <div
              key={c.title}
              className="it-stat-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate(c.route)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") navigate(c.route);
              }}
            >
              {c.route === OPEN_TICKETS_ROUTE && unreadTicketCount > 0 ? (
                <span
                  className="it-open-ticket-badge"
                  title={`${unreadTicketCount} ticket${unreadTicketCount === 1 ? "" : "s"} with unread ${unreadTicketCount === 1 ? "reply" : "replies"}`}
                >
                  {unreadTicketCount > 99 ? "99+" : unreadTicketCount}
                </span>
              ) : null}
              <h3>{c.title}</h3>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
