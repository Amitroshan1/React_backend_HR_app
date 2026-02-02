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













import React, { useState, useMemo } from 'react';
import { FiBriefcase, FiStar, FiPlus } from 'react-icons/fi';
import { ApplyLeaveModal } from './ApplyLeaveModal';
import './Leaves.css';

// Fixed Entitlements (These would come from an API in the future)
const ENTITLEMENTS = {
    casual: 12,
    privilege: 15
};

const INITIAL_REQUESTS = [
    // { type: 'Casual Leave', from: '2024-01-20', to: '2024-01-20', days: 1, reason: 'Personal', status: 'Approved' },
   
];

export const Leaves= () => {
    const [requests, setRequests] = useState(INITIAL_REQUESTS);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Dynamic Calculation of Balances
    const stats = useMemo(() => {
        const usedCasual = requests
            .filter(r => r.type === 'Casual Leave' && r.status !== 'Rejected')
            .reduce((sum, r) => sum + r.days, 0);

        const usedPrivilege = requests
            .filter(r => r.type === 'Privilege Leave' && r.status !== 'Rejected')
            .reduce((sum, r) => sum + r.days, 0);

        return [
            { 
                type: 'Casual Leave', 
                value: ENTITLEMENTS.casual - usedCasual, 
                subtext: `${usedCasual} used this year`, 
                icon: <FiBriefcase />, 
                colorClass: 'green-card'
            },
            { 
                type: 'Privilege Leave', 
                value: ENTITLEMENTS.privilege - usedPrivilege, 
                subtext: `${usedPrivilege} used this year`, 
                icon: <FiStar />, 
                colorClass: 'blue-card'
            }
        ];
    }, [requests]);

    const handleLeaveSubmit = (requestData) => {
        const newRequest = {
            type: requestData.leaveType,
            from: requestData.fromDate,
            to: requestData.toDate,
            days: requestData.calculatedDays,
            reason: requestData.reason,
            status: 'Pending'
        };
        setRequests(prev => [newRequest, ...prev]);
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
                    <table className="leave-requests-table">
                        <thead>
                            <tr>
                                <th>TYPE</th>
                                <th>FROM</th>
                                <th>TO</th>
                                <th>DAYS</th>
                                <th>STATUS</th>
                            </tr>
                        </thead>
                        <tbody>
                            {requests.map((request, index) => (
                                <tr key={index}>
                                    <td>{request.type}</td>
                                    <td>{request.from}</td>
                                    <td>{request.to}</td>
                                    <td>{request.days}</td>
                                    <td>
                                        <span className={`status-badge status-${request.status.toLowerCase()}`}>
                                            {request.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
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