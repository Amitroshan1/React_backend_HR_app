import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, MessageCircle, Send, X } from "lucide-react";
import "./DepartmentQueryInbox.css";
import { QueryChatModal } from "./QueryChatModal";
import { QueryChatAttachmentsBar } from "./QueryChatAttachmentsBar";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import {
  QUERY_CHAT_PARAM,
  QUERY_CHAT_POLL_MS,
  QUERY_INBOX_POLL_MS,
  QUERY_LIST_PAGE_SIZE,
  mapChatMessages,
  messagesChanged,
  parseChatIdFromSearch,
  buildQueryAttachmentUrl,
  readApiResponse,
} from "./queryChatHelpers";
import { QueryListPagination } from "./QueryListPagination";

const API_BASE_URL = "/api/query";

export const DepartmentQueryInbox = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const [queries, setQueries] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [chatMessage, setChatMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [closingId, setClosingId] = useState(null);
  const [error, setError] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterCircle, setFilterCircle] = useState("");
  const [circleOptions, setCircleOptions] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const chatEndRef = useRef(null);
  const openChatRef = useRef(null);
  const restoreAttemptedRef = useRef(null);

  const setChatInUrl = useCallback((chatId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (chatId) {
        next.set(QUERY_CHAT_PARAM, String(chatId));
      } else {
        next.delete(QUERY_CHAT_PARAM);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closeChatPanel = useCallback(() => {
    setActiveChat(null);
    setChatInUrl(null);
  }, [setChatInUrl]);

  const getAuthHeaders = () => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const formatDateTime = (value) => formatDateTimeDDMMYYYY(value, "");

  const getStatusLabel = (status) => {
    if (status === "Open") return "In Progress";
    if (status === "Closed") return "Closed";
    return "New";
  };

  const notifyQueryBadgeRefresh = () => {
    try {
      window.dispatchEvent(new CustomEvent("queryNotificationsUpdated"));
    } catch {
      /* no-op */
    }
  };

  const markQueryRead = async (queryId) => {
    if (!queryId) return;
    try {
      await fetch(`${API_BASE_URL}/queries/${queryId}/mark-read`, {
        method: "POST",
        headers: { ...getAuthHeaders() },
      });
      setQueries((prev) =>
        prev.map((q) =>
          q.id === queryId
            ? { ...q, hasUnreadReply: false, unreadReplyCount: 0 }
            : q
        )
      );
      notifyQueryBadgeRefresh();
    } catch {
      /* non-blocking */
    }
  };

  const mapInboxRow = (q) => ({
    id: q.id,
    title: q.title,
    employeeName: q.employee_name || "Employee",
    employeeEmail: q.employee_email || q.employee || "—",
    status: q.status,
    createdAtRaw: q.created_at,
    createdAt: formatDateTime(q.created_at) || "—",
    hasUnreadReply: Boolean(q.has_unread_reply),
    unreadReplyCount: Number(q.unread_reply_count || 0),
  });

  const sortInboxRows = (rows) =>
    [...rows].sort((a, b) => {
      if (a.hasUnreadReply !== b.hasUnreadReply) {
        return a.hasUnreadReply ? -1 : 1;
      }
      return new Date(b.createdAtRaw) - new Date(a.createdAtRaw);
    });

  const fetchInbox = async (overrides, options = {}) => {
    const { silent = false } = options;
    const month =
      overrides && Object.prototype.hasOwnProperty.call(overrides, "month")
        ? overrides.month
        : filterMonth;
    const circle =
      overrides && Object.prototype.hasOwnProperty.call(overrides, "circle")
        ? overrides.circle
        : filterCircle;
    const pageNum =
      overrides && Object.prototype.hasOwnProperty.call(overrides, "page")
        ? overrides.page
        : page;

    if (!silent) {
      setIsLoading(true);
      setError("");
    }
    try {
      const params = new URLSearchParams();
      params.set("page", String(pageNum));
      params.set("limit", String(QUERY_LIST_PAGE_SIZE));
      if (month) params.set("month", month);
      if (circle) params.set("circle", circle);
      const response = await fetch(
        `${API_BASE_URL}/queries?${params.toString()}`,
        {
          method: "GET",
          headers: { ...getAuthHeaders() },
        }
      );
      const { ok, data: result, error: parseError } = await readApiResponse(response);
      if (response.status === 403) {
        navigate("/queries", { replace: true });
        return;
      }
      if (!ok || !result.success) {
        throw new Error(parseError || result.message || "Failed to load department queries");
      }

      const total = Number(result.total) || 0;
      const pages = total === 0 ? 1 : Math.max(1, Number(result.pages) || 1);
      if (total > 0 && pageNum > pages) {
        setPage(pages);
        return;
      }
      setPage(pageNum);
      setTotalCount(total);
      setTotalPages(pages);

      const mapped = sortInboxRows((result.queries || []).map(mapInboxRow));
      if (mapped.length === 0 && pageNum > 1 && total > 0) {
        setPage(pageNum - 1);
        return;
      }
      setQueries(mapped);
    } catch (e) {
      if (!silent) {
        setError(e.message || "Unable to load department queries");
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  const openQueryAttachment = async (queryId, storedName) => {
    const token = localStorage.getItem("token");
    if (!token) {
      setError("Please log in again to view attachments.");
      return;
    }
    try {
      const response = await fetch(buildQueryAttachmentUrl(API_BASE_URL, queryId, storedName), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error("Unable to open file");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      console.error("Open query attachment error:", e);
      setError(e.message || "Unable to open attachment");
    }
  };

  const openChat = useCallback(async (queryItem, options = {}) => {
    const { silent = false, skipUrl = false } = options;
    if (!queryItem?.id) return;
    if (!silent) setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/queries/${queryItem.id}`, {
        method: "GET",
        headers: { ...getAuthHeaders() },
      });
      const { ok, data: result, error: parseError } = await readApiResponse(response);
      if (!ok || !result.success) {
        throw new Error(parseError || result.message || "Failed to open query chat");
      }

      const messages = mapChatMessages(result.chat_messages, queryItem.id, formatDateTime);
      const attachments = Array.isArray(result.query?.attachments)
        ? result.query.attachments
        : (queryItem.attachments || []);
      const nextChat = {
        id: queryItem.id,
        title: result.query?.title || queryItem.title,
        status: result.query?.status || queryItem.status,
        attachments,
        messages,
      };

      setActiveChat((prev) => {
        if (
          silent &&
          prev?.id === nextChat.id &&
          !messagesChanged(prev.messages, messages) &&
          prev.status === nextChat.status &&
          JSON.stringify(prev.attachments || []) === JSON.stringify(attachments)
        ) {
          return prev;
        }
        return nextChat;
      });

      setQueries((prev) =>
        prev.map((q) =>
          q.id === nextChat.id
            ? {
                ...q,
                status: nextChat.status,
                title: nextChat.title,
                hasUnreadReply: false,
                unreadReplyCount: 0,
              }
            : q
        )
      );

      if (!silent) {
        await markQueryRead(queryItem.id);
      }

      if (!skipUrl) {
        setChatInUrl(nextChat.id);
      }
    } catch (e) {
      if (!silent) {
        setError(e.message || "Unable to open query chat");
      }
    }
  }, [setChatInUrl]);

  openChatRef.current = openChat;

  const sendReply = async () => {
    if (!chatMessage.trim() || !activeChat || isSending) return;
    setIsSending(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/queries/${activeChat.id}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ reply_text: chatMessage.trim() }),
      });
      const { ok, data: result, error: parseError } = await readApiResponse(response);
      if (!ok || !result.success) {
        throw new Error(parseError || result.message || "Failed to send reply");
      }
      setChatMessage("");
      await openChat(activeChat);
      await fetchInbox();
    } catch (e) {
      setError(e.message || "Unable to send reply");
    } finally {
      setIsSending(false);
    }
  };

  const closeQuery = async (id) => {
    if (!window.confirm("Mark this query as resolved (closed)? Notifications and closure emails will be sent.")) return;
    setClosingId(id);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/queries/${id}/close`, {
        method: "POST",
        headers: { ...getAuthHeaders() },
      });
      const { ok, data: result, error: parseError } = await readApiResponse(response);
      if (!ok || !result.success) {
        throw new Error(parseError || result.message || "Failed to close query");
      }
      await fetchInbox();
      if (activeChat?.id === id) {
        await openChat({ id: activeChat.id, title: activeChat.title });
      }
    } catch (e) {
      setError(e.message || "Unable to close query");
    } finally {
      setClosingId(null);
    }
  };

  useRefreshOnNavigate(() => {
    fetchInbox();
  }, [page, filterMonth, filterCircle]);

  useEffect(() => {
    if (!parseChatIdFromSearch(location.search)) {
      restoreAttemptedRef.current = null;
    }
  }, [location.search]);

  useEffect(() => {
    const chatId = parseChatIdFromSearch(location.search);
    if (!chatId || isLoading) return;
    if (activeChat?.id === chatId) return;
    if (restoreAttemptedRef.current === chatId) return;

    const fromList = queries.find((q) => q.id === chatId);
    const stub = fromList || { id: chatId, title: "Query", status: "Open" };
    restoreAttemptedRef.current = chatId;
    openChatRef.current?.(stub, { skipUrl: true, silent: true });
  }, [location.search, queries, isLoading, activeChat?.id]);

  useEffect(() => {
    const chatId = activeChat?.id;
    if (!chatId) return undefined;
    const poll = () => {
      openChatRef.current?.({ id: chatId }, { silent: true, skipUrl: true });
      fetchInbox(undefined, { silent: true });
    };
    const intervalId = window.setInterval(poll, QUERY_CHAT_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [activeChat?.id]);

  useEffect(() => {
    if (activeChat?.id) return undefined;
    const intervalId = window.setInterval(() => {
      fetchInbox(undefined, { silent: true });
    }, QUERY_INBOX_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [activeChat?.id, filterMonth, filterCircle, page]);

  useEffect(() => {
    const chatId = parseChatIdFromSearch(location.search);
    if (!chatId && activeChat) {
      setActiveChat(null);
    }
  }, [location.search, activeChat]);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("token");
    if (!token) return undefined;
    (async () => {
      try {
        const res = await fetch("/api/auth/master-options", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data.success && Array.isArray(data.circles)) {
          setCircleOptions(data.circles);
        }
      } catch (_) {
        /* circles optional for filtering */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyFilters = () => {
    if (page !== 1) {
      setPage(1);
    } else {
      fetchInbox({ page: 1 });
    }
  };

  const resetFilters = () => {
    setFilterMonth("");
    setFilterCircle("");
    fetchInbox({ month: "", circle: "", page: 1 });
  };

  const handlePageChange = (nextPage) => {
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const hasActiveFilters = Boolean(filterMonth || filterCircle);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages]);

  const unreadQueryCount = queries.filter((q) => q.hasUnreadReply).length;

  return (
    <div className="dept-query-page">
      <div className="dept-query-card">
        <div className="dept-query-header">
          <h2>Department Query Inbox</h2>
          <p>
            Only queries assigned to your department are shown.
            {unreadQueryCount > 0 && (
              <span className="dept-inbox-unread-summary">
                {" "}
                {unreadQueryCount} with unread {unreadQueryCount === 1 ? "message" : "messages"}.
              </span>
            )}
          </p>
        </div>

        <div className="dept-query-filters">
          <div className="dept-query-filter-field">
            <label htmlFor="dept-query-month">Month</label>
            <input
              id="dept-query-month"
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
            />
          </div>
          <div className="dept-query-filter-field">
            <label htmlFor="dept-query-circle">Circle</label>
            <select
              id="dept-query-circle"
              value={filterCircle}
              onChange={(e) => setFilterCircle(e.target.value)}
            >
              <option value="">All circles</option>
              {circleOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="dept-query-filter-actions">
            <button type="button" className="dept-filter-apply" onClick={applyFilters}>
              Apply filters
            </button>
            <button type="button" className="dept-filter-reset" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </div>

        {error && <div className="dept-query-error">{error}</div>}

        <div className="dept-query-table-wrap">
          <table className="dept-query-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Title</th>
                <th>Status</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan="6" className="dept-empty">Loading...</td>
                </tr>
              ) : queries.length === 0 ? (
                <tr>
                  <td colSpan="6" className="dept-empty">
                    {hasActiveFilters
                      ? "No queries match your filters."
                      : "No queries for your department."}
                  </td>
                </tr>
              ) : (
                queries.map((q) => (
                  <tr
                    key={q.id}
                    className={q.hasUnreadReply ? "dept-query-row-unread" : undefined}
                  >
                    <td data-label="Name">{q.employeeName}</td>
                    <td data-label="Email">{q.employeeEmail}</td>
                    <td data-label="Title">
                      <div className="dept-title-cell">
                        {q.hasUnreadReply && (
                          <span className="dept-unread-dot" title="Unread reply" aria-hidden="true" />
                        )}
                        <span className={q.hasUnreadReply ? "dept-title-unread" : undefined}>
                          {q.title}
                        </span>
                        {q.hasUnreadReply && (
                          <span className="dept-new-reply-pill">New reply</span>
                        )}
                      </div>
                    </td>
                    <td data-label="Status">{getStatusLabel(q.status)}</td>
                    <td data-label="Created">{q.createdAt}</td>
                    <td className="dept-action-cell" data-label="Action">
                      <button type="button" className="dept-chat-btn" onClick={() => openChat(q)}>
                        <MessageCircle size={14} />
                        Open Chat
                        {q.unreadReplyCount > 0 && (
                          <span className="dept-chat-unread-badge">
                            {q.unreadReplyCount > 9 ? "9+" : q.unreadReplyCount}
                          </span>
                        )}
                      </button>
                      {q.status !== "Closed" && (
                        <button
                          type="button"
                          className="dept-close-query-btn"
                          disabled={closingId === q.id}
                          onClick={() => closeQuery(q.id)}
                        >
                          <CheckCircle size={14} /> {closingId === q.id ? "…" : "Close"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <QueryListPagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={QUERY_LIST_PAGE_SIZE}
          onPageChange={handlePageChange}
          disabled={isLoading}
        />
      </div>

      <QueryChatModal
        open={Boolean(activeChat)}
        onClose={closeChatPanel}
        ariaLabelledBy="query-dept-chat-title"
      >
        {activeChat && (
          <div className="dept-chat-panel dept-chat-panel--modal">
            <div className="dept-chat-header">
              <div>
                <h3 id="query-dept-chat-title">{activeChat.title}</h3>
                <small>Reply as Department</small>
              </div>
              <div className="dept-chat-header-actions">
                {activeChat.status !== "Closed" && (
                  <button
                    type="button"
                    className="dept-close-query-btn dept-close-query-btn--compact"
                    disabled={closingId === activeChat.id}
                    onClick={() => closeQuery(activeChat.id)}
                  >
                    <CheckCircle size={14} /> {closingId === activeChat.id ? "Closing…" : "Close query"}
                  </button>
                )}
                <button type="button" className="dept-close-btn" onClick={closeChatPanel} aria-label="Close chat">
                  <X size={18} />
                </button>
              </div>
            </div>

            <QueryChatAttachmentsBar
              attachments={activeChat.attachments}
              label="Files uploaded by employee"
              onOpenFile={(file) => openQueryAttachment(activeChat.id, file)}
            />

            <div className="dept-chat-messages">
              {activeChat.messages.map((m) => (
                <div key={m.id} className={`dept-msg ${m.sender}`}>
                  <div className="dept-bubble">
                    <div className="dept-sender">{m.senderName}</div>
                    {m.text}
                    <span className="dept-time">{m.timestamp}</span>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="dept-chat-input">
              <input
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                placeholder="Type your reply..."
                onKeyDown={(e) => e.key === "Enter" && sendReply()}
                disabled={activeChat.status === "Closed"}
              />
              <button onClick={sendReply} disabled={activeChat.status === "Closed" || isSending}>
                <Send size={16} />
              </button>
            </div>
          </div>
        )}
      </QueryChatModal>
    </div>
  );
};
