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


import React, { useState, useEffect, useRef } from 'react';
import { FiX, FiChevronDown } from 'react-icons/fi';
import dayjs from 'dayjs'; 
import './ApplyLeaveModal.css'; 

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
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [reason, setReason] = useState('');

    // --- Limit Logic ---
    const currentMonth = dayjs().format('YYYY-MM');
    
    // Check Casual Leave Count (Max 2 per month)
    const casualCount = initialRequests.filter(req => 
        req.type === 'Casual Leave' && dayjs(req.from).format('YYYY-MM') === currentMonth
    ).length;

    // Check Optional Leave Count (Max 1 per year/total)
    const hasUsedOptional = initialRequests.some(req => req.type === 'Optional Leave');

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

    const holidayOptions = ['Gudi Padwa', 'Eid', 'Christmas'];
    const casualDurationOptions = ['Full Day', 'Half Day'];

    // --- Day Calculation ---
    const totalDiff = (fromDate && toDate) ? dayjs(toDate).diff(dayjs(fromDate), 'day') + 1 : 0;
    let finalDays = (leaveType === 'Casual Leave' && casualLeaveDuration === 'Half Day' && totalDiff === 1) ? 0.5 : (totalDiff > 0 ? totalDiff : 0);
    
    // Optional Leave can only be 1 day
    if (leaveType === 'Optional Leave' && totalDiff > 1) {
        finalDays = 0; // Will trigger validation error
    }

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Prevent submission if logic is bypassed
        if (leaveType.includes('Used') || leaveType.includes('Limit')) {
            alert("This leave type is not available.");
            return;
        }

        // Validate Optional Leave requirements
        if (leaveType === 'Optional Leave') {
            if (!optionalHoliday) {
                alert("Please select a holiday for Optional Leave.");
                return;
            }
            if (totalDiff > 1) {
                alert("Optional Leave can only be applied for one day.");
                return;
            }
        }

        const finalReason = leaveType === 'Optional Leave' ? `Holiday: ${optionalHoliday}` : reason;
        
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
            setOptionalHoliday('');
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

                <form className="modal-form" onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label className="form-label">Leave Type</label>
                        <CustomDropdown
                            options={leaveOptions}
                            currentValue={leaveType}
                            onChange={setLeaveType}
                            label="Select leave type"
                        />
                    </div>

                    {leaveType === 'Casual Leave' && (
                        <div className="form-group">
                            <label className="form-label">Duration</label>
                            <CustomDropdown
                                options={casualDurationOptions}
                                currentValue={casualLeaveDuration}
                                onChange={setCasualLeaveDuration}
                                label="Select duration"
                                disabled={totalDiff > 1}
                            />
                        </div>
                    )}

                    {leaveType === 'Optional Leave' && (
                        <div className="form-group">
                            <label className="form-label">Select Holiday</label>
                            <CustomDropdown
                                options={holidayOptions}
                                currentValue={optionalHoliday}
                                onChange={setOptionalHoliday}
                                label="Choose a holiday"
                            />
                        </div>
                    )}

                    <div className="form-group date-group">
                        <div className="date-inputs">
                            <div className="date-input-block">
                                <label className="form-label">From Date</label>
                                <div className="date-input-wrapper">
                                    <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="date-input" required />
                                </div>
                            </div>
                            <div className="date-input-block">
                                <label className="form-label">To Date</label>
                                <div className="date-input-wrapper">
                                    <input 
                                        type="date" 
                                        value={toDate} 
                                        onChange={(e) => setToDate(e.target.value)} 
                                        className="date-input" 
                                        required 
                                        min={leaveType === 'Optional Leave' ? fromDate : fromDate}
                                        max={leaveType === 'Optional Leave' ? fromDate : undefined}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="form-group days-display">
                        <label className="form-label">Total Days</label>
                        <p className="days-value">{finalDays} Day(s)</p>
                    </div>

                    {leaveType !== 'Optional Leave' && (
                        <div className="form-group">
                            <label className="form-label">Reason</label>
                            <textarea
                                placeholder="Reason for leave..."
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                className="reason-input"
                                rows="3"
                                required
                            />
                        </div>
                    )}

                    <div className="modal-footer">
                        <button type="button" className="button button-cancel" onClick={onClose}>Cancel</button>
                        <button type="submit" className="button button-submit">Submit Request</button>
                    </div>
                </form>
            </div>
        </div>
    );
};