import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { NavLink } from "react-router-dom";
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
} from "react-icons/fi";
import { MdBadge, MdCalendarToday } from "react-icons/md";
import { GiReceiveMoney } from "react-icons/gi";
import { IoMdPerson } from "react-icons/io";
import "./Dashboard.css";
import { hasFeature } from "../../utils/planFeatures";
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
    result = { message: `Server error (${response.status})` };
  }
  return { ok: response.ok, result };
}

/** Fresh GPS for auto cap punch-out (not cached punch-in location). */
function fetchFreshPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

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

const formatDate = (dateString) => {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};
const formatTime = (timeString) => {
  if (!timeString) return "---";
  try {
    const s = String(timeString).trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
      const [h, m, sec = 0] = s.split(":").map(Number);
      const d = new Date();
      d.setHours(h, m, sec, 0);
      return d.toLocaleTimeString("en-US", {
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
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
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
}) {
  const items = [];
  if (punchIn) {
    items.push({
      key: "punch-in",
      dot: "green",
      text: `Punch-in at ${formatTime(punchIn)}`,
      time: "Today",
    });
  }
  if (punchOut) {
    items.push({
      key: "punch-out",
      dot: "blue",
      text: `Punch-out at ${formatTime(punchOut)}`,
      time: "Today",
    });
  }
  if (lastLeave) {
    const status = (lastLeave.status || "").toLowerCase();
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
    });
  }
  if (lastPayslip) {
    items.push({
      key: `payslip-${lastPayslip.id}`,
      dot: "blue",
      text: `Payslip updated: ${lastPayslip.month || ""} ${lastPayslip.year || ""}`,
      time:
        `${lastPayslip.month || ""} ${lastPayslip.year || ""}`.trim() || "—",
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
      {items.map((item) => (
        <li key={item.key}>
          <div className="left">
            <span className={`dot ${item.dot}`}></span> {item.text}
          </div>
          <span className="time">{item.time}</span>
        </li>
      ))}
    </ul>
  );
}

export const Dashboard = () => {  
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isPunching, setIsPunching] = useState(false);
    const [location, setLocation] = useState({ 
        lat: null, 
        lon: null, 
        error: null,
        isAvailable: false,
        isInRange: false
    });
    const [geo, setGeo] = useState({
        zone: "NO_GPS",
        requiresReason: false,
        distance: null,
        radius: null,
        grace: 100,
        message: ""
    });
    const [dynamicData, setDynamicData] = useState({
        user: {},
        employee: {},
        punch: {},
        leave_balance: { pl: 'N/A', cl: 'N/A' },
        managers: {},
        last_leave: null,
        last_payslip: null,
    });
    const [punchInDateTime, setPunchInDateTime] = useState(null);
    const [repeatPunchModalOpen, setRepeatPunchModalOpen] = useState(false);
    const [repeatPunchReason, setRepeatPunchReason] = useState("");
    const [extendedHoursModalOpen, setExtendedHoursModalOpen] = useState(false);
    const [extendedHoursReason, setExtendedHoursReason] = useState("");
    const punchDataRef = useRef({
        sessions: [],
        punch_in: null,
        has_open_session: false,
    });
    const [newsFeed, setNewsFeed] = useState([]);
    const [newsFeedScrollPaused, setNewsFeedScrollPaused] = useState(false);
    const newsFeedListRef = useRef(null);
    const autoCapPunchOutRef = useRef(false);
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
        const id = setInterval(() => fetchDashboardData(false), 60_000);
        return () => clearInterval(id);
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
                body.lat = fresh.lat;
                body.lon = fresh.lon;
                setLocation((prev) => ({
                    ...prev,
                    lat: fresh.lat,
                    lon: fresh.lon,
                    isAvailable: true,
                }));
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
                setNewsFeed(data.news_feed);
            }
        } catch {
            setNewsFeed([]);
        }
    };
    useEffect(() => {
        const loadInitialData = async () => {
            await fetchDashboardData();
            await fetchNewsFeed();
        };
        loadInitialData();
    }, []);

  /** Duplicate items for seamless top-to-bottom loop scroll */
  const loopedNewsFeed = useMemo(() => {
    if (newsFeed.length <= 1) return newsFeed;
    return [...newsFeed, ...newsFeed];
  }, [newsFeed]);

  /* News feed auto-scroll: continuous top → bottom loop (pauses on hover) */
  useEffect(() => {
    if (!newsFeed.length || newsFeedScrollPaused) return;
    const el = newsFeedListRef.current;
    if (!el || el.scrollHeight <= el.clientHeight) return;

    const step = 1;
    const intervalMs = 32;
    const loopAt = newsFeed.length > 1 ? el.scrollHeight / 2 : el.scrollHeight;

    const id = setInterval(() => {
      if (!el) return;
      el.scrollTop += step;
      if (el.scrollTop >= loopAt - 1) {
        el.scrollTop = 0;
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [newsFeed.length, newsFeedScrollPaused, loopedNewsFeed.length]);
  const validateLocationRange = async (lat, lon) => {
    const token = localStorage.getItem("token");
    if (!token)
      return { in_range: false, requires_reason: true, zone: "NO_GPS" };
    try {
      const res = await fetch(
        `${API_BASE_URL}/employee/location-check?lat=${lat}&lon=${lon}`,
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
      });
      return { in_range: false, requires_reason: true, zone: "NO_GPS" };
    }
  };

    useEffect(() => {
        const checkLocation = async () => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    async (position) => {
                        const lat = position.coords.latitude;
                        const lon = position.coords.longitude;
                        const locationData = await validateLocationRange(lat, lon);
                        const inRange = !!locationData?.in_range;
                        const zone = locationData?.zone || "NO_GPS";
                        const errorMessage = inRange || zone === "NO_OFFICE_CONFIG"
                            ? null
                            : "You are outside office range. Punch In/Out requires a reason.";
                        setLocation({
                            lat,
                            lon,
                            error: errorMessage,
                            isAvailable: true,
                            isInRange: inRange,
                        });
                    },
                    (err) => {
                        console.warn(`Geolocation Error: ${err.code} - ${err.message}`);
                        setLocation((prev) => ({ 
                            ...prev, 
                            error: "Location access denied or unavailable. Punch In/Out requires location.",
                            isAvailable: false,
                            isInRange: false
                        }));
                    }
                );
            } else {
                setLocation((prev) => ({ 
                    ...prev, 
                    error: "Geolocation not supported by this browser.",
                    isAvailable: false,
                    isInRange: false
                }));
            }
        };
        
        checkLocation();
        const locationInterval = setInterval(checkLocation, 30000);
        
        return () => clearInterval(locationInterval);
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
    const handlePunchIn = async (geoReason = "", repeatPunchReasonParam = "") => {
        if (isPunching || !location.lat || !location.lon || !location.isAvailable) {
            alert(location.error || "Cannot punch in without location. Please enable location services.");
            return;
        } 
        setIsPunching(true);
        const token = localStorage.getItem('token');
        const repeatTrim = (repeatPunchReasonParam || "").trim();
        const payload = {
            lat: location.lat,
            lon: location.lon,
            is_wfh: false,
            geo_reason: geoReason || null,
        };
        if (repeatTrim.length >= 3) {
            payload.repeat_punch_reason = repeatTrim;
        }
        try {
            const response = await fetch(`${API_BASE_URL}/employee/punch-in`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (response.ok && result.success) {
                setRepeatPunchModalOpen(false);
                setRepeatPunchReason("");
                alert(`Punched In Successfully at ${formatTime(result.punch_in)}!`);
                await fetchDashboardData(false);
            } else {
                // If location is out of range, update state
                if (result.message && result.message.includes("Too far")) {
                    setLocation(prev => ({ ...prev, isInRange: false }));
                }
                if (result.requires_repeat_punch_reason) {
                    setRepeatPunchModalOpen(true);
                }
                alert(`Punch In Failed: ${result.message || 'Server error.'}`);
            }
        } catch (error) {
            console.error("Punch In error:", error);
            if (!navigator.onLine) {
                alert("No internet connection. Please check your network and try again.");
            } else {
                alert("We couldn't complete your request right now. Please try again.");
            }
        } finally {
            setIsPunching(false);
        }
    };
    const handlePunchOut = async (geoReason = "", extendedHoursReasonParam = "") => {
        if (isPunching || !location.lat || !location.lon || !location.isAvailable) {
            alert(location.error || "Cannot punch out without location. Please enable location services.");
            return;
        } 
        setIsPunching(true);
        const token = localStorage.getItem('token');
        const extTrim = (extendedHoursReasonParam || "").trim();
        try {
            const { ok, result } = await postPunchOutRequest(token, {
                lat: location.lat,
                lon: location.lon,
                geo_reason: geoReason || null,
                ...(extTrim.length >= 3 ? { extended_hours_reason: extTrim } : {}),
            });
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
                await fetchDashboardData();
                setExtendedHoursModalOpen(false);
                setExtendedHoursReason("");
                alert(`Punched Out Successfully! Total Today's Work: ${result.today_work || 'N/A'}`);
            } else {
                if (result.message && result.message.includes("Too far")) {
                    setLocation(prev => ({ ...prev, isInRange: false }));
                }
                if (result.requires_extended_hours_reason) {
                    setExtendedHoursModalOpen(true);
                } else {
                    alert(`Punch Out Failed: ${result.message || 'Server error.'}`);
                }
            }
        } catch (error) {
            console.error("Punch Out error:", error);
            if (!navigator.onLine) {
                alert("No internet connection. Please check your network and try again.");
            } else {
                alert("We couldn't complete your request right now. Please try again.");
            }
        } finally {
            setIsPunching(false);
        }
    };
    const punchHasOpenSession = () =>
        dynamicData.punch.has_open_session ?? (!!dynamicData.punch.punch_in && !dynamicData.punch.punch_out);

    const onPunchInClick = async () => {
        if (isPunching || punchHasOpenSession()) return;
        if (!location.lat || !location.lon || !location.isAvailable) {
            alert(location.error || "Cannot punch in without location. Please enable location services.");
            return;
        }
        if (dynamicData.punch.requires_repeat_punch_reason) {
            setRepeatPunchModalOpen(true);
            return;
        }
        await handlePunchIn("", "");
    };
    const onPunchOutClick = async () => {
        if (isPunching || !punchHasOpenSession()) return;
        await handlePunchOut("");
    };

    const submitRepeatPunchIn = async () => {
        const t = repeatPunchReason.trim();
        if (t.length < 3) {
            alert("Please enter a reason (at least 3 characters).");
            return;
        }
        await handlePunchIn("", t);
    };

    const submitExtendedHoursPunchOut = async () => {
        const t = extendedHoursReason.trim();
        if (t.length < 3) {
            alert("Please enter a reason (at least 3 characters).");
            return;
        }
        await handlePunchOut("", t);
    };
    const dojFormatted = useMemo(() => formatDate(dynamicData.user.doj), [dynamicData.user.doj]);
    const experience = useMemo(() => calculateExperience(dynamicData.user.doj), [dynamicData.user.doj]);
    const totalLeave = useMemo(() => {
        const pl = Number(dynamicData.leave_balance.pl);
        const cl = Number(dynamicData.leave_balance.cl);
        return (isNaN(pl) || isNaN(cl)) ? 'N/A' : (pl + cl);
    }, [dynamicData.leave_balance]);
    const punchInTimeDisplay = useMemo(() => formatTime(dynamicData.punch.punch_in), [dynamicData.punch.punch_in]);
    const todaysDate = useMemo(() => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), []);
    const currentStatus = useMemo(() => {
        const open = dynamicData.punch.has_open_session ?? (!!dynamicData.punch.punch_in && !dynamicData.punch.punch_out);
        return open ? "Active" : "Inactive";
    }, [dynamicData.punch.punch_in, dynamicData.punch.punch_out, dynamicData.punch.has_open_session]);
    const isCheckedIn = punchHasOpenSession();
    const isCheckedOut = !punchHasOpenSession() && !!(dynamicData.punch.punch_in || dynamicData.punch.punch_out);
    const isActive = isCheckedIn;
    const managerName = [dynamicData.managers?.l2?.name, dynamicData.managers?.l1?.name, dynamicData.managers?.l3?.name]
        .map((n) => (typeof n === "string" ? n.trim() : n))
        .find((n) => n) || "N/A";
    const managerDept = dynamicData.user?.circle || "N/A"; 
    const userCircle = (dynamicData.user?.circle || '').trim().toUpperCase();
    const showWfhQuickAction = userCircle === "NHQ";
    const myEmpId =
        (dynamicData.user?.emp_id || dynamicData.user?.empId || dynamicData.employee?.emp_id || "").trim();
    if (loading) return (
        <div className="full-height-center">
            <h2 className="loader"></h2>
        </div>
    );
    return (
        <>
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
                        <div className="card top-card simple-card">
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
                                        <div className="location-badge">
                                            <span className="location-label">Location</span>
                                            <span className={`location-pill ${location.isAvailable && location.isInRange ? 'on' : 'off'}`}>
                                                <span className="location-dot"></span>
                                                {location.isAvailable && location.isInRange ? 'Within Range' : 'Off'}
                                            </span>
                                        </div>
                                        <div className={`status-badge-main ${isActive ? 'active' : 'inactive'}`}>
                                            <span className={`status-pulse-dot ${isActive ? 'active' : ''}`}></span>
                                            <span className="status-text">{currentStatus}</span>
                                        </div>
                                    </div>

                                    {location.error && (
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
                                            disabled={punchHasOpenSession() || isPunching || !location.isAvailable}
                                        >
                                            <FiCheckCircle className="btn-icon" />
                                            {isPunching && !isCheckedIn ? 'Punching In...' : 'Punch In'}
                                        </button>
                                        <button
                                            className="btn-punch btn-punch-out"
                                            onClick={onPunchOutClick}
                                            disabled={!punchHasOpenSession() || isPunching || !location.isAvailable}
                                        >
                                            {isPunching && punchHasOpenSession() ? 'Punching Out...' : 'Punch Out'}
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
                                className="news-feed-section"
                                onMouseEnter={() => setNewsFeedScrollPaused(true)}
                                onMouseLeave={() => setNewsFeedScrollPaused(false)}
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
                                    {loopedNewsFeed.map((item, index) => (
                                        <li key={`${item.id}-${index}`} className={`news-feed-item ${(item.type || 'post') === 'birthday' ? 'news-feed-birthday' : ''} ${(item.type || 'post') === 'anniversary' ? 'news-feed-anniversary' : ''}`}>
                                            <h4 className="news-feed-title">
                                                {(item.type || '') === 'birthday' && '🎂 '}
                                                {(item.type || '') === 'anniversary' && '🎉 '}
                                                {item.title}
                                            </h4>
                                            <p className="news-feed-content">{item.content}</p>
                                            <div className="news-feed-meta">
                                                <span className="news-feed-date">{formatDate(item.created_at)}</span>
                                                {(item.file_url || item.file_path) && (
                                                    <a
                                                        href={item.file_url || `/static/uploads/${item.file_path}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="news-feed-file"
                                                    >
                                                        Attachment
                                                    </a>
                                                )}
                                            </div>
                                        </li>
                                    ))}
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
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
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
