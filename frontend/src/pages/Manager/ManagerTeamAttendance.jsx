import { useEffect, useMemo, useState } from "react";
import { fetchManagerTeamAttendance } from "./api";
import "./ManagerTeamAttendance.css";

function formatSessionTime(iso) {
  if (!iso) return "—";
  const s = String(iso).trim();
  const normalized = s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function formatHmsDuration(hms) {
  if (!hms) return "—";
  const m = String(hms).match(/^(\d+):(\d{2}):(\d{2})/);
  if (!m) return hms;
  return `${Number(m[1])}h ${m[2]}m ${m[3]}s`;
}

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

export function ManagerTeamAttendance({ scope }) {
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedKey, setExpandedKey] = useState(null);

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    const list = [];
    for (let i = y - 3; i <= y + 1; i += 1) list.push(i);
    return list;
  }, [now]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchManagerTeamAttendance(month, year);
        if (!cancelled) {
          setRows(Array.isArray(data) ? data : []);
          setExpandedKey(null);
        }
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          setError(e.message || "Could not load attendance");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month, year]);

  const circleLabel = (scope?.circle || "—").trim() || "—";
  const deptLabel = (scope?.emp_type || "—").trim() || "—";

  return (
    <div className="manager-team-attendance">
      <div className="manager-team-attendance__scope">
        <div className="manager-team-attendance__scope-row">
          <span className="manager-team-attendance__scope-label">Circle</span>
          <span className="manager-team-attendance__scope-value">{circleLabel}</span>
        </div>
        <div className="manager-team-attendance__scope-row">
          <span className="manager-team-attendance__scope-label">Department</span>
          <span className="manager-team-attendance__scope-value">{deptLabel}</span>
        </div>
      </div>

      <div className="manager-team-attendance__filters">
        <label className="manager-team-attendance__filter">
          <span>Month</span>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            aria-label="Filter by month"
          >
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="manager-team-attendance__filter">
          <span>Year</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            aria-label="Filter by year"
          >
            {yearOptions.map((yOpt) => (
              <option key={yOpt} value={yOpt}>
                {yOpt}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p className="manager-team-attendance__status">Loading…</p>}
      {error && !loading && <p className="manager-team-attendance__error">{error}</p>}

      {!loading && !error && (
        <div className="manager-team-attendance__table-wrap">
          <table className="manager-team-attendance__table">
            <thead>
              <tr>
                <th className="manager-team-attendance__col-sessions" aria-label="Expand sessions" />
                <th>Date</th>
                <th>Name</th>
                <th>Punch in</th>
                <th>Punch out</th>
                <th>WFH</th>
                <th>Location</th>
                <th>Total hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="manager-team-attendance__empty">
                    No attendance records for this month.
                  </td>
                </tr>
              ) : (
                rows.flatMap((row, i) => {
                  const rowKey = `${row.date}-${row.name}-${i}`;
                  const sessions = Array.isArray(row.sessions) ? row.sessions : [];
                  const count = typeof row.session_count === "number" ? row.session_count : sessions.length;
                  const expanded = expandedKey === rowKey;
                  const mainRow = (
                    <tr key={rowKey} className={expanded ? "manager-team-attendance__row-expanded" : ""}>
                      <td className="manager-team-attendance__cell-toggle">
                        {count > 0 ? (
                          <button
                            type="button"
                            className="manager-team-attendance__expand-btn"
                            aria-expanded={expanded}
                            aria-label={expanded ? "Hide session details" : "Show session details"}
                            onClick={() => setExpandedKey(expanded ? null : rowKey)}
                          >
                            <span className="manager-team-attendance__expand-icon" aria-hidden>
                              {expanded ? "▼" : "▶"}
                            </span>
                            <span className="manager-team-attendance__session-count">{count}</span>
                          </button>
                        ) : (
                          <span className="manager-team-attendance__session-count-muted">—</span>
                        )}
                      </td>
                      <td>{row.date || "—"}</td>
                      <td>{row.name || "—"}</td>
                      <td>{row.punch_in || "—"}</td>
                      <td>{row.punch_out || "—"}</td>
                      <td>{row.wfh ?? "—"}</td>
                      <td>{row.location || "—"}</td>
                      <td>
                        <span className="manager-team-attendance__total-wrap">
                          {row.total_hours || "—"}
                          {row.has_open_session ? (
                            <span className="manager-team-attendance__open-badge">Open</span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                  if (!expanded || sessions.length === 0) {
                    return [mainRow];
                  }
                  const detailRow = (
                    <tr key={`${rowKey}-detail`} className="manager-team-attendance__detail-row">
                      <td colSpan={8} className="manager-team-attendance__detail-cell">
                        <div className="manager-team-attendance__sessions-panel">
                          <div className="manager-team-attendance__sessions-title">Sessions (in → out)</div>
                          <ul className="manager-team-attendance__sessions-list">
                            {sessions.map((s, j) => (
                              <li
                                key={s.id ?? j}
                                className={`manager-team-attendance__session-item${s.is_open ? " is-open" : ""}`}
                              >
                                <div className="manager-team-attendance__session-line">
                                  <span className="manager-team-attendance__session-times">
                                    {formatSessionTime(s.clock_in)} →{" "}
                                    {s.clock_out ? formatSessionTime(s.clock_out) : "—"}
                                  </span>
                                  <span className="manager-team-attendance__session-dur">
                                    {s.is_open ? (
                                      <>
                                        <span className="manager-team-attendance__live">In progress</span>
                                        <span className="manager-team-attendance__muted">(no clock-out yet)</span>
                                      </>
                                    ) : (
                                      formatHmsDuration(s.duration_hms)
                                    )}
                                  </span>
                                </div>
                                {s.repeat_reason ? (
                                  <p className="manager-team-attendance__session-note">
                                    <strong>Repeat punch:</strong> {s.repeat_reason}
                                  </p>
                                ) : null}
                                {s.extended_hours_reason ? (
                                  <p className="manager-team-attendance__session-note">
                                    <strong>Extended hours:</strong> {s.extended_hours_reason}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </td>
                    </tr>
                  );
                  return [mainRow, detailRow];
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
