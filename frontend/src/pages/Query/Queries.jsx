// import React, { useState, useRef, useEffect, useMemo } from 'react';
// import { 
//   MessageSquarePlus, Paperclip, MessageCircle, 
//   CheckCircle2, Send, X, Clock, Loader2 
// } from 'lucide-react';
// import './Queries.css';

// const DEPARTMENTS = [
//   { id: 'human-resource', name: 'Human Resource' },
//   { id: 'accounts', name: 'Accounts' },
//   { id: 'it', name: 'IT Department' },
//   { id: 'admin', name: 'Administration' }
// ];

// export const Queries = () => {
//   // State Management
//   const [queries, setQueries] = useState([]);
//   const [formData, setFormData] = useState({ department: '', title: '', text: '' });
//   const [file, setFile] = useState(null);
//   const [activeChat, setActiveChat] = useState(null);
//   const [chatMessage, setChatMessage] = useState('');
//   const [isSubmitting, setIsSubmitting] = useState(false);
  
//   const chatEndRef = useRef(null);

//   // Auto-scroll chat
//   useEffect(() => {
//     chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//   }, [activeChat?.messages]);

//   // Handle Form Inputs
//   const handleInputChange = (e) => {
//     const { name, value } = e.target;
//     setFormData(prev => ({ ...prev, [name]: value }));
//   };

//   // Submit New Query
//   const handleSubmit = async (e) => {
//     e.preventDefault();
//     if (!formData.department || !formData.title || !formData.text) return;

//     setIsSubmitting(true);
    
//     // Simulate API Call
//     setTimeout(() => {
//       const newQuery = {
//         id: Date.now().toString(),
//         ...formData,
//         createdAt: new Date().toLocaleDateString(),
//         status: 'pending',
//         satisfied: null,
//         messages: [{
//           id: '1',
//           sender: 'user',
//           text: formData.text,
//           timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
//         }],
//       };

//       setQueries([newQuery, ...queries]);
//       setFormData({ department: '', title: '', text: '' });
//       setFile(null);
//       setIsSubmitting(false);
//     }, 800);
//   };

//   // Chat Logic
//   const handleSendMessage = () => {
//     if (!chatMessage.trim() || !activeChat) return;

//     const userMsg = {
//       id: Date.now().toString(),
//       sender: 'user',
//       text: chatMessage,
//       timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
//     };

//     updateQueryMessages(activeChat.id, userMsg, 'in-progress');
//     setChatMessage('');

//     // Simulate Department Response
//     setTimeout(() => {
//       const deptMsg = {
//         id: (Date.now() + 1).toString(),
//         sender: 'department',
//         text: `We have received your update regarding "${activeChat.title}". Our team is looking into it.`,
//         timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
//       };
//       updateQueryMessages(activeChat.id, deptMsg);
//     }, 1500);
//   };

//   const updateQueryMessages = (queryId, newMessage, newStatus = null) => {
//     setQueries(prev => prev.map(q => {
//       if (q.id === queryId) {
//         const updated = { 
//           ...q, 
//           messages: [...q.messages, newMessage],
//           status: newStatus || q.status 
//         };
//         if (activeChat?.id === queryId) setActiveChat(updated);
//         return updated;
//       }
//       return q;
//     }));
//   };

//   const handleResolution = (id, isSatisfied) => {
//     setQueries(prev => prev.map(q => 
//       q.id === id ? { ...q, satisfied: isSatisfied, status: 'resolved' } : q
//     ));
//     if (activeChat?.id === id) setActiveChat(null);
//   };

//   return (
//     <div className="queries-container">
//       {/* <header className="page-header">
//         <h1>Queries</h1>
//         <p>Saffo Solution Technology Support Portal</p>
//       </header> */}

//       <div className="queries-grid">
//         {/* Left Column: Form or Active Chat */}
//         <section className="main-content">
//           {!activeChat ? (
//             <div className="card shadow-sm animate-in">
//               <div className="card-header">
//                 <MessageSquarePlus className="icon-primary" />
//                 <h2>Create New Query</h2>
//               </div>
//               <form onSubmit={handleSubmit} className="query-form">
//                 <div className="form-row">
//                   <div className="form-group">
//                     <label>Department</label>
//                     <select 
//                       name="department" 
//                       value={formData.department} 
//                       onChange={handleInputChange}
//                       required
//                     >
//                       <option value="">Select Department</option>
//                       {DEPARTMENTS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
//                     </select>
//                   </div>
//                   <div className="form-group">
//                     <label>Subject Title</label>
//                     <input 
//                       name="title" 
//                       placeholder="e.g., Salary discrepancy"
//                       value={formData.title}
//                       onChange={handleInputChange}
//                       required
//                     />
//                   </div>
//                 </div>

//                 <div className="form-group">
//                   <label>Description</label>
//                   <textarea 
//                     name="text"
//                     rows="4"
//                     placeholder="Describe your issue in detail..."
//                     value={formData.text}
//                     onChange={handleInputChange}
//                     required
//                   />
//                 </div>

//                 <div className="form-group">
//                   <label className="file-label">
//                     <Paperclip size={16} />
//                     <span>{file ? file.name : "Attach supporting documents"}</span>
//                     <input type="file" onChange={(e) => setFile(e.target.files[0])} />
//                   </label>
//                 </div>

//                 <button type="submit" className="btn-submit" disabled={isSubmitting}>
//                   {isSubmitting ? <Loader2 className="spin" /> : "Submit Query"}
//                 </button>
//               </form>
//             </div>
//           ) : (
//             <div className="card chat-card animate-in">
//               <div className="chat-header">
//                 <div className="header-info">
//                   <MessageCircle className="icon-primary" />
//                   <div>
//                     <h3>{activeChat.title}</h3>
//                     <span>{activeChat.department.replace('-', ' ')}</span>
//                   </div>
//                 </div>
//                 <button className="btn-close" onClick={() => setActiveChat(null)}><X /></button>
//               </div>

//               <div className="chat-messages">
//                 {activeChat.messages.map(msg => (
//                   <div key={msg.id} className={`message-wrapper ${msg.sender}`}>
//                     <div className="message-bubble">
//                       <p>{msg.text}</p>
//                       <span className="time">{msg.timestamp}</span>
//                     </div>
//                   </div>
//                 ))}
//                 <div ref={chatEndRef} />
//               </div>

//               {activeChat.status !== 'resolved' && (
//                 <div className="chat-input-area">
//                   <input 
//                     placeholder="Type your reply..." 
//                     value={chatMessage}
//                     onChange={(e) => setChatMessage(e.target.value)}
//                     onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
//                   />
//                   <button onClick={handleSendMessage} className="btn-send">
//                     <Send size={18} />
//                   </button>
//                 </div>
//               )}
//             </div>
//           )}
//         </section>

//         {/* Right Column / Bottom: Query History */}
//         <section className="history-content">
//           <div className="card shadow-sm">
//             <div className="card-header">
//               <h2>Recent Queries</h2>
//             </div>
//             <div className="table-responsive">
//               <table className="queries-table">
//                 <thead>
//                   <tr>
//                     <th>Query Details</th>
//                     <th>Status</th>
//                     <th>Action</th>
//                   </tr>
//                 </thead>
//                 <tbody>
//                   {queries.length === 0 ? (
//                     <tr><td colSpan="3" className="empty-state">No queries found.</td></tr>
//                   ) : (
//                     queries.map(q => (
//                       <tr key={q.id}>
//                         <td>
//                           <div className="query-info">
//                             <strong>{q.title}</strong>
//                             <span>{q.createdAt} • {q.department}</span>
//                           </div>
//                         </td>
//                         <td>
//                           <span className={`badge badge-${q.status}`}>
//                             {q.status}
//                           </span>
//                         </td>
//                         <td>
//                           <div className="action-cell">
//                             <button onClick={() => setActiveChat(q)} className="btn-icon-text">
//                               <MessageCircle size={14} /> Chat
//                             </button>
//                             {q.status !== 'pending' && q.satisfied === null && (
//                               <div className="resolve-actions">
//                                 <button className="btn-yes" onClick={() => handleResolution(q.id, true)}>Yes</button>
//                                 <button className="btn-no" onClick={() => handleResolution(q.id, false)}>No</button>
//                               </div>
//                             )}
//                             {q.satisfied !== null && (
//                               <span className={`satisfied-tag ${q.satisfied ? 'yes' : 'no'}`}>
//                                 {q.satisfied ? 'Satisfied' : 'Unsatisfied'}
//                               </span>
//                             )}
//                           </div>
//                         </td>
//                       </tr>
//                     ))
//                   )}
//                 </tbody>
//               </table>
//             </div>
//           </div>
//         </section>
//       </div>
//     </div>
//   );
// }


















// import React, { useState, useRef, useEffect } from 'react';
// import { 
//   MessageSquarePlus, Paperclip, MessageCircle, 
//   CheckCircle2, Send, X, Loader2 
// } from 'lucide-react';
// import './Queries.css';

// const DEPARTMENTS = [
//   { id: 'human-resource', name: 'Human Resource' },
//   { id: 'accounts', name: 'Accounts' },
//   { id: 'it', name: 'IT Department' },
//   { id: 'admin', name: 'Administration' }
// ];

// export const Queries = () => {
//   const [queries, setQueries] = useState([]);
//   const [formData, setFormData] = useState({ department: '', title: '', text: '' });
//   const [file, setFile] = useState(null);
//   const [activeChat, setActiveChat] = useState(null);
//   const [chatMessage, setChatMessage] = useState('');
//   const [isSubmitting, setIsSubmitting] = useState(false);
  
//   const chatEndRef = useRef(null);

//   useEffect(() => {
//     chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
//   }, [activeChat?.messages]);

//   const handleInputChange = (e) => {
//     const { name, value } = e.target;
//     setFormData(prev => ({ ...prev, [name]: value }));
//   };

//   const handleSubmit = async (e) => {
//     e.preventDefault();
//     if (!formData.department || !formData.title || !formData.text) return;
//     setIsSubmitting(true);
    
//     setTimeout(() => {
//       const newQuery = {
//         id: Date.now().toString(),
//         ...formData,
//         createdAt: new Date().toLocaleDateString(),
//         status: 'pending',
//         satisfied: null,
//         messages: [{
//           id: '1',
//           sender: 'user',
//           text: formData.text,
//           timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
//         }],
//       };
//       setQueries([newQuery, ...queries]);
//       setFormData({ department: '', title: '', text: '' });
//       setFile(null);
//       setIsSubmitting(false);
//     }, 800);
//   };

//   return (
//     <div className="queries-page-wrapper">
//       <div className="queries-vertical-stack">
//         {/* Top Section: Form or Chat */}
//         <section className="interaction-area">
//           {!activeChat ? (
//             <div className="query-card animate-in">
//               <div className="query-card-header">
//                 <MessageSquarePlus className="header-icon" />
//                 <h2>Create New Query</h2>
//               </div>
//               <form onSubmit={handleSubmit} className="query-form-body">
//                 <div className="input-group-row">
//                   <div className="input-field">
//                     <label>Department</label>
//                     <select name="department" value={formData.department} onChange={handleInputChange} required>
//                       <option value="">Select Department</option>
//                       {DEPARTMENTS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
//                     </select>
//                   </div>
//                   <div className="input-field">
//                     <label>Subject Title</label>
//                     <input name="title" placeholder="e.g., Salary discrepancy" value={formData.title} onChange={handleInputChange} required />
//                   </div>
//                 </div>

//                 <div className="input-field">
//                   <label>Description</label>
//                   <textarea name="text" rows="4" placeholder="Describe your issue in detail..." value={formData.text} onChange={handleInputChange} required />
//                 </div>

//                 <div className="file-upload-section">
//                   <label className="custom-file-upload">
//                     <Paperclip size={16} />
//                     <span>{file ? file.name : "Attach supporting documents"}</span>
//                     <input type="file" onChange={(e) => setFile(e.target.files[0])} hidden />
//                   </label>
//                 </div>

//                 <button type="submit" className="submit-query-btn" disabled={isSubmitting}>
//                   {isSubmitting ? <Loader2 className="spin-icon" /> : "Submit Query"}
//                 </button>
//               </form>
//             </div>
//           ) : (
//             <div className="query-card chat-mode animate-in">
//               {/* Chat Header */}
//               <div className="chat-interface-header">
//                  <div className="chat-title-info">
//                     <MessageCircle className="header-icon" />
//                     <div>
//                         <h3>{activeChat.title}</h3>
//                         <p>{activeChat.department.replace('-', ' ')}</p>
//                     </div>
//                  </div>
//                  <button className="chat-close-btn" onClick={() => setActiveChat(null)}><X size={18}/></button>
//               </div>
//               {/* Chat Messages */}
//               <div className="chat-window">
//                 {activeChat.messages.map(msg => (
//                   <div key={msg.id} className={`msg-bubble-container ${msg.sender}`}>
//                     <div className="msg-bubble">
//                       <p>{msg.text}</p>
//                       <span className="msg-timestamp">{msg.timestamp}</span>
//                     </div>
//                   </div>
//                 ))}
//                 <div ref={chatEndRef} />
//               </div>
//             </div>
//           )}
//         </section>

//         {/* Bottom Section: History */}
//         <section className="history-area">
//           <div className="query-card">
//             <div className="query-card-header">
//               <h2>Recent Queries</h2>
//             </div>
//             <div className="table-container">
//               <table className="history-table">
//                 <thead>
//                   <tr>
//                     <th>Query Details</th>
//                     <th>Status</th>
//                     <th>Action</th>
//                   </tr>
//                 </thead>
//                 <tbody>
//                   {queries.length === 0 ? (
//                     <tr><td colSpan="3" className="no-data">No queries found.</td></tr>
//                   ) : (
//                     queries.map(q => (
//                       <tr key={q.id}>
//                         <td>
//                           <div className="table-query-info">
//                             <span className="q-title">{q.title}</span>
//                             <span className="q-meta">{q.createdAt} • {q.department}</span>
//                           </div>
//                         </td>
//                         <td><span className={`status-pill ${q.status}`}>{q.status}</span></td>
//                         <td>
//                             <button onClick={() => setActiveChat(q)} className="chat-open-action">
//                                 <MessageCircle size={14} /> Chat
//                             </button>
//                         </td>
//                       </tr>
//                     ))
//                   )}
//                 </tbody>
//               </table>
//             </div>
//           </div>
//         </section>
//       </div>
//     </div>
//   );
// }









import React, { useState, useRef, useEffect } from 'react';
import { MessageSquarePlus, MessageCircle, Send, X, Loader2, CheckCircle } from 'lucide-react';
import './Queries.css';

const API_BASE_URL = '/api/query';

const DEPARTMENTS = [
  { id: 'Human Resource', name: 'Human Resource' },
  { id: 'Accounts', name: 'Accounts' },
  { id: 'IT Department', name: 'IT Department' },
  { id: 'Administration', name: 'Administration' }
];

export const Queries = () => {
  const [queries, setQueries] = useState([]);
  const [formData, setFormData] = useState({ department: '', title: '', text: '' });
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [chatMessage, setChatMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages]);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const formatDateTime = (value) => {
    if (!value) return '';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString();
    } catch {
      return String(value);
    }
  };

  const getSummary = (text) => {
    if (!text) return '';
    const words = String(text).trim().split(/\s+/).slice(0, 20);
    return words.join(' ');
  };

  const getStatusLabel = (status) => {
    if (status === 'Open') return 'In Progress';
    if (status === 'Closed') return 'Closed';
    return 'New';
  };

  const getStatusRank = (status) => {
    if (status === 'New') return 0;
    if (status === 'Open') return 1;
    return 2;
  };

  const fetchMyQueries = async () => {
    setIsLoading(true);
    setActionError('');
    try {
      const response = await fetch(`${API_BASE_URL}/queries/my?page=1&limit=50`, {
        method: 'GET',
        headers: {
          ...getAuthHeaders(),
        }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to load queries');
      }
      const mapped = (result.queries || []).map(q => ({
        id: q.id,
        title: q.title,
        department: q.department,
        status: q.status,
        queryText: q.query_text,
        createdAtRaw: q.created_at,
        createdAt: formatDateTime(q.created_at),
        messages: []
      }));
      const sorted = mapped.sort((a, b) => {
        const rankDiff = getStatusRank(a.status) - getStatusRank(b.status);
        if (rankDiff !== 0) return rankDiff;
        return new Date(b.createdAtRaw) - new Date(a.createdAtRaw);
      });
      setQueries(sorted);
    } catch (error) {
      console.error('Load queries error:', error);
      setActionError(error.message || 'Unable to load queries');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMyQueries();
  }, []);

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) {
      setSelectedFiles([]);
      return;
    }
    const tooLarge = files.find(file => file.size > MAX_FILE_SIZE_BYTES);
    if (tooLarge) {
      setActionError(`${tooLarge.name} exceeds 2MB limit`);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }
    setActionError('');
    setSelectedFiles(files);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setActionError('');
    setIsSubmitting(true);
    try {
      if (selectedFiles.some(file => file.size > MAX_FILE_SIZE_BYTES)) {
        throw new Error('One or more files exceed 2MB limit');
      }

      const payload = new FormData();
      payload.append('title', formData.title);
      payload.append('department', formData.department);
      payload.append('query_text', formData.text);
      selectedFiles.forEach(file => payload.append('files', file));

      const response = await fetch(`${API_BASE_URL}/queries`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
        },
        body: payload,
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to create query');
      }
      await fetchMyQueries();
      setFormData({ department: '', title: '', text: '' });
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Create query error:', error);
      setActionError(error.message || 'Unable to create query');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openChat = async (queryItem) => {
    setActionError('');
    try {
      const response = await fetch(`${API_BASE_URL}/queries/${queryItem.id}`, {
        method: 'GET',
        headers: {
          ...getAuthHeaders(),
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to load chat');
      }
      const messages = (result.chat_messages || []).map((message, idx) => ({
        id: `${queryItem.id}-${idx}`,
        sender: message.user_type === 'EMPLOYEE' ? 'user' : 'department',
        senderName: message.by,
        text: message.text,
        timestamp: formatDateTime(message.created_at),
      }));
      const updated = {
        ...queryItem,
        status: result.query?.status || queryItem.status,
        createdAt: formatDateTime(result.query?.created_at || queryItem.createdAt),
        messages,
      };
      setActiveChat(updated);
      setQueries(prev => prev.map(q => (q.id === updated.id ? updated : q)));
    } catch (error) {
      console.error('Open chat error:', error);
      setActionError(error.message || 'Unable to open chat');
    }
  };

  const handleSendMessage = async () => {
    if (!chatMessage.trim() || !activeChat) return;
    setActionError('');
    try {
      const response = await fetch(`${API_BASE_URL}/queries/${activeChat.id}/reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ reply_text: chatMessage }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to send reply');
      }
      await openChat(activeChat);
      setChatMessage('');
    } catch (error) {
      console.error('Send reply error:', error);
      setActionError(error.message || 'Unable to send reply');
    }
  };

  const closeQuery = async (id) => {
    setActionError('');
    try {
      const response = await fetch(`${API_BASE_URL}/queries/${id}/close`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to close query');
      }
      await fetchMyQueries();
      if (activeChat?.id === id) setActiveChat(null);
    } catch (error) {
      console.error('Close query error:', error);
      setActionError(error.message || 'Unable to close query');
    }
  };

  return (
    <div className="q-page">
      <div className="q-container">
        {/* FORM / CHAT SECTION */}
        <div className="q-card main-interaction">
          {!activeChat ? (
            <div className="q-form-container">
              <div className="q-header">
                <MessageSquarePlus size={20} color="#2563eb" />
                <h2>Raise a Query</h2>
              </div>
              {actionError && <div className="q-error">{actionError}</div>}
              <form onSubmit={handleSubmit} className="q-form">
                <div className="q-row">
                  <div className="q-group">
                    <label>Department</label>
                    <select value={formData.department} onChange={(e) => setFormData({...formData, department: e.target.value})} required>
                      <option value="">Select Department</option>
                      {DEPARTMENTS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                  <div className="q-group">
                    <label>Subject Title</label>
                    <input placeholder="Subject..." value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} required />
                  </div>
                </div>
                <div className="q-group">
                  <label>Description</label>
                  <textarea rows="3" placeholder="Describe your issue..." value={formData.text} onChange={(e) => setFormData({...formData, text: e.target.value})} required />
                </div>
                <div className="q-group">
                  <label>Attach files (max 2MB each)</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileChange}
                  />
                  {selectedFiles.length > 0 && (
                    <div className="q-file-list">
                      {selectedFiles.map(file => (
                        <div key={file.name} className="q-file-item">{file.name}</div>
                      ))}
                    </div>
                  )}
                </div>
                <button type="submit" className="q-btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="spin" /> : "Submit Request"}
                </button>
              </form>
            </div>
          ) : (
            <div className="q-chat-container">
              <div className="q-chat-header">
                <div>
                  <h3>{activeChat.title}</h3>
                  <small>{activeChat.department}</small>
                </div>
                <button onClick={() => setActiveChat(null)} className="q-close"><X size={20}/></button>
              </div>
              <div className="q-chat-messages">
                {activeChat.messages.map(m => (
                  <div key={m.id} className={`q-msg ${m.sender}`}>
                    <div className="q-bubble">
                      <div className="q-sender">{m.senderName}</div>
                      {m.text}
                      <span className="q-time">{m.timestamp}</span>
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="q-chat-input">
                <input placeholder="Type a message..." value={chatMessage} onChange={(e) => setChatMessage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} disabled={activeChat.status === 'Closed'} />
                <button onClick={handleSendMessage} className="q-send" disabled={activeChat.status === 'Closed'}><Send size={18}/></button>
              </div>
            </div>
          )}
        </div>

        {/* TABLE SECTION */}
        <div className="q-card table-section">
          <div className="q-header"><h2>Your Query History</h2></div>
          {actionError && <div className="q-error">{actionError}</div>}
          <div className="q-table-wrapper">
            <table className="q-table">
              <thead>
                <tr>
                  <th style={{width: '25%'}}>Query Details</th>
                  <th style={{width: '30%'}}>Description</th>
                  <th style={{width: '15%'}}>Status</th>
                  <th style={{width: '15%'}}>Close</th>
                  <th style={{width: '15%'}}>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan="5" className="empty">Loading...</td></tr>
                ) : queries.length === 0 ? (
                  <tr><td colSpan="5" className="empty">No queries yet.</td></tr>
                ) : (
                  queries.map(q => (
                    <tr key={q.id}>
                      <td><div className="cell-main"><strong>{q.title}</strong><small>{q.department} • {q.createdAt}</small></div></td>
                      <td>{getSummary(q.queryText)}</td>
                      <td><span className={`status-tag ${q.status}`}>{getStatusLabel(q.status)}</span></td>
                      <td>
                        {q.status !== 'Closed' ? (
                          <button className="done-btn" onClick={() => closeQuery(q.id)}><CheckCircle size={14}/> Close</button>
                        ) : (<span className="text-success">✅ Closed</span>)}
                      </td>
                      <td><button onClick={() => openChat(q)} className="chat-link">Chat</button></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};