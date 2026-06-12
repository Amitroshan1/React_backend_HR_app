// import { useState, useEffect, useRef } from 'react';
// import { FiX, FiChevronDown, FiCalendar } from 'react-icons/fi';
// import dayjs from 'dayjs'; 
// import './ApplyLeaveModal.css'; 

// // --- Custom Dropdown Component ---
// const CustomDropdown = ({ options, currentValue, onChange, label, disabled = false }) => {
//     const [isOpen, setIsOpen] = useState(false);
//     const dropdownRef = useRef(null);

//     // Close dropdown when clicking outside
//     useEffect(() => {
//         const handleClickOutside = (event) => {
//             if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//                 setIsOpen(false);
//             }
//         };
//         document.addEventListener('mousedown', handleClickOutside);
//         return () => document.removeEventListener('mousedown', handleClickOutside);
//     }, []);

//     return (
//         <div 
//             className={`modal-custom-dropdown ${disabled ? 'dropdown-disabled' : ''}`} 
//             onClick={() => !disabled && setIsOpen(!isOpen)}
//             ref={dropdownRef}
//         >
//             <div className="dropdown-toggle-modal">
//                 {currentValue || label}
//                 <FiChevronDown className={`dropdown-arrow-modal ${isOpen ? 'rotate' : ''}`} />
//             </div>
            
//             {isOpen && (
//                 <ul className="dropdown-menu-modal">
//                     {options.map((option) => (
//                         <li 
//                             key={option} 
//                             className={`dropdown-item-modal ${option === currentValue ? 'selected' : ''}`}
//                             onClick={(e) => {
//                                 e.stopPropagation();
//                                 onChange(option);
//                                 setIsOpen(false);
//                             }}
//                         >
//                             {option}
//                         </li>
//                     ))}
//                 </ul>
//             )}
//         </div>
//     );
// };

// const calculateDays = (start, end) => {
//     const startDate = dayjs(start);
//     const endDate = dayjs(end);

//     if (!startDate.isValid() || !endDate.isValid() || endDate.isBefore(startDate)) {
//         return null;
//     }

//     // +1 day to include the end date itself
//     return endDate.diff(startDate, 'day') + 1; 
// };


// // --- ApplyLeaveModal Component ---

// export const ApplyLeaveModal = ({ isOpen, onClose, onSubmit, initialRequests = [] }) => {
//     const [leaveType, setLeaveType] = useState('');
//     const [casualLeaveDuration, setCasualLeaveDuration] = useState('Full Day'); 
//     const [fromDate, setFromDate] = useState('');
//     const [toDate, setToDate] = useState('');
//     const [reason, setReason] = useState('');

//     // --- Dynamic Calculation ---
//     const totalDays = calculateDays(fromDate, toDate);
    
//     // Adjust total days for half day only if one day is selected
//     let finalDays = totalDays;
//     if (leaveType === 'Casual Leave' && casualLeaveDuration === 'Half Day' && totalDays === 1) {
//         finalDays = 0.5;
//     } else if (leaveType === 'Casual Leave' && casualLeaveDuration === 'Half Day' && totalDays > 1) {
//         // Reset duration if range is > 1 day, as Half Day typically applies to a single day
//         if (casualLeaveDuration !== 'Full Day') setCasualLeaveDuration('Full Day');
//     }


//     // --- Leave Limits Logic ---
//     const currentMonth = dayjs().format('YYYY-MM');
//     const casualLeaveCount = initialRequests.filter(req => 
//         req.type === 'Casual Leave' && dayjs(req.from).format('YYYY-MM') === currentMonth
//     ).length;

//     const isCasualLeaveDisabled = casualLeaveCount >= 2;

//     const leaveOptions = [
//         { label: 'Casual Leave', value: 'Casual Leave', disabled: isCasualLeaveDisabled }, 
//         { label: 'Sick Leave', value: 'Sick Leave' }, 
//         { label: 'Privilage Leave', value: 'Privilage Leave' }, 
//         { label: 'Work From Home', value: 'Work From Home' }
//     ].map(opt => opt.disabled ? `${opt.label} (Limit Reached)` : opt.label);

//     const casualDurationOptions = ['Full Day', 'Half Day'];


//     if (!isOpen) return null;

//     const handleSubmit = (e) => {
//         e.preventDefault();

//         // Final validation
//         if (!leaveType || finalDays === null || finalDays <= 0) {
//              alert("Please select a leave type and valid date range.");
//              return;
//         }

//         const requestData = { 
//             leaveType, 
//             fromDate, 
//             toDate, 
//             reason, 
//             calculatedDays: finalDays,
//             duration: leaveType === 'Casual Leave' ? casualLeaveDuration : 'Full Day' 
//         };
        
//         onSubmit(requestData); 
        
//         // Reset and close
//         setLeaveType('');
//         setCasualLeaveDuration('Full Day');
//         setFromDate('');
//         setToDate('');
//         setReason('');
//         onClose();
//     };


//     return (
//         <div className="modal-overlay">
//             <div className="modal-content">
//                 <div className="modal-header">
//                     <h2 className="modal-title">Apply for Leave</h2>
//                     <button className="modal-close-button" onClick={onClose}>
//                         <FiX />
//                     </button>
//                 </div>
//                 <p className="modal-subtext">Submit a new leave request</p>

//                 <form className="modal-form" onSubmit={handleSubmit}>
                    
//                     {/* LEAVE TYPE DROPDOWN */}
//                     <div className="form-group">
//                         <label className="form-label">Leave Type</label>
//                         <CustomDropdown
//                             options={leaveOptions}
//                             currentValue={leaveType}
//                             onChange={(option) => {
//                                 // Only update type if it's not the disabled warning label
//                                 if (!option.includes('(Limit Reached)')) {
//                                     setLeaveType(option);
//                                 }
//                             }}
//                             label="Select leave type"
//                         />
//                     </div>

//                     {/* CASUAL LEAVE DURATION DROPDOWN (Conditional) */}
//                     {leaveType === 'Casual Leave' && (
//                         <div className="form-group">
//                             <label className="form-label">Duration</label>
//                             <CustomDropdown
//                                 options={casualDurationOptions}
//                                 currentValue={casualLeaveDuration}
//                                 onChange={setCasualLeaveDuration}
//                                 label="Select duration"
//                                 // Disable half day if more than 1 day is selected
//                                 disabled={totalDays > 1}
//                             />
//                         </div>
//                     )}
                    
//                     {/* DATE INPUTS - FIXED LAYOUT */}
//                     <div className="form-group date-group">
//                         <div className="date-inputs">
                            
//                             {/* 1. FROM DATE BLOCK */}
//                             <div className="date-input-block"> 
//                                 <label className="form-label">From Date</label>
//                                 <div className="date-input-wrapper">
//                                     <input
//                                         type="date" 
//                                         value={fromDate}
//                                         onChange={(e) => setFromDate(e.target.value)}
//                                         className="date-input"
//                                         required
//                                     />
//                                     {/* <FiCalendar className="date-icon" />  */}
//                                 </div>
//                             </div>

//                             {/* 2. TO DATE BLOCK */}
//                             <div className="date-input-block">
//                                 <label className="form-label">To Date</label>
//                                 <div className="date-input-wrapper">
//                                     <input
//                                         type="date"
//                                         value={toDate}
//                                         onChange={(e) => setToDate(e.target.value)}
//                                         className="date-input"
//                                         required
//                                         min={fromDate} // Enforce valid range
//                                     />
//                                     {/* <FiCalendar className="date-icon" /> */}
//                                 </div>
//                             </div>
//                         </div>
//                     </div>

//                     {/* DAYS CALCULATED DISPLAY */}
//                     {finalDays !== null && finalDays > 0 && (
//                         <div className="form-group days-display">
//                             <label className="form-label">Calculated Days</label>
//                             <p className="days-value">{finalDays} Day{finalDays !== 1 ? 's' : ''}</p>
//                         </div>
//                     )}

//                     {/* REASON TEXTAREA */}
//                     <div className="form-group">
//                         <label className="form-label">Reason</label>
//                         <textarea
//                             placeholder="Enter reason for leave"
//                             value={reason}
//                             onChange={(e) => setReason(e.target.value)}
//                             className="reason-input"
//                             rows="3"
//                             required
//                         />
//                     </div>

//                     {/* FOOTER BUTTONS */}
//                     <div className="modal-footer">
//                         <button type="button" className="button button-cancel" onClick={onClose}>
//                             Cancel
//                         </button>
//                         <button type="submit" className="button button-submit">
//                             Submit Request
//                         </button>
//                     </div>
//                 </form>
//             </div>
//         </div>
//     );
// };


















// import React, { useState, useEffect, useRef } from 'react';
// import { FiX, FiChevronDown, FiCalendar } from 'react-icons/fi';
// import dayjs from 'dayjs'; 
// import './ApplyLeaveModal.css'; 

// const CustomDropdown = ({ options, currentValue, onChange, label, disabled = false }) => {
//     const [isOpen, setIsOpen] = useState(false);
//     const dropdownRef = useRef(null);

//     useEffect(() => {
//         const handleClickOutside = (event) => {
//             if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
//                 setIsOpen(false);
//             }
//         };
//         document.addEventListener('mousedown', handleClickOutside);
//         return () => document.removeEventListener('mousedown', handleClickOutside);
//     }, []);

//     return (
//         <div 
//             className={`modal-custom-dropdown ${disabled ? 'dropdown-disabled' : ''}`} 
//             onClick={() => !disabled && setIsOpen(!isOpen)}
//             ref={dropdownRef}
//         >
//             <div className="dropdown-toggle-modal">
//                 {currentValue || label}
//                 <FiChevronDown className={`dropdown-arrow-modal ${isOpen ? 'rotate' : ''}`} />
//             </div>
//             {isOpen && (
//                 <ul className="dropdown-menu-modal">
//                     {options.map((option) => (
//                         <li 
//                             key={option} 
//                             className={`dropdown-item-modal ${option === currentValue ? 'selected' : ''}`}
//                             onClick={(e) => {
//                                 e.stopPropagation();
//                                 onChange(option);
//                                 setIsOpen(false);
//                             }}
//                         >
//                             {option}
//                         </li>
//                     ))}
//                 </ul>
//             )}
//         </div>
//     );
// };

// export const ApplyLeaveModal = ({ isOpen, onClose, onSubmit, initialRequests = [] }) => {
//     const [leaveType, setLeaveType] = useState('');
//     const [casualLeaveDuration, setCasualLeaveDuration] = useState('Full Day'); 
//     const [optionalHoliday, setOptionalHoliday] = useState('');
//     const [fromDate, setFromDate] = useState('');
//     const [toDate, setToDate] = useState('');
//     const [reason, setReason] = useState('');

//     // --- Business Logic Checks ---
//     const currentMonth = dayjs().format('YYYY-MM');
//     const casualCountThisMonth = initialRequests.filter(req => 
//         req.type === 'Casual Leave' && dayjs(req.from).format('YYYY-MM') === currentMonth
//     ).length;
//     const hasUsedOptional = initialRequests.some(req => req.type === 'Optional Leave');

//     const leaveOptions = [
//         { label: 'Casual Leave', value: 'Casual Leave', disabled: casualCountThisMonth >= 2 },
//         { label: 'Privilege Leave', value: 'Privilege Leave', disabled: false },
//         { label: 'Optional Leave', value: 'Optional Leave', disabled: hasUsedOptional }
//     ].map(opt => opt.disabled ? `${opt.label} (Limit Reached)` : opt.label);

//     const holidayOptions = ['Gudi Padwa', 'Eid', 'Christmas'];
//     const casualDurationOptions = ['Full Day', 'Half Day'];

//     // --- Calculation Logic ---
//     const totalDiff = (fromDate && toDate) ? dayjs(toDate).diff(dayjs(fromDate), 'day') + 1 : 0;
//     const finalDays = (leaveType === 'Casual Leave' && casualLeaveDuration === 'Half Day' && totalDiff === 1) ? 0.5 : totalDiff;

//     if (!isOpen) return null;

//     const handleSubmit = (e) => {
//         e.preventDefault();
//         const finalReason = leaveType === 'Optional Leave' ? `Optional Holiday: ${optionalHoliday}` : reason;
        
//         onSubmit({ 
//             leaveType, 
//             fromDate, 
//             toDate, 
//             reason: finalReason, 
//             calculatedDays: finalDays 
//         });
        
//         setLeaveType('');
//         setFromDate('');
//         setToDate('');
//         setReason('');
//         setOptionalHoliday('');
//         onClose();
//     };

//     return (
//         <div className="modal-overlay">
//             <div className="modal-content">
//                 <div className="modal-header">
//                     <h2 className="modal-title">Apply for Leave</h2>
//                     <button className="modal-close-button" onClick={onClose}><FiX /></button>
//                 </div>

//                 <form className="modal-form" onSubmit={handleSubmit}>
//                     <div className="form-group">
//                         <label className="form-label">Leave Type</label>
//                         <CustomDropdown
//                             options={leaveOptions}
//                             currentValue={leaveType}
//                             onChange={(val) => !val.includes('Limit') && setLeaveType(val)}
//                             label="Select leave type"
//                         />
//                     </div>

//                     {leaveType === 'Casual Leave' && (
//                         <div className="form-group">
//                             <label className="form-label">Duration</label>
//                             <CustomDropdown
//                                 options={casualDurationOptions}
//                                 currentValue={casualLeaveDuration}
//                                 onChange={setCasualLeaveDuration}
//                                 label="Select duration"
//                                 disabled={totalDiff > 1}
//                             />
//                         </div>
//                     )}

//                     {leaveType === 'Optional Leave' && (
//                         <div className="form-group">
//                             <label className="form-label">Holiday Selection</label>
//                             <CustomDropdown
//                                 options={holidayOptions}
//                                 currentValue={optionalHoliday}
//                                 onChange={setOptionalHoliday}
//                                 label="Choose a holiday"
//                             />
//                         </div>
//                     )}

//                     <div className="form-group date-group">
//                         <div className="date-inputs">
//                             <div className="date-input-block">
//                                 <label className="form-label">From Date</label>
//                                 <div className="date-input-wrapper">
//                                     <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="date-input" required />
//                                     <FiCalendar className="date-icon" />
//                                 </div>
//                             </div>
//                             <div className="date-input-block">
//                                 <label className="form-label">To Date</label>
//                                 <div className="date-input-wrapper">
//                                     <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="date-input" required min={fromDate} />
//                                     <FiCalendar className="date-icon" />
//                                 </div>
//                             </div>
//                         </div>
//                     </div>

//                     <div className="form-group days-display">
//                         <label className="form-label">Total Days</label>
//                         <p className="days-value">{finalDays > 0 ? finalDays : 0} Day(s)</p>
//                     </div>

//                     <div className="form-group">
//                         <label className="form-label">Reason</label>
//                         <textarea
//                             placeholder="Reason for leave..."
//                             value={reason}
//                             onChange={(e) => setReason(e.target.value)}
//                             className="reason-input"
//                             rows="3"
//                             required={leaveType !== 'Optional Leave'}
//                         />
//                     </div>

//                     <div className="modal-footer">
//                         <button type="button" className="button button-cancel" onClick={onClose}>Cancel</button>
//                         <button type="submit" className="button button-submit">Submit Request</button>
//                     </div>
//                 </form>
//             </div>
//         </div>
//     );
// };


import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { FiX, FiChevronDown } from 'react-icons/fi';
import dayjs from 'dayjs'; 
import './ApplyLeaveModal.css';
import { formatDate } from '../../utils/dateFormat';

const LEAVE_API_BASE = '/api/leave';

const formatOptionalHolidayLabel = (holiday) =>
    `${holiday.holiday_name} (${formatDate(holiday.holiday_date)})`;

const buildOptionalLeaveReason = (holiday) =>
    `Optional leave requested for ${holiday.holiday_name} on ${formatDate(holiday.holiday_date)}.`;

const OPTIONAL_LEAVE_ACTIVE_STATUSES = ['Pending', 'Approved'];

const hasOptionalLeaveForYear = (requests, year) =>
    requests.some(
        (req) =>
            req.type === 'Optional Leave' &&
            OPTIONAL_LEAVE_ACTIVE_STATUSES.includes(req.status) &&
            dayjs(req.from).year() === year
    ); 

// --- Custom Dropdown Component ---
const CustomDropdown = ({ options, currentValue, onChange, label, disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div 
            className={`modal-custom-dropdown ${disabled ? 'dropdown-disabled' : ''}`} 
            onClick={() => !disabled && setIsOpen(!isOpen)}
            ref={dropdownRef}
        >
            <div className="dropdown-toggle-modal">
                {currentValue || label}
                <FiChevronDown className={`dropdown-arrow-modal ${isOpen ? 'rotate' : ''}`} />
            </div>
            {isOpen && (
                <ul className="dropdown-menu-modal">
                    {options.map((option) => (
                        <li 
                            key={option} 
                            className={`dropdown-item-modal ${option.includes('Reached') || option.includes('Used') ? 'disabled-option' : ''} ${option === currentValue ? 'selected' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!option.includes('Reached') && !option.includes('Used')) {
                                    onChange(option);
                                    setIsOpen(false);
                                }
                            }}
                        >
                            {option}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export const ApplyLeaveModal = ({ isOpen, onClose, onSubmit, initialRequests = [] }) => {
    const [leaveType, setLeaveType] = useState('');
    const [casualLeaveDuration, setCasualLeaveDuration] = useState('Full Day'); 
    const [optionalHoliday, setOptionalHoliday] = useState('');
    const [optionalHolidays, setOptionalHolidays] = useState([]);
    const [optionalHolidaysLoading, setOptionalHolidaysLoading] = useState(false);
    const [optionalHolidaysError, setOptionalHolidaysError] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [reason, setReason] = useState('');

    // --- Limit Logic ---
    const currentMonth = dayjs().format('YYYY-MM');
    
    // Check Casual Leave Count (Max 2 per month)
    const casualCount = initialRequests.filter(req => 
        req.type === 'Casual Leave' && dayjs(req.from).format('YYYY-MM') === currentMonth
    ).length;

    const currentYear = dayjs().year();
    const hasUsedOptional = hasOptionalLeaveForYear(initialRequests, currentYear);

    const leaveOptions = [
        { label: 'Casual Leave', value: 'Casual Leave', disabled: casualCount >= 2 },
        { label: 'Privilege Leave', value: 'Privilege Leave', disabled: false },
        { label: 'Compensatory Leave', value: 'Compensatory Leave', disabled: false },
        { label: 'Optional Leave', value: 'Optional Leave', disabled: hasUsedOptional }
    ].map(opt => {
        if (opt.value === 'Optional Leave' && opt.disabled) return "Optional Leave (Already Used)";
        if (opt.value === 'Casual Leave' && opt.disabled) return "Casual Leave (Monthly Limit Reached)";
        return opt.label;
    });

    const holidayOptions = useMemo(
        () => optionalHolidays.map(formatOptionalHolidayLabel),
        [optionalHolidays]
    );
    const casualDurationOptions = ['Full Day', 'Half Day'];

    const resetOptionalLeaveFields = useCallback(() => {
        setOptionalHoliday('');
        setOptionalHolidays([]);
        setOptionalHolidaysError('');
        setFromDate('');
        setToDate('');
        setReason('');
    }, []);

    const handleLeaveTypeChange = (type) => {
        if (type.includes('Already Used') || type.includes('Limit')) {
            return;
        }
        if (type === 'Optional Leave' && hasUsedOptional) {
            alert(`You have already used your optional leave for ${currentYear}. Only one optional leave is allowed per year.`);
            return;
        }
        if (type !== 'Optional Leave') {
            resetOptionalLeaveFields();
        }
        setLeaveType(type);
    };

    const handleOptionalHolidaySelect = (label) => {
        setOptionalHoliday(label);
        const holiday = optionalHolidays.find(
            (item) => formatOptionalHolidayLabel(item) === label
        );
        if (!holiday) return;

        setFromDate(holiday.holiday_date);
        setToDate(holiday.holiday_date);
        setReason(buildOptionalLeaveReason(holiday));
    };

    const isHalfDay =
        leaveType === 'Casual Leave' && casualLeaveDuration === 'Half Day';
    const isSingleDayLeave = isHalfDay || leaveType === 'Optional Leave';
    const todayStr = dayjs().format('YYYY-MM-DD');

    // --- Day Calculation ---
    const totalDiff = (fromDate && toDate) ? dayjs(toDate).diff(dayjs(fromDate), 'day') + 1 : 0;
    let finalDays = isHalfDay && totalDiff === 1 ? 0.5 : (totalDiff > 0 ? totalDiff : 0);

    if (leaveType === 'Optional Leave' && totalDiff > 1) {
        finalDays = 0;
    }

    const minFromDate = todayStr;
    const minToDate = fromDate || todayStr;

    useEffect(() => {
        if (!isOpen) return;
        if (isSingleDayLeave && fromDate) {
            setToDate(fromDate);
        }
    }, [isOpen, isSingleDayLeave, fromDate]);

    useEffect(() => {
        if (!isOpen || leaveType !== 'Optional Leave') return;

        const token = localStorage.getItem('token');
        if (!token) {
            setOptionalHolidaysError('Please login again to load optional holidays.');
            return;
        }

        const year = dayjs().year();
        let cancelled = false;

        const loadOptionalHolidays = async () => {
            setOptionalHolidaysLoading(true);
            setOptionalHolidaysError('');
            try {
                const response = await fetch(
                    `${LEAVE_API_BASE}/optional-holidays?year=${year}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    }
                );
                const result = await response.json();
                if (cancelled) return;

                if (!response.ok || !result.success) {
                    setOptionalHolidays([]);
                    setOptionalHolidaysError(result.message || 'Failed to load optional holidays.');
                    return;
                }

                if (result.optional_leave_used) {
                    setOptionalHolidays([]);
                    setOptionalHolidaysError(
                        `You have already used your optional leave for ${year}. Only one optional leave is allowed per year.`
                    );
                    return;
                }

                const selectable = result.selectable_holidays || [];
                setOptionalHolidays(selectable);
                if (!selectable.length) {
                    setOptionalHolidaysError('No optional holidays are available to apply for this year.');
                }
            } catch {
                if (!cancelled) {
                    setOptionalHolidays([]);
                    setOptionalHolidaysError('Failed to load optional holidays. Please try again.');
                }
            } finally {
                if (!cancelled) {
                    setOptionalHolidaysLoading(false);
                }
            }
        };

        loadOptionalHolidays();
        return () => {
            cancelled = true;
        };
    }, [isOpen, leaveType]);

    const handleFromDateChange = (value) => {
        setFromDate(value);
        if (isSingleDayLeave) {
            setToDate(value);
            return;
        }
        if (toDate && dayjs(toDate).isBefore(value)) {
            setToDate(value);
        }
    };

    const handleToDateChange = (value) => {
        if (isHalfDay) {
            setToDate(fromDate || value);
            return;
        }
        setToDate(value);
    };

    const handleDurationChange = (duration) => {
        setCasualLeaveDuration(duration);
        if (duration === 'Half Day' && fromDate) {
            setToDate(fromDate);
        }
    };

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Prevent submission if logic is bypassed
        if (leaveType.includes('Used') || leaveType.includes('Limit')) {
            alert("This leave type is not available.");
            return;
        }

        if (fromDate && dayjs(fromDate).isBefore(todayStr, 'day')) {
            alert("Start date cannot be in the past.");
            return;
        }
        if (toDate && dayjs(toDate).isBefore(todayStr, 'day')) {
            alert("End date cannot be in the past.");
            return;
        }
        if (toDate && fromDate && dayjs(toDate).isBefore(fromDate, 'day')) {
            alert("End date cannot be before start date.");
            return;
        }

        if (isHalfDay) {
            if (!fromDate) {
                alert("Please select a date for Half Day leave.");
                return;
            }
            if (toDate !== fromDate) {
                alert("Half Day leave can only be applied for a single date.");
                return;
            }
        }

        // Validate Optional Leave requirements
        if (leaveType === 'Optional Leave') {
            if (hasUsedOptional) {
                alert(`You have already used your optional leave for ${currentYear}. Only one optional leave is allowed per year.`);
                return;
            }
            if (optionalHolidaysLoading) {
                alert("Optional holidays are still loading. Please wait.");
                return;
            }
            if (!optionalHoliday) {
                alert("Please select a holiday for Optional Leave.");
                return;
            }
            if (!fromDate || !toDate || totalDiff > 1 || toDate !== fromDate) {
                alert("Optional Leave can only be applied for one day.");
                return;
            }
            if (!reason || reason.trim().length < 20) {
                alert("Reason is required for Optional Leave.");
                return;
            }
        }

        const finalReason = leaveType === 'Optional Leave' ? reason.trim() : reason;
        
        // Call parent onSubmit (which will handle API call)
        const success = await onSubmit({ 
            leaveType, 
            fromDate, 
            toDate, 
            reason: finalReason, 
            calculatedDays: finalDays 
        });
        
        // Only reset and close if submission was successful
        if (success) {
            setLeaveType('');
            setCasualLeaveDuration('Full Day');
            setFromDate('');
            setToDate('');
            setReason('');
            resetOptionalLeaveFields();
            onClose();
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h2 className="modal-title">Apply for Leave</h2>
                    <button className="modal-close-button" onClick={onClose}><FiX /></button>
                </div>

                <form id="apply-leave-form" className="modal-form" onSubmit={handleSubmit}>
                    <div className="modal-form-scroll">
                    <div className="form-group">
                        <label className="form-label">Leave Type</label>
                        <CustomDropdown
                            options={leaveOptions}
                            currentValue={leaveType}
                            onChange={handleLeaveTypeChange}
                            label="Select leave type"
                        />
                    </div>

                    {leaveType === 'Casual Leave' && (
                        <div className="form-group">
                            <label className="form-label">Duration</label>
                            <CustomDropdown
                                options={casualDurationOptions}
                                currentValue={casualLeaveDuration}
                                onChange={handleDurationChange}
                                label="Select duration"
                            />
                        </div>
                    )}

                    {leaveType === 'Optional Leave' && (
                        <div className="form-group">
                            <label className="form-label">Select Holiday</label>
                            <CustomDropdown
                                options={holidayOptions}
                                currentValue={optionalHoliday}
                                onChange={handleOptionalHolidaySelect}
                                label={
                                    optionalHolidaysLoading
                                        ? 'Loading holidays...'
                                        : holidayOptions.length
                                            ? 'Choose a holiday'
                                            : 'No holidays available'
                                }
                                disabled={optionalHolidaysLoading || !holidayOptions.length}
                            />
                            {optionalHolidaysError && (
                                <p className="optional-holiday-hint">{optionalHolidaysError}</p>
                            )}
                        </div>
                    )}

                    <div className="form-group date-group">
                        <div className="date-inputs">
                            <div className="date-input-block">
                                <label className="form-label">
                                    {isSingleDayLeave ? 'Date' : 'From Date'}
                                </label>
                                <div className="date-input-wrapper">
                                    <input
                                        type="date"
                                        value={fromDate}
                                        onChange={(e) => handleFromDateChange(e.target.value)}
                                        className="date-input"
                                        required
                                        min={minFromDate}
                                        readOnly={leaveType === 'Optional Leave'}
                                        disabled={leaveType === 'Optional Leave' && !optionalHoliday}
                                    />
                                </div>
                            </div>
                            {!isSingleDayLeave && (
                                <div className="date-input-block">
                                    <label className="form-label">To Date</label>
                                    <div className="date-input-wrapper">
                                        <input
                                            type="date"
                                            value={toDate}
                                            onChange={(e) => handleToDateChange(e.target.value)}
                                            className="date-input"
                                            required
                                            min={minToDate}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="form-group days-display">
                        <label className="form-label">Total Days</label>
                        <p className="days-value">{finalDays} Day(s)</p>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Reason</label>
                        <textarea
                            placeholder={
                                leaveType === 'Optional Leave'
                                    ? 'Select a holiday to auto-fill reason'
                                    : 'Reason for leave...'
                            }
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="reason-input"
                            rows="3"
                            required
                            readOnly={leaveType === 'Optional Leave'}
                        />
                    </div>
                    </div>
                </form>

                <div className="modal-footer">
                    <button type="button" className="button button-cancel" onClick={onClose}>Cancel</button>
                    <button type="submit" form="apply-leave-form" className="button button-submit">Submit Request</button>
                </div>
            </div>
        </div>
    );
};