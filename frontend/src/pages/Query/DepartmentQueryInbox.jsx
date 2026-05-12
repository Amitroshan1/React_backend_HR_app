import React, { useEffect, useRef, useState } from "react";
import { CheckCircle, MessageCircle, Send, X } from "lucide-react";
import "./DepartmentQueryInbox.css";

const API_BASE_URL = "/api/query";

export const DepartmentQueryInbox = () => {
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
  const chatEndRef = useRef(null);

  const getAuthHeaders = () => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const formatDateTime = (value) => {
    if (value == null || value === "") return "";
    if (typeof value === "string") {
      let s = value.trim();
      if (!s) return "";
      if (/^\d{4}-\d{2}-\d{2} \d/.test(s)) s = s.replace(" ", "T");
      const date = new Date(s);
      if (Number.isNaN(date.getTime())) return s;
      return date.toLocaleString();
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  };

  const getStatusLabel = (status) => {
    if (status === "Open") return "In Progress";
    if (status === "Closed") return "Closed";
    return "New";
  };

  const fetchInbox = async (overrides) => {
    const month =
      overrides && Object.prototype.hasOwnProperty.call(overrides, "month")
        ? overrides.month
        : filterMonth;
    const circle =
      overrides && Object.prototype.hasOwnProperty.call(overrides, "circle")
        ? overrides.circle
        : filterCircle;

    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (month) params.set("month", month);
      if (circle) params.set("circle", circle);
      const qs = params.toString();
      const response = await fetch(
        qs ? `${API_BASE_URL}/queries?${qs}` : `${API_BASE_URL}/queries`,
        {
          method: "GET",
          headers: { ...getAuthHeaders() },
        }
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to load department queries");
      }

      const mapped = (result.queries || []).map((q) => ({
        id: q.id,
        title: q.title,
        employee: q.employee || "Employee",
        status: q.status,
        createdAtRaw: q.created_at,
        createdAt: formatDateTime(q.created_at) || "—",
      }));

      mapped.sort((a, b) => new Date(b.createdAtRaw) - new Date(a.createdAtRaw));
      setQueries(mapped);
    } catch (e) {
      setError(e.message || "Unable to load department queries");
    } finally {
      setIsLoading(false);
    }
  };

  const openChat = async (queryItem) => {
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/queries/${queryItem.id}`, {
        method: "GET",
        headers: { ...getAuthHeaders() },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to open query chat");
      }

      const messages = (result.chat_messages || []).map((m, idx) => ({
        id: `${queryItem.id}-${idx}`,
        senderName: m.by || "User",
        sender: m.user_type === "EMPLOYEE" ? "user" : "department",
        text: m.text,
        timestamp: formatDateTime(m.created_at),
      }));

      setActiveChat({
        id: queryItem.id,
        title: result.query?.title || queryItem.title,
        status: result.query?.status || queryItem.status,
        messages,
      });
    } catch (e) {
      setError(e.message || "Unable to open query chat");
    }
  };

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
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to send reply");
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
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to close query");
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

  useEffect(() => {
    fetchInbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only; filters refreshed via Apply / Reset
  }, []);

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
    fetchInbox();
  };

  const resetFilters = () => {
    setFilterMonth("");
    setFilterCircle("");
    fetchInbox({ month: "", circle: "" });
  };

  const hasActiveFilters = Boolean(filterMonth || filterCircle);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const params = new URLSearchParams(window.location.search);
    if (!token || params.get("from") !== "notification") return;
    fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ all: true, type: "query" }),
    }).catch(() => {});
  }, []);

  return (
    <div className="dept-query-page">
      <div className="dept-query-card">
        <div className="dept-query-header">
          <h2>Department Query Inbox</h2>
          <p>Only queries assigned to your department are shown.</p>
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
                <th>Title</th>
                <th>Employee</th>
                <th>Status</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan="5" className="dept-empty">Loading...</td>
                </tr>
              ) : queries.length === 0 ? (
                <tr>
                  <td colSpan="5" className="dept-empty">
                    {hasActiveFilters
                      ? "No queries match your filters."
                      : "No queries for your department."}
                  </td>
                </tr>
              ) : (
                queries.map((q) => (
                  <tr key={q.id}>
                    <td>{q.title}</td>
                    <td>{q.employee}</td>
                    <td>{getStatusLabel(q.status)}</td>
                    <td>{q.createdAt}</td>
                    <td className="dept-action-cell">
                      <button type="button" className="dept-chat-btn" onClick={() => openChat(q)}>
                        <MessageCircle size={14} /> Open Chat
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
      </div>

      {activeChat && (
        <div className="dept-chat-panel">
          <div className="dept-chat-header">
            <div>
              <h3>{activeChat.title}</h3>
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
              <button type="button" className="dept-close-btn" onClick={() => setActiveChat(null)} aria-label="Close panel">
                <X size={18} />
              </button>
            </div>
          </div>

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
    </div>
  );
};
