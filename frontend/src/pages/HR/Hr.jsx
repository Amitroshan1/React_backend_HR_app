import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Users, UserPlus, UserCheck, Cake, RefreshCw, 
  UserCog, Newspaper, FileText, MapPin, Building, 
  FileCheck, Search, ArrowLeft, Download, ChevronDown 
} from 'lucide-react';
import './Hr.css';
import './SignUp.css'; 
import { UpdateSignUp } from './UpdateSignUp';
import { AddNewsFeed } from './AddNewsFeed';
import { UpdateLeave } from './UpdateLeave';
import { UpdateManager } from './UpdateManager';
import { AddAssets } from './AddAssets';
import { AddLocation } from './AddLocation';
import { AddNoc } from './AddNoc';
import { ConfirmationRequest } from './ConfirmationRequest';
export const Hr = () => {
  const navigate = useNavigate();
  
  // View Management: 'main', 'updates', 'signup'
  const [view, setView] = useState('main');
  
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedCircle, setSelectedCircle] = useState('');
  const [selectedEmployeeType, setSelectedEmployeeType] = useState('');
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const dropdownRef = useRef(null);

  const employeeDetailsOptions = [
    'Family Details', 'Employee Details', 'Document', 
    'Previous Company', 'Education', 'Attendance', 
    'Leave Details', 'Punch In-Out'
  ];

  const todaysBirthdays = [
    { name: 'John Smith', date: 'Dec 24', role: 'Software Engineer', designation: 'Senior Developer', email: 'jsmith@saffotech.com' },
  ];

  const stats = [
    { title: 'Total Employees', value: '248', subtitle: '+12 this month', icon: Users, color: 'blue' },
    { title: 'New Hires', value: '15', subtitle: 'This quarter', icon: UserPlus, color: 'green' },
    { title: 'Active Today', value: '186', subtitle: '75% attendance', icon: UserCheck, color: 'purple' },
  ];

  const updateOptions = [
    { title: 'Sign Up', icon: UserPlus, description: 'New employee registration' },
    { title: 'Update_SignUp', icon: UserCog, description: 'Modify signup details' },
    { title: 'News Feed', icon: Newspaper, description: 'Company announcements' },
    { title: 'Update Leave', icon: FileText, description: 'Modify leave records' },
    { title: 'Update Manager', icon: UserCog, description: 'Change manager assignments' },
    { title: 'Add Assets', icon: Building, description: 'Register company assets' },
    { title: 'Add Locations', icon: MapPin, description: 'Add office locations' },
    { title: 'Add NOC', icon: FileCheck, description: 'No Objection Certificate' },
    { title: 'Confirmation Request', icon: FileText, description: 'Employee confirmations' },
  ];

  const handleSearch = () => {
    if (selectedCircle && selectedEmployeeType) {
      setShowSearchResults(true);
    } else {
      alert("Please select both Circle and Employee Type");
    }
  };

  const searchResults = [
    { name: 'Amit', email: 'akumar4@saffotech.com', circle: selectedCircle, type: selectedEmployeeType },
    { name: 'Neha', email: 'nphatak@saffotech.com', circle: selectedCircle, type: selectedEmployeeType },
    { name: 'Plasha', email: 'ppal@saffotech.com', circle: selectedCircle, type: selectedEmployeeType },
  ];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleDropdown = (id) => {
    setOpenDropdownId(openDropdownId === id ? null : id);
  };

  const handleOptionClick = (option, employeeName) => {
    console.log(`Updating ${option} for ${employeeName}`);
    setOpenDropdownId(null);
    navigate('/profile'); 
  };

  const handleUpdateCardClick = (title) => {
    if (title === 'Sign Up') {
      setView('signup');
     
    } 
    else if (title === 'Update_SignUp') {
      setView('update_signup');
    }
    else if (title === 'News Feed') {
      setView('newsfeed');
    } else if (title === 'Update Leave') {
      setView('update_leave');
    } else if (title === 'Update Manager') {setView('update_manager');
    } else if (title === 'Add Assets') {
    setView('add_assets');
  } else if (title === 'Add Locations') {
    setView('add_location');
  }
  else if (title === 'Add NOC') {
    setView('add_noc');
  } else if (title === 'Confirmation Request') {
    setView('confirmation_request');
  }
    else {
      console.log(`Navigating to ${title}`);
    }
  };
if (view === 'update_signup') {
    return <UpdateSignUp onBack={() => setView('updates')} />;
  }

  if (view === 'newsfeed') {
  return <AddNewsFeed onBack={() => setView('updates')} />;
}
if (view === 'update_leave'){
  return <UpdateLeave onBack={() => setView('updates')} />
}

if (view === 'update_manager') {
  return <UpdateManager onBack={() => setView('updates')} />;
}

if (view === 'add_assets') {
  return <AddAssets onBack={() => setView('updates')} />;
}

if (view === 'add_location') {
  return <AddLocation onBack={() => setView('updates')} />;
}
if (view === 'add_noc') {
return <AddNoc onBack={() => setView('updates')} />;
}

if (view === 'confirmation_request') {
  return <ConfirmationRequest onBack={() => setView('updates')} />
}
  // VIEW 1: SIGN UP PAGE (Matches Reference Image 1)
  if (view === 'signup') {
    return (
      <div className="signup-page-container">

        <div className="signup-content-wrapper">
          <button className="btn-back-updates" onClick={() => setView('updates')}>
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
                    <option value="Human Resource">Human Resource</option>
                    <option value="Software Developer">Software Developer</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Circle</label>
                  <select defaultValue="">
                    <option value="" disabled>Choose Your Circle</option>
                    <option value="NHQ">NHQ</option>
                    <option value="Delhi">Delhi</option>
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
                <button type="submit" className="btn-create-account">Create Account</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // VIEW 2: UPDATES GRID
  if (view === 'updates') {
    return (
      <div className="hr-main-container">
        <button className="btn-back" onClick={() => setView('main')}>
          <ArrowLeft size={18} /> Back to HR Panel
        </button>
        <div className="updates-grid">
          {updateOptions.map((option) => (
            <div key={option.title} className="update-card" onClick={() => handleUpdateCardClick(option.title)}>
              <div className="update-icon-box">
                <option.icon size={24} />
              </div>
              <div className="update-text">
                <h4>{option.title}</h4>
                <p>{option.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // VIEW 3: MAIN HR PANEL
  return (
    <div className="hr-main-container">
      {todaysBirthdays && (
        <div className="birthday-anniversary-card">
          <div className="card-icon-wrapper">
            <div className="icon-circle">
              <Cake size={24} className="icon-gold" />
            </div>
          </div>
          <div className="card-content-wrapper">
            <div className="card-header-row">
              <span className="emoji-cake">🎂</span>
              <h3 className="card-title-text">Happy Birthday!</h3>
            </div>
            <h2 className="employee-name-text">John Smith</h2>
            <div className="employee-details-row">
              <span className="detail-item"><strong className="detail-label">Date:</strong> Dec 24</span>
              <span className="detail-item"><strong className="detail-label">Role:</strong> Software Engineer</span>
              <span className="detail-item"><strong className="detail-label">Designation:</strong> Senior Developer</span>
              <span className="detail-item"><strong className="detail-label">Email:</strong> jsmith@saffotech.com</span>
            </div>
          </div>
        </div>
      )}

      <div className="hr-stats-grid">
        {stats.map((stat) => (
          <div key={stat.title} className={`stat-card border-${stat.color}`}>
            <div className="stat-content">
              <p className="stat-label">{stat.title}</p>
              <h3 className="stat-value">{stat.value}</h3>
              <p className="stat-sub">{stat.subtitle}</p>
            </div>
            <div className={`stat-icon-bg bg-${stat.color}`}>
              <stat.icon size={24} />
            </div>
          </div>
        ))}

        <div className="stat-card clickable updates-card-theme" onClick={() => setView('updates')}>
          <div className="stat-content">
            <p className="stat-label">Updates</p>
            <h3 className="stat-value">9</h3>
            <p className="stat-sub">Click to manage</p>
          </div>
          <div className="stat-icon-bg bg-updates">
            <RefreshCw size={24} />
          </div>
        </div>
      </div>




<div className="hr-search-card">
        {!showSearchResults ? (
          <div className="search-section-inner">
            <h3 className="section-title">Search Employees</h3>
            <div className="search-controls">
              <div className="input-group">
                <label>Circle</label>
                <select value={selectedCircle} onChange={(e) => setSelectedCircle(e.target.value)}>
                  <option value="">Choose Your Circle</option>
                  <option value="NHQ">NHQ</option>
                  <option value="Delhi">Delhi</option>
                </select>
              </div>
              <div className="input-group">
                <label>Employee Type</label>
                <select value={selectedEmployeeType} onChange={(e) => setSelectedEmployeeType(e.target.value)}>
                  <option value="">Select Employee Type</option>
                  <option value="Human Resource">Human Resource</option>
                  <option value="Software Developer">Software Developer</option>
                </select>
              </div>
              <div className="search-btn-wrapper">
                <button className="btn-search" onClick={handleSearch}>
                  {/* <Search size={18} /> <span>Search</span> */} <i class="search-icon"></i> Search
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="results-container">
            <div className="results-header">
               <h3>Results for {selectedCircle} ({selectedEmployeeType})</h3>
            </div>
            <div className="table-outer-wrapper">
              <div className="table-responsive">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Circle</th>
                      <th>Type</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((emp, i) => (
                      <tr key={i}>
                        <td>{emp.name}</td>
                        <td>{emp.email}</td>
                        <td>{emp.circle}</td>
                        <td>{emp.type}</td>
                        <td>
                          <div className="dropdown-container" ref={openDropdownId === i ? dropdownRef : null}>
                            <button className={`btn-update-toggle ${openDropdownId === i ? 'active' : ''}`} onClick={() => toggleDropdown(i)}>
                              Update <ChevronDown size={14} className={openDropdownId === i ? 'rotate-180' : ''} />
                            </button>
                            {openDropdownId === i && (
                              <div className="dropdown-menu-list">
                                {employeeDetailsOptions.map((option) => (
                                  <div key={option} className="dropdown-item" onClick={() => handleOptionClick(option, emp.name)}>
                                    {option}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="results-actions">
              <button className="btn-outline" onClick={() => setShowSearchResults(false)}>Back to Search</button>
              <button className="btn-success"><Download size={16}/> Download Attendance</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}






      {/* <div className="hr-search-card">
        {!showSearchResults ? (
          <>
            <h3>Search Employees</h3>
            <div className="search-controls">
              <div className="input-group">
                <label>Circle</label>
                <select value={selectedCircle} onChange={(e) => setSelectedCircle(e.target.value)}>
                  <option value="">Choose Your Circle</option>
                  <option value="NHQ">NHQ</option>
                  <option value="Delhi">Delhi</option>
                </select>
              </div>
              <div className="input-group">
                <label>Employee Type</label>
                <select value={selectedEmployeeType} onChange={(e) => setSelectedEmployeeType(e.target.value)}>
                  <option value="">Select Employee Type</option>
                  <option value="Human Resource">Human Resource</option>
                  <option value="Software Developer">Software Developer</option>
                </select>
              </div>
              <button className="btn-search" onClick={handleSearch}>
                <Search size={18} /> Search
              </button>
            </div>
          </>
        ) : (
          <div className="results-container">
            <div className="results-header">
              <h3>Circle: {selectedCircle} | Type: {selectedEmployeeType}</h3>
            </div>
            <div className="table-responsive">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Circle</th>
                    <th>Type</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((emp, i) => (
                    <tr key={i}>
                      <td>{emp.name}</td>
                      <td>{emp.email}</td>
                      <td>{emp.circle}</td>
                      <td>{emp.type}</td>
                      <td>
                        <div className="dropdown-container" ref={dropdownRef}>
                          <button className="btn-update-toggle" onClick={() => toggleDropdown(i)}>
                            Update <ChevronDown size={14} className={openDropdownId === i ? 'rotate-180' : ''} />
                          </button>
                          {openDropdownId === i && (
                            <div className="dropdown-menu-list">
                              {employeeDetailsOptions.map((option) => (
                                <div key={option} className="dropdown-item" onClick={() => handleOptionClick(option, emp.name)}>
                                  {option}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="results-actions">
              <button className="btn-outline" onClick={() => setShowSearchResults(false)}>Back to Search</button>
              <button className="btn-success"><Download size={16}/> Download Attendance</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} */}



