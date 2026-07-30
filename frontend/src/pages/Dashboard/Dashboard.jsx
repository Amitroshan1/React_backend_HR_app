import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { NavLink, useNavigate } from "react-router-dom";
import {
  FiChevronRight,
  FiCheckCircle,
  FiUserCheck,
  FiSun,
  FiCalendar,
  FiHelpCircle,
  FiKey,
  FiHome,
  FiClock,
  FiDollarSign,
  FiUser,
  FiFileText,
  FiStar,
  FiRefreshCw,
  FiX,
} from "react-icons/fi";
import { MdBadge, MdCalendarToday } from "react-icons/md";
import { GiReceiveMoney } from "react-icons/gi";
import { IoMdPerson } from "react-icons/io";
import "./Dashboard.css";
import { hasFeature } from "../../utils/planFeatures";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { formatDateDDMMYYYY, parseAppDate } from "../../utils/dateFormat";
import { PolicyAckModal } from "../../components/PolicyAckModal";
import { usePunchGps } from "../../hooks/usePunchGps";
import {
  acquireGpsFix,
  zoneToLocationLabel,
} from "../../services/gpsAcquisition";
import { loadGeoClientConfig, getGeoClientConfig } from "../../services/geoClientConfig";
import {
  buildTrustedSnapshot,
  tryReuseTrustedLocation,
  evaluateTrustedLocation,
} from "../../services/trustedLocationCache";
import { getApiErrorMessage } from "../../utils/apiError";
const formatDate = (value) => formatDateDDMMYYYY(value, "N/A");

const NEWS_FEED_VISIBLE_DAYS = 6;

const isNewsFeedPostVisible = (item) => {
    const type = item?.type || "post";
    if (type !== "post") return true;
    const created = parseAppDate(item?.created_at);
    if (!created) return true;
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - NEWS_FEED_VISIBLE_DAYS);
    return created >= cutoff;
};

/** Birthdays / anniversaries / joinings already say "today" — no date line needed. */
const isCelebrationFeedItem = (type) =>
    type === "birthday" || type === "anniversary" || type === "joining";

const shouldShowNewsFeedDate = (item) => !isCelebrationFeedItem(item?.type || "post");
const API_BASE_URL = "/api/auth";

async function postPunchOutRequest(token, body) {
  const response = await fetch(`${API_BASE_URL}/employee/punch-out`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch (_) {
    result = {
      message: getApiErrorMessage(
        { status: response.status },
        "The server could not complete this request. Please try again.",
      ),
    };
  }
  if (!response.ok && (!result.message || /^internal server error/i.test(result.message))) {
    result = {
      ...result,
      message: getApiErrorMessage(
        { status: response.status, message: result.message },
        "The server could not complete this request. Please try again.",
      ),
    };
  }
  return { ok: response.ok, result };
}

/** Fresh GPS for auto cap punch-out — same engine as manual punch (never poll cache). */
async function fetchFreshPosition() {
  const result = await acquireGpsFix();
  if (!result.ok || !result.measurement) return null;
  return result.measurement;
}

/** Build punch payload coords + V2 measurement fields from a fresh acquisition. */
function measurementToPunchFields(measurement) {
  if (!measurement) return {};
  return {
    lat: measurement.lat,
    lon: measurement.lon,
    accuracy: measurement.accuracy_m,
    accuracy_m: measurement.accuracy_m,
    sample_count: measurement.sample_count,
    spread_m: measurement.spread_m,
    retry_count: measurement.retry_count,
    acquisition_ms: measurement.acquisition_ms,
    device_class: measurement.device_class,
    attempt_id: measurement.attempt_id,
    ...(measurement.from_trusted_cache
      ? {
          from_trusted_cache: true,
          trusted_age_ms: measurement.trusted_age_ms,
          freshness_ms: measurement.trusted_age_ms,
        }
      : {}),
  };
}

const PUNCH_DISPLAY_TZ = "Asia/Kolkata";

const parsePunchInToDate = (val) => {
  if (!val) return null;
  try {
    const s = String(val).trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
      const [h, m, sec = 0] = s.split(":").map(Number);
      const d = new Date();
      d.setHours(h, m, sec, 0);
      return d;
    }
    const normalized =
      s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
};

const formatTime = (timeString) => {
  if (!timeString) return "---";
  try {
    const s = String(timeString).trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
      const [h, m, sec = 0] = s.split(":").map(Number);
      const d = new Date();
      d.setHours(h, m, sec, 0);
      return d.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    }
    const normalized =
      s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return "Invalid Time";
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZone: PUNCH_DISPLAY_TZ,
    });
  } catch (e) {
    return "Invalid Time";
  }
};

const formatWorkingHours = (val) => {
  if (!val) return "0h 00m 00s";
  const v = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return "0h 00m 00s"; // Reject datetime-like "0000-04-22 00:00:00"
  if (/^\d+h\s+\d+m\s+\d+s$/.test(v)) return v;
  const m = v.match(/^(\d+):(\d{2}):(\d{2})/);
  if (m) {
    const [, h, min, sec] = m;
    return `${parseInt(h, 10)}h ${min}m ${sec}s`;
  }
  return "0h 00m 00s";
};
const calculateExperience = (doj) => {
  if (!doj) return "N/A";
  const today = new Date();
  const joinDate = new Date(doj);
  if (isNaN(joinDate.getTime())) return "N/A";
  let totalMonths =
    (today.getFullYear() - joinDate.getFullYear()) * 12 +
    (today.getMonth() - joinDate.getMonth());
  if (today.getDate() < joinDate.getDate()) totalMonths--;
  if (totalMonths < 0) return "Less than a year";
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} year${years !== 1 ? "s" : ""}`);
  if (months > 0) parts.push(`${months} month${months !== 1 ? "s" : ""}`);
  return parts.length ? parts.join(" ") : "Less than a month";
};
const formatTimeDifference = (diffMs) => {
    if (diffMs < 0) diffMs = 0;
    
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours)}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
};

/** Backend duration_hms is "H:MM:SS" — sum closed segments for Hours Today + live open */
const parseHmsToMs = (val) => {
    if (!val) return 0;
    const parts = String(val).trim().split(":").map((x) => Number(x));
    if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return 0;
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    const s = parts[2] || 0;
    return (h * 3600 + m * 60 + s) * 1000;
};

const parseIsoToMs = (iso) => {
    if (!iso) return NaN;
    const s = String(iso).trim();
    const normalized = s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
    return new Date(normalized).getTime();
};

/** Open-segment live time capped at the 10h auto-close deadline from the API. */
const cappedOpenLiveMs = (clockIn, sessionAutoCloseAt, now = Date.now()) => {
    const t0 = parseIsoToMs(clockIn);
    if (!Number.isFinite(t0)) return 0;
    let liveMs = Math.max(0, now - t0);
    const closeAt = parseIsoToMs(sessionAutoCloseAt);
    if (Number.isFinite(closeAt)) {
        liveMs = Math.min(liveMs, Math.max(0, closeAt - t0));
    }
    return liveMs;
};

const localIsoDate = (d = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

/** Per punch-in → punch-out segments from homepage API (closed = fixed duration; open = live). */
function PunchSessionsList({ sessions, sessionAttendanceDate, formatTime, formatWorkingHours, formatTimeDifference }) {
    const list = Array.isArray(sessions) ? sessions : [];
    if (list.length === 0) return null;
    const showDateNote =
        sessionAttendanceDate && sessionAttendanceDate !== localIsoDate();
    return (
        <div className="dashboard-punch-sessions">
            <div className="dashboard-punch-sessions-head">
                <h3 className="dashboard-punch-sessions-title">Sessions today</h3>
                {showDateNote && (
                    <span className="dashboard-punch-sessions-date-note">
                        Attendance date: {formatDate(`${sessionAttendanceDate}T12:00:00`)}
                    </span>
                )}
            </div>
            <ul className="dashboard-punch-sessions-list">
                {list.map((s, idx) => {
                    const liveMs = s.is_open
                        ? cappedOpenLiveMs(s.clock_in, s.session_auto_close_at)
                        : 0;
                    const durationLabel = s.is_open
                        ? formatTimeDifference(liveMs)
                        : formatWorkingHours(s.duration_hms || '0:00:00');
                    const rangeOut = s.clock_out ? formatTime(s.clock_out) : '—';
                    return (
                        <li key={s.id ?? idx} className={`dashboard-punch-session-row${s.is_open ? ' is-open' : ''}`}>
                            <div className="dashboard-punch-session-main">
                                <span className="dashboard-punch-session-range">
                                    {formatTime(s.clock_in)} → {rangeOut}
                                </span>
                                <span className="dashboard-punch-session-duration">
                                    {s.is_open ? (
                                        <>
                                            <span className="dashboard-punch-session-live">In progress</span>
                                            <span className="dashboard-punch-session-hms">{durationLabel}</span>
                                        </>
                                    ) : (
                                        durationLabel
                                    )}
                                </span>
                            </div>
                            {s.repeat_reason ? (
                                <p className="dashboard-punch-session-reason">Reason: {s.repeat_reason}</p>
                            ) : null}
                            {s.extended_hours_reason ? (
                                <p className="dashboard-punch-session-reason">Extended hours: {s.extended_hours_reason}</p>
                            ) : null}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

/** Format a date/time for Recent Activity (e.g. "Today", "Yesterday", "2 days ago"). */
const formatTimeAgo = (isoString) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (d >= todayStart) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return formatDate(isoString);
};

/** Build list of recent activity items from punch, last leave, last payslip. */
function RecentActivityList({
  punchIn,
  punchOut,
  lastLeave,
  lastPayslip,
  formatTime,
  formatTimeAgo,
  formatDate,
  onNavigate,
  canViewPayslip = true,
}) {
  const items = [];
  if (punchIn) {
    items.push({
      key: "punch-in",
      dot: "green",
      text: `Punch-in at ${formatTime(punchIn)}`,
      time: "Today",
      href: "/attendance",
      ariaLabel: "Open attendance details",
    });
  }
  if (punchOut) {
    items.push({
      key: "punch-out",
      dot: "blue",
      text: `Punch-out at ${formatTime(punchOut)}`,
      time: "Today",
      href: "/attendance",
      ariaLabel: "Open attendance details",
    });
  }
  if (lastLeave) {
    const status = (lastLeave.status || "").toLowerCase();
    const leaveType = (lastLeave.leave_type || "").toLowerCase();
    const isCompOff = leaveType.includes("comp");
    const dot =
      status === "approved"
        ? "green"
        : status === "rejected"
          ? "red"
          : "orange";
    items.push({
      key: `leave-${lastLeave.id}`,
      dot,
      text: `Leave (${lastLeave.leave_type || "Leave"}): ${lastLeave.status || "Pending"}`,
      time:
        formatTimeAgo(lastLeave.created_at) || formatDate(lastLeave.start_date),
      href: isCompOff ? "/leaves/comp-off" : "/leaves",
      ariaLabel: isCompOff ? "Open Comp Off details" : "Open leave details",
      important: status === "pending" || status === "new" || status === "open",
    });
  }
  if (lastPayslip && canViewPayslip) {
    items.push({
      key: `payslip-${lastPayslip.id}`,
      dot: "blue",
      text: `Payslip updated: ${lastPayslip.month || ""} ${lastPayslip.year || ""}`,
      time:
        `${lastPayslip.month || ""} ${lastPayslip.year || ""}`.trim() || "—",
      href: "/payslip",
      ariaLabel: "Open payslip details",
    });
  }
  if (items.length === 0) {
    return (
      <ul className="activity-list">
        <li>
          <div className="left">
            <span className="dot blue"></span> No recent activity
          </div>
          <span className="time">—</span>
        </li>
      </ul>
    );
  }
  return (
    <ul className="activity-list">
      {items.map((item) => {
        const clickable = Boolean(item.href && onNavigate);
        return (
          <li
            key={item.key}
            className={`${clickable ? "activity-list__item--clickable" : ""}${item.important ? " activity-list__item--important" : ""}`.trim()}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            aria-label={clickable ? item.ariaLabel : undefined}
            onClick={clickable ? () => onNavigate(item.href) : undefined}
            onKeyDown={clickable ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNavigate(item.href);
              }
            } : undefined}
          >
            <div className="left">
              <span className={`dot ${item.dot}`}></span>
              <span className="activity-list__text">{item.text}</span>
              {item.important ? (
                <span className="activity-list__badge">Important</span>
              ) : null}
            </div>
            <span className="activity-list__meta">
              <span className="time">{item.time}</span>
              {clickable ? <FiChevronRight className="activity-list__chevron" aria-hidden size={16} /> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export const Dashboard = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isPunching, setIsPunching] = useState(false);
    /** Poll-only indicator — NEVER submit these coords on Punch In/Out. */
    const [location, setLocation] = useState(() => {
        try {
            const cached = sessionStorage.getItem("dash_loc");
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Date.now() - (parsed._ts || 0) < 60000) {
                    return { lat: parsed.lat, lon: parsed.lon, error: parsed.error, isAvailable: parsed.isAvailable, isInRange: parsed.isInRange };
                }
            }
        } catch {}
        return { lat: null, lon: null, error: null, isAvailable: false, isInRange: false };
    });
    const [geo, setGeo] = useState({
        zone: "NO_GPS",
        requiresReason: false,
        distance: null,
        radius: null,
        grace: 100,
        message: ""
    });
    const punchGps = usePunchGps();
    /** Fresh measurement from last Punch click (shared by In/Out + reason modal). */
    const punchMeasurementRef = useRef(null);
    /**
     * Trusted dashboard fix for Punch reuse (INSIDE + fresh + accurate + confident).
     * Separate from UI `location` — always updated on successful poll.
     */
    const trustedLocationRef = useRef(null);
    /** Presentation-only: age (seconds) when trusted cache is valid for instant punch. */
    const [instantPunchAgeSec, setInstantPunchAgeSec] = useState(null);
    const [dynamicData, setDynamicData] = useState({
        user: {},
        employee: {},
        punch: {},
        leave_balance: { pl: 'N/A', cl: 'N/A' },
        managers: {},
        last_leave: null,
        last_payslip: null,
        probation: null,
    });
    const [punchInDateTime, setPunchInDateTime] = useState(null);
    const [repeatPunchModalOpen, setRepeatPunchModalOpen] = useState(false);
    const [repeatPunchReason, setRepeatPunchReason] = useState("");
    const [geoReasonModalOpen, setGeoReasonModalOpen] = useState(false);
    const [geoReason, setGeoReason] = useState("");
    const [geoReasonMode, setGeoReasonMode] = useState("in"); // "in" | "out"
    const [extendedHoursModalOpen, setExtendedHoursModalOpen] = useState(false);
    const [extendedHoursReason, setExtendedHoursReason] = useState("");
    const [leaveBalanceModalOpen, setLeaveBalanceModalOpen] = useState(false);
    const punchDataRef = useRef({
        sessions: [],
        punch_in: null,
        has_open_session: false,
    });
    const punchTimingRef = useRef({});
    const [newsFeed, setNewsFeed] = useState([]);
    const [newsFeedScrollPaused, setNewsFeedScrollPaused] = useState(false);
    const newsFeedListRef = useRef(null);
    const autoCapPunchOutRef = useRef(false);
    const resetPunchTimings = () => {
        punchTimingRef.current = { t0: (typeof performance !== "undefined" ? performance.now() : Date.now()) };
    };
    const markPunchTiming = (key, valueMs = null) => {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (valueMs == null) {
            punchTimingRef.current[key] = now;
        } else {
            punchTimingRef.current[key] = valueMs;
        }
    };
    const logPunchTimingBreakdown = (label, backendTiming = null) => {
        const t = punchTimingRef.current || {};
        const toDur = (a, b) =>
            Number.isFinite(t[a]) && Number.isFinite(t[b]) ? Math.max(0, t[b] - t[a]) : null;
        const out = {
            label,
            uiValidationMs: toDur("t0", "afterUiValidation"),
            gpsAcquisitionMs: toDur("gpsStart", "gpsEnd"),
            locationCheckApiMs: toDur("locCheckStart", "locCheckEnd"),
            punchApiMs: toDur("punchApiStart", "punchApiEnd"),
            responseHandlingMs: toDur("punchApiEnd", "responseDone"),
            totalMs: toDur("t0", "responseDone"),
            backendTiming,
        };
        // Real measured trace for debugging/optimization.
        console.table(out);
    };
    const fetchDashboardData = async (showAlert = false) => {
        const token = localStorage.getItem('token');
        if (!token) return;
        try {
            const response = await fetch(`${API_BASE_URL}/employee/homepage`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                if (response.status === 401) {
                }
                throw new Error("Failed to fetch dashboard data.");
            }
            const result = await response.json();
            if (result.success) {
                const punch = result.punch || {};
                const workingHours = punch.working_hours ? formatWorkingHours(punch.working_hours) : punch.working_hours;
                setDynamicData({
                    user: result.user || {},
                    employee: result.employee || {},
                    punch: {
                        ...punch,
                        working_hours: workingHours || punch.working_hours,
                        has_open_session: punch.has_open_session ?? !!(punch.punch_in && !punch.punch_out),
                        requires_repeat_punch_reason: !!punch.requires_repeat_punch_reason,
                        sessions: Array.isArray(punch.sessions) ? punch.sessions : [],
                        session_attendance_date: punch.session_attendance_date || null,
                    },
                    leave_balance: result.leave_balance || { pl: 'N/A', cl: 'N/A' },
                    managers: result.managers || {},
                    last_leave: result.last_leave || null,
                    last_payslip: result.last_payslip || null,
                    probation: result.probation || null,
                });
                const open = punch.has_open_session ?? !!(punch.punch_in && !punch.punch_out);
                if (open && punch.punch_in) {
                    setPunchInDateTime(parsePunchInToDate(punch.punch_in));
                } else {
                    setPunchInDateTime(null);
                }
            } else if (showAlert) {
                alert(result.message || "Failed to load data.");
            }
        } catch (err) {
            console.error("Fetch error:", err);
            if (showAlert) alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        punchDataRef.current = {
            sessions: Array.isArray(dynamicData.punch.sessions)
                ? dynamicData.punch.sessions
                : [],
            punch_in: dynamicData.punch.punch_in || null,
            has_open_session:
                dynamicData.punch.has_open_session ??
                !!(dynamicData.punch.punch_in && !dynamicData.punch.punch_out),
        };
    }, [dynamicData.punch]);

    /** Refresh while punched in so server auto punch-out (every 2 min) updates the UI. */
    useEffect(() => {
        const open =
            dynamicData.punch.has_open_session ??
            !!(dynamicData.punch.punch_in && !dynamicData.punch.punch_out);
        if (!open || loading) return undefined;
        const id = setInterval(() => {
            if (typeof document !== "undefined" && document.visibilityState !== "visible") {
                return;
            }
            fetchDashboardData(false);
        }, 60_000);
        const onVisibility = () => {
            if (document.visibilityState === "visible") fetchDashboardData(false);
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            clearInterval(id);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [
        loading,
        dynamicData.punch.has_open_session,
        dynamicData.punch.punch_in,
        dynamicData.punch.punch_out,
    ]);

    const runAutoCapPunchOut = useCallback(async (capIso) => {
        if (autoCapPunchOutRef.current) return;
        autoCapPunchOutRef.current = true;
        const token = localStorage.getItem("token");
        if (!token) {
            autoCapPunchOutRef.current = false;
            return;
        }
        setIsPunching(true);
        try {
            const fresh = await fetchFreshPosition();
            const body = { auto_system_punch_out: true };
            if (fresh?.lat != null && fresh?.lon != null) {
                Object.assign(body, measurementToPunchFields(fresh));
            }
            const { ok, result } = await postPunchOutRequest(token, body);
            if (ok && result.success) {
                setPunchInDateTime(null);
                const outLabel = formatTime(result.punch_out || capIso);
                const geoNote =
                    result.location_status_out === "outside_geofence"
                        ? " Location recorded: outside office geofence."
                        : result.location_status_out === "inside_geofence"
                          ? ""
                          : result.location_status_out
                            ? ` Location: ${result.location_status_out}.`
                            : "";
                alert(
                    `10-hour work cap reached. You were punched out automatically at ${outLabel}.${geoNote}`,
                );
                await fetchDashboardData(false);
                return;
            }
            const msg = String(result.message || "");
            if (msg.toLowerCase().includes("no active punch")) {
                await fetchDashboardData(false);
                return;
            }
            autoCapPunchOutRef.current = false;
            console.warn("Auto cap punch-out failed:", msg || "unknown error");
        } catch (err) {
            autoCapPunchOutRef.current = false;
            console.error("Auto cap punch-out error:", err);
        } finally {
            setIsPunching(false);
        }
    }, []);

    /** At 10h cap: punch out with live GPS (before server scheduler uses stale punch-in location). */
    useEffect(() => {
        const open =
            dynamicData.punch.has_open_session ??
            !!(dynamicData.punch.punch_in && !dynamicData.punch.punch_out);
        if (!open || loading) {
            if (!open) autoCapPunchOutRef.current = false;
            return undefined;
        }
        const sessions = Array.isArray(dynamicData.punch.sessions)
            ? dynamicData.punch.sessions
            : [];
        const openSeg = sessions.find((s) => s.is_open);
        const capMs = parseIsoToMs(openSeg?.session_auto_close_at);
        if (!Number.isFinite(capMs)) return undefined;

        const fire = () => {
            if (Date.now() >= capMs) {
                runAutoCapPunchOut(openSeg.session_auto_close_at);
            }
        };

        if (Date.now() >= capMs) {
            fire();
            return undefined;
        }
        const delay = Math.max(0, capMs - Date.now() + 250);
        const timer = setTimeout(fire, delay);
        return () => clearTimeout(timer);
    }, [
        loading,
        dynamicData.punch.has_open_session,
        dynamicData.punch.punch_in,
        dynamicData.punch.punch_out,
        dynamicData.punch.sessions,
        runAutoCapPunchOut,
    ]);

    const fetchNewsFeed = async () => {
        const token = localStorage.getItem('token');
        if (!token) return;
        try {
            const res = await fetch(`${API_BASE_URL}/news-feed`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success && Array.isArray(data.news_feed)) {
                setNewsFeed(data.news_feed.filter(isNewsFeedPostVisible));
            }
        } catch {
            setNewsFeed([]);
        }
    };
    useRefreshOnNavigate(() => {
        const loadInitialData = async () => {
            await fetchDashboardData();
            await fetchNewsFeed();
        };
        loadInitialData();
    });

  /** Duplicate items for seamless top-to-bottom loop scroll */
  /** Duplicate list only when long enough for seamless auto-scroll (avoids showing events twice). */
  const loopedNewsFeed = useMemo(() => {
    if (newsFeed.length <= 1) return newsFeed;
    if (newsFeed.length < 4) return newsFeed;
    return [...newsFeed, ...newsFeed];
  }, [newsFeed]);

  /* News feed auto-scroll: continuous top → bottom loop (pauses on hover/touch) */
  useEffect(() => {
    if (!newsFeed.length || newsFeedScrollPaused) return;
    const el = newsFeedListRef.current;
    if (!el) return;

    let intervalId = null;
    let retryTimeoutId = null;

    const startScroll = () => {
      if (!el || el.scrollHeight <= el.clientHeight) return false;
      const step = 1;
      const intervalMs = 32;
      const loopAt = newsFeed.length > 1 ? el.scrollHeight / 2 : el.scrollHeight;

      intervalId = window.setInterval(() => {
        if (!el) return;
        el.scrollTop += step;
        if (el.scrollTop >= loopAt - 1) {
          el.scrollTop = 0;
        }
      }, intervalMs);
      return true;
    };

    const raf = window.requestAnimationFrame(() => {
      if (!startScroll()) {
        retryTimeoutId = window.setTimeout(() => startScroll(), 300);
      }
    });

    return () => {
      window.cancelAnimationFrame(raf);
      if (retryTimeoutId) window.clearTimeout(retryTimeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [newsFeed.length, newsFeedScrollPaused, loopedNewsFeed.length]);
  const validateLocationRange = async (lat, lon, accuracyM = null) => {
    const token = localStorage.getItem("token");
    if (!token)
      return { in_range: false, requires_reason: true, zone: "NO_GPS" };
    try {
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
      });
      if (accuracyM != null && Number.isFinite(Number(accuracyM))) {
        params.set("accuracy", String(accuracyM));
        params.set("accuracy_m", String(accuracyM));
      }
      const res = await fetch(
        `${API_BASE_URL}/employee/location-check?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await res.json();
      setGeo({
        zone: data.zone || "NO_GPS",
        requiresReason: !!data.requires_reason,
        distance: data.distance_meters ?? null,
        radius: data.radius_meters ?? null,
        grace: data.grace_meters ?? 100,
        message: data.message || "",
        confidence: data.confidence ?? null,
        geoDecision: data.geo_decision || null,
        accuracyM: data.accuracy_m ?? accuracyM ?? null,
      });
      return data;
    } catch {
      setGeo({
        zone: "NO_GPS",
        requiresReason: true,
        distance: null,
        radius: null,
        grace: 100,
        message: "Location check failed",
        confidence: null,
        geoDecision: null,
        accuracyM: null,
      });
      return { in_range: false, requires_reason: true, zone: "NO_GPS" };
    }
  };

    useEffect(() => {
        // Adaptive background poll for UI badge only — NEVER used as Punch coordinates.
        // Config loaded async; use defaults synchronously until ready.
        const dc = getGeoClientConfig().dashboard;
        let POLL_INTERVAL_MS = dc.pollIntervalMs;
        let STALE_THRESHOLD_MS = dc.staleThresholdMs;
        let MIN_RECHECK_MS = dc.minRecheckMs;
        let HA_TIMEOUT = dc.highAccuracyTimeoutMs;
        let LA_TIMEOUT = dc.lowAccuracyTimeoutMs;
        let HA_MAX_AGE = dc.highAccuracyMaxAgeMs;
        let LA_MAX_AGE = dc.lowAccuracyMaxAgeMs;
        let REFINE_DELAY = dc.highAccuracyRefineDelayMs;
        let IDLE_CB_TIMEOUT = dc.idleCallbackTimeoutMs;

        const lastCheckRef = { ts: 0 };
        let pollTimer = null;
        let alive = true;

        // Load server config in background; update values if different
        loadGeoClientConfig().then((cfg) => {
            if (!alive) return;
            const d = cfg.dashboard;
            POLL_INTERVAL_MS = d.pollIntervalMs;
            STALE_THRESHOLD_MS = d.staleThresholdMs;
            MIN_RECHECK_MS = d.minRecheckMs;
            HA_TIMEOUT = d.highAccuracyTimeoutMs;
            LA_TIMEOUT = d.lowAccuracyTimeoutMs;
            HA_MAX_AGE = d.highAccuracyMaxAgeMs;
            LA_MAX_AGE = d.lowAccuracyMaxAgeMs;
        });

        const applyPosition = async (position) => {
            if (!alive) return;
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const accuracyM = Number(position.coords.accuracy);
            lastCheckRef.ts = Date.now();
            const locationData = await validateLocationRange(
                lat,
                lon,
                Number.isFinite(accuracyM) ? accuracyM : null,
            );
            if (!alive) return;
            const inRange = !!locationData?.in_range;
            const zone = locationData?.zone || "NO_GPS";
            const errorMessage = inRange || zone === "NO_OFFICE_CONFIG"
                ? null
                : "You are outside office range. Punch In/Out requires a reason.";
            const next = { lat, lon, error: errorMessage, isAvailable: true, isInRange: inRange };
            // Always refresh trusted snapshot (even when UI badge fields are unchanged).
            trustedLocationRef.current = buildTrustedSnapshot({
                lat,
                lon,
                accuracy_m: Number.isFinite(accuracyM) ? accuracyM : null,
                locationData,
            });
            setLocation((prev) => {
                if (
                    prev.isInRange === next.isInRange &&
                    prev.isAvailable === next.isAvailable &&
                    prev.error === next.error &&
                    prev.lat === next.lat &&
                    prev.lon === next.lon
                ) {
                    return prev;
                }
                return next;
            });
            try {
                sessionStorage.setItem(
                    "dash_loc",
                    JSON.stringify({
                        ...next,
                        accuracy_m: Number.isFinite(accuracyM) ? accuracyM : null,
                        confidence: locationData?.confidence ?? null,
                        zone,
                        geo_decision: locationData?.geo_decision || null,
                        _ts: Date.now(),
                    }),
                );
            } catch {}
        };

        const onError = (err) => {
            if (!alive) return;
            console.warn(`Geolocation Error: ${err.code} - ${err.message}`);
            trustedLocationRef.current = null;
            setLocation((prev) => ({
                ...prev,
                error: "Location access denied or unavailable. Punch In/Out requires location.",
                isAvailable: false,
                isInRange: false,
            }));
        };

        const checkLocation = (highAccuracy = false) => {
            if (!alive || !navigator.geolocation) {
                if (!navigator.geolocation) {
                    setLocation((prev) => ({
                        ...prev,
                        error: "Geolocation not supported by this browser.",
                        isAvailable: false,
                        isInRange: false,
                    }));
                }
                return;
            }
            if (Date.now() - lastCheckRef.ts < MIN_RECHECK_MS) return;
            navigator.geolocation.getCurrentPosition(
                applyPosition,
                onError,
                {
                    enableHighAccuracy: highAccuracy,
                    timeout: highAccuracy ? HA_TIMEOUT : LA_TIMEOUT,
                    maximumAge: highAccuracy ? HA_MAX_AGE : LA_MAX_AGE,
                },
            );
        };

        const schedulePoll = () => {
            if (pollTimer) clearTimeout(pollTimer);
            pollTimer = setTimeout(() => {
                if (!alive) return;
                if (document.visibilityState !== "visible") return;
                checkLocation(true);
                schedulePoll();
            }, POLL_INTERVAL_MS);
        };

        // Delay initial GPS until after paint
        const initialId = (typeof window.requestIdleCallback === "function")
            ? window.requestIdleCallback(() => { checkLocation(false); schedulePoll(); }, { timeout: IDLE_CB_TIMEOUT })
            : setTimeout(() => { checkLocation(false); schedulePoll(); }, 100);

        // High-accuracy refinement after configurable delay
        const refineTimeout = setTimeout(() => checkLocation(true), REFINE_DELAY);

        // Visibility: suspend when hidden, refresh when visible again
        const onVisibility = () => {
            if (document.visibilityState === "visible") {
                const age = Date.now() - lastCheckRef.ts;
                if (age > STALE_THRESHOLD_MS) {
                    checkLocation(true);
                } else if (age > MIN_RECHECK_MS) {
                    checkLocation(false);
                }
                schedulePoll();
            } else {
                if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
            }
        };
        document.addEventListener("visibilitychange", onVisibility);

        // Network: refresh when coming back online
        const onOnline = () => {
            if (document.visibilityState === "visible") checkLocation(true);
        };
        window.addEventListener("online", onOnline);

        return () => {
            alive = false;
            if (typeof window.cancelIdleCallback === "function") {
                window.cancelIdleCallback(initialId);
            } else {
                clearTimeout(initialId);
            }
            clearTimeout(refineTimeout);
            if (pollTimer) clearTimeout(pollTimer);
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("online", onOnline);
        };
    }, []);

    useEffect(() => {
        let timer;
        // Only start timer if punched in and NOT punched out
        const openSession = dynamicData.punch.has_open_session ?? (!!dynamicData.punch.punch_in && !dynamicData.punch.punch_out);
        if (punchInDateTime && openSession) {
            timer = setInterval(() => {
                const now = Date.now();
                setDynamicData((prev) => {
                    const sessions = Array.isArray(prev.punch.sessions) ? prev.punch.sessions : [];
                    let closedMs = 0;
                    for (const s of sessions) {
                        if (!s.is_open && s.duration_hms) {
                            closedMs += parseHmsToMs(s.duration_hms);
                        }
                    }
                    const openSeg = sessions.find((s) => s.is_open);
                    let liveMs = 0;
                    if (openSeg?.clock_in) {
                        liveMs = cappedOpenLiveMs(
                            openSeg.clock_in,
                            openSeg.session_auto_close_at,
                            now,
                        );
                    }
                    if (liveMs === 0 && sessions.some((s) => s.is_open) && punchInDateTime) {
                        liveMs = Math.max(0, now - punchInDateTime.getTime());
                    }
                    const totalMs =
                        sessions.length > 0
                            ? closedMs + liveMs
                            : Math.max(0, now - punchInDateTime.getTime());
                    const formattedTime = formatTimeDifference(totalMs);
                    return {
                        ...prev,
                        punch: {
                            ...prev.punch,
                            working_hours: formattedTime,
                        },
                    };
                });
            }, 1000);
        } else {
            // Stop timer if punched out
            setDynamicData((prev) => ({
                ...prev,
                punch: {
                    ...prev.punch,
                    working_hours: prev.punch.working_hours || '0h 00m 00s',
                },
            }));
        }
        return () => {
            if (timer) {
                clearInterval(timer);
            }
        };
    }, [punchInDateTime, dynamicData.punch.punch_out, dynamicData.punch.has_open_session, dynamicData.punch.punch_in]);

    const handlePunchIn = async (geoReason = "", repeatPunchReasonParam = "", measurement = null, { isWfh = false } = {}) => {
        const fix = measurement || punchMeasurementRef.current;
        if (isPunching || !fix?.lat || !fix?.lon) {
            alert(
                punchGps.errorMessage ||
                    location.error ||
                    "Cannot punch in without location. Please enable location services.",
            );
            return;
        }
        setIsPunching(true);
        punchGps.setPunchState(punchGps.PunchGpsState.SUBMITTING, "Submitting attendance...");
        const token = localStorage.getItem('token');
        const repeatTrim = (repeatPunchReasonParam || "").trim();
        const payload = {
            ...measurementToPunchFields(fix),
            is_wfh: isWfh,
            geo_reason: geoReason || null,
        };
        if (repeatTrim.length >= 3) {
            payload.repeat_punch_reason = repeatTrim;
        }
        try {
            markPunchTiming("punchApiStart");
            const response = await fetch(`${API_BASE_URL}/employee/punch-in`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            markPunchTiming("punchApiEnd");
            if (response.ok && result.success) {
                setRepeatPunchModalOpen(false);
                setRepeatPunchReason("");
                setGeoReasonModalOpen(false);
                setGeoReason("");
                punchMeasurementRef.current = null;
                punchGps.setPunchState(punchGps.PunchGpsState.SUCCESS);
                alert(`Punched In Successfully at ${formatTime(result.punch_in)}!`);
                // UX optimization: unblock button/modal immediately, refresh dashboard in background.
                setIsPunching(false);
                punchGps.setPunchState(punchGps.PunchGpsState.SUCCESS, "Almost done...");
                markPunchTiming("responseDone");
                logPunchTimingBreakdown("Punch In", result.timing || null);
                fetchDashboardData(false)
                    .catch((e) => console.warn("Dashboard refresh failed after punch-in:", e))
                    .finally(() => punchGps.reset());
                return;
            } else {
                if (result.message && result.message.includes("Too far")) {
                    setLocation(prev => ({ ...prev, isInRange: false }));
                }
                if (result.requires_geo_reason) {
                    setLocation((prev) => ({ ...prev, isInRange: false }));
                    punchGps.setPunchState(punchGps.PunchGpsState.OUTSIDE);
                    setGeoReasonMode("in");
                    setGeoReasonModalOpen(true);
                } else if (result.requires_repeat_punch_reason) {
                    setRepeatPunchModalOpen(true);
                    punchGps.setPunchState(punchGps.PunchGpsState.READY);
                } else {
                    punchGps.setPunchState(punchGps.PunchGpsState.ERROR, result.message);
                    alert(`Punch In Failed: ${result.message || 'Server error.'}`);
                }
            }
            markPunchTiming("responseDone");
            logPunchTimingBreakdown("Punch In (failed)", result?.timing || null);
        } catch (error) {
            console.error("Punch In error:", error);
            if (!navigator.onLine) {
                punchGps.setPunchState(
                    punchGps.PunchGpsState.ERROR,
                    "No internet connection. Please check your network and try again.",
                );
                alert("No internet connection. Please check your network and try again.");
            } else {
                punchGps.setPunchState(
                    punchGps.PunchGpsState.ERROR,
                    "We couldn't complete your request right now. Please try again.",
                );
                alert("We couldn't complete your request right now. Please try again.");
            }
            markPunchTiming("responseDone");
            logPunchTimingBreakdown("Punch In (exception)", null);
        } finally {
            setIsPunching(false);
        }
    };

    const handlePunchOut = async (geoReason = "", extendedHoursReasonParam = "", measurement = null) => {
        const fix = measurement || punchMeasurementRef.current;
        if (isPunching || !fix?.lat || !fix?.lon) {
            alert(
                punchGps.errorMessage ||
                    location.error ||
                    "Cannot punch out without location. Please enable location services.",
            );
            return;
        }
        setIsPunching(true);
        punchGps.setPunchState(punchGps.PunchGpsState.SUBMITTING, "Submitting attendance...");
        const token = localStorage.getItem('token');
        const extTrim = (extendedHoursReasonParam || "").trim();
        try {
            markPunchTiming("punchApiStart");
            const { ok, result } = await postPunchOutRequest(token, {
                ...measurementToPunchFields(fix),
                geo_reason: geoReason || null,
                ...(extTrim.length >= 3 ? { extended_hours_reason: extTrim } : {}),
            });
            markPunchTiming("punchApiEnd");
            if (ok && result.success) {
                setPunchInDateTime(null);
                const workHours = formatWorkingHours(result.today_work);
                setDynamicData(prev => ({
                    ...prev,
                    punch: {
                        ...prev.punch,
                        punch_out: result.punch_out, 
                        punch_in: prev.punch.punch_in,
                        working_hours: workHours
                    }
                }));
                setExtendedHoursModalOpen(false);
                setExtendedHoursReason("");
                setGeoReasonModalOpen(false);
                setGeoReason("");
                punchMeasurementRef.current = null;
                punchGps.setPunchState(punchGps.PunchGpsState.SUCCESS);
                alert(`Punched Out Successfully! Total Today's Work: ${result.today_work || 'N/A'}`);
                // UX optimization: unblock immediately; refresh in background.
                setIsPunching(false);
                punchGps.setPunchState(punchGps.PunchGpsState.SUCCESS, "Almost done...");
                markPunchTiming("responseDone");
                logPunchTimingBreakdown("Punch Out", result.timing || null);
                fetchDashboardData()
                    .catch((e) => console.warn("Dashboard refresh failed after punch-out:", e))
                    .finally(() => punchGps.reset());
                return;
            } else {
                if (result.message && result.message.includes("Too far")) {
                    setLocation(prev => ({ ...prev, isInRange: false }));
                }
                if (result.requires_geo_reason) {
                    punchGps.setPunchState(punchGps.PunchGpsState.OUTSIDE);
                    setGeoReasonMode("out");
                    setGeoReasonModalOpen(true);
                } else if (result.requires_extended_hours_reason) {
                    setExtendedHoursModalOpen(true);
                    punchGps.setPunchState(punchGps.PunchGpsState.READY);
                } else {
                    punchGps.setPunchState(punchGps.PunchGpsState.ERROR, result.message);
                    alert(`Punch Out Failed: ${result.message || 'Server error.'}`);
                }
            }
            markPunchTiming("responseDone");
            logPunchTimingBreakdown("Punch Out (failed)", result?.timing || null);
        } catch (error) {
            console.error("Punch Out error:", error);
            if (!navigator.onLine) {
                punchGps.setPunchState(
                    punchGps.PunchGpsState.ERROR,
                    "No internet connection. Please check your network and try again.",
                );
                alert("No internet connection. Please check your network and try again.");
            } else {
                punchGps.setPunchState(
                    punchGps.PunchGpsState.ERROR,
                    "We couldn't complete your request right now. Please try again.",
                );
                alert("We couldn't complete your request right now. Please try again.");
            }
            markPunchTiming("responseDone");
            logPunchTimingBreakdown("Punch Out (exception)", null);
        } finally {
            setIsPunching(false);
        }
    };

    const punchHasOpenSession = () =>
        dynamicData.punch.has_open_session ?? (!!dynamicData.punch.punch_in && !dynamicData.punch.punch_out);

    /** Prefer trusted INSIDE cache; otherwise acquire fresh GPS. Backend always re-validates. */
    const prepareFreshPunchMeasurement = async () => {
        markPunchTiming("gpsStart");
        let acquired = null;
        let usedTrustedCache = false;

        const trustedTry = tryReuseTrustedLocation(trustedLocationRef.current);
        if (trustedTry.ok && trustedTry.measurement) {
            usedTrustedCache = true;
            punchGps.setPunchState(punchGps.PunchGpsState.READY, "Using recent office location…");
            acquired = {
                ok: true,
                cancelled: false,
                lowSignal: false,
                measurement: trustedTry.measurement,
                message: "trusted_cache",
            };
            if (typeof console !== "undefined" && console.info) {
                console.info("[punch] trusted location cache hit", {
                    ageMs: trustedTry.evaluation?.ageMs,
                    confidence: trustedTry.evaluation?.confidence,
                    accuracy_m: trustedTry.measurement.accuracy_m,
                });
            }
        } else {
            if (typeof console !== "undefined" && console.info && trustedTry.reason) {
                console.info("[punch] trusted location cache miss:", trustedTry.reason);
            }
            acquired = await punchGps.acquireForPunch();
        }
        markPunchTiming("gpsEnd");
        if (acquired.cancelled) return null;
        if (!acquired.ok || !acquired.measurement) {
            alert(
                acquired.message ||
                    punchGps.errorMessage ||
                    "Cannot continue without location. Please enable location services.",
            );
            return null;
        }
        punchMeasurementRef.current = acquired.measurement;
        markPunchTiming("locCheckStart");
        const locationData = await validateLocationRange(
            acquired.measurement.lat,
            acquired.measurement.lon,
            acquired.measurement.accuracy_m,
        );
        markPunchTiming("locCheckEnd");
        const inRange = !!locationData?.in_range;
        const zone = locationData?.zone || "NO_GPS";
        const geoDecision = locationData?.geo_decision || null;
        const wfhApproved = !!locationData?.wfh_approved;
        const requiresReason = (!!locationData?.requires_reason || !inRange) && !wfhApproved;
        setLocation((prev) => ({
            ...prev,
            isInRange: inRange,
            wfhApproved,
            error:
                inRange || zone === "NO_OFFICE_CONFIG" || wfhApproved
                    ? null
                    : "You are outside office range. Punch In/Out requires a reason.",
        }));
        trustedLocationRef.current = buildTrustedSnapshot({
            lat: acquired.measurement.lat,
            lon: acquired.measurement.lon,
            accuracy_m: acquired.measurement.accuracy_m,
            locationData,
            device_class: acquired.measurement.device_class,
        });
        if (requiresReason) {
            punchGps.setPunchState(punchGps.PunchGpsState.OUTSIDE);
        }
        return {
            measurement: acquired.measurement,
            requiresReason,
            inRange,
            zone,
            geoDecision,
            lowSignal: !!acquired.lowSignal,
            wfhApproved,
            usedTrustedCache,
        };
    };

    const onPunchInClick = async () => {
        if (isPunching || punchGps.isBusy || punchHasOpenSession()) return;
        resetPunchTimings();
        markPunchTiming("afterUiValidation");
        if (!location.isAvailable) {
            alert(location.error || "Cannot punch in without location. Please enable location services.");
            return;
        }
        if (dynamicData.punch.requires_repeat_punch_reason) {
            setRepeatPunchModalOpen(true);
            return;
        }
        const prepared = await prepareFreshPunchMeasurement();
        if (!prepared) return;
        if (prepared.requiresReason || prepared.lowSignal) {
            setGeoReasonMode("in");
            setGeoReasonModalOpen(true);
            return;
        }
        await handlePunchIn("", "", prepared.measurement, { isWfh: !!prepared.wfhApproved });
    };

    const onPunchOutClick = async () => {
        if (isPunching || punchGps.isBusy || !punchHasOpenSession()) return;
        resetPunchTimings();
        markPunchTiming("afterUiValidation");
        if (!location.isAvailable) {
            alert(location.error || "Cannot punch out without location. Please enable location services.");
            return;
        }
        const prepared = await prepareFreshPunchMeasurement();
        if (!prepared) return;
        if (prepared.requiresReason || prepared.lowSignal) {
            setGeoReasonMode("out");
            setGeoReasonModalOpen(true);
            return;
        }
        await handlePunchOut("", "", prepared.measurement);
    };

    const submitRepeatPunchIn = async () => {
        resetPunchTimings();
        const t = repeatPunchReason.trim();
        if (t.length < 3) {
            alert("Please enter a reason (at least 3 characters).");
            return;
        }
        markPunchTiming("afterUiValidation");
        // Need fresh GPS if user opened repeat modal before acquiring
        if (!punchMeasurementRef.current) {
            const prepared = await prepareFreshPunchMeasurement();
            if (!prepared) return;
            if (prepared.requiresReason || prepared.lowSignal) {
                setGeoReasonMode("in");
                setGeoReasonModalOpen(true);
                return;
            }
            await handlePunchIn("", t, prepared.measurement, { isWfh: !!prepared.wfhApproved });
            return;
        }
        const geoTrim = geoReason.trim();
        const wfhOk = !!location.wfhApproved;
        if (!wfhOk && (geo.requiresReason || !location.isInRange) && geoTrim.length < 10) {
            setGeoReasonMode("in");
            setGeoReasonModalOpen(true);
            return;
        }
        await handlePunchIn(geoTrim, t, punchMeasurementRef.current, { isWfh: wfhOk });
    };

    const submitGeoReasonPunch = async () => {
        resetPunchTimings();
        const t = geoReason.trim();
        if (t.length < 10) {
            alert("Please enter a location reason (at least 10 characters).");
            return;
        }
        markPunchTiming("afterUiValidation");
        if (!punchMeasurementRef.current) {
            const prepared = await prepareFreshPunchMeasurement();
            if (!prepared) return;
        }
        punchGps.setPunchState(punchGps.PunchGpsState.READY, "Location verified");
        if (geoReasonMode === "out") {
            await handlePunchOut(t, "", punchMeasurementRef.current);
            return;
        }
        const repeatTrim = repeatPunchReason.trim();
        if (dynamicData.punch.requires_repeat_punch_reason && repeatTrim.length < 3) {
            setRepeatPunchModalOpen(true);
            return;
        }
        await handlePunchIn(t, repeatTrim, punchMeasurementRef.current);
    };

    const submitExtendedHoursPunchOut = async () => {
        resetPunchTimings();
        const t = extendedHoursReason.trim();
        if (t.length < 3) {
            alert("Please enter a reason (at least 3 characters).");
            return;
        }
        markPunchTiming("afterUiValidation");
        if (!punchMeasurementRef.current) {
            const prepared = await prepareFreshPunchMeasurement();
            if (!prepared) return;
            if (prepared.requiresReason || prepared.lowSignal) {
                setGeoReasonMode("out");
                setGeoReasonModalOpen(true);
                return;
            }
        }
        await handlePunchOut("", t, punchMeasurementRef.current);
    };
    const probation = dynamicData.probation;
    const showProbationCard = probation?.show_on_dashboard;
    const probationCardClass = probation?.status ? `probation-status-card--${probation.status}` : '';
    const dojFormatted = useMemo(() => formatDate(dynamicData.user.doj), [dynamicData.user.doj]);
    const experience = useMemo(() => calculateExperience(dynamicData.user.doj), [dynamicData.user.doj]);
    const totalLeave = useMemo(() => {
        const pl = Number(dynamicData.leave_balance.pl);
        const cl = Number(dynamicData.leave_balance.cl);
        return (isNaN(pl) || isNaN(cl)) ? 'N/A' : (pl + cl);
    }, [dynamicData.leave_balance]);
    const leaveBreakdown = useMemo(() => {
        const lb = dynamicData.leave_balance || {};
        const remainingPl = Number(lb.pl ?? 0);
        const remainingCl = Number(lb.cl ?? 0);
        const remainingComp = Number(lb.comp ?? 0);
        const totalPl = Number(lb.total_pl ?? 0);
        const totalCl = Number(lb.total_cl ?? 0);
        const usedPl = Number(lb.used_pl ?? 0);
        const usedCl = Number(lb.used_cl ?? 0);
        const usedComp = Number(lb.used_comp ?? 0);
        const compSubtext = remainingComp > 0
            ? `Available now · each valid 30 days`
            : usedComp > 0
                ? `Used ${usedComp} · no active comp-off`
                : 'Earned on Sundays · valid 30 days';
        return [
            {
                key: 'pl',
                label: 'Privilege Leave (PL)',
                remaining: remainingPl,
                subtext: `Total ${totalPl}, Used ${usedPl}`,
                icon: <FiStar size={22} />,
                colorClass: 'blue',
            },
            {
                key: 'cl',
                label: 'Casual Leave (CL)',
                remaining: remainingCl,
                subtext: `Total ${totalCl}, Used ${usedCl}`,
                icon: <FiSun size={22} />,
                colorClass: 'green',
            },
            {
                key: 'comp',
                label: 'Compensatory Leave (Comp Off)',
                remaining: remainingComp,
                subtext: `${compSubtext} · tap for details`,
                icon: <FiRefreshCw size={22} />,
                colorClass: 'orange',
                clickable: true,
                onClick: () => {
                    setLeaveBalanceModalOpen(false);
                    navigate('/leaves/comp-off');
                },
            },
        ];
    }, [dynamicData.leave_balance, navigate]);
    const punchInTimeDisplay = useMemo(() => formatTime(dynamicData.punch.punch_in), [dynamicData.punch.punch_in]);
    const todaysDate = useMemo(() => formatDate(new Date()), []);
    const currentStatus = useMemo(() => {
        const open = dynamicData.punch.has_open_session ?? (!!dynamicData.punch.punch_in && !dynamicData.punch.punch_out);
        return open ? "Active" : "Inactive";
    }, [dynamicData.punch.punch_in, dynamicData.punch.punch_out, dynamicData.punch.has_open_session]);
    const isCheckedIn = punchHasOpenSession();
    const isCheckedOut = !punchHasOpenSession() && !!(dynamicData.punch.punch_in || dynamicData.punch.punch_out);
    const isActive = isCheckedIn;
    const locationPill = useMemo(
        () => zoneToLocationLabel(geo.zone, location.isInRange),
        [geo.zone, location.isInRange],
    );
    const punchBusy = isPunching || punchGps.isBusy;
    const punchStatusLine =
        punchGps.statusMessage ||
        (punchGps.errorMessage && punchGps.state === punchGps.PunchGpsState.ERROR
            ? punchGps.errorMessage
            : "");

    // Presentation-only: mirror trusted-cache eligibility under the location badge.
    useEffect(() => {
        let alive = true;
        const refreshHint = () => {
            if (!alive) return;
            if (punchGps.isBusy || isPunching) {
                setInstantPunchAgeSec(null);
                return;
            }
            const evaluation = evaluateTrustedLocation(trustedLocationRef.current);
            if (!evaluation.ok) {
                setInstantPunchAgeSec(null);
                return;
            }
            setInstantPunchAgeSec(Math.max(0, Math.floor((evaluation.ageMs || 0) / 1000)));
        };
        refreshHint();
        const id = window.setInterval(refreshHint, 1000);
        return () => {
            alive = false;
            window.clearInterval(id);
        };
    }, [punchGps.isBusy, isPunching, location.lat, location.lon, location.isInRange, geo.zone]);

    const instantPunchHint =
        instantPunchAgeSec == null
            ? null
            : instantPunchAgeSec <= 1
              ? "Ready for instant punch"
              : `Verified ${instantPunchAgeSec} seconds ago`;
    const managerName = [dynamicData.managers?.l2?.name, dynamicData.managers?.l1?.name, dynamicData.managers?.l3?.name]
        .map((n) => (typeof n === "string" ? n.trim() : n))
        .find((n) => n) || "N/A";
    const managerDept = dynamicData.user?.circle || "N/A"; 
    const userCircle = (dynamicData.user?.circle || '').trim().toUpperCase();
    const showWfhQuickAction = userCircle === "NHQ";
    const myEmpId =
        (dynamicData.user?.emp_id || dynamicData.user?.empId || dynamicData.employee?.emp_id || "").trim();

    useEffect(() => {
        if (!leaveBalanceModalOpen) return undefined;
        const onKeyDown = (e) => {
            if (e.key === "Escape") setLeaveBalanceModalOpen(false);
        };
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKeyDown);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [leaveBalanceModalOpen]);

    if (loading) return (
        <div className="full-height-center">
            <h2 className="loader"></h2>
        </div>
    );
    return (
        <>
        <PolicyAckModal />
        <div className="main-layout">
            <div className="content-area">
                <div className="dashboard-content" style={{ paddingTop: "24px" }}>
                    <div className="top-cards-grid">
                        <div className="card top-card simple-card">
                            <div className="card-content-wrapper">
                                <h4 className="card-label">Employee ID</h4>
                                <h3 className="card-value">{dynamicData.user.emp_id || 'N/A'}</h3> 
                                <p className="card-subtext">{dynamicData.employee?.emp_type || dynamicData.user?.emp_type || dynamicData.user?.department || 'N/A'}</p> 
                            </div>
                            <div className="card-icon-round blue-bg">
                                <MdBadge className="icon-white" size={24} />
                            </div>
                        </div>
                        <div className="card top-card simple-card">
                            <div className="card-content-wrapper">
                                <h4 className="card-label">Date of Joining</h4>
                                <h3 className="card-value">{dojFormatted}</h3> 
                                <p className="card-subtext">{experience}</p> 
                            </div>
                            <div className="card-icon-round green-bg">
                                <MdCalendarToday className="icon-white" size={24} />
                            </div>
                        </div>
                        <div
                            className="card top-card simple-card leave-balance-card--clickable"
                            role="button"
                            tabIndex={0}
                            aria-label="View leave balance breakdown"
                            onClick={() => setLeaveBalanceModalOpen(true)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setLeaveBalanceModalOpen(true);
                                }
                            }}
                        >
                            <div className="card-content-wrapper">
                                <h4 className="card-label">Leave Balance</h4>
                                <h3 className="card-value">{totalLeave} Days</h3> 
                                <p className="card-subtext">
                                    {dynamicData.leave_balance.pl} PL + {dynamicData.leave_balance.cl} CL
                                </p>
                            </div>
                            <div className="card-icon-round sky-bg">
                                <FiSun className="icon-white" size={24} />
                            </div>
                        </div>
                        <div className="card top-card manager-card">
                            <div className="manager-content-left">
                                <div className="card-label">Reporting Manager</div>
                                <div className="manager-profile-box">
                                    <h3 className="manager-name-text">{managerName}</h3> 
                                    <p className="manager-dept-text">{managerDept}</p> 
                                </div>
                            </div>
                            <button className="profile-action-btn orange-bg">
                                <FiUserCheck className="icon-white" size={24} />
                            </button>
                        </div>
                    </div>
                    {showProbationCard && (
                        <div className={`probation-status-card ${probationCardClass}`}>
                            <div className="probation-status-card__content">
                                <p className="probation-status-card__label">Probation</p>
                                <h3 className="probation-status-card__title">{probation.status_label}</h3>
                                <p className="probation-status-card__message">{probation.message}</p>
                                <div className="probation-status-card__meta">
                                    <span>End date: {formatDate(probation.probation_end_date)}</span>
                                    {probation.days_remaining > 0 && (
                                        <span>{probation.days_remaining} day(s) left</span>
                                    )}
                                </div>
                            </div>
                            <div className="probation-status-card__icon">
                                <FiCheckCircle size={28} />
                            </div>
                        </div>
                    )}
                    <div className="main-grid">
                        <div className="dashboard-top-row grid-span-4">
                            <div className="attendance-section">
                            <div className="attendance-header">
                                <h2 className="section-title">Today's Status</h2>
                                <span className="attendance-date">{todaysDate}</span>
                            </div>
                            <div className="attendance-body">
                                <div className="attendance-body-primary">
                                    {/* Location & Status Row */}
                                    <div className="status-row-top">
                                        <div className="location-badge-stack">
                                            <div className="location-badge">
                                                <span className="location-label">Location</span>
                                                <span className={`location-pill ${locationPill.tone}`}>
                                                    <span className="location-dot"></span>
                                                    {location.isAvailable ? locationPill.text : "Off"}
                                                </span>
                                            </div>
                                            {instantPunchHint && !punchStatusLine && (
                                                <span
                                                    className="location-trusted-hint"
                                                    aria-live="polite"
                                                >
                                                    {instantPunchHint}
                                                </span>
                                            )}
                                        </div>
                                        <div className={`status-badge-main ${isActive ? 'active' : 'inactive'}`}>
                                            <span className={`status-pulse-dot ${isActive ? 'active' : ''}`}></span>
                                            <span className="status-text">{currentStatus}</span>
                                        </div>
                                    </div>

                                    {punchStatusLine && (
                                        <div
                                            className={`location-gps-status${
                                                punchGps.state === punchGps.PunchGpsState.ERROR
                                                    ? " location-gps-status--error"
                                                    : punchGps.state === punchGps.PunchGpsState.LOW_SIGNAL ||
                                                        punchGps.state === punchGps.PunchGpsState.OUTSIDE
                                                      ? " location-gps-status--warn"
                                                      : ""
                                            }`}
                                            aria-live="polite"
                                        >
                                            {punchStatusLine}
                                        </div>
                                    )}

                                    {location.error && !punchStatusLine && (
                                        <div className="location-error-banner">
                                            <span>⚠️</span>
                                            <span>{location.error}</span>
                                        </div>
                                    )}

                                    {/* Stats Grid */}
                                    <div className="status-stats-grid">
                                        <div className="status-stat-card">
                                            <span className="stat-label">Check In</span>
                                            <span className="stat-value">{punchInTimeDisplay || '--:--:--'}</span>
                                        </div>
                                        <div className="status-stat-card highlight">
                                            <span className="stat-label">Hours Today</span>
                                            <span className="stat-value stat-timer">{formatWorkingHours(dynamicData.punch.working_hours)}</span>
                                            <span className="stat-hint">Including all sessions</span>
                                        </div>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="status-action-buttons">
                                        <button
                                            className="btn-punch btn-punch-in"
                                            onClick={onPunchInClick}
                                            disabled={punchHasOpenSession() || punchBusy || !location.isAvailable}
                                        >
                                            <FiCheckCircle className="btn-icon" />
                                            {punchBusy && !isCheckedIn
                                                ? punchGps.isBusy
                                                    ? punchGps.statusMessage || "Finding your location…"
                                                    : "Punching In..."
                                                : "Punch In"}
                                        </button>
                                        <button
                                            className="btn-punch btn-punch-out"
                                            onClick={onPunchOutClick}
                                            disabled={!punchHasOpenSession() || punchBusy || !location.isAvailable}
                                        >
                                            {punchBusy && punchHasOpenSession()
                                                ? punchGps.isBusy
                                                    ? punchGps.statusMessage || "Finding your location…"
                                                    : "Punching Out..."
                                                : "Punch Out"}
                                        </button>
                                    </div>
                                </div>

                                <PunchSessionsList
                                    sessions={dynamicData.punch.sessions}
                                    sessionAttendanceDate={dynamicData.punch.session_attendance_date}
                                    formatTime={formatTime}
                                    formatWorkingHours={formatWorkingHours}
                                    formatTimeDifference={formatTimeDifference}
                                />
                            </div>
                            </div>
                            <div 
                                className={`news-feed-section${newsFeedScrollPaused ? ' news-feed-section--manual-scroll' : ''}`}
                                onMouseEnter={() => setNewsFeedScrollPaused(true)}
                                onMouseLeave={() => setNewsFeedScrollPaused(false)}
                                onTouchStart={() => setNewsFeedScrollPaused(true)}
                                onTouchEnd={() => setNewsFeedScrollPaused(false)}
                                onTouchCancel={() => setNewsFeedScrollPaused(false)}
                            >
                            <h2 className="news-feed">
                                <span 
                                    className="news-feed-gradient-text"
                                    style={{ 
                                        background: 'linear-gradient(to right, #4f46e5, #3b82f6, #10b981)', 
                                        WebkitBackgroundClip: 'text', 
                                        backgroundClip: 'text', 
                                        color: 'transparent',
                                        WebkitTextFillColor: 'transparent',
                                        display: 'inline-block'
                                    }}
                                >
                                    News Feed
                                </span>
                            </h2>
                            <p className="subtext">Announcements, birthdays & work anniversaries for your circle</p>
                            {newsFeed.length === 0 ? (
                                <p className="news-feed-empty">No announcements yet.</p>
                            ) : (
                                <div className="news-feed-scroll-viewport">
                                <ul className="news-feed-list" ref={newsFeedListRef}>
                                    {loopedNewsFeed.map((item, index) => {
                                        const feedType = item.type || "post";
                                        const showDate = shouldShowNewsFeedDate(item);
                                        const hasAttachment = Boolean(item.file_url || item.file_path);
                                        return (
                                        <li
                                            key={`${item.id}-${index}`}
                                            className={`news-feed-item ${feedType === "birthday" ? "news-feed-birthday" : ""} ${feedType === "anniversary" ? "news-feed-anniversary" : ""} ${feedType === "joining" ? "news-feed-joining" : ""}`}
                                        >
                                            <h4 className="news-feed-title">
                                                {feedType === "birthday" && "🎂 "}
                                                {feedType === "anniversary" && "🎉 "}
                                                {feedType === "joining" && "👋 "}
                                                {item.title}
                                            </h4>
                                            <p className="news-feed-content">{item.content}</p>
                                            {(showDate || hasAttachment) && (
                                            <div className="news-feed-meta">
                                                {showDate ? (
                                                    <span className="news-feed-date">{formatDate(item.created_at)}</span>
                                                ) : null}
                                                {hasAttachment ? (
                                                    <a
                                                        href={item.file_url || `/static/uploads/${item.file_path}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="news-feed-file"
                                                    >
                                                        Attachment
                                                    </a>
                                                ) : null}
                                            </div>
                                            )}
                                        </li>
                                        );
                                    })}
                                </ul>
                                </div>
                            )}
                        </div>
                        </div>
                        <div className="quick-actions grid-span-4 actions-grid" >
                            <NavLink to="/leaves" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <div className="action-icon green"><div className="action-icon-inner"><FiSun /></div></div>
                                    <div>
                                        <h4>Apply for Leave</h4>
                                        <p>Submit a new leave request</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            {hasFeature("dashboard_payslip") ? (
                            <NavLink to="/payslip" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <div className="action-icon orange"><div className="action-icon-inner"><GiReceiveMoney /></div></div>
                                    <div>
                                        <h4>View Payslips</h4>
                                        <p>Download payslip statements</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            ) : null}
                            <NavLink to="/profile" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <div className="action-icon sky"><div className="action-icon-inner"><FiUser /></div></div>
                                    <div>
                                        <h4>My Profile</h4>
                                        <p>View and edit your details</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            {showWfhQuickAction ? (
                            <NavLink to="/wfh" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <div className="action-icon green"><div className="action-icon-inner"><FiHome /></div></div>
                                    <div>
                                        <h4>WFH Request</h4>
                                        <p>Request work from home</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            ) : null}
                            <NavLink to="/attendance" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <div className="action-icon sky"><div className="action-icon-inner"><FiClock /></div></div>
                                    <div>
                                        <h4>My Attendance</h4>
                                        <p>Check attendance records</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            <NavLink to="/queries" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <div className="action-icon blue"><div className="action-icon-inner"><FiHelpCircle /></div></div> 
                                    <div>
                                        <h4>Raise a Query</h4>
                                        <p>Ask for HR/Admin support</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            {hasFeature("dashboard_my_assets") ? (
                            <NavLink
                                to={myEmpId ? `/it/employee/${encodeURIComponent(myEmpId)}` : "#"}
                                state={{ selfAssets: true }}
                                className="action-card nav-link-card"
                                onClick={(e) => {
                                    if (!myEmpId) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        alert("Employee ID not found. Please contact IT.");
                                    }
                                }}
                            >
                                <div className="action-icon-group">
                                    <div className="action-icon sky"><div className="action-icon-inner"><FiUserCheck /></div></div>
                                    <div>
                                        <h4>My Assets</h4>
                                        <p>View your assigned assets</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            ) : null}
                             {hasFeature("dashboard_claims") ? (
                             <NavLink to="/claims" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <div className="action-icon orange"><div className="action-icon-inner"><FiDollarSign /></div></div>
                                    <div>
                                        <h4>Claims</h4>
                                        <p>Check claim records</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                             ) : null}
                            {hasFeature("dashboard_payslip") ? (
                            <NavLink to="/tax-declaration" className="action-card nav-link-card">
                                <div className="action-icon-group">
                                    <div className="action-icon orange"><div className="action-icon-inner"><FiFileText /></div></div>
                                    <div>
                                        <h4>Tax Declaration</h4>
                                        <p>Declare investments &amp; tax details</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            ) : null}
                            <NavLink to="/change-password" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <div className="action-icon blue"><div className="action-icon-inner"><FiKey /></div></div>
                                    <div>
                                        <h4>Change Password</h4>
                                        <p>Update your account password</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            <NavLink
                                to="/holiday-calendar"
                                className="action-card nav-link-card"
                                onClick={(e) => {
                                    if (userCircle !== 'NHQ') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        alert('Holiday Calendar is only available for NHQ users.');
                                    }
                                }}
                            > 
                                <div className="action-icon-group">
                                    <div className="action-icon sky"><div className="action-icon-inner"><FiCalendar /></div></div>
                                    <div>
                                        <h4>Holiday Calendar</h4>
                                        <p>View upcoming holidays</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                               {/* <NavLink to="/account" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <IoMdPerson className="action-icon sky" />
                                    <div>
                                        <h4>Accounts</h4>
                                        <p>Accounts Details</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink> */}
                        </div>

                        {/* Recent Activity */}
                        <div className="recent-box grid-span-4">
                            <h2 className="rec-act">Recent Activity</h2>
                            <RecentActivityList
                                punchIn={dynamicData.punch?.punch_in}
                                punchOut={dynamicData.punch?.punch_out}
                                lastLeave={dynamicData.last_leave}
                                lastPayslip={dynamicData.last_payslip}
                                formatTime={formatTime}
                                formatTimeAgo={formatTimeAgo}
                                formatDate={formatDate}
                                canViewPayslip={hasFeature("dashboard_payslip")}
                                onNavigate={(href) => navigate(href)}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
        {leaveBalanceModalOpen && createPortal(
            <div
                className="dashboard-leave-balance-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="leave-balance-title"
                onClick={() => setLeaveBalanceModalOpen(false)}
            >
                <div className="dashboard-leave-balance-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="dashboard-leave-balance-modal__header">
                        <div>
                            <h3 id="leave-balance-title">Leave Balance</h3>
                            <p className="dashboard-leave-balance-modal__subtitle">
                                {dynamicData.user?.first_name
                                    ? `${dynamicData.user.first_name}'s available leave`
                                    : 'Your available leave'}
                            </p>
                        </div>
                        <button
                            type="button"
                            className="dashboard-leave-balance-modal__close"
                            aria-label="Close"
                            onClick={() => setLeaveBalanceModalOpen(false)}
                        >
                            <FiX size={20} />
                        </button>
                    </div>
                    <div className="dashboard-leave-balance-grid">
                        {leaveBreakdown.map((item) => (
                            <div
                                key={item.key}
                                className={`dashboard-leave-balance-item dashboard-leave-balance-item--${item.colorClass}${item.clickable ? ' dashboard-leave-balance-item--clickable' : ''}`}
                                role={item.clickable ? 'button' : undefined}
                                tabIndex={item.clickable ? 0 : undefined}
                                aria-label={item.clickable ? `${item.label} details` : undefined}
                                onClick={item.clickable ? item.onClick : undefined}
                                onKeyDown={item.clickable ? (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        item.onClick?.();
                                    }
                                } : undefined}
                            >
                                <div className="dashboard-leave-balance-item__content">
                                    <span className="dashboard-leave-balance-item__value">
                                        {Number.isFinite(item.remaining) ? item.remaining : 'N/A'}
                                    </span>
                                    <span className="dashboard-leave-balance-item__label">{item.label}</span>
                                    <span className="dashboard-leave-balance-item__subtext">{item.subtext}</span>
                                </div>
                                <div className="dashboard-leave-balance-item__icon">{item.icon}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>,
            document.body,
        )}
        {repeatPunchModalOpen && (
            <div
                className="dashboard-repeat-punch-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="repeat-punch-title"
                onClick={() => !isPunching && setRepeatPunchModalOpen(false)}
            >
                <div className="dashboard-repeat-punch-modal" onClick={(e) => e.stopPropagation()}>
                    <h3 id="repeat-punch-title">Punch in again</h3>
                    <p className="dashboard-repeat-punch-hint">
                        You already completed a session today. Enter a reason for this punch-in (at least 3 characters).
                    </p>
                    <textarea
                        className="dashboard-repeat-punch-textarea"
                        value={repeatPunchReason}
                        onChange={(e) => setRepeatPunchReason(e.target.value)}
                        placeholder="e.g. Returned for night support / client call"
                        rows={4}
                        disabled={isPunching}
                    />
                    <div className="dashboard-repeat-punch-actions">
                        <button
                            type="button"
                            className="dashboard-repeat-punch-btn secondary"
                            disabled={isPunching}
                            onClick={() => {
                                setRepeatPunchModalOpen(false);
                                setRepeatPunchReason("");
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="dashboard-repeat-punch-btn primary"
                            disabled={isPunching}
                            onClick={submitRepeatPunchIn}
                        >
                            {isPunching ? "Submitting…" : "Confirm punch in"}
                        </button>
                    </div>
                </div>
            </div>
        )}
        {geoReasonModalOpen && (
            <div
                className="dashboard-repeat-punch-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="geo-reason-title"
                onClick={() => {
                  if (isPunching || punchBusy) return;
                  setGeoReasonModalOpen(false);
                  setGeoReason("");
                  punchMeasurementRef.current = null;
                  punchGps.reset();
                }}
            >
                <div className="dashboard-repeat-punch-modal" onClick={(e) => e.stopPropagation()}>
                    <h3 id="geo-reason-title">
                        {geoReasonMode === "out" ? "Outside office — punch out reason" : "Outside office — punch in reason"}
                    </h3>
                    <p className="dashboard-repeat-punch-hint">
                        Your location is outside the office geofence. Enter a reason (at least 10 characters),
                        or punch from an approved WFH day.
                    </p>
                    <textarea
                        className="dashboard-repeat-punch-textarea"
                        value={geoReason}
                        onChange={(e) => setGeoReason(e.target.value)}
                        placeholder="e.g. Client site visit at ABC Corp / field duty"
                        rows={4}
                        disabled={isPunching || punchBusy}
                    />
                    <div className="dashboard-repeat-punch-actions">
                        <button
                            type="button"
                            className="dashboard-repeat-punch-btn secondary"
                            disabled={isPunching || punchBusy}
                            onClick={() => {
                                setGeoReasonModalOpen(false);
                                setGeoReason("");
                                punchMeasurementRef.current = null;
                                punchGps.reset();
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="dashboard-repeat-punch-btn primary"
                            disabled={isPunching || punchBusy}
                            onClick={submitGeoReasonPunch}
                        >
                            {isPunching || punchBusy
                                ? "Submitting…"
                                : geoReasonMode === "out"
                                    ? "Confirm punch out"
                                    : "Confirm punch in"}
                        </button>
                    </div>
                </div>
            </div>
        )}
        {extendedHoursModalOpen && (
            <div
                className="dashboard-repeat-punch-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="extended-hours-punch-title"
                onClick={() => !isPunching && setExtendedHoursModalOpen(false)}
            >
                <div className="dashboard-repeat-punch-modal" onClick={(e) => e.stopPropagation()}>
                    <h3 id="extended-hours-punch-title">Long session — reason required</h3>
                    <p className="dashboard-repeat-punch-hint">
                        Today's total work is over 10 hours (for example, forgot to punch out).
                        Please explain briefly (at least 3 characters) before punching out.
                    </p>
                    <textarea
                        className="dashboard-repeat-punch-textarea"
                        value={extendedHoursReason}
                        onChange={(e) => setExtendedHoursReason(e.target.value)}
                        placeholder="e.g. Forgot to punch out / on-call overnight"
                        rows={4}
                        disabled={isPunching}
                    />
                    <div className="dashboard-repeat-punch-actions">
                        <button
                            type="button"
                            className="dashboard-repeat-punch-btn secondary"
                            disabled={isPunching}
                            onClick={() => {
                                setExtendedHoursModalOpen(false);
                                setExtendedHoursReason("");
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="dashboard-repeat-punch-btn primary"
                            disabled={isPunching}
                            onClick={submitExtendedHoursPunchOut}
                        >
                            {isPunching ? "Submitting…" : "Confirm punch out"}
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
};
