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



























import React, { useState, useEffect } from 'react';
import { Toast } from './ui/Toast';
import './Wfh.css';

const API_BASE_URL = "/api/leave";

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

export const Wfh = () => {
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ from: '', to: '', reason: '' });
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const isFormValid = form.from !== '' && form.to !== '' && form.reason.trim().length > 0;

  const fetchWfhRequests = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/wfh`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      let json = {};
      try {
        json = await res.json();
      } catch {
        throw new Error('Invalid response from server');
      }
      if (json.success && json.applications) {
        setRequests(json.applications);
      } else {
        setToast({ show: true, message: json.message || 'Failed to load WFH requests', type: 'error' });
      }
    } catch (err) {
      setToast({ show: true, message: err.message || 'Network error', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWfhRequests();
  }, []);

  const handleFromChange = (e) => {
    const selectedFrom = e.target.value;
    let updatedTo = form.to;
    if (form.to && selectedFrom > form.to) { updatedTo = ''; }
    setForm({ ...form, from: selectedFrom, to: updatedTo });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isFormValid || submitting) return;

    const token = localStorage.getItem('token');
    if (!token) {
      setToast({ show: true, message: 'Please log in to submit WFH request', type: 'error' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/wfh`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          start_date: form.from,
          end_date: form.to,
          reason: form.reason.trim()
        })
      });
      let json = {};
      try {
        json = await res.json();
      } catch {
        throw new Error(`Server error (${res.status})`);
      }

      if (json.success) {
        setForm({ from: '', to: '', reason: '' });
        setToast({ show: true, message: 'WFH Request submitted successfully!', type: 'success' });
        await fetchWfhRequests();
        // Notify attendance page to refresh
        window.dispatchEvent(new CustomEvent('wfhApplied'));
      } else {
        setToast({ show: true, message: json.message || 'Failed to submit', type: 'error' });
      }
    } catch (err) {
      setToast({ show: true, message: err.message || 'Network error', type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="hr-main-container">
      {toast.show && (
        <Toast 
          message={toast.message} 
          type={toast.type || 'success'} 
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
              <label>Reason for WFH</label>
              <input 
                type="text"
                className="custom-input"
                placeholder="Enter reason..."
                value={form.reason}
                onChange={e => setForm({...form, reason: e.target.value})}
              />
            </div>
            <div className="search-btn-wrapper">
              <button type="submit" className="btn-search" disabled={!isFormValid || submitting}>
                {submitting ? 'Submitting...' : 'Submit Request'}
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
              {loading ? (
                <tr>
                  <td colSpan="5" className="empty-state" style={{ textAlign: 'center', padding: '40px' }}>
                    Loading...
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan="5" className="empty-state" style={{ textAlign: 'center', padding: '40px' }}>
                    No WFH requests found.
                  </td>
                </tr>
              ) : (
                requests.map(req => (
                  <tr key={req.id}>
                    <td>{formatDate(req.start_date)}</td>
                    <td>{formatDate(req.end_date)}</td>
                    <td>{req.reason}</td>
                    <td>{formatDate(req.created_at)}</td>
                    <td>
                      <span className={['pending','approved','rejected'].includes((req.status || 'pending').toLowerCase()) 
                        ? `badge-${(req.status || 'pending').toLowerCase()}` 
                        : 'badge-default'}>
                        {req.status || 'Pending'}
                      </span>
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