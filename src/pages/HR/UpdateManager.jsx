import React, { useState } from 'react';
import { ArrowLeft, Search, Bell } from 'lucide-react';
import './UpdateManager.css';

export const UpdateManager = ({ onBack }) => {
  const [view, setView] = useState('search'); // 'search' or 'details'

  const handleSearch = () => {
    setView('details');
  };

  // --- VIEW 2: FULL DETAILS FORM (Matches Image 469143.png) ---
  if (view === 'details') {
    return (
      <div className="manager-page-container">
        <header className="manager-nav">
          <button className="btn-back-square" onClick={() => setView('search')}>
            <ArrowLeft size={18} /> Back to Search
          </button>
        </header>

        <div className="manager-form-wrapper">
          <div className="details-sidebar-card">
            <form className="sidebar-form" onSubmit={(e) => e.preventDefault()}>
              <div className="form-item-group">
                <label>Circle</label>
                <select><option>Delhi</option></select>
              </div>

              <div className="form-item-group">
                <label>Department</label>
                <select><option>Software Developer</option></select>
              </div>

              <div className="form-item-group">
                <label>Lead/Manager (Optional)</label>
                <input type="text" placeholder="Lead/Manager" />
              </div>

              <div className="section-divider">L1 Contact Information (Optional)</div>
              <div className="form-item-group">
                <label>L1 Name</label>
                <input type="text" placeholder="L1 Name" />
              </div>
              <div className="form-item-group">
                <label>L1 Mobile</label>
                <input type="text" placeholder="L1 Mobile" />
              </div>

              <div className="section-divider highlight-blue">L2 (Manager) Contact Information *</div>
              <div className="form-item-group">
                <label>L2 Name</label>
                <input type="text" defaultValue="Mayank" />
              </div>
              <div className="form-item-group">
                <label>L2 Mobile</label>
                <input type="text" defaultValue="9716513620" />
              </div>
              <div className="form-item-group">
                <label>L2 Email</label>
                <input type="email" defaultValue="mayank@saffotech.com" />
              </div>

              <div className="section-divider highlight-blue">L3 (Lead) Contact Information *</div>
              <div className="form-item-group">
                <label>L3 Name</label>
                <input type="text" defaultValue="shubam srivat" />
              </div>
              <div className="form-item-group">
                <label>L3 Mobile</label>
                <input type="text" defaultValue="9172206294" />
              </div>
              <div className="form-item-group">
                <label>L3 Email</label>
                <input type="email" defaultValue="ssaurverge@saffotech.com" />
              </div>

              <button type="submit" className="btn-manager-submit">Submit</button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW 1: SEARCH CENTERED (Matches Image 467e01.png) ---
  return (
    <div className="manager-search-overlay">
      <div className="search-manager-card">
        <button className="close-btn" onClick={onBack}><ArrowLeft size={20} /></button>
        <h2>Search Employees</h2>
        
        <div className="search-field-box">
          <label>Circle</label>
          <select>
            <option>Choose Your Circle</option>
            <option>Delhi</option>
            <option>NHQ</option>
          </select>
        </div>

        <div className="search-field-box">
          <label>Employee Type</label>
          <select>
            <option>Select Employee Type</option>
            <option>Software Developer</option>
          </select>
        </div>

        <div className="search-field-box">
          <label>Employee Email / ID (optional)</label>
          <input type="text" placeholder="Enter email or employee ID (leave blank for all)" />
        </div>

        <button className="btn-execute-search" onClick={handleSearch}>
          Search
        </button>
      </div>
    </div>
  );
};
