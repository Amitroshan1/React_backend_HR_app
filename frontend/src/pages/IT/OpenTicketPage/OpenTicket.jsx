
import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getTickets, saveTickets, resolveTicket } from "../Data";
import "./OpenTicket.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const PENDING_STATUSES   = ["pending"];
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

const fmt = (iso) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });

// ─── Main Component ───────────────────────────────────────────────────────────
export default function OpenTicket() {
  const navigate = useNavigate();

  const [tickets,   setTickets  ] = useState([]);
  const [search,    setSearch   ] = useState("");
  const [statusTab, setStatusTab] = useState("Pending");
  const [sortOrder, setSortOrder] = useState("newest");

  // Load from Data.js / localStorage on mount
  useEffect(() => {
    setTickets(getTickets());
  }, []);

  // ── Filtered + Sorted tickets ───────────────────────────────────────────────
  const filtered = useMemo(() => {
    const allowedStatuses =
      statusTab === "Pending" ? PENDING_STATUSES : COMPLETED_STATUSES;

    let result = tickets.filter((t) => {
      const matchStatus = allowedStatuses.includes(t.status);
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        t.empId.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        t.query.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });

    return [...result].sort((a, b) => {
      const diff = new Date(a.date) - new Date(b.date);
      return sortOrder === "oldest" ? diff : -diff;
    });
  }, [tickets, search, statusTab, sortOrder]);

  const handleResolve = (id) => {
    resolveTicket(id);
    setTickets(getTickets());
  };

  const pendingCount   = tickets.filter((t) => PENDING_STATUSES.includes(t.status)).length;
  const completedCount = tickets.filter((t) => COMPLETED_STATUSES.includes(t.status)).length;

  return (
    <div className="ot-page">
      {/* ── Header ── */}
      <div className="ot-header">
        <div className="ot-header-left">
          <button className="ot-back-btn" onClick={() => navigate(-1)}>
            ← Back
          </button>
          <div>
            <h1 className="ot-title">Ticket Management</h1>
            <p className="ot-subtitle">Track and resolve employee support requests</p>
          </div>
        </div>
        <div className="ot-header-right">
          <div className="ot-stat-box">
            <span className="ot-stat-num">{pendingCount}</span>
            <span className="ot-stat-label">Pending</span>
          </div>
          <div className="ot-stat-box resolved">
            <span className="ot-stat-num">{completedCount}</span>
            <span className="ot-stat-label">Resolved</span>
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
                  return (
                    <tr key={ticket.id} className="ot-tr">
                      <td className="ot-td-idx">{i + 1}</td>
                      <td><span className="ot-emp-id">{ticket.empId}</span></td>
                      <td><span className="ot-email">{ticket.email}</span></td>
                      <td className="ot-td-query">
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
                          {meta.label}
                        </span>
                      </td>
                      <td>
                        <a
                          href={`mailto:${ticket.email}?subject=Re: Ticket ${ticket.id}`}
                          className="ot-chat-btn"
                        >
                          ✉ Chat
                        </a>
                      </td>
                      {statusTab === "Pending" && (
                        <td>
                          {ticket.status === "completed" ? (
                            <span className="ot-resolved-badge">✓ Resolved</span>
                          ) : (
                            <button
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
    </div>
  );
}
