// import React, { useState, useMemo, useEffect } from 'react';
// import { MdOutlineWatchLater } from 'react-icons/md';
// import { FiArrowRight, FiDownload, FiChevronDown, FiCalendar } from 'react-icons/fi';

// import './Attendance.css';

// // --- Placeholder Data Structure (To be replaced by API calls) ---
// const INITIAL_ATTENDANCE_DATA = {
//     summary: {
//         presentDays: 18,
//         avgPunchIn: '9:05 AM',
//         avgPunchOut: '6:15 PM',
//         totalHours: '144h',
//         targetHours: '176h',
//         onTimeStatus: 'On Time',
//         overtimeStatus: 'Overtime 2h',
//     },
//     // Data uses abbreviations internally, which are mapped in the component
//     calendar: [
//         { day: 1, status: 'Hol' }, { day: 2, status: 'Pres' }, { day: 3, status: 'Pres' }, 
//         { day: 4, status: 'Pres' }, { day: 5, status: 'Half' }, { day: 6, status: 'Pres' }, 
//         { day: 7, status: 'Week' }, { day: 8, status: 'Pres' }, { day: 9, status: 'Pres' }, 
//         { day: 10, status: 'On Leave' }, { day: 11, status: 'Pres' }, { day: 12, status: 'Pres' }, 
//         { day: 13, status: 'WFM' }, { day: 14, status: 'Week' }, { day: 15, status: 'Pres' }, 
//         { day: 16, status: 'Pres' }, { day: 17, status: 'Pend' }, { day: 18, status: 'Pres' }, 
//         { day: 19, status: 'WFM' }, { day: 20, status: 'Pres' }, { day: 21, status: 'Week' }, 
//         { day: 22, status: 'Week' }, { day: 23, status: 'Pres' }, { day: 24, status: 'Pres' }, 
//         { day: 25, status: 'Hol' }, { day: 26, status: 'Pres' }, { day: 27, status: 'Pres' }, 
//         { day: 28, status: 'Week' }, { day: 29, status: 'Week' }, { day: 30, status: 'Pres' }, 
//         { day: 31, status: 'Pres' },
//     ]
// };

// // --- Month/Year Selector Component ---
// const MonthYearSelector = ({ currentMonth, currentYear, setMonth, setYear }) => {
//     const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
//     const years = ['2024', '2025', '2026'];

//     return (
//         <div className="dropdowns-group">
//             <div className="filter-icon-wrapper">
//                 <span className="filter-icon">≡</span>
//             </div>
            
//             <div className="custom-dropdown">
//                 <select 
//                     value={currentMonth} 
//                     onChange={(e) => setMonth(e.target.value)}
//                     className="dropdown-select"
//                 >
//                     {months.map(m => <option key={m} value={m}>{m}</option>)}
//                 </select>
//                 <FiChevronDown className="dropdown-arrow" />
//             </div>

//             <div className="custom-dropdown">
//                 <select 
//                     value={currentYear} 
//                     onChange={(e) => setYear(e.target.value)}
//                     className="dropdown-select"
//                 >
//                     {years.map(y => <option key={y} value={y}>{y}</option>)}
//                 </select>
//                 <FiChevronDown className="dropdown-arrow" />
//             </div>
//         </div>
//     );
// };


// // --- Calendar Day Cell Component (Updated Logic) ---
// const CalendarDayCell = ({ day, status }) => {
    
//     const statusClassMap = {
//         'Pres': 'status-present',
//         'Abs': 'status-absent',
//         'On Leave': 'status-absent',
//         'Half': 'status-half-day',
//         'Hol': 'status-public-holiday',
//         'Week': 'status-weekend', // Default weekend style
//         'Pend': 'status-pending',
//         'WFM': 'status-wfm',
//     };

//     let calculatedStatus = status;
    
//     // Day of Week Calculation (0=Sunday, 6=Saturday). 
//     // This assumes the first day (day 1) aligns with the calendar header's start day (Sunday).
//     const dayOfWeekIndex = (day - 1) % 7; 
//     const isWeekend = dayOfWeekIndex === 0 || dayOfWeekIndex === 6; 

//     if (isWeekend) {
//         // Rule: Default to 'Week' status, but allow WFM to override on SATURDAY (index 6).
//         if (dayOfWeekIndex === 6 && status === 'WFM') { 
//             calculatedStatus = 'WFM';
//         } else if (status !== 'WFM' && status !== 'Hol') {
//              // If not WFM on Saturday or Sunday, and not a Holiday, force the 'Week' status.
//             calculatedStatus = 'Week';
//         }
//     }
    
//     const className = statusClassMap[calculatedStatus] || 'status-default';
    
//     // Logic for displaying the full text status
//     let displayStatus = calculatedStatus;
//     if (calculatedStatus === 'Pres') {
//         displayStatus = 'Present';
//     } else if (calculatedStatus === 'Pending') {
//         displayStatus = 'Pending';
//     } else if (calculatedStatus === 'Half') {
//         displayStatus = 'Half Day';
//     } else if (calculatedStatus === 'WFM') {
//         displayStatus = 'WFM'; // Keep WFM as is
//     } else if (calculatedStatus === 'On Leave' || calculatedStatus === 'Abs') {
//         displayStatus = 'On Leave';
//     } else if (calculatedStatus === 'Hol') {
//         displayStatus = 'Holiday';
//     }


//     return (
//         <div className={`calendar-day-cell ${className}`}>
//             <span className="day-number">{day}</span>
//             {/* Display status label only for non-defaulted days (Week, Hol) */}
//             {((calculatedStatus !== 'Week') && (calculatedStatus !== 'Hol')) && (
//                 <span className="day-status-label">{displayStatus}</span>
//             )}
//         </div>
//     );
// };

// export const Attendance = () => {
    
//     const [data, setData] = useState(INITIAL_ATTENDANCE_DATA);
//     const [currentMonth, setCurrentMonth] = useState('December');
//     const [currentYear, setCurrentYear] = useState('2025');

//     useEffect(() => {
//         // Fetch data here when month/year changes
//         console.log(`Fetching data for ${currentMonth}, ${currentYear}...`);
//     }, [currentMonth, currentYear]);

//     const daysOfWeek = useMemo(() => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], []);

//     // Helper function to render a summary card
//     const renderSummaryCard = (icon, value, label, subtext, colorClass) => (
//         <div className={`summary-card ${colorClass}`}>
//             <div className="summary-icon">{icon}</div>
//             <div className="summary-content">
//                 <p className="summary-value">{value}</p>
//                 <p className="summary-label">{label}</p>
//                 <p className="summary-subtext">{subtext}</p>
//             </div>
//         </div>
//     );

//     return (
//         <div className="attendance-page-container">
            
//             {/* <h1 className="page-title">Attendance</h1> */}

//             {/* 1. TOP SUMMARY CARDS */}
//             <div className="summary-cards-grid">
//                 {renderSummaryCard(
//                     <FiCalendar className="icon-main" />,
//                     `${data.summary.presentDays}`,
//                     'Present Days',
//                     'this month',
//                     'blue-card'
//                 )}
//                 {renderSummaryCard(
//                     <FiArrowRight className="icon-main" />,
//                     `${data.summary.avgPunchIn}`,
//                     'Average Punch In',
//                     data.summary.onTimeStatus,
//                     'green-card'
//                 )}
//                 {renderSummaryCard(
//                     <FiArrowRight className="icon-main icon-flipped" />,
//                     `${data.summary.avgPunchOut}`,
//                     'Average Punch Out',
//                     data.summary.overtimeStatus,
//                     'orange-card'
//                 )}
//                 {renderSummaryCard(
//                     <MdOutlineWatchLater className="icon-main" />,
//                     `${data.summary.totalHours}`,
//                     'Total Hours',
//                     `Target ${data.summary.targetHours}`,
//                     'yellow-card'
//                 )}
//             </div>

//             {/* 2. ATTENDANCE CALENDAR */}
//             <div className="attendance-calendar-card card">
//                 <div className="calendar-header-row">
//                     <h2 className="section-title">Attendance Calendar</h2>
//                     <div className='title-subtext'>View and export monthly attendance records.</div>

//                     <div className="calendar-controls">
//                         <MonthYearSelector 
//                             currentMonth={currentMonth}
//                             currentYear={currentYear}
//                             setMonth={setCurrentMonth}
//                             setYear={setCurrentYear}
//                         />
                        
//                         <button className="print-button">
//                             <FiDownload className="icon-white" />
//                             Print to Excel
//                         </button>
//                     </div>
//                 </div>

//                 {/* Status Key */}
//                 <div className="status-key">
//                     <span className="key-item status-present">Present</span>
//                     <span className="key-item status-absent">Absent / On Leave</span>
//                     <span className="key-item status-half-day">Half Day</span>
//                     <span className="key-item status-pending">Pending Punch Out</span>
//                     <span className="key-item status-wfm">Work From Home</span>
//                     <span className="key-item status-weekend">Weekend</span>
//                     <span className="key-item status-public-holiday">Public Holiday</span>
//                 </div>

//                 {/* Calendar Grid */}
//                 <div className="calendar-grid">
//                     {daysOfWeek.map(day => (
//                         <div key={day} className="day-name">{day}</div>
//                     ))}
                    
//                     {data.calendar.map(item => (
//                         <CalendarDayCell 
//                             key={item.day}
//                             day={item.day}
//                             status={item.status}
//                         />
//                     ))}
//                 </div>
//             </div>
            
//         </div>
//     );
// };

















// src/pages/Attendance/Attendance.jsx - CORRECTED WITH CUSTOM DROPDOWN

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { MdOutlineWatchLater } from 'react-icons/md';
import { FiArrowRight, FiDownload, FiChevronDown, FiCalendar, FiRefreshCw } from 'react-icons/fi';

import './Attendance.css';

const API_BASE_URL = "/api/leave";

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const INITIAL_ATTENDANCE_DATA = {
    summary: {
        presentDays: 0,
        avgPunchIn: '--:--',
        avgPunchOut: '--:--',
        totalHours: '0h',
        targetHours: '0h',
        onTimeStatus: '-',
        overtimeStatus: '-',
    },
    calendar: []
};

const formatTimeFromTimedelta = (tdStr) => {
    if (!tdStr) return '--:--';
    const s = String(tdStr).trim();
    const m = s.match(/(\d+):(\d{2})(?::(\d{2}))?/);
    if (!m) return s;
    const [, h, min, sec] = m;
    const hour = parseInt(h, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hr12 = hour % 12 || 12;
    return `${hr12}:${min} ${ampm}`;
};

const formatHours = (tdStr) => {
    if (!tdStr) return '0h';
    const s = String(tdStr).trim().replace(/^-/, '');
    const m = s.match(/(\d+):(\d{2})(?::(\d{2}))?/);
    if (!m) return String(tdStr);
    const [, h, min] = m;
    const total = parseInt(h, 10) * 60 + parseInt(min, 10);
    if (total >= 60) return `${Math.floor(total / 60)}h`;
    if (total > 0) return `${total}m`;
    return '0h';
};

const formatCalendarWorkHours = (tdStr) => {
    if (!tdStr) return '';
    const s = String(tdStr).trim().replace(/^-/, '');
    const m = s.match(/(\d+):(\d{2})(?::(\d{2}))?/);
    if (!m) return s;
    const [, h, min] = m;
    return `${parseInt(h, 10)}h ${min}m`;
};

const backendStatusToFrontend = (backendStatus, details = {}) => {
    if (backendStatus === 'WEEKEND') return 'Week';
    if (backendStatus === 'HOLIDAY') return 'Hol';
    if (backendStatus === 'HOLIDAY_OPTIONAL') return 'HolOpt';
    if (backendStatus === 'LEAVE') return 'On Leave';
    if (backendStatus === 'LEAVE_PENDING') return 'On Leave'; // Show as leave but could add visual indicator
    if (backendStatus === 'ABSENT') return 'Abs';
    if (backendStatus === 'PENDING_PUNCH_OUT') return 'Pend';
    if (backendStatus === 'HALF_DAY') return 'Half';
    if (backendStatus === 'WFH_APPROVED') return 'WFM';
    if (backendStatus === 'WFH_PENDING') return 'WFM'; // Show as WFM but pending approval
    if (backendStatus === 'PRESENT') return details?.wfh ? 'WFM' : 'Pres';
    return 'Pres';
};

// --- Custom Dropdown Component (Ensures options open DOWNWARDS) ---
const CustomDropdown = ({ options, currentValue, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    // Close the dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (value) => {
        onChange(value);
        setIsOpen(false);
    };

    return (
        <div className="custom-dropdown-v2" ref={dropdownRef}>
            <button 
                className="dropdown-toggle" 
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                {currentValue}
                <FiChevronDown className={`dropdown-arrow ${isOpen ? 'rotate' : ''}`} />
            </button>
            
            {isOpen && (
                <ul className="dropdown-menu">
                    {options.map((option) => (
                        <li 
                            key={option} 
                            className={`dropdown-item ${option === currentValue ? 'selected' : ''}`}
                            onClick={() => handleSelect(option)}
                        >
                            {option}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};


// --- Month/Year Selector Component (Now uses CustomDropdown) ---
const MonthYearSelector = ({ currentMonth, currentYear, setMonth, setYear }) => {
    const months = MONTH_NAMES;
    const currentY = new Date().getFullYear();
    const years = [String(currentY - 1), String(currentY), String(currentY + 1)];

    return (
        <div className="dropdowns-group">
            <div className="filter-icon-wrapper">
                <span className="filter-icon">≡</span>
            </div>
            
            <CustomDropdown
                options={months}
                currentValue={currentMonth}
                onChange={setMonth}
            />

            <CustomDropdown
                options={years}
                currentValue={currentYear}
                onChange={setYear}
            />
        </div>
    );
};


// --- Calendar Day Cell Component ---
const CalendarDayCell = ({ day, status, isFuture, details = {} }) => {
    if (status === 'empty' || day == null) {
        return <div className="calendar-day-cell status-empty" />;
    }

    const statusClassMap = {
        'Pres': 'status-present',
        'Abs': 'status-absent',
        'On Leave': 'status-on-leave',
        'Half': 'status-half-day',
        'Hol': 'status-public-holiday',
        'HolOpt': 'status-optional-holiday',
        'Week': 'status-weekend',
        'Pend': 'status-pending',
        'WFM': 'status-wfm',
    };

    const finalClassName = statusClassMap[status] || 'status-default';

    let displayStatus = status;
    if (status === 'Pres') displayStatus = 'Present';
    else if (status === 'Pend') displayStatus = 'Pending Punch Out';
    else if (status === 'Half') displayStatus = 'Half Day';
    else if (status === 'WFM') displayStatus = 'WFM';
    else if (status === 'On Leave') displayStatus = 'On Leave';
    else if (status === 'Abs') displayStatus = 'Absent';
    else if (status === 'Hol') displayStatus = 'Public Holiday';
    else if (status === 'HolOpt') displayStatus = 'Optional Holiday';

    const showWorkHours = Boolean(details?.punch_in && details?.punch_out && details?.work_hours);
    const workHoursText = showWorkHours ? formatCalendarWorkHours(details.work_hours) : '';
    const showStatusLabel = status !== 'Week';
    const showInlineStatusAndHours = showStatusLabel && showWorkHours;

    return (
        <div className={`calendar-day-cell ${finalClassName}`}>
            <span className="day-number">{day}</span>
            {showInlineStatusAndHours ? (
                <div className="day-status-row">
                    <span className="day-status-label">{displayStatus}</span>
                    <span className="day-work-hours day-work-hours-bold">{workHoursText}</span>
                </div>
            ) : (
                <>
                    {showStatusLabel && (
                        <span className="day-status-label">{displayStatus}</span>
                    )}
                    {showWorkHours && (
                        <span className="day-work-hours">{workHoursText}</span>
                    )}
                </>
            )}
        </div>
    );
};

export const Attendance = () => {
    
    const [data, setData] = useState(INITIAL_ATTENDANCE_DATA);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [downloadingExcel, setDownloadingExcel] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
    const [currentYear, setCurrentYear] = useState(String(new Date().getFullYear()));

  const monthNum = useMemo(() => MONTH_NAMES.indexOf(currentMonth) + 1, [currentMonth]);
  const yearNum = useMemo(() => parseInt(currentYear, 10), [currentYear]);

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE_URL}/attendance/summary?month=${monthNum}&year=${yearNum}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || 'Failed to fetch attendance');
      }
      if (json.success && json.calendar) {
        const firstDay = new Date(yearNum, monthNum - 1, 1);
        const offset = firstDay.getDay();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const paddedCalendar = [];
        for (let i = 0; i < offset; i++) {
          paddedCalendar.push({ day: null, status: 'empty' });
        }
        json.calendar.forEach((item) => {
          const itemDate = new Date(item.date);
          itemDate.setHours(0, 0, 0, 0);
          const isFuture = itemDate > today;
          let status = backendStatusToFrontend(item.status, item.details);
          // For future dates with ABSENT status, keep as 'Abs' but mark as future
          paddedCalendar.push({
            day: item.day,
            status: status,
            isFuture: isFuture && item.status === 'ABSENT',
            details: item.details || {},
          });
        });
        setData({
          summary: {
            presentDays: json.total_present_days ?? 0,
            avgPunchIn: formatTimeFromTimedelta(json.average_punch_in),
            avgPunchOut: formatTimeFromTimedelta(json.average_punch_out),
            totalHours: formatHours(json.actual_work_hours),
            targetHours: formatHours(json.expected_work_hours),
            onTimeStatus: json.difference?.startsWith('-') ? 'Late' : 'On Time',
            overtimeStatus: json.difference ? (json.difference.startsWith('-') ? `Short ${formatHours(json.difference)}` : `Overtime ${formatHours(json.difference)}`) : '-',
          },
          calendar: paddedCalendar,
        });
      }
    } catch (err) {
      setError(err.message);
      setData(INITIAL_ATTENDANCE_DATA);
    } finally {
      setLoading(false);
    }
  }, [monthNum, yearNum]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

    const handleDownloadExcel = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            setError('Please login again to download attendance.');
            return;
        }
        setDownloadingExcel(true);
        try {
            const monthParam = `${yearNum}-${String(monthNum).padStart(2, '0')}`;
            const res = await fetch(
                `${API_BASE_URL}/attendance/download?month=${monthParam}`,
                {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            if (!res.ok) {
                let message = 'Download failed';
                try {
                    const errData = await res.json();
                    message = errData.message || message;
                } catch (_) {
                    // ignore parse failure
                }
                throw new Error(message);
            }

            const blob = await res.blob();
            const contentDisposition = res.headers.get('content-disposition') || '';
            let backendFileName = '';
            const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
            const asciiMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
            if (utf8Match && utf8Match[1]) {
                backendFileName = decodeURIComponent(utf8Match[1].trim());
            } else if (asciiMatch && asciiMatch[1]) {
                backendFileName = asciiMatch[1].trim();
            }

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = backendFileName || `Attendance_${currentMonth}_${currentYear}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            setError(err.message || 'Download failed');
        } finally {
            setDownloadingExcel(false);
        }
    };

  useEffect(() => {
    const handleLeaveApplied = () => {
      fetchAttendance();
    };
    const handleWfhApplied = () => {
      fetchAttendance();
    };
    window.addEventListener('leaveApplied', handleLeaveApplied);
    window.addEventListener('wfhApplied', handleWfhApplied);
    return () => {
      window.removeEventListener('leaveApplied', handleLeaveApplied);
      window.removeEventListener('wfhApplied', handleWfhApplied);
    };
  }, [fetchAttendance]);

    const daysOfWeek = useMemo(() => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], []);

    const renderSummaryCard = (icon, value, label, subtext, colorClass) => (
        <div className={`summary-card ${colorClass}`}>
            <div className="summary-icon">{icon}</div>
            <div className="summary-content">
                <p className="summary-value">{value}</p>
                <p className="summary-label">{label}</p>
                <p className="summary-subtext">{subtext}</p>
            </div>
        </div>
    );

    if (loading) {
        return (
            <div className="attendance-page-container">
                <div className="attendance-loading" style={{ padding: '4rem', textAlign: 'center' }}>
                    <div className="loader" style={{ width: 40, height: 40, margin: '0 auto' }} />
                    <p style={{ marginTop: 16, color: '#666' }}>Loading attendance...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="attendance-page-container">
            {error && (
                <div className="attendance-error" style={{ padding: 12, marginBottom: 20, background: '#fee', borderRadius: 8, color: '#c00' }}>
                    {error}
                </div>
            )}

            {/* 1. TOP SUMMARY CARDS */}
            <div className="summary-cards-grid">
                {renderSummaryCard(<FiCalendar className="icon-main" />, `${data.summary.presentDays}`, 'Present Days', 'this month', 'blue-card')}
                {renderSummaryCard(<FiArrowRight className="icon-main" />, `${data.summary.avgPunchIn}`, 'Average Punch In', data.summary.onTimeStatus, 'green-card')}
                {renderSummaryCard(<FiArrowRight className="icon-main icon-flipped" />, `${data.summary.avgPunchOut}`, 'Average Punch Out', data.summary.overtimeStatus, 'orange-card')}
                {renderSummaryCard(<MdOutlineWatchLater className="icon-main" />, `${data.summary.totalHours}`, 'Total Hours', `Target ${data.summary.targetHours}`, 'yellow-card')}
            </div>

            {/* 2. ATTENDANCE CALENDAR */}
            <div className="attendance-calendar-card card">
                <div className="calendar-header-row">
                    <h2 className="section-title">Attendance Calendar</h2>
                    <div className='title-subtext'>View and export monthly attendance records.</div>

                    <div className="calendar-controls">
                        <MonthYearSelector 
                            currentMonth={currentMonth}
                            currentYear={currentYear}
                            setMonth={setCurrentMonth}
                            setYear={setCurrentYear}
                        />
                        
                        <button 
                            className="print-button" 
                            onClick={() => fetchAttendance()}
                            disabled={loading}
                            style={{ marginRight: '10px' }}
                        >
                            <FiRefreshCw className="icon-white" style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                            Refresh
                        </button>
                        <button
                            className="print-button"
                            onClick={handleDownloadExcel}
                            disabled={downloadingExcel}
                        >
                            <FiDownload className="icon-white" />
                            {downloadingExcel ? 'Downloading...' : 'Print to Excel'}
                        </button>
                    </div>
                </div>

                {/* Status Key */}
                <div className="status-key">
                    <span className="key-item status-present">Present</span>
                    <span className="key-item status-absent">Absent</span>
                    <span className="key-item status-on-leave">On Leave</span>
                    <span className="key-item status-half-day">Half Day</span>
                    <span className="key-item status-pending">Pending Punch Out</span>
                    <span className="key-item status-wfm">Work From Home</span>
                    <span className="key-item status-weekend">Weekend</span>
                    <span className="key-item status-public-holiday">Public Holiday</span>
                    <span className="key-item status-optional-holiday">Optional Holiday</span>
                </div>

                {/* Calendar Grid */}
                <div className="calendar-grid">
                    {daysOfWeek.map(day => (
                        <div key={day} className="day-name">{day}</div>
                    ))}
                    
                    {data.calendar.map((item, index) => (
                        <CalendarDayCell 
                            key={`calendar-day-${index}-${item.day || 'empty'}`}
                            day={item.day}
                            status={item.status}
                            isFuture={item.isFuture || false}
                            details={item.details || {}}
                        />
                    ))}
                </div>
            </div>
            
        </div>
    );
};