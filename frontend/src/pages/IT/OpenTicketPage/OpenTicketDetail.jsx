import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Paperclip } from "lucide-react";
import { toast } from "react-toastify";
import { toastITApiFailure } from "../Data";
import {
  filterQueriesForItInbox,
  openQueryAttachmentFile,
  queryAttachmentDisplayName,
} from "../../Query/queryChatHelpers";
import { formatDateTimeDDMMYYYY } from "../../../utils/dateFormat";
import { mapQueryToTicket, statusBadgeLabel } from "./OpenTicket";
import "./OpenTicket.css";

const QUERY_API_BASE = "/api/query";

const authHeaders = () => {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const norm = (s) => String(s || "").trim().toLowerCase();
const fmtDateTime = (value) => formatDateTimeDDMMYYYY(value, "—");

export default function OpenTicketDetail() {
  const { ticketId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const chatEndRef = useRef(null);

  const [ticket, setTicket] = useState(location.state?.ticket || null);
  const [queryMeta, setQueryMeta] = useState(null);
  const [messages, setMessages] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [failed, setFailed] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setFailed("");
    try {
      const [detailRes, inboxRes] = await Promise.all([
        fetch(`${QUERY_API_BASE}/queries/${ticketId}`, { headers: authHeaders() }),
        fetch(`${QUERY_API_BASE}/queries/it-inbox`, { headers: authHeaders() }),
      ]);
      const detail = await detailRes.json().catch(() => ({}));
      const inbox = await inboxRes.json().catch(() => ({}));
      if (!detailRes.ok || !detail.success) {
        throw new Error(detail.message || "Failed to load query");
      }
      setQueryMeta(detail.query || null);
      setAttachments(Array.isArray(detail.query?.attachments) ? detail.query.attachments : []);
      setMessages(
        (detail.chat_messages || []).map((m, idx) => ({
          id: `${ticketId}-${idx}`,
          senderName: m.by || "User",
          side: m.user_type === "EMPLOYEE" ? "emp" : "dept",
          text: m.text,
          ts: fmtDateTime(m.created_at),
        })),
      );
      if (inboxRes.ok && inbox.success) {
        const match = filterQueriesForItInbox(inbox.queries || [])
          .map(mapQueryToTicket)
          .find((row) => String(row.id) === String(ticketId));
        if (match) setTicket(match);
      }
      await fetch(`${QUERY_API_BASE}/queries/${ticketId}/mark-read`, {
        method: "POST",
        headers: authHeaders(),
      }).catch(() => {});
    } catch (err) {
      setFailed(err.message || "Could not load this query.");
      toastITApiFailure(err, "Could not load query details.");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const closed = norm(queryMeta?.status) === "closed";
  const title = queryMeta?.title || ticket?.title || "Query details";
  const empId = ticket?.empId || "—";
  const email = ticket?.email || "—";
  const department = queryMeta?.department || ticket?.department || "—";
  const statusRaw = queryMeta?.status || ticket?.rawStatus || "";
  const created = queryMeta?.created_at || ticket?.date;
  const queryText = ticket?.query || messages[0]?.text || "";

  const conversation = useMemo(() => {
    if (!messages.length) return [];
    const first = messages[0];
    if (first.side === "emp" && queryText && norm(first.text) === norm(queryText)) {
      return messages.slice(1);
    }
    return messages;
  }, [messages, queryText]);

  const sendReply = async () => {
    if (!replyText.trim() || sending || closed) return;
    setSending(true);
    try {
      const response = await fetch(`${QUERY_API_BASE}/queries/${ticketId}/reply`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ reply_text: replyText.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to send reply");
      }
      setReplyText("");
      await load();
    } catch (err) {
      toastITApiFailure(err, "Could not send your reply.");
    } finally {
      setSending(false);
    }
  };

  const handleResolve = async () => {
    if (!window.confirm("Mark this query as resolved (closed)?")) return;
    try {
      const response = await fetch(`${QUERY_API_BASE}/queries/${ticketId}/close`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to close query");
      }
      toast.success("Query marked as resolved.");
      await load();
    } catch (err) {
      toastITApiFailure(err, "Could not resolve this query on the server.");
    }
  };

  const openAttachment = async (file) => {
    try {
      await openQueryAttachmentFile(QUERY_API_BASE, ticketId, file);
    } catch (err) {
      toastITApiFailure(err, "Unable to open attachment.");
    }
  };

  return (
    <div className="ot-page ot-detail-page">
      <header className="otd-hero">
        <div className="otd-hero__left">
          <button className="ot-back-btn" type="button" onClick={() => navigate("/it/OpenTicket")}>
            ← Back
          </button>
          <div className="otd-hero__titles">
            <p className="otd-kicker">Ticket #{ticketId}</p>
            <h1 className="otd-title">{title}</h1>
          </div>
        </div>
        <div className="otd-hero__right">
          <span className={`otd-status ${closed ? "otd-status--ok" : "otd-status--open"}`}>
            {statusBadgeLabel(statusRaw)}
          </span>
          {closed ? (
            <span className="ot-resolved-badge">Resolved</span>
          ) : (
            <button type="button" className="ot-resolve-btn ot-resolve-btn--primary" onClick={handleResolve}>
              Resolve
            </button>
          )}
        </div>
      </header>

      {failed ? (
        <div className="ot-card">
          <div className="ot-empty-inner">
            <p>{failed}</p>
            <button type="button" className="ot-view-btn" onClick={load}>Try again</button>
          </div>
        </div>
      ) : (
        <>
          <section className="otd-facts" aria-label="Ticket facts">
            <div>
              <span>Emp ID</span>
              <strong>{empId}</strong>
            </div>
            <div>
              <span>Email</span>
              <strong title={email}>{email}</strong>
            </div>
            <div>
              <span>Department</span>
              <strong>{department}</strong>
            </div>
            <div>
              <span>Raised on</span>
              <strong>{fmtDateTime(created)}</strong>
            </div>
          </section>

          <div className="otd-split">
            <section className="otd-panel">
              <header className="otd-panel__head">
                <h2>Query</h2>
              </header>
              <div className="otd-query-body">
                {loading ? <p className="ot-chat-loading">Loading query…</p> : (
                  <p>{queryText || "No query text was provided."}</p>
                )}
                {attachments.length > 0 ? (
                  <div className="otd-files">
                    {attachments.map((file) => (
                      <button
                        key={file}
                        type="button"
                        className="ot-msg-attachment-chip"
                        onClick={() => openAttachment(file)}
                      >
                        <Paperclip size={13} aria-hidden="true" />
                        <span>{queryAttachmentDisplayName(file)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="otd-panel otd-panel--chat">
              <header className="otd-panel__head">
                <h2>Conversation</h2>
                <p>{closed ? "Closed — replies are disabled" : "Reply to the employee"}</p>
              </header>
              <div className="otd-thread">
                {loading ? (
                  <p className="ot-chat-loading">Loading conversation…</p>
                ) : conversation.length === 0 ? (
                  <p className="otd-thread-empty">No replies yet. Send the first response below.</p>
                ) : (
                  conversation.map((m) => (
                    <div key={m.id} className={`otd-bubble otd-bubble--${m.side}`}>
                      <div className="otd-bubble__meta">
                        <strong>{m.senderName}</strong>
                        <time>{m.ts}</time>
                      </div>
                      <p>{m.text}</p>
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="otd-composer">
                <textarea
                  rows={2}
                  placeholder={closed ? "This query is closed" : "Type a reply…"}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  disabled={closed || loading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={sendReply}
                  disabled={closed || loading || sending || !replyText.trim()}
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
