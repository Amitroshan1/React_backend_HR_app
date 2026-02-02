import { useEffect, useState, useMemo } from "react";
import { NavLink } from 'react-router-dom';
import {  FiChevronRight,FiCheckCircle, FiUserCheck,FiCalendar,FiBriefcase as FiBriefcaseIcon, FiMessageSquare 
} from "react-icons/fi";
import { MdOutlineDateRange } from "react-icons/md";
import { GiReceiveMoney } from "react-icons/gi";
import { TbDeviceLaptop } from "react-icons/tb";
import { IoMdPerson } from "react-icons/io";
import "./style/Dashboard.css";
const API_BASE_URL = "http://localhost:5000/api/auth";
const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const formatTime = (isoString) => {
    if (!isoString) return '---';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return 'Invalid Time';
        return date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: true 
        });
    } catch (e) {
        return 'Invalid Time';
    }
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
        error: null 
    });
    const [dynamicData, setDynamicData] = useState({
        user: {},
        employee: {},
        punch: {},
        leave_balance: { pl: 'N/A', cl: 'N/A' },
        manager: {},
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
                setDynamicData({
                    user: result.user || {},
                    employee: result.employee || {},
                    punch: result.punch || {},
                    leave_balance: result.leave_balance || { pl: 'N/A', cl: 'N/A' },
                    manager: result.manager || {},
                });
                if (result.punch.punch_in && !result.punch.punch_out) {
                    setPunchInDateTime(new Date(result.punch.punch_in));
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
    useEffect(() => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setLocation({
                        lat: position.coords.latitude,
                        lon: position.coords.longitude,
                        error: null,
                    });
                },
                (err) => {
                    console.warn(`Geolocation Error: ${err.code} - ${err.message}`);
                    setLocation((prev) => ({ 
                        ...prev, 
                        error: "Location access denied or unavailable. Punch In requires location." 
                    }));
                }
            );
        } else {
            setLocation((prev) => ({ 
                ...prev, 
                error: "Geolocation not supported by this browser." 
            }));
        }
    }, []);
    useEffect(() => {
        let timer;
        if (punchInDateTime) {
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
        }
        return () => {
            if (timer) {
                clearInterval(timer);
            }
        };
    }, [punchInDateTime]); 
    const handlePunchIn = async () => {
        if (isPunching || !location.lat) {
            alert(location.error || "Cannot punch in without location.");
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
                const newPunchInTime = new Date(result.punch_in);
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
        if (isPunching) return; 
        setIsPunching(true);
        const token = localStorage.getItem('token');
        try {
            const response = await fetch(`${API_BASE_URL}/employee/punch-out`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            const result = await response.json();
            if (response.ok && result.success) {
                setPunchInDateTime(null); 
                setDynamicData(prev => ({
                    ...prev,
                    punch: {
                        ...prev.punch,
                        punch_out: result.punch_out, 
                        working_hours: result.today_work || prev.punch.working_hours, 
                    }
                }));
                alert(`Punched Out Successfully! Total Today's Work: ${result.today_work || 'N/A'}`);
            } else {
                alert(`Punch Out Failed: ${result.message || 'Server error.'}`);
            }
        } catch (error) {
            console.error("Punch Out error:", error);
            alert("Network error during Punch Out.");
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
            return dynamicData.punch.punch_out ? "Checked Out" : "Checked In";
        }
        return "Not Checked In";
    }, [dynamicData.punch.punch_in, dynamicData.punch.punch_out]);
    const isCheckedIn = currentStatus === 'Checked In';
    const isCheckedOut = currentStatus === 'Checked Out';
    const managerName = dynamicData.manager?.l1 || "N/A"; 
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
                                <p className="card-subtext">{dynamicData.employee.designation || dynamicData.user.department || 'N/A'}</p> 
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
                                {location.error && (
                                    <p className="location-error-message">⚠️ {location.error}</p>
                                )}
                                <div className="check-in-time">
                                    <p className="label">Check In Time</p>
                                    <p className="time-value dashed-separator">{punchInTimeDisplay}</p>
                                </div>
                                <div className="current-status">
                                    <p className="label">Current Status</p>
                                    <p className={`status-value ${currentStatus.replace(' ', '-').toLowerCase()}`}>
                                        {currentStatus}
                                    </p>
                                </div>
                                <div className="hours-today">
                                    <p className="label">Hours Today</p>
                                    <p className="time-value">{dynamicData.punch.working_hours || '0h 00m 00s'}</p>
                                </div>
                                <div className="action-buttons">
                                    <button 
                                        className="check-in-btn" 
                                        onClick={handlePunchIn}
                                        disabled={!!dynamicData.punch.punch_in || isPunching || !!location.error}
                                >
                                        {isPunching && !isCheckedIn ? 'Punching In...' : <><FiCheckCircle /> Punch In</>}
                                    </button>
                                    <button 
                                        className="check-out-btn"
                                        onClick={handlePunchOut}
                                        disabled={!isCheckedIn || isPunching}
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
                            <NavLink to="/leaves" className="action-card nav-link-card"> 
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
                            <NavLink to="/attendance" className="action-card nav-link-card"> 
                                <div className="action-icon-group">
                                    <FiMessageSquare className="action-icon blue" /> 
                                    <div>
                                        <h4>Raise a Query</h4>
                                        <p>Ask for HR/Admin support</p>
                                    </div>
                                </div>
                                <FiChevronRight className="arrow" />
                            </NavLink>
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











// // import React, { useEffect, useState, useMemo } from "react";
// // import { NavLink } from 'react-router-dom';
// // import { 
// //     FiChevronRight, FiCheckCircle, FiUserCheck, FiCalendar, 
// //     FiBriefcase as FiBriefcaseIcon, FiMessageSquare 
// // } from "react-icons/fi";
// // import { MdOutlineDateRange } from "react-icons/md";
// // import { GiReceiveMoney } from "react-icons/gi";
// // import { TbDeviceLaptop } from "react-icons/tb";
// // import "./style/Dashboard.css";

// // const API_BASE_URL = "http://localhost:5000/api/auth";

// // // --- HELPERS ---
// // const formatDate = (dateString) => {
// //     if (!dateString || dateString === 'None' || dateString === 'undefined') return 'N/A';
// //     const date = new Date(dateString);
// //     return isNaN(date) ? 'N/A' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
// // };

// // const formatTime = (timeInput) => {
// //     if (!timeInput || timeInput === 'None') return '---';
// //     try {
// //         let dateObj = new Date(timeInput);
// //         if (isNaN(dateObj.getTime())) {
// //             const today = new Date().toISOString().split('T')[0];
// //             dateObj = new Date(`${today}T${timeInput}`);
// //         }
// //         return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
// //     } catch (e) { return '---'; }
// // };

// // const formatTimeDifference = (diffMs) => {
// //     if (diffMs < 0 || isNaN(diffMs)) diffMs = 0;
// //     const totalSeconds = Math.floor(diffMs / 1000);
// //     const hours = Math.floor(totalSeconds / 3600);
// //     const minutes = Math.floor((totalSeconds % 3600) / 60);
// //     const seconds = totalSeconds % 60;
// //     return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
// // };

// // export const Dashboard = () => {
// //     const [loading, setLoading] = useState(true);
// //     const [isPunching, setIsPunching] = useState(false);
// //     const [location, setLocation] = useState({ lat: null, lon: null, error: null });
// //     const [punchInDateTime, setPunchInDateTime] = useState(null);
    
// //     // Initial state matching your backend structure
// //     const [dynamicData, setDynamicData] = useState({
// //         user: { name: "", emp_id: "", circle: "", doj: "" },
// //         employee: { designation: "" },
// //         punch: { punch_in: null, punch_out: null, working_hours: "0h 00m 00s" },
// //         leave_balance: { pl: 0, cl: 0 },
// //         manager: { l1: "N/A" },
// //     });

// //     const fetchDashboardData = async () => {
// //         const token = localStorage.getItem('token');
// //         try {
// //             const response = await fetch(`${API_BASE_URL}/employee/homepage`, {
// //                 headers: { 'Authorization': `Bearer ${token}` }
// //             });
// //             const result = await response.json();
            
// //             if (result.success) {
// //                 setDynamicData(result);
                
// //                 // Set the ticking timer if user is punched in but not out
// //                 if (result.punch?.punch_in && !result.punch?.punch_out) {
// //                     let pIn = result.punch.punch_in;
// //                     if (pIn.length <= 8) {
// //                         pIn = `${new Date().toISOString().split('T')[0]}T${pIn}`;
// //                     }
// //                     setPunchInDateTime(new Date(pIn));
// //                 }
// //             }
// //         } catch (err) {
// //             console.error("Fetch error:", err);
// //         } finally {
// //             setLoading(false);
// //         }
// //     };

// //     useEffect(() => {
// //         fetchDashboardData();
// //     }, []);

// //     useEffect(() => {
// //         if (navigator.geolocation) {
// //             navigator.geolocation.getCurrentPosition(
// //                 (pos) => setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude, error: null }),
// //                 () => setLocation(p => ({ ...p, error: "Location access denied." }))
// //             );
// //         }
// //     }, []);

// //     // Timer logic
// //     useEffect(() => {
// //         let interval;
// //         if (punchInDateTime) {
// //             interval = setInterval(() => {
// //                 const diff = new Date().getTime() - punchInDateTime.getTime();
// //                 setDynamicData(prev => ({
// //                     ...prev,
// //                     punch: { ...prev.punch, working_hours: formatTimeDifference(diff) }
// //                 }));
// //             }, 1000);
// //         }
// //         return () => clearInterval(interval);
// //     }, [punchInDateTime]);

// //     const handlePunchIn = async () => {
// //         if (!location.lat) return alert("Please allow location access.");
// //         setIsPunching(true);
// //         try {
// //             const response = await fetch(`${API_BASE_URL}/employee/punch-in`, {
// //                 method: 'POST',
// //                 headers: { 
// //                     'Authorization': `Bearer ${localStorage.getItem('token')}`,
// //                     'Content-Type': 'application/json' 
// //                 },
// //                 body: JSON.stringify({ lat: location.lat, lon: location.lon })
// //             });
// //             const result = await response.json();
// //             if (result.success) {
// //                 let pIn = result.punch_in;
// //                 if (pIn.length <= 8) pIn = `${new Date().toISOString().split('T')[0]}T${pIn}`;
// //                 setPunchInDateTime(new Date(pIn));
// //                 fetchDashboardData(); // Refresh to sync all states
// //             } else {
// //                 alert(result.message);
// //             }
// //         } catch (e) {
// //             alert("Punch In Failed");
// //         } finally {
// //             setIsPunching(false);
// //         }
// //     };

// //     const handlePunchOut = async () => {
// //         setIsPunching(true);
// //         try {
// //             const response = await fetch(`${API_BASE_URL}/employee/punch-out`, {
// //                 method: 'POST',
// //                 headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
// //             });
// //             const result = await response.json();
// //             if (result.success) {
// //                 setPunchInDateTime(null);
// //                 setDynamicData(prev => ({
// //                     ...prev,
// //                     punch: { 
// //                         ...prev.punch, 
// //                         punch_out: result.punch_out, 
// //                         working_hours: result.today_work 
// //                     }
// //                 }));
// //             }
// //         } catch (e) {
// //             alert("Punch Out Failed");
// //         } finally {
// //             setIsPunching(false);
// //         }
// //     };

// //     return (
// //         <div className="main-layout">
// //             <header className="dashboard-header">
// //                 {/* Fixed User Name Display */}
// //                 <h2>Welcome, {dynamicData.user?.name || "User"}</h2>
// //             </header>

// //             <div className="content-area">
// //                 <div className="dashboard-content">
// //                     <div className="top-cards-grid">
// //                         {/* Employee ID Card */}
// //                         <div className="card top-card">
// //                             <div className="card-content-wrapper">
// //                                 <h4 className="card-label">Employee ID</h4>
// //                                 <h3 className="card-value">{dynamicData.user?.emp_id || '---'}</h3>
// //                                 <p className="card-subtext">{dynamicData.employee?.designation || 'Staff'}</p>
// //                             </div>
// //                             <div className="card-icon-round blue-bg"><FiBriefcaseIcon /></div>
// //                         </div>

// //                         {/* DOJ Card */}
// //                         <div className="card top-card">
// //                             <div className="card-content-wrapper">
// //                                 <h4 className="card-label">Joining Date</h4>
// //                                 <h3 className="card-value">{formatDate(dynamicData.user?.doj)}</h3>
// //                                 <p className="card-subtext">Experience: Joined in {new Date(dynamicData.user?.doj).getFullYear() || '---'}</p>
// //                             </div>
// //                             <div className="card-icon-round green-bg"><MdOutlineDateRange /></div>
// //                         </div>

// //                         {/* Leave Balance Card (Matches your backend pl/cl) */}
// //                         <div className="card top-card">
// //                             <div className="card-content-wrapper">
// //                                 <h4 className="card-label">Leave Balance</h4>
// //                                 <h3 className="card-value">
// //                                     {Number(dynamicData.leave_balance?.pl || 0) + Number(dynamicData.leave_balance?.cl || 0)} Days
// //                                 </h3>
// //                                 <p className="card-subtext">{dynamicData.leave_balance?.pl} PL + {dynamicData.leave_balance?.cl} CL</p>
// //                             </div>
// //                             <div className="card-icon-round sky-bg"><FiCalendar /></div>
// //                         </div>

// //                         {/* Manager Card */}
// //                         <div className="card top-card">
// //                             <div className="card-content-wrapper">
// //                                 <h4 className="card-label">Reporting Manager</h4>
// //                                 <h3 className="card-value" style={{fontSize: '15px'}}>{dynamicData.manager?.l1 || 'N/A'}</h3>
// //                                 <p className="card-subtext">Circle: {dynamicData.user?.circle || '---'}</p>
// //                             </div>
// //                             <div className="card-icon-round orange-bg"><FiUserCheck /></div>
// //                         </div>
// //                     </div>

// //                     <div className="main-grid">
// //                         <div className="attendance-section grid-span-4">
// //                             <div className="attendance-header">
// //                                 <h2 className="section-title">Today's Status</h2>
// //                                 <span className="attendance-date">{new Date().toDateString()}</span>
// //                             </div>
// //                             <div className="attendance-body">
// //                                 <div className="status-row">
// //                                     <span>Check In: <strong>{formatTime(dynamicData.punch?.punch_in)}</strong></span>
// //                                 </div>
// //                                 <div className="timer-display">
// //                                     <p className="label">Working Hours Today</p>
// //                                     <h1 className="work-hours">{dynamicData.punch?.working_hours || "0h 00m 00s"}</h1>
// //                                 </div>
// //                                 <div className="action-buttons">
// //                                     <button 
// //                                         className="check-in-btn" 
// //                                         onClick={handlePunchIn} 
// //                                         disabled={!!dynamicData.punch?.punch_in || isPunching}
// //                                     >
// //                                         <FiCheckCircle /> Punch In
// //                                     </button>
// //                                     <button 
// //                                         className="check-out-btn" 
// //                                         onClick={handlePunchOut} 
// //                                         disabled={!dynamicData.punch?.punch_in || !!dynamicData.punch?.punch_out || isPunching}
// //                                     >
// //                                         Punch Out
// //                                     </button>
// //                                 </div>
// //                             </div>
// //                         </div>
// //                     </div>
// //                 </div>
// //             </div>
// //         </div>
// //     );
// // };






