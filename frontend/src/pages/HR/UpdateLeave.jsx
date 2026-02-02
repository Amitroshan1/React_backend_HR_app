import React, { useState } from 'react';
import { ArrowLeft, Search, Bell } from 'lucide-react';
import './UpdateLeave.css';

export const UpdateLeave = ({ onBack }) => {
  const [view, setView] = useState('search'); // 'search' or 'edit'
  const [showResults, setShowResults] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const mockLeaveData = [
    { id: '101236', name: 'Amit kumar' },
    { id: '10206', name: 'neha phatak' },
    { id: '10268', name: 'Plasha pal' },
    { id: '10278', name: 'Rita rout' },
    { id: '10252', name: 'Shivani srinet' },
    { id: '10317', name: 'Prajukta chakrapani podili' },
  ];

  const handleSearch = () => setShowResults(true);

  const handleViewBalance = (user) => {
    setSelectedUser(user);
    setView('edit');
  };

  // --- SUB-VIEW: LEAVE BALANCE FORM (Matches Image 45a824.png) ---
  if (view === 'edit') {
    return (
      <div className="leave-page-wrapper">
        {/* <header className="page-top-header">
          <div className="header-titles">
            <h1>Leave Balance for: {selectedUser.name}</h1>
            <p>Update leave balances</p>
          </div>
          <div className="header-right-tools">
            <div className="search-input-box"><Search size={16} /><input type="text" placeholder="Search..." /></div>
            <div className="header-status-icons">
              <div className="notif-bell"><Bell size={20} /><span>3</span></div>
              <div className="user-profile-pill">EH <span>Emily HR <br/> Hr</span></div>
            </div>
          </div>
        </header> */}

        <div className="leave-edit-container">
          <div className="balance-form-card">
            <div className="leave-field">
              <label>Personal Leave Balance</label>
              <input type="text" defaultValue="6.4" />
            </div>
            <div className="leave-field">
              <label>Casual Leave Balance</label>
              <input type="text" defaultValue="1.35" />
            </div>
            <div className="leave-form-footer">
              <button className="btn-save-update">Update</button>
              <button className="btn-cancel-list" onClick={() => setView('search')}>Back to Employee List</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN VIEW: SEARCH & TABLE (Matches Image 45a7e8.png) ---
  return (
    <div className="leave-page-wrapper">
      {/* <header className="page-top-header">
        <div className="header-titles">
          <h1>Leave Balance</h1>
          <p>View and update employee leave balances</p>
        </div>
        <div className="header-right-tools">
          <div className="search-input-box"><Search size={16} /><input type="text" placeholder="Search..." /></div>
          <div className="header-status-icons">
            <div className="notif-bell"><Bell size={20} /><span>3</span></div>
            <div className="user-profile-pill">EH <span>Emily HR <br/> Hr</span></div>
          </div>
        </div>
      </header> */}

      <div className="leave-content-area">
        <button className="back-to-updates-btn" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="leave-search-filter-box">
          <div className="filter-inner-grid">
            <div className="filter-column">
              <label>Employee Type</label>
              <select><option>Manager</option></select>
            </div>
            <div className="filter-column">
              <label>Circle</label>
              <select><option>Delhi</option></select>
            </div>
            <button className="execute-search-btn" onClick={handleSearch}>
              <Search size={18} /> Search
            </button>
          </div>
        </div>

        {showResults && (
          <div className="leave-table-wrapper">
            <table className="leave-data-table">
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>First Name</th>
                  <th>Leave Balance</th>
                </tr>
              </thead>
              <tbody>
                {mockLeaveData.map((user) => (
                  <tr key={user.id}>
                    <td>{user.id}</td>
                    <td>{user.name}</td>
                    <td>
                      <button className="view-balance-link" onClick={() => handleViewBalance(user)}>
                        View Leave Balance
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
