import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useRefreshOnNavigate } from "../../../hooks/useRefreshOnNavigate";
import { toastITApiFailure } from "../Data";
import {
  filterQueriesForItInbox,
  QUERY_INBOX_POLL_MS,
} from "../../Query/queryChatHelpers";
import "./OpenTicket.css";
import { formatDate as fmt } from "../../../utils/dateFormat";

const QUERY_API_BASE = "/api/query";
const PAGE_SIZE = 6;

const PENDING_STATUSES = ["pending"];
const COMPLETED_STATUSES = ["completed"];

const STATUS_META = {
  pending: {
    label: "Pending",
    bg: "#fef2f2", color: "#ef4444", border: "#fecaca", dot: "#ef4444",
  },
  completed: {
    label: "Completed",
    bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0", dot: "#22c55e",
  },
};

const authHeaders = () => {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const norm = (s) => String(s || "").trim().toLowerCase();

export const mapQueryToTicket = (q) => {
  const st = norm(q.status);
  const closed = st === "closed";
  return {
    id: q.id,
    empId: (q.emp_id || "").trim() || "—",
    email: (q.employee || "").trim() || "—",
    title: q.title || "",
    department: q.department || "",
    query: q.query_text || "",
    date: q.created_at,
    status: closed ? "completed" : "pending",
    rawStatus: q.status || "New",
    hasUnreadReply: Boolean(q.has_unread_reply),
    unreadReplyCount: Number(q.unread_reply_count || 0),
  };
};

export const statusBadgeLabel = (raw) => {
  const s = norm(raw);
  if (s === "closed") return "Resolved";
  if (s === "open") return "In progress";
  return "Pending";
};

const ticketCreatedMs = (t) => {
  const ms = new Date(t.date).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const ticketSearchBlob = (t) =>
  [t.id, t.empId, t.email, t.department, t.title, t.query, t.rawStatus, fmt(t.date)]
    .map((p) => String(p ?? "").toLowerCase())
    .join(" ");

export default function OpenTicket() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState("Pending");
  const [sortOrder, setSortOrder] = useState("newest");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const loadTickets = useCallback(async () => {
    const response = await fetch(`${QUERY_API_BASE}/queries/it-inbox`, {
      method: "GET",
      headers: authHeaders(),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Failed to load department queries");
    }
    setTickets(filterQueriesForItInbox(result.queries || []).map(mapQueryToTicket));
    try {
      window.dispatchEvent(new Event("it-open-tickets-updated"));
    } catch {
      /* no-op */
    }
  }, []);

  const refreshTickets = useCallback(() => {
    loadTickets().catch((err) => {
      toastITApiFailure(
        err,
        "Could not load queries from the server. You may need department (e.g. IT) access.",
      );
      setTickets([]);
    });
  }, [loadTickets]);

  useRefreshOnNavigate(refreshTickets);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      loadTickets().catch(() => {});
    }, QUERY_INBOX_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") loadTickets().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadTickets]);

  const filtered = useMemo(() => {
    const allowedStatuses = statusTab === "Pending" ? PENDING_STATUSES : COMPLETED_STATUSES;
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const result = tickets.filter((t) => {
      if (!allowedStatuses.includes(t.status)) return false;
      if (tokens.length === 0) return true;
      return tokens.every((tok) => ticketSearchBlob(t).includes(tok));
    });
    return [...result].sort((a, b) => {
      const diff = ticketCreatedMs(a) - ticketCreatedMs(b);
      if (diff !== 0) return sortOrder === "oldest" ? diff : -diff;
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
  }, [tickets, search, statusTab, sortOrder]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, statusTab, sortOrder]);

  const visibleTickets = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const unreadPendingCount = tickets.filter((t) => t.status === "pending" && t.hasUnreadReply).length;
  const pendingCount = tickets.filter((t) => PENDING_STATUSES.includes(t.status)).length;
  const completedCount = tickets.filter((t) => COMPLETED_STATUSES.includes(t.status)).length;

  return (
    <div className="ot-page">
      <div className="ot-header">
        <div className="ot-header-left">
          <button className="ot-back-btn" type="button" onClick={() => navigate("/it")}>
            ← Back
          </button>
          <div>
            <h1 className="ot-title">Ticket Management</h1>
            <p className="ot-subtitle">Track and resolve employee support requests</p>
          </div>
        </div>
      </div>

      <div className="ot-controls">
        <div className="ot-tabs">
          {["Pending", "Completed"].map((tab) => (
            <button
              key={tab}
              className={`ot-tab ${statusTab === tab ? "active" : ""}`}
              onClick={() => {
                setStatusTab(tab);
                setVisibleCount(PAGE_SIZE);
              }}
            >
              {tab}
              <span className="ot-tab-badge">
                {tab === "Pending" ? pendingCount : completedCount}
              </span>
            </button>
          ))}
        </div>

        <div className="ot-controls-right">
          <label className="ot-search-wrap" htmlFor="ot-search">
            <Search className="ot-search-icon" size={16} aria-hidden />
            <input
              id="ot-search"
              className="ot-search-input"
              type="search"
              placeholder="Search employee ID, email, or department…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
            {search ? (
              <button type="button" className="ot-search-clear" onClick={() => setSearch("")} aria-label="Clear search">×</button>
            ) : null}
          </label>
          <div className="ot-sort-wrap">
            <button className={`ot-sort-btn ${sortOrder === "newest" ? "active" : ""}`} onClick={() => setSortOrder("newest")}>
              ↓ Newest
            </button>
            <button className={`ot-sort-btn ${sortOrder === "oldest" ? "active" : ""}`} onClick={() => setSortOrder("oldest")}>
              ↑ Oldest
            </button>
          </div>
        </div>
      </div>

      <div className="ot-card">
        <div className="ot-card-head">
          <div className="ot-card-head-left">
            <span className="ot-card-title">
              {statusTab === "Pending" ? "Active Tickets" : "Resolved Tickets"}
            </span>
            <span className="ot-card-desc">
              Sorted by {sortOrder === "newest" ? "newest first" : "oldest first"}
              {unreadPendingCount > 0 ? (
                <span className="ot-unread-summary">
                  {" "}· {unreadPendingCount} with unread {unreadPendingCount === 1 ? "reply" : "replies"}
                </span>
              ) : null}
            </span>
          </div>
          <span className="ot-card-count">
            {visibleTickets.length} of {filtered.length}
          </span>
        </div>

        <div className="ot-table-scroll it-m-scroll--cards">
          <table className="ot-table ot-table--list">
            <thead>
              <tr>
                <th>Emp ID</th>
                <th>Email</th>
                <th>Department</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="ot-empty">
                    <div className="ot-empty-inner">
                      <span className="ot-empty-icon">📭</span>
                      <p>No {statusTab === "Pending" ? "active" : "resolved"} tickets found</p>
                      {search ? <span>Try clearing the search filter</span> : null}
                    </div>
                  </td>
                </tr>
              ) : (
                visibleTickets.map((ticket) => {
                  const meta = STATUS_META[ticket.status];
                  return (
                    <tr
                      key={ticket.id}
                      className={ticket.hasUnreadReply ? "ot-tr ot-tr-unread" : "ot-tr"}
                    >
                      <td data-label="Emp ID"><span className="ot-emp-id">{ticket.empId}</span></td>
                      <td data-label="Email"><span className="ot-email">{ticket.email}</span></td>
                      <td data-label="Department">
                        <span className="ot-dept-badge" title={ticket.department || ""}>
                          {ticket.department || "—"}
                        </span>
                      </td>
                      <td data-label="Status">
                        <span
                          className="ot-status-badge"
                          style={{
                            background: meta.bg,
                            color: meta.color,
                            border: `1px solid ${meta.border}`,
                          }}
                        >
                          <span className="ot-status-dot" style={{ background: meta.dot }} />
                          {statusBadgeLabel(ticket.rawStatus)}
                          {ticket.hasUnreadReply ? <span className="ot-new-reply-pill">New</span> : null}
                        </span>
                      </td>
                      <td data-label="Action">
                        <button
                          type="button"
                          className="ot-view-btn"
                          onClick={() => navigate(`/it/OpenTicket/${ticket.id}`, { state: { ticket } })}
                        >
                          View details
                          {ticket.unreadReplyCount > 0 ? (
                            <span className="ot-chat-unread-badge">
                              {ticket.unreadReplyCount > 9 ? "9+" : ticket.unreadReplyCount}
                            </span>
                          ) : null}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {hasMore ? (
          <div className="ot-more-wrap">
            <button
              type="button"
              className="ot-more-btn"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              Show more
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}




