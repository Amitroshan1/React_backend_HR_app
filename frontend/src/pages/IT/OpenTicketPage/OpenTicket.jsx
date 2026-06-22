
import { useState, useMemo, useEffect, useCallback, useRef, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { Paperclip } from "lucide-react";
import { toast } from "react-toastify";
import { getITApiErrorMessage } from "../Data";
import {
  buildQueryAttachmentUrl,
  queryAttachmentDisplayName,
  QUERY_INBOX_POLL_MS,
} from "../../Query/queryChatHelpers";
import "./OpenTicket.css";
import { formatDate as fmt, formatDateTimeDDMMYYYY } from "../../../utils/dateFormat";

const QUERY_API_BASE = "/api/query";

// ─── Constants ────────────────────────────────────────────────────────────────
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

/** Map HR Query row → ticket row used by this table */
const mapQueryToTicket = (q) => {
  const st = norm(q.status);
  const closed = st === "closed";
  return {
    id: q.id,
    empId: (q.emp_id || "").trim() || "—",
    email: (q.employee || "").trim() || "—",
    title: q.title || "",
    query: q.query_text || "",
    date: q.created_at,
    status: closed ? "completed" : "pending",
    rawStatus: q.status || "New",
    hasUnreadReply: Boolean(q.has_unread_reply),
    unreadReplyCount: Number(q.unread_reply_count || 0),
  };
};

const fmtDateTime = (value) => formatDateTimeDDMMYYYY(value, "");

const statusBadgeLabel = (raw) => {
  const s = norm(raw);
  if (s === "closed") return "Resolved";
  if (s === "open") return "In progress";
  return "Pending";
};

/** Milliseconds for sorting by ticket date (invalid dates → 0). */
const ticketCreatedMs = (t) => {
  const ms = new Date(t.date).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

/** All searchable fields as one lowercased string (supports multi-word search). */
const ticketSearchBlob = (t) =>
  [
    t.id,
    t.empId,
    t.email,
    t.title,
    t.query,
    t.rawStatus,
    fmt(t.date),
  ]
    .map((p) => String(p ?? "").toLowerCase())
    .join(" ");

// ─── Main Component ───────────────────────────────────────────────────────────
export default function OpenTicket() {
  const navigate = useNavigate();
  const chatEndRef = useRef(null);

  const [tickets, setTickets] = useState([]);
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState("Pending");
  const [sortOrder, setSortOrder] = useState("newest");

  const [chatTicket, setChatTicket] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatAttachments, setChatAttachments] = useState([]);
  const [chatQueryMeta, setChatQueryMeta] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [replyText, setReplyText] = useState("");

  const loadTickets = useCallback(async () => {
    const response = await fetch(`${QUERY_API_BASE}/queries`, {
      method: "GET",
      headers: authHeaders(),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Failed to load department queries");
    }
    const rows = (result.queries || []).map(mapQueryToTicket);
    setTickets(rows);
    try {
      window.dispatchEvent(new Event("it-open-tickets-updated"));
    } catch {
      /* no-op */
    }
  }, []);

  useEffect(() => {
    const run = async () => {
      try {
        await loadTickets();
      } catch (err) {
        console.error("[OpenTicket] Failed to load queries:", err);
        toast.error(
          getITApiErrorMessage(
            err,
            "Could not load queries from the server. You may need department (e.g. IT) access.",
          ),
        );
        setTickets([]);
        try {
          window.dispatchEvent(new Event("it-open-tickets-updated"));
        } catch {
          /* no-op */
        }
      }
    };
    run();
  }, [loadTickets]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadTickets().catch(() => {});
    }, QUERY_INBOX_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadTickets]);

  const markTicketRead = useCallback(async (ticketId) => {
    if (!ticketId) return;
    try {
      await fetch(`${QUERY_API_BASE}/queries/${ticketId}/mark-read`, {
        method: "POST",
        headers: authHeaders(),
      });
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId
            ? { ...t, hasUnreadReply: false, unreadReplyCount: 0 }
            : t,
        ),
      );
      try {
        window.dispatchEvent(new Event("it-open-tickets-updated"));
      } catch {
        /* no-op */
      }
    } catch {
      /* non-blocking */
    }
  }, []);

  const openChat = useCallback(async (ticket) => {
    setChatTicket(ticket);
    setReplyText("");
    setChatLoading(true);
    setChatMessages([]);
    setChatAttachments([]);
    setChatQueryMeta(null);
    try {
      const response = await fetch(`${QUERY_API_BASE}/queries/${ticket.id}`, {
        method: "GET",
        headers: authHeaders(),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to open query chat");
      }
      setChatQueryMeta(result.query || null);
      setChatAttachments(
        Array.isArray(result.query?.attachments) ? result.query.attachments : [],
      );
      const messages = (result.chat_messages || []).map((m, idx) => ({
        id: `${ticket.id}-${idx}`,
        senderName: m.by || "User",
        side: m.user_type === "EMPLOYEE" ? "emp" : "dept",
        text: m.text,
        ts: fmtDateTime(m.created_at),
      }));
      setChatMessages(messages);
      setChatTicket((prev) =>
        prev?.id === ticket.id
          ? { ...prev, hasUnreadReply: false, unreadReplyCount: 0 }
          : prev,
      );
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticket.id
            ? { ...t, hasUnreadReply: false, unreadReplyCount: 0 }
            : t,
        ),
      );
      await markTicketRead(ticket.id);
    } catch (err) {
      console.error("[OpenTicket] Chat load failed:", err);
      toast.error(getITApiErrorMessage(err, "Could not load chat history."));
      setChatTicket(null);
    } finally {
      setChatLoading(false);
    }
  }, [markTicketRead]);

  const closeChat = useCallback(() => {
    setChatTicket(null);
    setChatMessages([]);
    setChatAttachments([]);
    setChatQueryMeta(null);
    setReplyText("");
  }, []);

  const openQueryAttachment = useCallback(async (queryId, storedName) => {
    const token = localStorage.getItem("token");
    if (!token) {
      toast.error("Please log in again to view attachments.");
      return;
    }
    try {
      const response = await fetch(
        buildQueryAttachmentUrl(QUERY_API_BASE, queryId, storedName),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        throw new Error("Unable to open file");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error("[OpenTicket] Open attachment failed:", err);
      toast.error(getITApiErrorMessage(err, "Unable to open attachment."));
    }
  }, []);

  const sendReply = useCallback(async () => {
    if (!chatTicket || !replyText.trim() || chatSending) return;
    const closed = norm(chatQueryMeta?.status) === "closed";
    if (closed) return;
    setChatSending(true);
    try {
      const response = await fetch(`${QUERY_API_BASE}/queries/${chatTicket.id}/reply`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ reply_text: replyText.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to send reply");
      }
      setReplyText("");
      await openChat(chatTicket);
      await loadTickets();
    } catch (err) {
      console.error("[OpenTicket] Reply failed:", err);
      toast.error(getITApiErrorMessage(err, "Could not send your reply."));
    } finally {
      setChatSending(false);
    }
  }, [chatTicket, chatQueryMeta, replyText, chatSending, openChat, loadTickets]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  // ── Filtered + Sorted tickets ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    const allowedStatuses =
      statusTab === "Pending" ? PENDING_STATUSES : COMPLETED_STATUSES;

    const tokens = search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const result = tickets.filter((t) => {
      if (!allowedStatuses.includes(t.status)) return false;
      if (tokens.length === 0) return true;
      const blob = ticketSearchBlob(t);
      return tokens.every((tok) => blob.includes(tok));
    });

    return [...result].sort((a, b) => {
      if (a.hasUnreadReply !== b.hasUnreadReply) {
        return a.hasUnreadReply ? -1 : 1;
      }
      const ta = ticketCreatedMs(a);
      const tb = ticketCreatedMs(b);
      let diff = ta - tb;
      if (diff === 0) diff = (Number(a.id) || 0) - (Number(b.id) || 0);
      return sortOrder === "oldest" ? diff : -diff;
    });
  }, [tickets, search, statusTab, sortOrder]);

  const unreadPendingCount = useMemo(
    () => tickets.filter((t) => t.status === "pending" && t.hasUnreadReply).length,
    [tickets],
  );

  const handleResolve = async (id) => {
    if (!window.confirm("Mark this query as resolved (closed)?")) return;
    try {
      const response = await fetch(`${QUERY_API_BASE}/queries/${id}/close`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to close query");
      }
      await loadTickets();
      if (chatTicket?.id === id) {
        closeChat();
      }
      toast.success("Query marked as resolved.");
    } catch (err) {
      console.error("[OpenTicket] Close query failed:", err);
      toast.error(getITApiErrorMessage(err, "Could not resolve this query on the server."));
    }
  };

  const pendingCount = tickets.filter((t) => PENDING_STATUSES.includes(t.status)).length;
  const completedCount = tickets.filter((t) => COMPLETED_STATUSES.includes(t.status)).length;

  const chatClosed = norm(chatQueryMeta?.status) === "closed";

  return (
    <div className="ot-page">
      {/* ── Header ── */}
      <div className="ot-header">
        <div className="ot-header-left">
          <button className="ot-back-btn" type="button" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <div>
            <h1 className="ot-title">Ticket Management</h1>
            <p className="ot-subtitle">Track and resolve employee support requests</p>
          </div>
        </div>
      </div>

      {/* ── Controls Bar ── */}
      <div className="ot-controls">
        <div className="ot-tabs">
          {["Pending", "Completed"].map((tab) => (
            <button
              key={tab}
              className={`ot-tab ${statusTab === tab ? "active" : ""}`}
              onClick={() => setStatusTab(tab)}
            >
              {tab}
              <span className="ot-tab-badge">
                {tab === "Pending" ? pendingCount : completedCount}
              </span>
            </button>
          ))}
        </div>

        <div className="ot-controls-right">
          <div className="ot-search-wrap">
            <span className="ot-search-icon">🔍</span>
            <input
              className="ot-search-input"
              placeholder="Search by EMP ID, email or query..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="ot-search-clear" onClick={() => setSearch("")}>×</button>
            )}
          </div>

          <div className="ot-sort-wrap">
            <button
              className={`ot-sort-btn ${sortOrder === "newest" ? "active" : ""}`}
              onClick={() => setSortOrder("newest")}
            >
              ↓ Newest
            </button>
            <button
              className={`ot-sort-btn ${sortOrder === "oldest" ? "active" : ""}`}
              onClick={() => setSortOrder("oldest")}
            >
              ↑ Oldest
            </button>
          </div>
        </div>
      </div>

      {/* ── Table Card ── */}
      <div className="ot-card">
        <div className="ot-card-head">
          <div className="ot-card-head-left">
            <span className="ot-card-title">
              {statusTab === "Pending" ? "Active Tickets" : "Resolved Tickets"}
            </span>
            <span className="ot-card-desc">
              Sorted by {sortOrder === "newest" ? "newest first" : "oldest first"}
              {unreadPendingCount > 0 && (
                <span className="ot-unread-summary">
                  {" "}
                  · {unreadPendingCount} with unread{" "}
                  {unreadPendingCount === 1 ? "reply" : "replies"}
                </span>
              )}
            </span>
          </div>
          <span className="ot-card-count">
            {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="ot-table-scroll">
          <table className="ot-table">
            <thead>
              <tr>
                <th>#</th>
                <th>EMP ID</th>
                <th>Email</th>
                <th>Query Details</th>
                <th>Date</th>
                <th>Status</th>
                <th>Chat</th>
                {statusTab === "Pending" && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={statusTab === "Pending" ? 8 : 7} className="ot-empty">
                    <div className="ot-empty-inner">
                      <span className="ot-empty-icon">📭</span>
                      <p>No {statusTab === "Pending" ? "active" : "resolved"} tickets found</p>
                      {search && <span>Try clearing the search filter</span>}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((ticket, i) => {
                  const meta = STATUS_META[ticket.status];
                  const bLabel = statusBadgeLabel(ticket.rawStatus);
                  return (
                    <tr
                      key={ticket.id}
                      className={ticket.hasUnreadReply ? "ot-tr ot-tr-unread" : "ot-tr"}
                    >
                      <td className="ot-td-idx">{i + 1}</td>
                      <td><span className="ot-emp-id">{ticket.empId}</span></td>
                      <td><span className="ot-email">{ticket.email}</span></td>
                      <td className="ot-td-query">
                        <div className="ot-query-title-cell">
                          {ticket.hasUnreadReply && (
                            <span className="ot-unread-dot" title="Unread reply" aria-hidden="true" />
                          )}
                          <span className={ticket.hasUnreadReply ? "ot-query-title ot-query-title-unread" : "ot-query-title"}>
                            {ticket.title}
                          </span>
                          {ticket.hasUnreadReply && (
                            <span className="ot-new-reply-pill">New reply</span>
                          )}
                        </div>
                        <span className="ot-query">{ticket.query}</span>
                      </td>
                      <td><span className="ot-date">{fmt(ticket.date)}</span></td>
                      <td>
                        <span
                          className="ot-status-badge"
                          style={{
                            background: meta.bg,
                            color: meta.color,
                            border: `1px solid ${meta.border}`,
                          }}
                        >
                          <span className="ot-status-dot" style={{ background: meta.dot }} />
                          {bLabel}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`ot-chat-btn${ticket.hasUnreadReply ? " ot-chat-btn-unread" : ""}`}
                          onClick={() => openChat(ticket)}
                          title={ticket.hasUnreadReply ? "Unread employee reply" : "Open chat"}
                        >
                          ✉ Chat
                          {ticket.unreadReplyCount > 0 && (
                            <span className="ot-chat-unread-badge">
                              {ticket.unreadReplyCount > 9 ? "9+" : ticket.unreadReplyCount}
                            </span>
                          )}
                        </button>
                      </td>
                      {statusTab === "Pending" && (
                        <td>
                          {ticket.status === "completed" ? (
                            <span className="ot-resolved-badge">✓ Resolved</span>
                          ) : (
                            <button
                              type="button"
                              className="ot-resolve-btn"
                              onClick={() => handleResolve(ticket.id)}
                            >
                              Resolve
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {chatTicket && (
        <div className="ot-chat-backdrop" role="presentation" onClick={closeChat}>
          <div className="ot-chat-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ot-chat-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ot-chat-head">
              <div>
                <h3 id="ot-chat-title" className="ot-chat-title">
                  {chatQueryMeta?.title || chatTicket.title}
                </h3>
                <p className="ot-chat-meta">
                  {chatTicket.empId} · {chatTicket.email}
                  {chatQueryMeta?.status && (
                    <span className="ot-chat-status-pill">{chatQueryMeta.status}</span>
                  )}
                </p>
              </div>
              <button type="button" className="ot-chat-close" onClick={closeChat} aria-label="Close">
                ×
              </button>
            </div>

            <div className="ot-chat-messages">
              {chatLoading ? (
                <p className="ot-chat-loading">Loading conversation…</p>
              ) : (
                <>
                  {chatMessages.map((m, index) => (
                    <Fragment key={m.id}>
                      {index === 0 && chatAttachments.length > 0 && (
                        <div className={`ot-msg ot-msg--${m.side}`}>
                          <div className="ot-msg-attachments">
                            {chatAttachments.map((file) => (
                              <button
                                key={file}
                                type="button"
                                className="ot-msg-attachment-chip"
                                onClick={() => openQueryAttachment(chatTicket.id, file)}
                                title={queryAttachmentDisplayName(file)}
                              >
                                <Paperclip size={13} aria-hidden="true" />
                                <span>{queryAttachmentDisplayName(file)}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className={`ot-msg ot-msg--${m.side}`}>
                        <div className="ot-msg-bubble">
                          <div className="ot-msg-from">{m.senderName}</div>
                          <div className="ot-msg-text">{m.text}</div>
                          <div className="ot-msg-time">{m.ts}</div>
                        </div>
                      </div>
                    </Fragment>
                  ))}
                  <div ref={chatEndRef} />
                </>
              )}
            </div>

            <div className="ot-chat-input-row">
              <input
                className="ot-chat-input"
                placeholder={chatClosed ? "Query is closed" : "Type a reply…"}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                disabled={chatClosed || chatLoading}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendReply()}
              />
              <button
                type="button"
                className="ot-chat-send"
                onClick={sendReply}
                disabled={chatClosed || chatLoading || chatSending || !replyText.trim()}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
