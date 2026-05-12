import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "./ITPanel.css";

const OPEN_TICKETS_ROUTE = "/it/OpenTicket";

const authHeaders = () => {
  const token = localStorage.getItem("token");
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const countOpenQueries = (queries) =>
  (queries || []).filter((q) => String(q.status || "").trim().toLowerCase() !== "closed")
    .length;

export const ITPanel = () => {
  const navigate = useNavigate();
  const [openTicketCount, setOpenTicketCount] = useState(0);

  const cards = [
    { title: "Active Devices", route: "/it/ActiveDevices" },
    { title: "Open Tickets", route: OPEN_TICKETS_ROUTE },
    { title: "Assets", route: "/it/Assets" },
    { title: "Inventory", route: "/it/inventory" },
    { title: "Return Requests", route: "/it/return-requests" },
    { title: "NOC Request", route: "/it/noc-requests" },
  ];

  const refreshOpenTicketCount = useCallback(async () => {
    try {
      const res = await fetch("/api/query/queries", {
        method: "GET",
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setOpenTicketCount(0);
        return;
      }
      setOpenTicketCount(countOpenQueries(data.queries));
    } catch {
      setOpenTicketCount(0);
    }
  }, []);

  useEffect(() => {
    refreshOpenTicketCount();
  }, [refreshOpenTicketCount]);

  useEffect(() => {
    const onFocus = () => refreshOpenTicketCount();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshOpenTicketCount]);

  useEffect(() => {
    const onUpdated = () => refreshOpenTicketCount();
    window.addEventListener("it-open-tickets-updated", onUpdated);
    return () => window.removeEventListener("it-open-tickets-updated", onUpdated);
  }, [refreshOpenTicketCount]);

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
              {c.route === OPEN_TICKETS_ROUTE && openTicketCount > 0 ? (
                <span className="it-open-ticket-badge" title={`${openTicketCount} open ticket(s)`}>
                  {openTicketCount > 99 ? "99+" : openTicketCount}
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
