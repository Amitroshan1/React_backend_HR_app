// import React, { useState } from 'react';
// import {Card} from './ui/Card';
// import {Toast} from './ui/Toast'; // Make sure you created this file
// import './Wfh.css';

// export const Wfh = () => {
//   const [requests, setRequests] = useState([]);
//   const [form, setForm] = useState({ from: '', to: '', reason: '' });
  
//   // New State for Toast
//   const [toast, setToast] = useState({ show: false, message: '' });

//   const today = new Date().toISOString().split('T')[0];

//   const isFormValid = form.from !== '' && form.to !== '' && form.reason.trim().length > 0;

//   const handleFromChange = (e) => {
//     const selectedFrom = e.target.value;
//     let updatedTo = form.to;
//     if (form.to && selectedFrom > form.to) {
//       updatedTo = '';
//     }
//     setForm({ ...form, from: selectedFrom, to: updatedTo });
//   };

//   const handleSubmit = (e) => {
//     e.preventDefault();
//     if (!isFormValid) return;

//     const newEntry = {
//       ...form,
//       id: Date.now(),
//       appliedOn: new Date().toLocaleDateString(),
//       status: 'Pending'
//     };
    
//     setRequests([newEntry, ...requests]);
//     setForm({ from: '', to: '', reason: '' });

//     // Trigger Success Toast
//     setToast({ show: true, message: 'WFH Request submitted successfully!' });
//   };

//   return (
//     <div className="wfh-page">
//       {/* 1. Render Toast if active */}
//       {toast.show && (
//         <Toast 
//           message={toast.message} 
//           type="success" 
//           onClose={() => setToast({ ...toast, show: false })} 
//         />
//       )}

//       <Card title="Apply for Work From Home">
//         <form className="wfh-form" onSubmit={handleSubmit}>
//           <div className="form-row">
//             <div className="input-group">
//               <label>From Date</label>
//               <input 
//                 type="date" 
//                 value={form.from}
//                 min={today}
//                 onChange={handleFromChange} 
//               />
//             </div>
//             <div className="input-group">
//               <label>To Date</label>
//               <input 
//                 type="date" 
//                 value={form.to}
//                 min={form.from || today} 
//                 onChange={e => setForm({...form, to: e.target.value})} 
//               />
//             </div>
//           </div>
//           <div className="input-group">
//             <label>Reason</label>
//             <textarea 
//               placeholder="Enter reason for work from home..."
//               value={form.reason}
//               onChange={e => setForm({...form, reason: e.target.value})}
//             />
//           </div>
          
//           <button 
//             type="submit" 
//             className="btn-submit" 
//             disabled={!isFormValid}
//           >
//             Submit Request
//           </button>
//         </form>
//       </Card>

//       <div className="requests-section u-mt-2">
//         <Card title="Your WFH Requests">
//           <div className="table-container">
//             <table className="data-table">
//               <thead>
//                 <tr>
//                   <th>From Date</th>
//                   <th>To Date</th>
//                   <th>Reason</th>
//                   <th>Applied On</th>
//                   <th>Status</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {requests.length === 0 ? (
//                   <tr>
//                     <td colSpan="5" className="empty-state">No WFH requests found.</td>
//                   </tr>
//                 ) : (
//                   requests.map(req => (
//                     <tr key={req.id} className="fade-in">
//                       <td>{req.from}</td>
//                       <td>{req.to}</td>
//                       <td>{req.reason}</td>
//                       <td>{req.appliedOn}</td>
//                       <td><span className="badge-pending">{req.status}</span></td>
//                     </tr>
//                   ))
//                 )}
//               </tbody>
//             </table>
//           </div>
//         </Card>
//       </div>
//     </div>
//   );
// };



























import React, { useState } from 'react';
import { Card } from './ui/Card';
import { Toast } from './ui/Toast';
import './Wfh.css';

export const Wfh = () => {
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ from: '', to: '', reason: '' });
  const [toast, setToast] = useState({ show: false, message: '' });

  const today = new Date().toISOString().split('T')[0];
  const isFormValid = form.from !== '' && form.to !== '' && form.reason.trim().length > 0;

  const handleFromChange = (e) => {
    const selectedFrom = e.target.value;
    let updatedTo = form.to;
    if (form.to && selectedFrom > form.to) { updatedTo = ''; }
    setForm({ ...form, from: selectedFrom, to: updatedTo });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isFormValid) return;

    const newEntry = {
      ...form,
      id: Date.now(),
      appliedOn: new Date().toLocaleDateString(),
      status: 'Pending'
    };
    
    setRequests([newEntry, ...requests]);
    setForm({ from: '', to: '', reason: '' });
    setToast({ show: true, message: 'WFH Request submitted successfully!' });
  };

  return (
    <div className="hr-main-container">
      {toast.show && (
        <Toast 
          message={toast.message} 
          type="success" 
          onClose={() => setToast({ ...toast, show: false })} 
        />
      )}

      <h2 className="section-title">Work From Home Request</h2>

      <div className="hr-search-card">
        <form className="wfh-form" onSubmit={handleSubmit}>
          <div className="search-controls">
            <div className="input-group">
              <label>From Date</label>
              <input 
                type="date" 
                className="custom-input"
                value={form.from}
                min={today}
                onChange={handleFromChange} 
              />
            </div>
            <div className="input-group">
              <label>To Date</label>
              <input 
                type="date" 
                className="custom-input"
                value={form.to}
                min={form.from || today} 
                onChange={e => setForm({...form, to: e.target.value})} 
              />
            </div>
            <div className="input-group full-width-mobile">
              <label>Reason for Leave</label>
              <input 
                type="text"
                className="custom-input"
                placeholder="Enter reason..."
                value={form.reason}
                onChange={e => setForm({...form, reason: e.target.value})}
              />
            </div>
            <div className="search-btn-wrapper">
              <button type="submit" className="btn-search" disabled={!isFormValid}>
                Submit Request
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className="table-outer-wrapper">
        <h3 className="section-title" style={{ marginTop: '2rem' }}>Request History</h3>
        <div className="table-responsive">
          <table className="results-table">
            <thead>
              <tr>
                <th>From Date</th>
                <th>To Date</th>
                <th>Reason</th>
                <th>Applied On</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan="5" className="empty-state" style={{ textAlign: 'center', padding: '40px' }}>
                    No WFH requests found.
                  </td>
                </tr>
              ) : (
                requests.map(req => (
                  <tr key={req.id}>
                    <td>{req.from}</td>
                    <td>{req.to}</td>
                    <td>{req.reason}</td>
                    <td>{req.appliedOn}</td>
                    <td>
                      <span className="badge-pending">{req.status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};