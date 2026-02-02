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

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MdOutlineWatchLater } from 'react-icons/md';
import { FiArrowRight, FiDownload, FiChevronDown, FiCalendar } from 'react-icons/fi';

import './Attendance.css';

// --- Placeholder Data Structure (Remains the same) ---
const INITIAL_ATTENDANCE_DATA = {
    summary: {
        presentDays: 18,
        avgPunchIn: '9:05 AM',
        avgPunchOut: '6:15 PM',
        totalHours: '144h',
        targetHours: '176h',
        onTimeStatus: 'On Time',
        overtimeStatus: 'Overtime 2h',
    },
    calendar: [
        { day: 1, status: 'Hol' }, { day: 2, status: 'Pres' }, { day: 3, status: 'Pres' }, 
        { day: 4, status: 'Pres' }, { day: 5, status: 'Half' }, { day: 6, status: 'WFM' }, // Changed to WFM for Saturday test
        { day: 7, status: 'Week' }, { day: 8, status: 'Pres' }, { day: 9, status: 'Pres' }, 
        { day: 10, status: 'On Leave' }, { day: 11, status: 'Pres' }, { day: 12, status: 'Pres' }, 
        { day: 13, status: 'WFM' }, { day: 14, status: 'Week' }, { day: 15, status: 'Pres' }, 
        { day: 16, status: 'Pres' }, { day: 17, status: 'Pend' }, { day: 18, status: 'Pres' }, 
        { day: 19, status: 'WFM' }, { day: 20, status: 'Pres' }, { day: 21, status: 'Week' }, 
        { day: 22, status: 'Week' }, { day: 23, status: 'Pres' }, { day: 24, status: 'Pres' }, 
        { day: 25, status: 'Hol' }, { day: 26, status: 'Pres' }, { day: 27, status: 'Pres' }, 
        { day: 28, status: 'Week' }, { day: 29, status: 'Week' }, { day: 30, status: 'Pres' }, 
        { day: 31, status: 'Pres' },
    ]
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
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const years = ['2024', '2025', '2026'];

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
const CalendarDayCell = ({ day, status }) => {
    
    const statusClassMap = {
        'Pres': 'status-present',
        'Abs': 'status-absent',
        'On Leave': 'status-absent',
        'Half': 'status-half-day',
        'Hol': 'status-public-holiday',
        'Week': 'status-weekend',
        'Pend': 'status-pending',
        'WFM': 'status-wfm',
    };

    let calculatedStatus = status;
    
    // Day of Week Calculation (0=Sunday, 6=Saturday)
    const dayOfWeekIndex = (day - 1) % 7; 
    const isWeekend = dayOfWeekIndex === 0 || dayOfWeekIndex === 6; 

    if (isWeekend) {
        // Allow WFM to override the default 'Week' status on SATURDAY (index 6).
        if (dayOfWeekIndex === 6 && status === 'WFM') { 
            calculatedStatus = 'WFM';
        } else if (status !== 'WFM' && status !== 'Hol') {
            calculatedStatus = 'Week';
        }
    }
    
    const className = statusClassMap[calculatedStatus] || 'status-default';
    
    // Logic for displaying the full text status
    let displayStatus = calculatedStatus;
    if (calculatedStatus === 'Pres') {
        displayStatus = 'Present';
    } else if (calculatedStatus === 'Pend') {
        displayStatus = 'Pending';
    } else if (calculatedStatus === 'Half') {
        displayStatus = 'Half Day';
    } else if (calculatedStatus === 'WFM') {
        displayStatus = 'WFM'; 
    } else if (calculatedStatus === 'On Leave' || calculatedStatus === 'Abs') {
        displayStatus = 'On Leave';
    } else if (calculatedStatus === 'Hol') {
        displayStatus = 'Holiday';
    }


    return (
        <div className={`calendar-day-cell ${className}`}>
            <span className="day-number">{day}</span>
            {((calculatedStatus !== 'Week') && (calculatedStatus !== 'Hol')) && (
                <span className="day-status-label">{displayStatus}</span>
            )}
        </div>
    );
};

export const Attendance = () => {
    
    const [data, setData] = useState(INITIAL_ATTENDANCE_DATA);
    const [currentMonth, setCurrentMonth] = useState('December');
    const [currentYear, setCurrentYear] = useState('2025');

    useEffect(() => {
        console.log(`Fetching data for ${currentMonth}, ${currentYear}...`);
    }, [currentMonth, currentYear]);

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

    return (
        <div className="attendance-page-container">
            
            {/* <h1 className="page-title">Attendance</h1> */}

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
                        
                        <button className="print-button">
                            <FiDownload className="icon-white" />
                            Print to Excel
                        </button>
                    </div>
                </div>

                {/* Status Key */}
                <div className="status-key">
                    <span className="key-item status-present">Present</span>
                    <span className="key-item status-absent">Absent / On Leave</span>
                    <span className="key-item status-half-day">Half Day</span>
                    <span className="key-item status-pending">Pending Punch Out</span>
                    <span className="key-item status-wfm">Work From Home</span>
                    <span className="key-item status-weekend">Weekend</span>
                    <span className="key-item status-public-holiday">Public Holiday</span>
                </div>

                {/* Calendar Grid */}
                <div className="calendar-grid">
                    {daysOfWeek.map(day => (
                        <div key={day} className="day-name">{day}</div>
                    ))}
                    
                    {data.calendar.map(item => (
                        <CalendarDayCell 
                            key={item.day}
                            day={item.day}
                            status={item.status}
                        />
                    ))}
                </div>
            </div>
            
        </div>
    );
};