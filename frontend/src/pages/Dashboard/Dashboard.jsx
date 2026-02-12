import { useEffect, useState, useMemo } from "react";
import { NavLink } from 'react-router-dom';
import {  FiChevronRight,FiCheckCircle, FiUserCheck,FiCalendar,FiBriefcase as FiBriefcaseIcon, FiMessageSquare 
} from "react-icons/fi";
import { MdOutlineDateRange } from "react-icons/md";
import { GiReceiveMoney } from "react-icons/gi";
import { TbDeviceLaptop } from "react-icons/tb";
import { IoMdPerson } from "react-icons/io";
import "./Dashboard.css";
const API_BASE_URL = "http://localhost:5000/api/auth";

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
        const normalized = s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
        const d = new Date(normalized);
        return isNaN(d.getTime()) ? null : d;
    } catch {
        return null;
    }
};

const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const formatTime = (timeString) => {
    if (!timeString) return '---';
    try {
        const s = String(timeString).trim();
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
            const [h, m, sec = 0] = s.split(":").map(Number);
            const d = new Date();
            d.setHours(h, m, sec, 0);
            return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        }
        const normalized = s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s;
        const d = new Date(normalized);
        if (isNaN(d.getTime())) return 'Invalid Time';
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    } catch (e) {
        return 'Invalid Time';
    }
};

const formatWorkingHours = (val) => {
    if (!val) return '0h 00m 00s';
    const v = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return '0h 00m 00s';  // Reject datetime-like "0000-04-22 00:00:00"
    if (/^\d+h\s+\d+m\s+\d+s$/.test(v)) return v;
    const m = v.match(/^(\d+):(\d{2}):(\d{2})/);
    if (m) {
        const [, h, min, sec] = m;
        return `${parseInt(h, 10)}h ${min}m ${sec}s`;
    }
    return '0h 00m 00s';
};
const calculateExperience = (doj) => {
    if (!doj) return 'N/A';
    const today = new Date();
    const joinDate = new Date(doj);
    let years = today.getFullYear() - joinDate.getFullYear();
    const months = today.getMonth() - joinDate.getMonth();
    
    if (months < 0 || (months === 0 && today.getDate() < joinDate.getDate())) {
        years--;
    }
    return years >= 0 ? `${years} years` : 'Less than a year';
};
const formatTimeDifference = (diffMs) => {
    if (diffMs < 0) diffMs = 0;
    
    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours)}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
};
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
    const [dynamicData, setDynamicData] = useState({
        user: {},
        employee: {},
        punch: {},
        leave_balance: { pl: 'N/A', cl: 'N/A' },
        managers: {},
    });
    const [punchInDateTime, setPunchInDateTime] = useState(null); 
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
                    punch: { ...punch, working_hours: workingHours || punch.working_hours },
                    leave_balance: result.leave_balance || { pl: 'N/A', cl: 'N/A' },
                    managers: result.managers || {},
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
            console.error("Fetch error:", err);
            if (showAlert) alert(err.message);
        } finally {
            setLoading(false); 
        }
    };
    useEffect(() => {
        const loadInitialData = async () => {
            await fetchDashboardData();
        };
        loadInitialData();
    }, []);
    const validateLocationRange = async (lat, lon) => {
        const token = localStorage.getItem('token');
        if (!token) return false;
        try {
            const res = await fetch(`${API_BASE_URL}/employee/location-check?lat=${lat}&lon=${lon}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            return data.success && data.in_range;
        } catch {
            return false;
        }
    };

    useEffect(() => {
        const checkLocation = async () => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    async (position) => {
                        const lat = position.coords.latitude;
                        const lon = position.coords.longitude;
                        const inRange = await validateLocationRange(lat, lon);
                        setLocation({
                            lat,
                            lon,
                            error: inRange ? null : "You are outside office range. Punch In/Out requires you to be within office premises.",
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
        if (punchInDateTime && !dynamicData.punch.punch_out) {
            timer = setInterval(() => {
                const now = new Date();
                const diffMs = now.getTime() - punchInDateTime.getTime();
                const formattedTime = formatTimeDifference(diffMs);
                setDynamicData(prev => ({
                    ...prev,
                    punch: {
                        ...prev.punch,
                        working_hours: formattedTime,
                    }
                }));
            }, 1000); 
        } else {
            // Stop timer if punched out
            setDynamicData(prev => ({
                ...prev,
                punch: {
                    ...prev.punch,
                    working_hours: prev.punch.working_hours || '0h 00m 00s',
                }
            }));
        }
        return () => {
            if (timer) {
                clearInterval(timer);
            }
        };
    }, [punchInDateTime, dynamicData.punch.punch_out]); 
    const handlePunchIn = async () => {
        if (isPunching || !location.lat || !location.lon || !location.isAvailable) {
            alert(location.error || "Cannot punch in without location. Please enable location services.");
            return;
        } 
        setIsPunching(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE_URL}/employee/punch-in`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lat: location.lat,
                    lon: location.lon,
                    is_wfh: false // Assuming office punch-in for now
                })
            });
            const result = await response.json();
            if (response.ok && result.success) {
                const newPunchInTime = parsePunchInToDate(result.punch_in) || new Date();
                setDynamicData(prev => ({
                    ...prev,
                    punch: {
                        ...prev.punch,
                        punch_in: result.punch_in, 
                        punch_out: null, 
                        working_hours: "0h 00m 00s", 
                    }
                }));
                setPunchInDateTime(newPunchInTime);
                alert(`Punched In Successfully at ${formatTime(result.punch_in)}!`);
            } else {
                // If location is out of range, update state
                if (result.message && result.message.includes("Too far")) {
                    setLocation(prev => ({ ...prev, isInRange: false }));
                }
                alert(`Punch In Failed: ${result.message || 'Server error.'}`);
            }
        } catch (error) {
            console.error("Punch In error:", error);
            alert("Network error during Punch In.");
        } finally {
            setIsPunching(false);
        }
    };
    const handlePunchOut = async () => {
        if (isPunching || !location.lat || !location.lon || !location.isAvailable) {
            alert(location.error || "Cannot punch out without location. Please enable location services.");
            return;
        } 
        setIsPunching(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE_URL}/employee/punch-out`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    lat: location.lat,
                    lon: location.lon
                })
            });
            const text = await response.text();
            let result;
            try {
                result = text ? JSON.parse(text) : {};
            } catch (_) {
                throw new Error(`Server error (${response.status}). Check backend logs.`);
            }
            if (response.ok && result.success) {
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
                alert(`Punched Out Successfully! Total Today's Work: ${result.today_work || 'N/A'}`);
            } else {
                if (result.message && result.message.includes("Too far")) {
                    setLocation(prev => ({ ...prev, isInRange: false }));
                }
                alert(`Punch Out Failed: ${result.message || 'Server error.'}`);
            }
        } catch (error) {
            console.error("Punch Out error:", error);
            const msg = error.message || "Network error during Punch Out.";
            alert(msg.includes("Failed to fetch") || msg.includes("NetworkError") ? "Network error: Check if backend is running and CORS is configured." : `Punch Out Failed: ${msg}`);
        } finally {
            setIsPunching(false);
        }
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
        if (dynamicData.punch.punch_in) {
            return dynamicData.punch.punch_out ? "Inactive" : "Active";
        }
        return "Inactive";
    }, [dynamicData.punch.punch_in, dynamicData.punch.punch_out]);
    const isCheckedIn = dynamicData.punch.punch_in && !dynamicData.punch.punch_out;
    const isCheckedOut = dynamicData.punch.punch_out;
    const isActive = isCheckedIn;
    const managerName = dynamicData.managers?.l1?.name || "N/A"; 
    const managerDept = dynamicData.user?.circle || "N/A"; 
    if (loading) return (
        <div className="full-height-center">
            <h2 className="loader"></h2>
        </div>
    );
    return (
        <div className="main-layout">
            <div className="content-area">
                <div className="dashboard-content">
                    <div className="top-cards-grid">
                        <div className="card top-card simple-card">
                            <div className="card-content-wrapper">
                                <h4 className="card-label">Employee ID</h4>
                                <h3 className="card-value">{dynamicData.user.emp_id || 'N/A'}</h3> 
                                <p className="card-subtext">{dynamicData.employee?.emp_type || dynamicData.user?.emp_type || dynamicData.user?.department || 'N/A'}</p> 
                            </div>
                            <div className="card-icon-round blue-bg">
                                <FiBriefcaseIcon className="icon-white" />
                            </div>
                        </div>
                        <div className="card top-card simple-card">
                            <div className="card-content-wrapper">
                                <h4 className="card-label">Date of Joining</h4>
                                <h3 className="card-value">{dojFormatted}</h3> 
                                <p className="card-subtext">{experience}</p> 
                            </div>
                            <div className="card-icon-round green-bg">
                                <MdOutlineDateRange className="icon-white" />
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
                                <FiCalendar className="icon-white" />
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
                                <FiUserCheck className="icon-white" />
                            </button>
                        </div>
                    </div>
                    <div className="main-grid">
                        <div className="attendance-section grid-span-4">
                            <div className="attendance-header">
                                <h2 className="section-title">Today's Status</h2>
                                <span className="attendance-date">{todaysDate}</span>
                            </div>
                            <div className="attendance-body">
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
                                    </div>
                                </div>
                                
                                {/* Action Buttons */}
                                <div className="status-action-buttons">
                                    <button 
                                        className="btn-punch btn-punch-in" 
                                        onClick={handlePunchIn}
                                        disabled={!!dynamicData.punch.punch_in || isPunching || !location.isAvailable || !location.isInRange}
                                    >
                                        <FiCheckCircle className="btn-icon" />
                                        {isPunching && !isCheckedIn ? 'Punching In...' : 'Punch In'}
                                    </button>
                                    <button 
                                        className="btn-punch btn-punch-out"
                                        onClick={handlePunchOut}
                                        disabled={!isCheckedIn || isPunching || !location.isAvailable || !location.isInRange}
                                    >
                                        {isPunching && isCheckedIn ? 'Punching Out...' : 'Punch Out'}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="quick-actions grid-span-4 actions-grid" >
                            <NavLink to="/leaves" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <TbDeviceLaptop className="action-icon green" />
                                    <div>
                                        <h4>Apply for Leave</h4>
                                        <p>Submit a new leave request</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            <NavLink to="/salary" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <GiReceiveMoney className="action-icon orange" />
                                    <div>
                                        <h4>View Payslips</h4>
                                        <p>Download salary statements</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            <NavLink to="/wfh" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <TbDeviceLaptop className="action-icon green" />
                                    <div>
                                        <h4>WFH Request</h4>
                                        <p>Request work from home</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            <NavLink to="/attendance" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <IoMdPerson className="action-icon sky" />
                                    <div>
                                        <h4>My Attendance</h4>
                                        <p>Check attendance records</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                            <NavLink to="/queries" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <FiMessageSquare className="action-icon blue" /> 
                                    <div>
                                        <h4>Raise a Query</h4>
                                        <p>Ask for HR/Admin support</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
                             <NavLink to="/claims" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <IoMdPerson className="action-icon sky" />
                                    <div>
                                        <h4>Claims</h4>
                                        <p>Check claim records</p>
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
                        <div className="progress-section grid-span-2">
                            <h2 className="section-title">Monthly Progress</h2>
                            <p className="subtext">Your attendance this month</p>
                            <div className="progress-item">
                                <div className="progress-label">
                                    <span>Days Worked</span>
                                    <span>18/22</span> 
                                </div>
                                <div className="progress-bar">
                                    <div className="progress-fill" style={{ width: "82%" }}></div> 
                                </div>
                            </div>
                            <div className="progress-item">
                                <div className="progress-label">
                                    <span>Hours Logged</span>
                                    <span>144/176</span> 
                                </div>
                                <div className="progress-bar">
                                    <div className="progress-fill" style={{ width: "78%" }}></div> 
                                </div>
                            </div>
                        </div>


                        {/* 4.4. Recent Activity - (Static Data Placeholder) */}
                        <div className="recent-box grid-span-2">
                            <h2 className="section-title">Recent Activity</h2>
                            <ul className="activity-list">
                                <li>
                                    <div className="left"><span className="dot green"></span> Leave approved</div>
                                    <span className="time">2 hours ago</span>
                                </li>
                                <li>
                                    <div className="left"><span className="dot red"></span> Punch-out at 6:02 PM</div>
                                    <span className="time">Yesterday</span>
                                </li>
                                <li>
                                    <div className="left"><span className="dot blue"></span> New policy added</div>
                                    <span className="time">3 days ago</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};






// import { useEffect, useState, useMemo } from "react";
// import { NavLink } from 'react-router-dom';
// import { 
//     FiChevronRight, FiCheckCircle, FiUserCheck, FiCalendar, 
//     FiBriefcase as FiBriefcaseIcon, FiMessageSquare 
// } from "react-icons/fi";
// import { MdOutlineDateRange } from "react-icons/md";
// import { GiReceiveMoney } from "react-icons/gi";
// import { TbDeviceLaptop } from "react-icons/tb";
// import { IoMdPerson } from "react-icons/io";
// import "./Dashboard.css";

// const API_BASE_URL = "http://localhost:5000/api/auth";

// // Helper Functions
// const formatDate = (dateString) => {
//     if (!dateString) return 'N/A';
//     const date = new Date(dateString);
//     return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
// };

// const formatTime = (isoString) => {
//     if (!isoString) return '---';
//     try {
//         const date = new Date(isoString);
//         return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
//     } catch (e) { return 'Invalid Time'; }
// };

// const calculateExperience = (doj) => {
//     if (!doj) return 'N/A';
//     const today = new Date();
//     const joinDate = new Date(doj);
//     let years = today.getFullYear() - joinDate.getFullYear();
//     if (today.getMonth() < joinDate.getMonth() || (today.getMonth() === joinDate.getMonth() && today.getDate() < joinDate.getDate())) {
//         years--;
//     }
//     return years >= 0 ? `${years} years` : 'Less than a year';
// };

// const formatTimeDifference = (diffMs) => {
//     if (diffMs < 0) diffMs = 0;
//     const totalSeconds = Math.floor(diffMs / 1000);
//     const hours = Math.floor(totalSeconds / 3600);
//     const minutes = Math.floor((totalSeconds % 3600) / 60);
//     const seconds = totalSeconds % 60;
//     return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
// };

// export const Dashboard = () => {
//     const [loading, setLoading] = useState(true);
//     const [isPunching, setIsPunching] = useState(false);
//     const [location, setLocation] = useState({ lat: null, lon: null, error: null });
//     const [dynamicData, setDynamicData] = useState({
//         user: {}, employee: {}, punch: {}, leave_balance: { pl: 'N/A', cl: 'N/A' }, manager: {},
//     });
//     const [punchInDateTime, setPunchInDateTime] = useState(null);

//     const fetchDashboardData = async () => {
//         const token = localStorage.getItem('token');
//         if (!token) return;
//         try {
//             const response = await fetch(`${API_BASE_URL}/employee/homepage`, {
//                 method: 'GET', headers: { 'Authorization': `Bearer ${token}` }
//             });
//             const result = await response.json();
//             if (result.success) {
//                 setDynamicData({
//                     user: result.user || {},
//                     employee: result.employee || {},
//                     punch: result.punch || {},
//                     leave_balance: result.leave_balance || { pl: 0, cl: 0 },
//                     manager: result.manager || {},
//                 });
//                 if (result.punch.punch_in && !result.punch.punch_out) {
//                     setPunchInDateTime(new Date(result.punch.punch_in));
//                 }
//             }
//         } catch (err) { console.error("Fetch error:", err); }
//         finally { setLoading(false); }
//     };

//     useEffect(() => { fetchDashboardData(); }, []);

//     // Geolocation Effect
//     useEffect(() => {
//         if (navigator.geolocation) {
//             navigator.geolocation.getCurrentPosition(
//                 (pos) => setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude, error: null }),
//                 (err) => setLocation(p => ({ ...p, error: "Location required for Punch In." }))
//             );
//         }
//     }, []);

//     // Timer Effect
//     useEffect(() => {
//         let timer;
//         if (punchInDateTime) {
//             timer = setInterval(() => {
//                 const diffMs = new Date().getTime() - punchInDateTime.getTime();
//                 setDynamicData(prev => ({ ...prev, punch: { ...prev.punch, working_hours: formatTimeDifference(diffMs) } }));
//             }, 1000);
//         }
//         return () => clearInterval(timer);
//     }, [punchInDateTime]);

//     // Punch Handlers
//     const handlePunchIn = async () => {
//         if (!location.lat) return alert(location.error);
//         setIsPunching(true);
//         try {
//             const response = await fetch(`${API_BASE_URL}/employee/punch-in`, {
//                 method: 'POST',
//                 headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
//                 body: JSON.stringify({ lat: location.lat, lon: location.lon, is_wfh: false })
//             });
//             const result = await response.json();
//             if (result.success) {
//                 setPunchInDateTime(new Date(result.punch_in));
//                 fetchDashboardData();
//             }
//         } catch (e) { alert("Network error"); }
//         finally { setIsPunching(false); }
//     };

//     const handlePunchOut = async () => {
//         setIsPunching(true);
//         try {
//             const response = await fetch(`${API_BASE_URL}/employee/punch-out`, {
//                 method: 'POST',
//                 headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
//             });
//             const result = await response.json();
//             if (result.success) {
//                 setPunchInDateTime(null);
//                 fetchDashboardData();
//             }
//         } catch (e) { alert("Network error"); }
//         finally { setIsPunching(false); }
//     };

//     // Memos
//     const totalLeave = useMemo(() => Number(dynamicData.leave_balance.pl || 0) + Number(dynamicData.leave_balance.cl || 0), [dynamicData.leave_balance]);
//     const todaysDate = useMemo(() => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }), []);

//     if (loading) return <div className="full-height-center"><div className="loader"></div></div>;

//     return (
//         <div className="dashboard-container">
//             {/* Top Cards */}
//             <div className="top-cards-grid">
//                 <div className="card simple-card">
//                     <div className="card-content">
//                         <p className="card-label">Employee ID</p>
//                         <h3 className="card-value">{dynamicData.user.emp_id || 'N/A'}</h3>
//                         <p className="card-subtext">{dynamicData.employee.designation || 'Staff'}</p>
//                     </div>
//                     <div className="card-icon-round blue-bg"><FiBriefcaseIcon /></div>
//                 </div>

//                 <div className="card simple-card">
//                     <div className="card-content">
//                         <p className="card-label">Joined Date</p>
//                         <h3 className="card-value">{formatDate(dynamicData.user.doj)}</h3>
//                         <p className="card-subtext">{calculateExperience(dynamicData.user.doj)}</p>
//                     </div>
//                     <div className="card-icon-round green-bg"><MdOutlineDateRange /></div>
//                 </div>

//                 <div className="card simple-card">
//                     <div className="card-content">
//                         <p className="card-label">Leave Balance</p>
//                         <h3 className="card-value">{totalLeave} Days</h3>
//                         <p className="card-subtext">{dynamicData.leave_balance.pl} PL | {dynamicData.leave_balance.cl} CL</p>
//                     </div>
//                     <div className="card-icon-round sky-bg"><FiCalendar /></div>
//                 </div>

//                 <div className="card manager-card">
//                     <div className="manager-info">
//                         <p className="card-label">Reporting Manager</p>
//                         <h3 className="manager-name">{dynamicData.manager?.l1 || 'N/A'}</h3>
//                         <p className="manager-dept">{dynamicData.user?.circle || 'Management'}</p>
//                     </div>
//                     <button className="action-circle-btn orange-bg"><FiUserCheck /></button>
//                 </div>
//             </div>

//             {/* Attendance Section */}
//             <div className="attendance-section card">
//                 <div className="attendance-header">
//                     <h2 className="section-title">Today's Status</h2>
//                     <span className="attendance-date">{todaysDate}</span>
//                 </div>
//                 <div className="attendance-body">
//                     <div className="status-item">
//                         <p className="label">Check In Time</p>
//                         <p className="time-value underline">{formatTime(dynamicData.punch.punch_in)}</p>
//                     </div>
//                     <div className="status-item center-status">
//                         <p className="label">Current Status</p>
//                         <p className={`status-pill ${punchInDateTime && !dynamicData.punch.punch_out ? 'active' : 'inactive'}`}>
//                             {punchInDateTime && !dynamicData.punch.punch_out ? "Checked In" : "Checked Out"}
//                         </p>
//                     </div>
//                     <div className="status-item">
//                         <p className="label">Hours Today</p>
//                         <p className="time-value">{dynamicData.punch.working_hours || '0h 00m 00s'}</p>
//                     </div>
//                     <div className="action-buttons">
//                         <button className="btn-punch-in" onClick={handlePunchIn} disabled={!!punchInDateTime || isPunching}>
//                             <FiCheckCircle /> Punch In
//                         </button>
//                         <button className="btn-punch-out" onClick={handlePunchOut} disabled={!punchInDateTime || isPunching}>
//                             Punch Out
//                         </button>
//                     </div>
//                 </div>
//             </div>

//             {/* Side-by-Side Bottom Section */}
//             <div className="bottom-grid-container">
//                 <div className="quick-actions-box card">
//                     <h2 className="section-title">Quick Actions</h2>
//                     <div className="actions-subgrid">
//                         <NavLink to="/leaves" className="nav-action-card">
//                             <div className="nav-content"><TbDeviceLaptop className="icon green" /> <div><h4>Leave</h4><p>Apply Now</p></div></div>
//                             <FiChevronRight />
//                         </NavLink>
//                         <NavLink to="/salary" className="nav-action-card">
//                             <div className="nav-content"><GiReceiveMoney className="icon orange" /> <div><h4>Payslips</h4><p>View Details</p></div></div>
//                             <FiChevronRight />
//                         </NavLink>
//                         <NavLink to="/attendance" className="nav-action-card">
//                             <div className="nav-content"><IoMdPerson className="icon sky" /> <div><h4>Attendance</h4><p>History</p></div></div>
//                             <FiChevronRight />
//                         </NavLink>
//                         <NavLink to="/queries" className="nav-action-card">
//                             <div className="nav-content"><FiMessageSquare className="icon blue" /> <div><h4>Queries</h4><p>Support</p></div></div>
//                             <FiChevronRight />
//                         </NavLink>
//                          <NavLink to="/wfh" className="nav-action-card"> 
//                                 <div className="nav-content">
//                                      <FiMessageSquare className="icon blue" />
//                                      <div>
//                                          <h4>WFH Request</h4>
//                                          <p>Request work from home</p>
//                                      </div>
//                                  </div>
//                                  <FiChevronRight />
//                              </NavLink>
//                               <NavLink to="/claims" className="nav-action-card">                                  <div className="nav-content">
//                                      <FiMessageSquare className="icon blue"  />
//                                      <div>
//                                          <h4>Claims</h4>
//                                          <p>Check claim records</p>                                     </div>
//                                  </div>
//                                  <FiChevronRight/>
//                             </NavLink>
//                     </div>
//                 </div>

//                 <div className="recent-activity-box card">
//                     <h2 className="section-title">Recent Activity</h2>
//                     <ul className="activity-timeline">
//                         <li><span className="dot green"></span> <p>Leave approved by HR</p> <small>2h ago</small></li>
//                         <li><span className="dot red"></span> <p>Punched out (Yesterday)</p> <small>6:02 PM</small></li>
//                         <li><span className="dot blue"></span> <p>New policy update</p> <small>3 days ago</small></li>
//                     </ul>
//                 </div>
//             </div>
//         </div>
//     );
// };













// import { useEffect, useState, useMemo } from "react";
// import { NavLink } from 'react-router-dom';
// import { 
//     FiChevronRight, FiCheckCircle, FiLogOut, FiUser, 
//     FiBriefcase, FiCalendar, FiMessageSquare, FiClock 
// } from "react-icons/fi";
// import { MdOutlineDateRange, MdPayments } from "react-icons/md";
// import { IoMdPerson } from "react-icons/io";
// import "./Dashboard.css";

// const API_BASE_URL = "http://localhost:5000/api/auth";

// const formatDate = (dateString) => {
//     if (!dateString) return 'N/A';
//     const date = new Date(dateString);
//     return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
// };

// const formatTimeDifference = (diffMs) => {
//     if (diffMs < 0) diffMs = 0;
//     const totalSeconds = Math.floor(diffMs / 1000);
//     const hours = Math.floor(totalSeconds / 3600);
//     const minutes = Math.floor((totalSeconds % 3600) / 60);
//     const seconds = totalSeconds % 60;
//     return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
// };

// export const Dashboard = () => {  
//     const [loading, setLoading] = useState(true);
//     const [isPunching, setIsPunching] = useState(false);
//     const [punchInDateTime, setPunchInDateTime] = useState(null);
//     const [dynamicData, setDynamicData] = useState({
//         user: {}, employee: {}, punch: {}, leave_balance: { pl: 0, cl: 0 }, manager: {},
//     });

//     const fetchDashboardData = async () => {
//         const token = localStorage.getItem('token');
//         try {
//             const response = await fetch(`${API_BASE_URL}/employee/homepage`, {
//                 headers: { 'Authorization': `Bearer ${token}` }
//             });
//             const result = await response.json();
//             if (result.success) { 
//                 setDynamicData({
//                     user: result.user || {},
//                     employee: result.employee || {},
//                     punch: result.punch || {},
//                     leave_balance: result.leave_balance || { pl: 0, cl: 0 },
//                     manager: result.manager || {},
//                 }); 
//                 if (result.punch.punch_in && !result.punch.punch_out) {
//                     setPunchInDateTime(new Date(result.punch.punch_in));
//                 }
//             }
//         } catch (err) { console.error(err); } 
//         finally { setLoading(false); }
//     };

//     useEffect(() => { fetchDashboardData(); }, []);

//     useEffect(() => {
//         let timer; 
//         if (punchInDateTime) {
//             timer = setInterval(() => {
//                 const diffMs = new Date().getTime() - punchInDateTime.getTime();
//                 setDynamicData(prev => ({ ...prev, punch: { ...prev.punch, working_hours: formatTimeDifference(diffMs) } }));
//             }, 1000); 
//         }
//         return () => clearInterval(timer);
//     }, [punchInDateTime]);

//     const isCheckedIn = !!dynamicData.punch.punch_in && !dynamicData.punch.punch_out;

//     if (loading) return <div className="loader-container"><div className="spinner"></div></div>;

//     return (
//         <div className="dashboard-container">
//             {/* Top Stats Row */}
//             <div className="stats-grid">
//                 <div className="stat-card">
//                     <div className="stat-info">
//                         <span className="stat-label">Employee ID</span>
//                         <h3 className="stat-value">{dynamicData.user.emp_id || '---'}</h3>
//                         <span className="stat-sub">{dynamicData.employee.designation || 'Staff'}</span>
//                     </div>
//                     <div className="stat-icon-box blue"><FiBriefcase /></div>
//                 </div>

//                 <div className="stat-card">
//                     <div className="stat-info">
//                         <span className="stat-label">Date of Joining</span>
//                         <h3 className="stat-value">{formatDate(dynamicData.user.doj)}</h3>
//                         <span className="stat-sub">New Member</span>
//                     </div>
//                     <div className="stat-icon-box green"><MdOutlineDateRange /></div>
//                 </div>

//                 <div className="stat-card">
//                     <div className="stat-info">
//                         <span className="stat-label">Leave Balance</span>
//                         <h3 className="stat-value">{Number(dynamicData.leave_balance.pl) + Number(dynamicData.leave_balance.cl)} Days</h3>
//                         <span className="stat-sub">{dynamicData.leave_balance.pl} PL | {dynamicData.leave_balance.cl} CL</span>
//                     </div>
//                     <div className="stat-icon-box sky"><FiCalendar /></div>
//                 </div>

//                 <div className="stat-card manager-card">
//                     <div className="stat-info">
//                         <span className="stat-label">Reporting Manager</span>
//                         <h3 className="stat-value manager-name">{dynamicData.manager?.l1 || "N/A"}</h3>
//                         <span className="stat-sub">{dynamicData.user?.circle || "Head Office"}</span>
//                     </div>
//                     <div className="stat-icon-box orange"><FiUser /></div>
//                 </div>
//             </div>

//             {/* Attendance Section */}
//             <div className="attendance-card">
//                 <div className="card-header">
//                     <h2>Today's Status</h2>
//                     <span className="date-badge">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
//                 </div>
//                 <div className="attendance-content">
//                     <div className="info-group">
//                         <label><FiClock /> Check In</label>
//                         <p>{dynamicData.punch.punch_in ? new Date(dynamicData.punch.punch_in).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}</p>
//                     </div>
//                     <div className="info-group">
//                         <label>Status</label>
//                         <span className={`status-pill ${isCheckedIn ? 'in' : 'out'}`}>
//                             {isCheckedIn ? "Checked In" : "Not Checked In"}
//                         </span>
//                     </div>
//                     <div className="info-group">
//                         <label>Working Hours</label>
//                         <p className="timer-text">{dynamicData.punch.working_hours || '0h 00m 00s'}</p>
//                     </div>
//                     <div className="button-group">
//                         <button className="btn-punch in" disabled={isCheckedIn || isPunching}>
//                             <FiCheckCircle /> Punch In
//                         </button>
//                         <button className="btn-punch out" disabled={!isCheckedIn || isPunching}>
//                             <FiLogOut /> Punch Out
//                         </button>
//                     </div>
//                 </div>
//             </div>

//             {/* Bottom Section */}
//             <div className="bottom-row">
//                 <div className="quick-actions-box">
//                     <h2 className="section-title">Quick Actions</h2>
//                     <div className="actions-grid">
//                         <NavLink to="/leaves" className="action-item">
//                             <div className="action-icon purple"><FiCalendar /></div>
//                             <div className="action-text">
//                                 <strong>Apply Leave</strong>
//                                 <p>Plan your time off</p>
//                             </div>
//                             <FiChevronRight className="chevron" />
//                         </NavLink>
//                         <NavLink to="/salary" className="action-item">
//                             <div className="action-icon gold"><MdPayments /></div>
//                             <div className="action-text">
//                                 <strong>Payslips</strong>
//                                 <p>View & Download</p>
//                             </div>
//                             <FiChevronRight className="chevron" />
//                         </NavLink>
//                         <NavLink to="/attendance" className="action-item">
//                             <div className="action-icon teal"><IoMdPerson /></div>
//                             <div className="action-text">
//                                 <strong>Attendance</strong>
//                                 <p>History & Logs</p>
//                             </div>
//                             <FiChevronRight className="chevron" />
//                         </NavLink>
//                         <NavLink to="/queries" className="action-item">
//                             <div className="action-icon rose"><FiMessageSquare /></div>
//                             <div className="action-text">
//                                 <strong>Help Desk</strong>
//                                 <p>Raise a Query</p>
//                             </div>
//                             <FiChevronRight className="chevron" />
//                         </NavLink>
//                     </div>
//                 </div>

//                 <div className="activity-box">
//                     <h2 className="section-title">Recent Activity</h2>
//                     <div className="activity-list">
//                         <div className="activity-item">
//                             <span className="activity-dot green"></span>
//                             <div className="activity-info">
//                                 <p>Leave Request Approved</p>
//                                 <small>2 hours ago</small>
//                             </div>
//                         </div>
//                         <div className="activity-item">
//                             <span className="activity-dot blue"></span>
//                             <div className="activity-info">
//                                 <p>Punch In successful</p>
//                                 <small>09:15 AM</small>
//                             </div>
//                         </div>
//                     </div>
//                 </div>
//             </div>
//         </div>
//     );
// };











///////working welllllllllll
// import { useEffect, useState, useMemo } from "react";
// import { NavLink } from 'react-router-dom';
// import { 
//     FiChevronRight, FiCheckCircle, FiLogOut, FiUser, 
//     FiBriefcase, FiCalendar, FiMessageSquare, FiClock 
// } from "react-icons/fi";
// import { MdOutlineDateRange, MdPayments } from "react-icons/md";
// import { IoMdPerson } from "react-icons/io";
// import "./Dashboard.css";

// const API_BASE_URL = "http://localhost:5000/api/auth";

// const formatDate = (dateString) => {
//     if (!dateString) return 'N/A';
//     const date = new Date(dateString);
//     return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
// };

// const formatTimeDifference = (diffMs) => {
//     if (diffMs < 0) diffMs = 0;
//     const totalSeconds = Math.floor(diffMs / 1000);
//     const hours = Math.floor(totalSeconds / 3600);
//     const minutes = Math.floor((totalSeconds % 3600) / 60);
//     const seconds = totalSeconds % 60;
//     return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
// };

// export const Dashboard = () => {  
//     const [loading, setLoading] = useState(true);
//     const [isPunching, setIsPunching] = useState(false);
//     const [punchInDateTime, setPunchInDateTime] = useState(null);
//     const [dynamicData, setDynamicData] = useState({
//         user: {}, employee: {}, punch: {}, leave_balance: { pl: 0, cl: 0 }, manager: {},
//     });

//     const fetchDashboardData = async () => {
//         const token = localStorage.getItem('token');
//         try {
//             const response = await fetch(`${API_BASE_URL}/employee/homepage`, {
//                 headers: { 'Authorization': `Bearer ${token}` }
//             });
//             const result = await response.json();
//             if (result.success) { 
//                 setDynamicData({
//                     user: result.user || {},
//                     employee: result.employee || {},
//                     punch: result.punch || {},
//                     leave_balance: result.leave_balance || { pl: 0, cl: 0 },
//                     manager: result.manager || {},
//                 }); 
//                 if (result.punch.punch_in && !result.punch.punch_out) {
//                     setPunchInDateTime(new Date(result.punch.punch_in));
//                 }
//             }
//         } catch (err) { console.error(err); } 
//         finally { setLoading(false); }
//     };

//     useEffect(() => { fetchDashboardData(); }, []);

//     useEffect(() => {
//         let timer; 
//         if (punchInDateTime) {
//             timer = setInterval(() => {
//                 const diffMs = new Date().getTime() - punchInDateTime.getTime();
//                 setDynamicData(prev => ({ ...prev, punch: { ...prev.punch, working_hours: formatTimeDifference(diffMs) } }));
//             }, 1000); 
//         }
//         return () => clearInterval(timer);
//     }, [punchInDateTime]);

//     const isCheckedIn = !!dynamicData.punch.punch_in && !dynamicData.punch.punch_out;

//     if (loading) return <div className="loader-container"><div className="spinner"></div></div>;

//     return (
//         <div className="dashboard-container">
//             {/* The 4 Top Cards (Original Design) */}
//             <div className="stats-grid">
//                 <div className="stat-card">
//                     <div className="stat-content">
//                         <p className="stat-label">Employee ID</p>
//                         <h3 className="stat-value">{dynamicData.user.emp_id || '---'}</h3>
//                         <p className="stat-subtext">{dynamicData.employee.designation || 'N/A'}</p>
//                     </div>
//                     <div className="stat-icon-circle blue-bg"><FiBriefcase /></div>
//                 </div>

//                 <div className="stat-card">
//                     <div className="stat-content">
//                         <p className="stat-label">Date of Joining</p>
//                         <h3 className="stat-value">{formatDate(dynamicData.user.doj)}</h3>
//                         <p className="stat-subtext">0 years</p>
//                     </div>
//                     <div className="stat-icon-circle green-bg"><MdOutlineDateRange /></div>
//                 </div>

//                 <div className="stat-card">
//                     <div className="stat-content">
//                         <p className="stat-label">Leave Balance</p>
//                         <h3 className="stat-value">{Number(dynamicData.leave_balance.pl) + Number(dynamicData.leave_balance.cl)} Days</h3>
//                         <p className="stat-subtext">{dynamicData.leave_balance.pl} PL + {dynamicData.leave_balance.cl} CL</p>
//                     </div>
//                     <div className="stat-icon-circle sky-bg"><FiCalendar /></div>
//                 </div>

//                 <div className="stat-card">
//                     <div className="stat-content">
//                         <p className="stat-label">Reporting Manager</p>
//                         <h3 className="stat-value">{dynamicData.manager?.l1 || "N/A"}</h3>
//                         <p className="stat-subtext">{dynamicData.user?.circle || "NHQ"}</p>
//                     </div>
//                     <div className="stat-icon-circle orange-bg"><FiUser /></div>
//                 </div>
//             </div>

//             {/* Attendance Section (Polished) */}
//             <div className="attendance-section">
//                 <div className="attendance-header">
//                     <h2 className="section-title">Today's Status</h2>
//                     <span className="current-date">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
//                 </div>
//                 <div className="attendance-row">
//                     <div className="att-info">
//                         <span className="att-label">Check In Time</span>
//                         <span className="att-data">{dynamicData.punch.punch_in ? new Date(dynamicData.punch.punch_in).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '---'}</span>
//                     </div>
//                     <div className="att-info">
//                         <span className="att-label">Current Status</span>
//                         <span className={`status-tag ${isCheckedIn ? 'active' : 'inactive'}`}>
//                             {isCheckedIn ? "Checked In" : "Not Checked In"}
//                         </span>
//                     </div>
//                     <div className="att-info">
//                         <span className="att-label">Hours Today</span>
//                         <span className="att-data timer">{dynamicData.punch.working_hours || '0h 00m 00s'}</span>
//                     </div>
//                     <div className="att-actions">
//                         <button className="punch-btn in" disabled={isCheckedIn || isPunching}>
//                            <FiCheckCircle /> Punch In
//                         </button>
//                         <button className="punch-btn out" disabled={!isCheckedIn || isPunching}>
//                            <FiLogOut /> Punch Out
//                         </button>
//                     </div>
//                 </div>
//             </div>

//             {/* Bottom Row */}
//             <div className="bottom-layout">
//                 <div className="quick-actions-card">
//                     <h2 className="section-title">Quick Actions</h2>
//                     <div className="actions-container">
//                         <NavLink to="/leaves" className="action-tile">
//                             <div className="tile-icon purple"><FiCalendar /></div>
//                             <div className="tile-text">
//                                 <strong>Apply Leave</strong>
//                                 <small>Submit request</small>
//                             </div>
//                             <FiChevronRight className="tile-arrow" />
//                         </NavLink>
//                         <NavLink to="/salary" className="action-tile">
//                             <div className="tile-icon gold"><MdPayments /></div>
//                             <div className="tile-text">
//                                 <strong>Payslips</strong>
//                                 <small>Download</small>
//                             </div>
//                             <FiChevronRight className="tile-arrow" />
//                         </NavLink>
//                         <NavLink to="/attendance" className="action-tile">
//                             <div className="tile-icon teal"><IoMdPerson /></div>
//                             <div className="tile-text">
//                                 <strong>Attendance</strong>
//                                 <small>View records</small>
//                             </div>
//                             <FiChevronRight className="tile-arrow" />
//                         </NavLink>
//                         <NavLink to="/queries" className="action-tile">
//                             <div className="tile-icon rose"><FiMessageSquare /></div>
//                             <div className="tile-text">
//                                 <strong>Queries</strong>
//                                 <small>HR Support</small>
//                             </div>
//                             <FiChevronRight className="tile-arrow" />
//                         </NavLink>
//                     </div>
//                 </div>

//                 <div className="activity-card">
//                     <h2 className="section-title">Recent Activity</h2>
//                     <div className="activity-feed">
//                         <div className="feed-item">
//                             <div className="feed-dot green"></div>
//                             <div className="feed-content">
//                                 <p>Leave approved</p>
//                                 <small>2h ago</small>
//                             </div>
//                         </div>
//                         <div className="feed-item">
//                             <div className="feed-dot blue"></div>
//                             <div className="feed-content">
//                                 <p>Punch-out at 6:02 PM</p>
//                                 <small>Yesterday</small>
//                             </div>
//                         </div>
//                     </div>
//                 </div>
//             </div>
//         </div>
//     );
// };













// import { useEffect, useState } from "react";
// import { NavLink } from 'react-router-dom';
// import { 
//     FiChevronRight, FiCheckCircle, FiLogOut, FiUser, 
//     FiBriefcase, FiCalendar, FiMessageSquare, FiActivity, FiClock 
// } from "react-icons/fi";
// import { MdOutlineDateRange, MdPayments } from "react-icons/md";
// import { IoMdPerson } from "react-icons/io";
// import "./Dashboard.css";

// const API_BASE_URL = "http://localhost:5000/api/auth";

// export const Dashboard = () => {  
//     const [loading, setLoading] = useState(true);
//     const [punchInDateTime, setPunchInDateTime] = useState(null);
//     const [dynamicData, setDynamicData] = useState({
//         user: {}, employee: {}, punch: {}, leave_balance: { pl: 0, cl: 0 }, manager: {},
//     });

//     const fetchDashboardData = async () => {
//         const token = localStorage.getItem('token');
//         try {
//             const response = await fetch(`${API_BASE_URL}/employee/homepage`, {
//                 headers: { 'Authorization': `Bearer ${token}` }
//             });
//             const result = await response.json();
//             if (result.success) { 
//                 setDynamicData({
//                     user: result.user || {},
//                     employee: result.employee || {},
//                     punch: result.punch || {},
//                     leave_balance: result.leave_balance || { pl: 0, cl: 0 },
//                     manager: result.manager || {},
//                 }); 
//                 if (result.punch.punch_in && !result.punch.punch_out) {
//                     setPunchInDateTime(new Date(result.punch.punch_in));
//                 }
//             }
//         } catch (err) { console.error(err); } 
//         finally { setLoading(false); }
//     };

//     useEffect(() => { fetchDashboardData(); }, []);

//     const isCheckedIn = !!dynamicData.punch.punch_in && !dynamicData.punch.punch_out;

//     if (loading) return <div className="loader-container"><div className="spinner"></div></div>;

//     return (
//         <main className="dashboard-wrapper">
//             {/* <header className="dashboard-welcome">
//                 <h1>Welcome back, {dynamicData.user.name || 'User'}!</h1>
//                 <p>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
//             </header> */}

//             <section className="stats-grid">
//                 {[
//                     { label: "Employee ID", val: dynamicData.user.emp_id, sub: dynamicData.employee.designation, icon: <FiBriefcase />, theme: "blue" },
//                     { label: "Date of Joining", val: dynamicData.user.doj ? new Date(dynamicData.user.doj).toLocaleDateString() : 'N/A', sub: "Permanent", icon: <MdOutlineDateRange />, theme: "green" },
//                     { label: "Leave Balance", val: `${Number(dynamicData.leave_balance.pl) + Number(dynamicData.leave_balance.cl)} Days`, sub: `${dynamicData.leave_balance.pl} PL | ${dynamicData.leave_balance.cl} CL`, icon: <FiCalendar />, theme: "sky" },
//                     { label: "Reporting Manager", val: dynamicData.manager?.l1 || "Not Assigned", sub: dynamicData.user?.circle || "Head Office", icon: <FiUser />, theme: "orange" }
//                 ].map((card, i) => (
//                     <div className="stat-card" key={i}>
//                         <div className="stat-info">
//                             <span className="label">{card.label}</span>
//                             <span className="value">{card.val || '---'}</span>
//                             <span className="subtext">{card.sub || '---'}</span>
//                         </div>
//                         <div className={`icon-box ${card.theme}`}>{card.icon}</div>
//                     </div>
//                 ))}
//             </section>

//             <section className="attendance-card">
//                 <div className="card-header">
//                     <h2><FiClock /> Attendance Overview</h2>
//                     <span className={`status-pill ${isCheckedIn ? 'online' : 'offline'}`}>
//                         {isCheckedIn ? "Checked In" : "Offline"}
//                     </span>
//                 </div>
//                 <div className="attendance-body">
//                     <div className="data-point">
//                         <span className="label">Check In</span>
//                         <span className="text">{dynamicData.punch.punch_in ? new Date(dynamicData.punch.punch_in).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}</span>
//                     </div>
//                     <div className="data-point">
//                         <span className="label">Working Hours</span>
//                         <span className="text timer">{dynamicData.punch.working_hours || '0h 00m 00s'}</span>
//                     </div>
//                     <div className="button-group">
//                         <button className="btn-punch in" disabled={isCheckedIn}>Punch In</button>
//                         <button className="btn-punch out" disabled={!isCheckedIn}>Punch Out</button>
//                     </div>
//                 </div>
//             </section>

//             <div className="dashboard-footer-grid">
//                 <section className="actions-card">
//                     <h3>Quick Actions</h3>
//                     <div className="actions-list">
//                         {[
//                             { to: "/leaves", icon: <FiCalendar />, title: "Apply Leave", color: "purple" },
//                             { to: "/salary", icon: <MdPayments />, title: "View Payslips", color: "gold" },
//                             { to: "/attendance", icon: <IoMdPerson />, title: "Records", color: "teal" }
//                         ].map((link, i) => (
//                             <NavLink to={link.to} className="action-item" key={i}>
//                                 <span className={`action-icon ${link.color}`}>{link.icon}</span>
//                                 <span className="action-label">{link.title}</span>
//                                 <FiChevronRight className="arrow" />
//                             </NavLink>
//                         ))}
//                     </div>
//                 </section>

//                 <section className="activity-card">
//                     <h3>Recent Activity</h3>
//                     <div className="timeline">
//                         <div className="timeline-item">
//                             <div className="marker active"></div>
//                             <div className="content">
//                                 <p>Punch-in Recorded</p>
//                                 <span>Today, 09:15 AM</span>
//                             </div>
//                         </div>
//                         <div className="timeline-item">
//                             <div className="marker"></div>
//                             <div className="content">
//                                 <p>Monthly Salary Credited</p>
//                                 <span>Jan 25, 2026</span>
//                             </div>
//                         </div>
//                     </div>
//                 </section>
//             </div>
//         </main>
//     );
// };










// import { useEffect, useState } from "react";
// import { NavLink } from 'react-router-dom';
// import { 
//     FiChevronRight, FiUser, FiBriefcase, FiCalendar, FiClock, FiActivity 
// } from "react-icons/fi";
// import { MdOutlineDateRange, MdPayments } from "react-icons/md";
// import { IoMdPerson } from "react-icons/io";
// import "./Dashboard.css";

// const API_BASE_URL = "http://localhost:5000/api/auth";

// export const Dashboard = () => {  
//     const [loading, setLoading] = useState(true);
//     const [dynamicData, setDynamicData] = useState({
//         user: {}, employee: {}, punch: {}, leave_balance: { pl: 0, cl: 0 }, manager: {},
//     });

//     const fetchDashboardData = async () => {
//         const token = localStorage.getItem('token');
//         try {
//             const response = await fetch(`${API_BASE_URL}/employee/homepage`, {
//                 headers: { 'Authorization': `Bearer ${token}` }
//             });
//             const result = await response.json();
//             if (result.success) { 
//                 setDynamicData({
//                     user: result.user || {},
//                     employee: result.employee || {},
//                     punch: result.punch || {},
//                     leave_balance: result.leave_balance || { pl: 0, cl: 0 },
//                     manager: result.manager || {},
//                 }); 
//             }
//         } catch (err) { console.error(err); } 
//         finally { setLoading(false); }
//     };

//     useEffect(() => { fetchDashboardData(); }, []);

//     if (loading) return <div className="loader-container"><div className="spinner"></div></div>;

//     const statItems = [
//         { label: "Employee ID", val: dynamicData.user.emp_id, sub: dynamicData.employee.designation, icon: <FiBriefcase />, theme: "blue" },
//         { label: "Date of Joining", val: dynamicData.user.doj ? new Date(dynamicData.user.doj).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : 'N/A', sub: "Permanent", icon: <MdOutlineDateRange />, theme: "green" },
//         { label: "Leave Balance", val: `${Number(dynamicData.leave_balance.pl) + Number(dynamicData.leave_balance.cl)} Days`, sub: `${dynamicData.leave_balance.pl} PL + ${dynamicData.leave_balance.cl} CL`, icon: <FiCalendar />, theme: "sky" },
//         { label: "Reporting Manager", val: dynamicData.manager?.l1 || "N/A", sub: dynamicData.user?.circle || "Head Office", icon: <FiUser />, theme: "orange" }
//     ];

//     return (
//         <div className="dashboard-main">
//             {/* Top Stat Cards: Content Left, Icon Right */}
//             <div className="stats-row">
//                 {statItems.map((item, i) => (
//                     <div className="stat-card" key={i}>
//                         <div className="info-side">
//                             <span className="info-label">{item.label}</span>
//                             <h2 className="info-value">{item.val}</h2>
//                             <span className="info-subtext">{item.sub}</span>
//                         </div>
//                         <div className={`icon-side ${item.theme}`}>
//                             {item.icon}
//                         </div>
//                     </div>
//                 ))}
//             </div>

//             {/* Attendance Card */}
//             <div className="attendance-box">
//                 <div className="box-header">
//                     <h3>Attendance Overview</h3>
//                     <span className="date-tag">{new Date().toDateString()}</span>
//                 </div>
//                 <div className="box-grid">
//                     <div className="grid-item">
//                         <label>Check In</label>
//                         <p>{dynamicData.punch.punch_in ? new Date(dynamicData.punch.punch_in).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}</p>
//                     </div>
//                     <div className="grid-item">
//                         <label>Working Hours</label>
//                         <p className="highlight-blue">{dynamicData.punch.working_hours || '0h 00m 00s'}</p>
//                     </div>
//                     <div className="grid-actions">
//                         <button className="punch-btn punch-in">Punch In</button>
//                         <button className="punch-btn punch-out">Punch Out</button>
//                     </div>
//                 </div>
//             </div>

//             {/* Bottom Section */}
//             <div className="bottom-row">
//                 <div className="content-box">
//                     <h3>Quick Actions</h3>
//                     <div className="action-stack">
//                         <NavLink to="/leaves" className="action-btn">
//                             <FiCalendar className="act-icon purple" />
//                             <div className="act-text"><strong>Apply Leave</strong><small>Submit request</small></div>
//                             <FiChevronRight className="act-arrow" />
//                         </NavLink>
//                         <NavLink to="/salary" className="action-btn">
//                             <MdPayments className="act-icon gold" />
//                             <div className="act-text"><strong>Payslips</strong><small>Download monthly</small></div>
//                             <FiChevronRight className="act-arrow" />
//                         </NavLink>
//                     </div>
//                 </div>
//                 <div className="content-box">
//                     <h3>Recent Activity</h3>
//                     <div className="activity-feed">
//                         <div className="feed-item">
//                             <div className="feed-dot green"></div>
//                             <div className="feed-content">
//                                 <strong>Punch-in Recorded</strong>
//                                 <span>Today, 09:15 AM</span>
//                             </div>
//                         </div>
//                     </div>
//                 </div>
//             </div>
//         </div>
//     );
// };3