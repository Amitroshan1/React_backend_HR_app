import { useEffect, useState, useMemo, useRef } from "react";
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
const API_BASE_URL = "/api/auth";

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
  return `${String(hours)}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
};

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
    isInRange: false,
  });
  const [geo, setGeo] = useState({
    zone: "NO_GPS",
    requiresReason: false,
    distance: null,
    radius: null,
    grace: 100,
    message: "",
  });
  const [dynamicData, setDynamicData] = useState({
    user: {},
    employee: {},
    punch: {},
    leave_balance: { pl: "N/A", cl: "N/A" },
    managers: {},
    last_leave: null,
    last_payslip: null,
  });
  const [punchInDateTime, setPunchInDateTime] = useState(null);
  const [newsFeed, setNewsFeed] = useState([]);
  const [newsFeedScrollPaused, setNewsFeedScrollPaused] = useState(false);
  const newsFeedListRef = useRef(null);
  const fetchDashboardData = async (showAlert = false) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE_URL}/employee/homepage`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        if (response.status === 401) {
        }
        throw new Error("Failed to fetch dashboard data.");
      }
      const result = await response.json();
      if (result.success) {
        const punch = result.punch || {};
        const workingHours = punch.working_hours
          ? formatWorkingHours(punch.working_hours)
          : punch.working_hours;
        setDynamicData({
          user: result.user || {},
          employee: result.employee || {},
          punch: {
            ...punch,
            working_hours: workingHours || punch.working_hours,
          },
          leave_balance: result.leave_balance || { pl: "N/A", cl: "N/A" },
          managers: result.managers || {},
          last_leave: result.last_leave || null,
          last_payslip: result.last_payslip || null,
        });
        if (result.punch.punch_in && !result.punch.punch_out) {
          setPunchInDateTime(parsePunchInToDate(result.punch.punch_in));
        } else {
          setPunchInDateTime(null);
        }
      } else if (showAlert) {
        alert(result.message || "Failed to load data.");
      }
    } catch (err) {
      // console.error("Fetch error:", err);
      if (showAlert) alert(err.message);
    } finally {
      setLoading(false);
    }
  };
  const fetchNewsFeed = async () => {
    const token = localStorage.getItem("token");
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

  /* News feed auto-scroll: smooth bidirectional (last → first → last → first) */
  const newsFeedDirRef = useRef("down");
  useEffect(() => {
    if (!newsFeed.length || newsFeedScrollPaused) return;
    const el = newsFeedListRef.current;
    if (!el || el.scrollHeight <= el.clientHeight) return;
    const step = 1;
    const interval = 32;
    const id = setInterval(() => {
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 2;
      const atTop = scrollTop <= 2;
      if (newsFeedDirRef.current === "down") {
        if (atBottom) {
          newsFeedDirRef.current = "up";
          el.scrollTop -= step;
        } else {
          el.scrollTop += step;
        }
      } else {
        if (atTop) {
          newsFeedDirRef.current = "down";
          el.scrollTop += step;
        } else {
          el.scrollTop -= step;
        }
      }
    }, interval);
    return () => clearInterval(id);
  }, [newsFeed.length, newsFeedScrollPaused]);
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
            const errorMessage =
              inRange || zone === "NO_OFFICE_CONFIG"
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
              error:
                "Location access denied or unavailable. Punch In/Out requires location.",
              isAvailable: false,
              isInRange: false,
            }));
          },
        );
      } else {
        setLocation((prev) => ({
          ...prev,
          error: "Geolocation not supported by this browser.",
          isAvailable: false,
          isInRange: false,
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
    if (punchInDateTime && !dynamicData.punch.punch_out) {
      timer = setInterval(() => {
        const now = new Date();
        const diffMs = now.getTime() - punchInDateTime.getTime();
        const formattedTime = formatTimeDifference(diffMs);
        setDynamicData((prev) => ({
          ...prev,
          punch: {
            ...prev.punch,
            working_hours: formattedTime,
          },
        }));
      }, 1000);
    } else {
      // Stop timer if punched out
      setDynamicData((prev) => ({
        ...prev,
        punch: {
          ...prev.punch,
          working_hours: prev.punch.working_hours || "0h 00m 00s",
        },
      }));
    }
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [punchInDateTime, dynamicData.punch.punch_out]);
  const handlePunchIn = async (reason = "") => {
    if (isPunching || !location.lat || !location.lon || !location.isAvailable) {
      alert(
        location.error ||
          "Cannot punch in without location. Please enable location services.",
      );
      return;
    }
    setIsPunching(true);
    const token = localStorage.getItem("token");
    try {
      const response = await fetch(`${API_BASE_URL}/employee/punch-in`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lat: location.lat,
          lon: location.lon,
          is_wfh: false, // Assuming office punch-in for now
          geo_reason: reason || null,
        }),
      });
      const result = await response.json();
      if (response.ok && result.success) {
        const newPunchInTime =
          parsePunchInToDate(result.punch_in) || new Date();
        setDynamicData((prev) => ({
          ...prev,
          punch: {
            ...prev.punch,
            punch_in: result.punch_in,
            punch_out: null,
            working_hours: "0h 00m 00s",
          },
        }));
        setPunchInDateTime(newPunchInTime);
        alert(`Punched In Successfully at ${formatTime(result.punch_in)}!`);
      } else {
        // If location is out of range, update state
        if (result.message && result.message.includes("Too far")) {
          setLocation((prev) => ({ ...prev, isInRange: false }));
        }
        alert(`Punch In Failed: ${result.message || "Server error."}`);
      }
    } catch (error) {
      console.error("Punch In error:", error);
      if (!navigator.onLine) {
        alert(
          "No internet connection. Please check your network and try again.",
        );
      } else {
        alert("We couldn't complete your request right now. Please try again.");
      }
    } finally {
      setIsPunching(false);
    }
  };
  const handlePunchOut = async (reason = "") => {
    if (isPunching || !location.lat || !location.lon || !location.isAvailable) {
      alert(
        location.error ||
          "Cannot punch out without location. Please enable location services.",
      );
      return;
    }
    setIsPunching(true);
    const token = localStorage.getItem("token");
    try {
      const response = await fetch(`${API_BASE_URL}/employee/punch-out`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lat: location.lat,
          lon: location.lon,
          geo_reason: reason || null,
        }),
      });
      const text = await response.text();
      let result;
      try {
        result = text ? JSON.parse(text) : {};
      } catch (_) {
        throw new Error(
          `Server error (${response.status}). Check backend logs.`,
        );
      }
      if (response.ok && result.success) {
        setPunchInDateTime(null);
        const workHours = formatWorkingHours(result.today_work);
        setDynamicData((prev) => ({
          ...prev,
          punch: {
            ...prev.punch,
            punch_out: result.punch_out,
            punch_in: prev.punch.punch_in,
            working_hours: workHours,
          },
        }));
        await fetchDashboardData();
        alert(
          `Punched Out Successfully! Total Today's Work: ${result.today_work || "N/A"}`,
        );
      } else {
        if (result.message && result.message.includes("Too far")) {
          setLocation((prev) => ({ ...prev, isInRange: false }));
        }
        alert(`Punch Out Failed: ${result.message || "Server error."}`);
      }
    } catch (error) {
      console.error("Punch Out error:", error);
      if (!navigator.onLine) {
        alert(
          "No internet connection. Please check your network and try again.",
        );
      } else {
        alert("We couldn't complete your request right now. Please try again.");
      }
    } finally {
      setIsPunching(false);
    }
  };
  const onPunchInClick = async () => {
    if (isPunching || !!dynamicData.punch.punch_in) return;
    await handlePunchIn("");
  };
  const onPunchOutClick = async () => {
    if (isPunching || !dynamicData.punch.punch_in) return;
    await handlePunchOut("");
  };
  const dojFormatted = useMemo(
    () => formatDate(dynamicData.user.doj),
    [dynamicData.user.doj],
  );
  const experience = useMemo(
    () => calculateExperience(dynamicData.user.doj),
    [dynamicData.user.doj],
  );
  const totalLeave = useMemo(() => {
    const pl = Number(dynamicData.leave_balance.pl);
    const cl = Number(dynamicData.leave_balance.cl);
    return isNaN(pl) || isNaN(cl) ? "N/A" : pl + cl;
  }, [dynamicData.leave_balance]);
  const punchInTimeDisplay = useMemo(
    () => formatTime(dynamicData.punch.punch_in),
    [dynamicData.punch.punch_in],
  );
  const todaysDate = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    [],
  );
  const currentStatus = useMemo(() => {
    if (dynamicData.punch.punch_in) {
      return dynamicData.punch.punch_out ? "Inactive" : "Active";
    }
    return "Inactive";
  }, [dynamicData.punch.punch_in, dynamicData.punch.punch_out]);
  const isCheckedIn =
    dynamicData.punch.punch_in && !dynamicData.punch.punch_out;
  const isCheckedOut = dynamicData.punch.punch_out;
  const isActive = isCheckedIn;
  const managerName =
    [
      dynamicData.managers?.l2?.name,
      dynamicData.managers?.l1?.name,
      dynamicData.managers?.l3?.name,
    ]
      .map((n) => (typeof n === "string" ? n.trim() : n))
      .find((n) => n) || "N/A";
  const managerDept = dynamicData.user?.circle || "N/A";
  const userCircle = (dynamicData.user?.circle || "").trim().toUpperCase();
  if (loading)
    return (
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
                  <h3 className="card-value">
                    {dynamicData.user.emp_id || "N/A"}
                  </h3>
                  <p className="card-subtext">
                    {dynamicData.employee?.emp_type ||
                      dynamicData.user?.emp_type ||
                      dynamicData.user?.department ||
                      "N/A"}
                  </p>
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
                    {dynamicData.leave_balance.pl} PL +{" "}
                    {dynamicData.leave_balance.cl} CL
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
                    {/* Location & Status Row */}
                    <div className="status-row-top">
                      <div className="location-badge">
                        <span className="location-label">Location</span>
                        <span
                          className={`location-pill ${location.isAvailable && location.isInRange ? "on" : "off"}`}
                        >
                          <span className="location-dot"></span>
                          {location.isAvailable && location.isInRange
                            ? "Within Range"
                            : "Off"}
                        </span>
                      </div>
                      <div
                        className={`status-badge-main ${isActive ? "active" : "inactive"}`}
                      >
                        <span
                          className={`status-pulse-dot ${isActive ? "active" : ""}`}
                        ></span>
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
                        <span className="stat-value">
                          {punchInTimeDisplay || "--:--:--"}
                        </span>
                      </div>
                      <div className="status-stat-card highlight">
                        <span className="stat-label">Hours Today</span>
                        <span className="stat-value stat-timer">
                          {formatWorkingHours(dynamicData.punch.working_hours)}
                        </span>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="status-action-buttons">
                      <button
                        className="btn-punch btn-punch-in"
                        onClick={onPunchInClick}
                        disabled={
                          !!dynamicData.punch.punch_in ||
                          isPunching ||
                          !location.isAvailable
                        }
                      >
                        <FiCheckCircle className="btn-icon" />
                        {isPunching && !isCheckedIn
                          ? "Punching In..."
                          : "Punch In"}
                      </button>
                      <button
                        className="btn-punch btn-punch-out"
                        onClick={onPunchOutClick}
                        disabled={
                          !dynamicData.punch.punch_in ||
                          isPunching ||
                          !location.isAvailable
                        }
                      >
                        {isPunching && dynamicData.punch.punch_in
                          ? "Punching Out..."
                          : "Punch Out"}
                      </button>
                    </div>
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
                        background:
                          "linear-gradient(to right, #4f46e5, #3b82f6, #10b981)",
                        WebkitBackgroundClip: "text",
                        backgroundClip: "text",
                        color: "transparent",
                        WebkitTextFillColor: "transparent",
                        display: "inline-block",
                      }}
                    >
                      News Feed
                    </span>
                  </h2>
                  <p className="subtext">
                    Announcements, birthdays & work anniversaries for your
                    circle
                  </p>
                  {newsFeed.length === 0 ? (
                    <p className="news-feed-empty">No announcements yet.</p>
                  ) : (
                    <ul className="news-feed-list" ref={newsFeedListRef}>
                      {newsFeed.map((item) => (
                        <li
                          key={item.id}
                          className={`news-feed-item ${(item.type || "post") === "birthday" ? "news-feed-birthday" : ""} ${(item.type || "post") === "anniversary" ? "news-feed-anniversary" : ""}`}
                        >
                          <h4 className="news-feed-title">
                            {(item.type || "") === "birthday" && "🎂 "}
                            {(item.type || "") === "anniversary" && "🎉 "}
                            {item.title}
                          </h4>
                          <p className="news-feed-content">{item.content}</p>
                          <div className="news-feed-meta">
                            <span className="news-feed-date">
                              {formatDate(item.created_at)}
                            </span>
                            {(item.file_url || item.file_path) && (
                              <a
                                href={
                                  item.file_url ||
                                  `/static/uploads/${item.file_path}`
                                }
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
                  )}
                </div>
              </div>
              <div className="quick-actions grid-span-4 actions-grid">
                <NavLink to="/leaves" className="action-card nav-link-card">
                  <div className="action-icon-group">
                    <div className="action-icon green">
                      <div className="action-icon-inner">
                        <FiSun />
                      </div>
                    </div>
                    <div>
                      <h4>Apply for Leave</h4>
                      <p>Submit a new leave request</p>
                    </div>
                  </div>
                  <FiChevronRight className="arrow" />
                </NavLink>
                <NavLink to="/payslip" className="action-card nav-link-card">
                  <div className="action-icon-group">
                    <div className="action-icon orange">
                      <div className="action-icon-inner">
                        <GiReceiveMoney />
                      </div>
                    </div>
                    <div>
                      <h4>View Payslips</h4>
                      <p>Download payslip statements</p>
                    </div>
                  </div>
                  <FiChevronRight className="arrow" />
                </NavLink>
                <NavLink to="/profile" className="action-card nav-link-card">
                  <div className="action-icon-group">
                    <div className="action-icon sky">
                      <div className="action-icon-inner">
                        <FiUser />
                      </div>
                    </div>
                    <div>
                      <h4>My Profile</h4>
                      <p>View and edit your details</p>
                    </div>
                  </div>
                  <FiChevronRight className="arrow" />
                </NavLink>
                <NavLink to="/wfh" className="action-card nav-link-card">
                  <div className="action-icon-group">
                    <div className="action-icon green">
                      <div className="action-icon-inner">
                        <FiHome />
                      </div>
                    </div>
                    <div>
                      <h4>WFH Request</h4>
                      <p>Request work from home</p>
                    </div>
                  </div>
                  <FiChevronRight className="arrow" />
                </NavLink>
                <NavLink to="/attendance" className="action-card nav-link-card">
                  <div className="action-icon-group">
                    <div className="action-icon sky">
                      <div className="action-icon-inner">
                        <FiClock />
                      </div>
                    </div>
                    <div>
                      <h4>My Attendance</h4>
                      <p>Check attendance records</p>
                    </div>
                  </div>
                  <FiChevronRight className="arrow" />
                </NavLink>
                <NavLink to="/queries" className="action-card nav-link-card">
                  <div className="action-icon-group">
                    <div className="action-icon blue">
                      <div className="action-icon-inner">
                        <FiHelpCircle />
                      </div>
                    </div>
                    <div>
                      <h4>Raise a Query</h4>
                      <p>Ask for HR/Admin support</p>
                    </div>
                  </div>
                  <FiChevronRight className="arrow" />
                </NavLink>
                <NavLink to="/claims" className="action-card nav-link-card">
                  <div className="action-icon-group">
                    <div className="action-icon orange">
                      <div className="action-icon-inner">
                        <FiDollarSign />
                      </div>
                    </div>
                    <div>
                      <h4>Claims</h4>
                      <p>Check claim records</p>
                    </div>
                  </div>
                  <FiChevronRight className="arrow" />
                </NavLink>
                <NavLink
                  to="/change-password"
                  className="action-card nav-link-card"
                >
                  <div className="action-icon-group">
                    <div className="action-icon blue">
                      <div className="action-icon-inner">
                        <FiKey />
                      </div>
                    </div>
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
                    if (userCircle !== "NHQ") {
                      e.preventDefault();
                      e.stopPropagation();
                      alert(
                        "Holiday Calendar is only available for NHQ users.",
                      );
                    }
                  }}
                >
                  <div className="action-icon-group">
                    <div className="action-icon sky">
                      <div className="action-icon-inner">
                        <FiCalendar />
                      </div>
                    </div>
                    <div>
                      <h4>Holiday Calendar</h4>
                      <p>View upcoming holidays</p>
                    </div>
                  </div>
                  <FiChevronRight className="arrow" />
                </NavLink>
                <NavLink to="/account" className="action-card nav-link-card">
                  <div className="action-icon-group">
                    <IoMdPerson className="action-icon sky" />
                    <div>
                      <h4>Accounts</h4>
                      <p>Accounts Details</p>
                    </div>
                  </div>
                  <FiChevronRight className="arrow" />
                </NavLink>
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
    </>
  );
};
