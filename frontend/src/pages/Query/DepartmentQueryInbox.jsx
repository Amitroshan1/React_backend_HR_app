import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import "./DepartmentQueryInbox.css";

const API_BASE_URL = "/api/query";

export const DepartmentQueryInbox = () => {
  const [queries, setQueries] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [chatMessage, setChatMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const chatEndRef = useRef(null);

  const getAuthHeaders = () => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const formatDateTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  };

  const getStatusLabel = (status) => {
    if (status === "Open") return "In Progress";
    if (status === "Closed") return "Closed";
    return "New";
  };

  const fetchInbox = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/queries`, {
        method: "GET",
        headers: { ...getAuthHeaders() },
      });
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
        createdAt: formatDateTime(q.created_at),
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

  useEffect(() => {
    fetchInbox();
  }, []);

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
                  <td colSpan="5" className="dept-empty">No queries for your department.</td>
                </tr>
              ) : (
                queries.map((q) => (
                  <tr key={q.id}>
                    <td>{q.title}</td>
                    <td>{q.employee}</td>
                    <td>{getStatusLabel(q.status)}</td>
                    <td>{q.createdAt}</td>
                    <td>
                      <button className="dept-chat-btn" onClick={() => openChat(q)}>
                        <MessageCircle size={14} /> Open Chat
                      </button>
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
            <button className="dept-close-btn" onClick={() => setActiveChat(null)}>
              <X size={18} />
            </button>
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
