import React, { useState, useEffect } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import './SignUp.css';

const MASTER_OPTIONS_API = '/api/auth/master-options';
const FALLBACK_EMP_TYPES = ['Human Resource', 'Software Developer'];
const FALLBACK_CIRCLES = ['NHQ', 'Mumbai'];

export const SignUp = ({ onBack }) => {
  const [empTypeOptions, setEmpTypeOptions] = useState(FALLBACK_EMP_TYPES);
  const [circleOptions, setCircleOptions] = useState(FALLBACK_CIRCLES);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetch(MASTER_OPTIONS_API, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.json().catch(() => ({})))
        .then((data) => {
          if (data.success) {
            if (data.departments?.length) setEmpTypeOptions(data.departments);
            if (data.circles?.length) setCircleOptions(data.circles);
          }
        });
    }
  }, []);

  return (
    <div className="signup-page-container">
      {/* Header Section */}
      {/* <header className="signup-header">
        <div className="header-left">
          <h1>Sign Up</h1>
          <p>New employee registration</p>
        </div>
        <div className="header-right">
          <div className="search-bar-container">
            <Search size={18} className="search-icon" />
            <input type="text" placeholder="Search..." />
          </div>
          <div className="header-icons">
             <div className="notification-bell">
                <span className="bell-icon">🔔</span>
                <span className="count-badge">3</span>
             </div>
             <div className="user-profile">
                <div className="avatar-circle">EH</div>
                <div className="user-info">
                   <span className="user-name">Employee</span>
                   <span className="user-role">Hr</span>
                </div>
             </div>
          </div>
        </div>
      </header> */}

      {/* Main Form Area */}
      <div className="signup-content-wrapper">
        <button className="btn-back-updates" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="signup-card">
          <div className="card-header">
            <h2>Create New Employee Account</h2>
            <p>Fill in the details to register a new employee</p>
          </div>

          <form className="signup-form">
            <div className="form-row">
              <div className="form-group">
                <label>UserName</label>
                <input type="text" placeholder="Create Unique UserName" />
              </div>
              <div className="form-group">
                <label>Full Name</label>
                <input type="text" placeholder="Enter your Full Name" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Email</label>
                <input type="email" placeholder="Enter your Email ID" />
              </div>
              <div className="form-group">
                <label>Employee ID</label>
                <input type="text" placeholder="Enter your Employee ID" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Mobile Number</label>
                <input type="tel" placeholder="Enter your Mobile Number" />
              </div>
              <div className="form-group">
                <label>Date of Joining</label>
                <input type="date" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Employee Type</label>
                <select defaultValue="">
                  <option value="" disabled>Select Employee Type</option>
                  {empTypeOptions.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Circle</label>
                <select defaultValue="">
                  <option value="" disabled>Choose Your Circle</option>
                  {circleOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Password</label>
                <input type="password" placeholder="Enter your Password" />
              </div>
              <div className="form-group">
                <label>Confirm Password</label>
                <input type="password" placeholder="Confirm your Password" />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn-create-account">
                Create Account
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
