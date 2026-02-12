// // src/pages/Leave/LeaveDashboard.jsx - UPDATED SUMMARY CARD STYLE
// import React, { useState, useMemo } from 'react';
// import { 
//     FiCalendar, 
//     FiBriefcase, 
//     FiHeart, 
//     FiHome, 
//     FiPlus 
// } from 'react-icons/fi';

// import { MdOutlineWatchLater } from 'react-icons/md'; 
// import { ApplyLeaveModal } from './ApplyLeaveModal';
// import './Leaves.css';

// // --- Placeholder Data Structure ---
// // NOTE: I've added a 'class' property to assign specific colors/classes.
// const INITIAL_LEAVE_DATA = {
//     summary: [
//         { 
//             type: 'Total Balance', 
//             value: 12, 
//             subtext: '7 Days remaining', 
//             icon: <FiCalendar />, 
//             colorClass: 'blue-card' // Use class for styling
//         },
//         { 
//             type: 'Casual Leave', 
//             value: 8, 
//             subtext: '3 used', 
//             icon: <FiBriefcase />, 
//             colorClass: 'green-card'
//         },
//         { 
//             type: 'Sick Leave', 
//             value: 4, 
//             subtext: '2 used', 
//             icon: <FiHeart />, 
//             colorClass: 'orange-card'
//         },
//         { 
//             type: 'WFH Days', 
//             value: 5, 
//             subtext: '10 used', 
//             icon: <FiHome />, 
//             colorClass: 'yellow-card' // Using yellow for WFH
//         },
//     ],
//     requests: [
//         { type: 'Casual Leave', from: '1/20/2024', to: '1/23/2024', days: 3, reason: 'Family function', status: 'Approved' },
//         { type: 'Work From Home', from: '1/18/2024', to: '1/18/2024', days: 1, reason: 'Medical appointment', status: 'Pending' },
//         { type: 'Sick Leave', from: '1/10/2024', to: '1/11/2024', days: 2, reason: 'Fever', status: 'Approved' },
//         { type: 'Casual Leave', from: '1/5/2024', to: '1/5/2024', days: 1, reason: 'Personal work', status: 'Rejected' },
//     ]
// };

// export const Leaves = () => {
    
//     const [data, setData] = useState(INITIAL_LEAVE_DATA);
//     const [isModalOpen, setIsModalOpen] = useState(false);

//     // --- UPDATED renderSummaryCard function to match the new look ---
//     const renderSummaryCard = (item) => (
//         <div className={`summary-card-leave ${item.colorClass}`}>
//             <div className="summary-icon-leave">{item.icon}</div>
//             <div className="summary-content-leave">
//                 {/* Value is larger and prominent */}
//                 <p className="summary-value-leave">{item.value}</p> 
//                 <p className="summary-label-leave">{item.type}</p>
//                 {/* Subtext remains small */}
//                 <p className="summary-subtext-leave">{item.subtext}</p> 
//             </div>
//         </div>
//     );
//     // -----------------------------------------------------------------

//     const getStatusClass = (status) => {
//         switch (status) {
//             case 'Approved': return 'status-approved';
//             case 'Pending': return 'status-pending';
//             case 'Rejected': return 'status-rejected';
//             default: return 'status-default';
//         }
//     };
    

// const handleLeaveSubmit = (requestData) => {
//         console.log('New Leave Request Submitted:', requestData);
        
//         // Use calculatedDays from requestData
//         const newRequest = {
//             type: requestData.leaveType,
//             from: requestData.fromDate,
//             to: requestData.toDate,
//             days: requestData.calculatedDays, // Use calculated days
//             reason: requestData.reason,
//             status: 'Pending'
//         };
//         setData(prevData => ({
//             ...prevData,
//             requests: [newRequest, ...prevData.requests]
//         }));
//     };



//     return (
//         <div className="leave-dashboard-container">
            
//             <div className="summary-cards-grid-leave">
//                 {data.summary.map((item, index) => (
//                     <div key={index}>
//                          {renderSummaryCard(item)}
//                     </div>
//                 ))}
//             </div>

//             {/* 2. LEAVE REQUESTS TABLE */}
//             <div className="leave-requests-card card">
//                 <div className="requests-header-row">
//                     <h2 className="section-title-leave">Leave Requests</h2>
//                     <button className="apply-leave-button" onClick={() => setIsModalOpen(true)}>
//                         <FiPlus /> Apply Leave
//                     </button>
//                 </div>
//                 <p className="table-subtext">Your leave history and pending requests</p>

//                 <div className="leave-table-container">
//                     <table className="leave-requests-table">
//                         <thead>
//                             <tr>
//                                 <th>TYPE</th>
//                                 <th>FROM</th>
//                                 <th>TO</th>
//                                 <th className="days-col">DAYS</th>
//                                 <th className="reason-col">REASON</th>
//                                 <th>STATUS</th>
//                             </tr>
//                         </thead>
//                         <tbody>
//                             {data.requests.map((request, index) => (
//                                 <tr key={index}>
//                                     <td>{request.type}</td>
//                                     <td>{request.from}</td>
//                                     <td>{request.to}</td>
//                                     <td className="days-col">{request.days}</td>
//                                     <td className="reason-col">{request.reason}</td>
//                                     <td>
//                                         <span className={`status-badge ${getStatusClass(request.status)}`}>
//                                             {request.status}
//                                         </span>
//                                     </td>
//                                 </tr>
//                             ))}
//                         </tbody>
//                     </table>
//                 </div>
//             </div>
            
//             {/* 3. APPLY LEAVE MODAL */}
//             <ApplyLeaveModal

//             isOpen={isModalOpen}
//                 onClose={() => setIsModalOpen(false)}
//                 onSubmit={handleLeaveSubmit}
//                 initialRequests={data.requests}
//                 // isOpen={isModalOpen}
//                 // onClose={() => setIsModalOpen(false)}
//                 // onSubmit={handleLeaveSubmit}
//             />
            
//         </div>
//     );
// };













import React, { useState, useMemo, useEffect } from 'react';
import { FiBriefcase, FiStar, FiPlus } from 'react-icons/fi';
import { ApplyLeaveModal } from './ApplyLeaveModal';
import './Leaves.css';
import { useUser } from '../../components/layout/UserContext';

const API_BASE_URL = "http://localhost:5000/api/leave";

export const Leaves= () => {
    const { userData, refreshUserData } = useUser();
    const [requests, setRequests] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loadingRequests, setLoadingRequests] = useState(true);

    // Dynamic Calculation of Balances based on backend leave_balance
    const stats = useMemo(() => {
        const lb = userData.leave_balance || {};

        // Remaining/Pending balances from backend (what's left to use)
        const remainingPl = Number(lb.pl ?? 0);
        const remainingCl = Number(lb.cl ?? 0);
        const remainingComp = Number(lb.comp ?? 0);

        // Total entitlements from backend (fixed totals - e.g., CL=8, PL=13)
        const totalPl = Number(lb.total_pl ?? 0);
        const totalCl = Number(lb.total_cl ?? 0);
        const totalComp = Number(lb.total_comp ?? 0);

        // Used values from backend (how much has been used from total)
        const usedCasual = Number(lb.used_cl ?? 0);
        const usedPrivilege = Number(lb.used_pl ?? 0);
        const usedComp = Number(lb.used_comp ?? 0);

        return [
            { 
                type: 'Casual Leave', 
                value: remainingCl,  // Big number: Show remaining/pending (e.g., 5)
                subtext: `Total ${totalCl}, Used ${usedCasual}`,  // Subtext: Total entitlement (8) and how much used
                icon: <FiBriefcase />, 
                colorClass: 'green-card'
            },
            { 
                type: 'Privilege Leave', 
                value: remainingPl,  // Big number: Show remaining/pending (e.g., 11)
                subtext: `Total ${totalPl}, Used ${usedPrivilege}`,  // Subtext: Total entitlement (13) and how much used
                icon: <FiStar />, 
                colorClass: 'blue-card'
            },
            {
                type: 'Compensatory Leave',
                value: remainingComp,  // Big number: Show remaining/pending
                subtext: `Total ${totalComp}, Used ${usedComp}`,  // Subtext: Total entitlement and how much used
                icon: <FiBriefcase />,
                colorClass: 'orange-card'
            }
        ];
    }, [userData.leave_balance]);

    // Fetch leave requests from backend
    const fetchLeaveRequests = async () => {
        const token = localStorage.getItem('token');
        if (!token) {
            setLoadingRequests(false);
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/LeaveDetails`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error("API Error Response:", errorText);
                throw new Error(`Failed to fetch leave requests: ${response.status}`);
            }

            const result = await response.json();
            console.log("Leave Details API Response:", result); // Debug log

            if (result.success) {
                if (result.applications && Array.isArray(result.applications)) {
                    // Transform backend format to frontend format
                    const formattedRequests = result.applications.map(app => ({
                        id: app.id,
                        type: app.leave_type || 'Unknown',
                        from: app.start_date || '',
                        to: app.end_date || '',
                        days: app.deducted_days || 0,
                        reason: app.reason || '',
                        status: app.status || 'Pending'
                    }));
                    console.log("Formatted Requests:", formattedRequests); // Debug log
                    setRequests(formattedRequests);
                } else {
                    console.warn("No applications array in response:", result);
                    setRequests([]);
                }
            } else {
                console.error("API returned success=false:", result.message);
                setRequests([]);
            }
        } catch (err) {
            console.error("Error fetching leave requests:", err);
            setRequests([]);
        } finally {
            setLoadingRequests(false);
        }
    };

    // Fetch leave requests on component mount
    useEffect(() => {
        fetchLeaveRequests();
    }, []);

    const handleLeaveSubmit = async (requestData) => {
        const token = localStorage.getItem('token');
        if (!token) {
            alert("Please login again");
            return false; // Return false to prevent modal from closing
        }

        try {
            // Map frontend leave types to backend format
            let backendLeaveType = requestData.leaveType;
            if (requestData.leaveType === 'Casual Leave' && requestData.calculatedDays === 0.5) {
                backendLeaveType = 'Half Day Leave';
            }
            // Optional Leave is now supported - no special mapping needed

            const requestPayload = {
                leave_type: backendLeaveType,
                start_date: requestData.fromDate,
                end_date: requestData.toDate,
                reason: requestData.reason
            };
            
            console.log("Submitting leave application:", requestPayload); // Debug log
            
            const response = await fetch(`${API_BASE_URL}/apply`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestPayload)
            });

            const result = await response.json();

            if (!response.ok) {
                alert(result.message || "Failed to apply leave");
                return false; // Return false to prevent modal from closing
            }

            if (result.success) {
                console.log("Leave applied successfully:", result); // Debug log
                // Refresh leave requests list and user data (to update balances)
                // Add small delay to ensure DB commit is complete
                await new Promise(resolve => setTimeout(resolve, 500));
                await fetchLeaveRequests();
                await refreshUserData();
                // Notify attendance page to refresh
                window.dispatchEvent(new CustomEvent('leaveApplied'));
                alert("Leave applied successfully!");
                return true; // Return true to allow modal to close
            } else {
                console.error("Leave application failed:", result); // Debug log
            }
            return false;
        } catch (err) {
            console.error("Error applying leave:", err);
            alert("Failed to apply leave. Please try again.");
            return false; // Return false to prevent modal from closing
        }
    };

    return (
        <div className="leave-dashboard-container">
            {/* <h1 className="page-title-leave">Leave Management</h1> */}

            <div className="summary-cards-grid-leave">
                {stats.map((item, index) => (
                    <div key={index} className={`summary-card-leave ${item.colorClass}`}>
                        <div className="summary-icon-leave">{item.icon}</div>
                        <div className="summary-content-leave">
                            <p className="summary-value-leave">{item.value}</p> 
                            <p className="summary-label-leave">{item.type}</p>
                            <p className="summary-subtext-leave">{item.subtext}</p> 
                        </div>
                    </div>
                ))}
            </div>

            <div className="leave-requests-card">
                <div className="requests-header-row">
                    <h2 className="section-title-leave">Leave Requests</h2>
                    <button className="apply-leave-button" onClick={() => setIsModalOpen(true)}>
                        <FiPlus /> Apply Leave
                    </button>
                </div>
                <div className="leave-table-container">
                    {loadingRequests ? (
                        <p style={{ textAlign: 'center', padding: '20px' }}>Loading leave requests...</p>
                    ) : requests.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
                            No leave requests found. Click "Apply Leave" to submit a new request.
                        </p>
                    ) : (
                        <table className="leave-requests-table">
                            <thead>
                                <tr>
                                    <th>TYPE</th>
                                    <th>FROM</th>
                                    <th>TO</th>
                                    <th>DAYS</th>
                                    <th>REASON</th>
                                    <th>STATUS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {requests.map((request) => (
                                    <tr key={request.id}>
                                        <td>{request.type}</td>
                                        <td>{request.from}</td>
                                        <td>{request.to}</td>
                                        <td>{request.days}</td>
                                        <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {request.reason}
                                        </td>
                                        <td>
                                            <span className={`status-badge status-${request.status.toLowerCase()}`}>
                                                {request.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
            
            <ApplyLeaveModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleLeaveSubmit}
                initialRequests={requests}
            />
        </div>
    );
};