import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
// New import for Exit Employee
import ExitEmployee from './ExitEmployee';
import AddDeptCircle from './AddDeptCircle';
const HR_API_BASE = 'http://localhost:5000/api/HumanResource';

function formatDateShort(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}




export const Hr = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  const [view, setView] = useState('main');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedCircle, setSelectedCircle] = useState('');
  const [selectedEmployeeType, setSelectedEmployeeType] = useState('');
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const dropdownRef = useRef(null);

  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(null);
  const [counts, setCounts] = useState({ total_employees: 0, new_joinees_last_30_days: 0, today_punch_in_count: 0 });
  const [birthdays, setBirthdays] = useState([]);
  const [anniversaries, setAnniversaries] = useState([]);

  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  const [signupForm, setSignupForm] = useState({
    user_name: '',
    first_name: '',
    email: '',
    emp_id: '',
    mobile: '',
    doj: '',
    emp_type: '',
    circle: '',
    password: '',
    confirmPassword: ''
  });
  const [signupSubmitting, setSignupSubmitting] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSignupChange = (e) => {
    const { name, value } = e.target;
    setSignupForm(prev => ({ ...prev, [name]: value }));
    setSignupError('');
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    setSignupError('');
    const { user_name, first_name, email, emp_id, mobile, doj, emp_type, circle, password, confirmPassword } = signupForm;
    if (!user_name?.trim() || !first_name?.trim() || !email?.trim() || !emp_id?.trim() || !mobile?.trim() || !doj || !emp_type || !circle) {
      setSignupError('Please fill in all required fields (UserName, Full Name, Email, Employee ID, Mobile, DOJ, Employee Type, Circle).');
      return;
    }
    if (password && password !== confirmPassword) {
      setSignupError('Password and Confirm Password do not match.');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) {
      setSignupError('Please log in to create an employee account.');
      return;
    }
    setSignupSubmitting(true);
    try {
      const res = await fetch(`${HR_API_BASE}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          user_name: user_name.trim(),
          first_name: first_name.trim(),
          email: email.trim(),
          emp_id: emp_id.trim(),
          mobile: mobile.trim().replace(/\s/g, ''),
          doj,
          emp_type,
          circle,
          ...(password?.trim() ? { password: password.trim() } : {})
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setSignupSuccess(true);
        setSignupForm({ user_name: '', first_name: '', email: '', emp_id: '', mobile: '', doj: '', emp_type: '', circle: '', password: '', confirmPassword: '' });
      } else {
        setSignupError(data.message || 'Failed to create account.');
      }
    } catch (err) {
      console.error(err);
      setSignupError('Network error. Please try again.');
    } finally {
      setSignupSubmitting(false);
    }
  };

  const employeeDetailsOptions = [
    'Family Details', 'Employee Details', 'Document', 
    'Previous Company', 'Education', 'Attendance', 
    'Leave Details', 'Punch In-Out'
  ];

  const stats = [
    { title: 'Total Employees', value: String(counts.total_employees), subtitle: 'All active', icon: Users, color: 'blue' },
    { title: 'New Hires', value: String(counts.new_joinees_last_30_days), subtitle: 'Last 30 days', icon: UserPlus, color: 'green' },
    { title: 'Active Today', value: String(counts.today_punch_in_count), subtitle: 'Punched in today', icon: UserCheck, color: 'purple' },
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
    { title: 'Exit Employee', icon: Users, description: 'Employee Exit Handling' },
    { title: 'Add Department And Circle', icon: MapPin, description: 'Add departments and circles Types' },
  ];

  const handleSearch = async () => {
    if (!selectedCircle || !selectedEmployeeType) {
      alert("Please select both Circle and Employee Type");
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) {
      alert("Please log in to search employees.");
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(
        `${HR_API_BASE}/search?circle=${encodeURIComponent(selectedCircle)}&emp_type=${encodeURIComponent(selectedEmployeeType)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (res.ok && data.success && data.employees) {
        setSearchResults(data.employees.map((e) => ({
          name: e.name,
          email: e.email,
          circle: selectedCircle,
          type: selectedEmployeeType,
          id: e.id
        })));
        setShowSearchResults(true);
      } else {
        setSearchResults([]);
        setShowSearchResults(true);
        if (!data.success && data.message) alert(data.message);
      }
    } catch (err) {
      console.error(err);
      setSearchResults([]);
      setShowSearchResults(true);
    } finally {
      setSearchLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setDashboardLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${HR_API_BASE}/dashboard`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          if (!cancelled) setDashboardError('Failed to load dashboard');
          return;
        }
        const data = await res.json();
        if (cancelled || !data.success) return;
        setCounts(data.counts || {});
        setBirthdays(data.birthdays || []);
        setAnniversaries(data.anniversaries || []);
        setDashboardError(null);
      } catch (err) {
        if (!cancelled) setDashboardError('Failed to load dashboard');
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
// }
  
  
     //Added by me 
    // If navigated here with a `view` in location.state, switch to it (e.g. 'updates')
    useEffect(() => {
      if (location && location.state && location.state.view) {
        setView(location.state.view);
      }
    }, [location]);

  // const searchResults = [
  //   { name: 'Amit', email: 'akumar4@saffotech.com', circle: selectedCircle, type: selectedEmployeeType },
  //   { name: 'Neha', email: 'nphatak@saffotech.com', circle: selectedCircle, type: selectedEmployeeType },
  //   { name: 'Plasha', email: 'ppal@saffotech.com', circle: selectedCircle, type: selectedEmployeeType },
  // ];

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
      setSignupSuccess(false);
      setSignupError('');
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
  else if (title === 'Exit Employee') { //New Condition For Exit Employee
  setView('exit_employee');
}
else if (title === 'Add Department And Circle') {
  setView('add_dept_circle');
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
if (view === 'exit_employee') {  //new condition for exit employee 
  return <ExitEmployee onBack={() => setView('updates')} />;
}

if (view === 'add_dept_circle') { //new condition for add department and cir.
  return <AddDeptCircle onBack={() => setView('updates')} />;
}

// Simple placeholder view for Add Circle & Employee Type card
if (view === 'add_circle_type') {
  return (
    <div className="add-circle-placeholder">
      <button className="btn-back-updates" onClick={() => setView('updates')}>
        <ArrowLeft size={16} /> Back to Updates
      </button>
      <div style={{padding:20}}>
        <h2>Add Circle & Employee Type</h2>
        <p>This view is a placeholder. Implement the add forms here when ready.</p>
      </div>
    </div>
  );
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
            {signupSuccess && (
              <div className="signup-success-msg" style={{ padding: '12px', marginBottom: '16px', background: '#dcfce7', color: '#166534', borderRadius: '8px' }}>
                Employee onboarded successfully. You can create another or go back.
              </div>
            )} 
            {signupError && (
              <div className="signup-error-msg" style={{ padding: '12px', marginBottom: '16px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px' }}>
                {signupError}
              </div>
            )}
            <form className="signup-form" onSubmit={handleSignupSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>UserName <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="user_name" type="text" placeholder="Create Unique UserName" value={signupForm.user_name} onChange={handleSignupChange} />
                </div>
                <div className="form-group">
                  <label>Full Name <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="first_name" type="text" placeholder="Enter your Full Name" value={signupForm.first_name} onChange={handleSignupChange} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="email" type="email" placeholder="Enter your Email ID" value={signupForm.email} onChange={handleSignupChange} />
                </div>
                <div className="form-group">
                  <label>Employee ID <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="emp_id" type="text" placeholder="Enter your Employee ID" value={signupForm.emp_id} onChange={handleSignupChange} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Mobile Number <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="mobile" type="tel" placeholder="Enter your Mobile Number" value={signupForm.mobile} onChange={handleSignupChange} />
                </div>
                <div className="form-group">
                  <label>Date of Joining <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="doj" type="date" value={signupForm.doj} onChange={handleSignupChange} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Employee Type <span style={{ color: '#b91c1c' }}>*</span></label>
                  <select name="emp_type" value={signupForm.emp_type} onChange={handleSignupChange}>
                    <option value="">Select Employee Type</option>
                    <option value="Human Resource">Human Resource</option>
                    <option value="Software Developer">Software Developer</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Circle <span style={{ color: '#b91c1c' }}>*</span></label>
                  <select name="circle" value={signupForm.circle} onChange={handleSignupChange}>
                    <option value="">Choose Your Circle</option>
                    <option value="NHQ">NHQ</option>
                    <option value="Delhi">Delhi</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Password (optional)</label>
                  <input name="password" type="password" placeholder="Leave blank to send set-password email" value={signupForm.password} onChange={handleSignupChange} />
                </div>
                <div className="form-group">
                  <label>Confirm Password</label>
                  <input name="confirmPassword" type="password" placeholder="Confirm your Password" value={signupForm.confirmPassword} onChange={handleSignupChange} />
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-create-account" disabled={signupSubmitting}>
                  {signupSubmitting ? 'Creating...' : 'Create Account'}
                </button>
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
      {dashboardLoading && <p className="hr-loading">Loading dashboard...</p>}
      {dashboardError && <p className="hr-error">{dashboardError}</p>}

      {!dashboardLoading && (birthdays.length > 0 || anniversaries.length > 0) && (
        <div className="birthday-anniversary-section">
          {birthdays.length > 0 && (
            <div className="birthday-anniversary-card">
              <div className="card-icon-wrapper">
                <div className="icon-circle">
                  <Cake size={24} className="icon-gold" />
                </div>
              </div>
              <div className="card-content-wrapper">
                <div className="card-header-row">
                  <span className="emoji-cake">🎂</span>
                  <h3 className="card-title-text">Birthday (DOB)</h3>
                </div>
                {birthdays.map((b, i) => (
                  <div key={i} className="employee-celebration-block">
                    <h2 className="employee-name-text">{b.name}</h2>
                    <div className="employee-details-row">
                      <span className="detail-item"><strong className="detail-label">Date:</strong> {formatDateShort(b.dob)}</span>
                      {b.designation && <span className="detail-item"><strong className="detail-label">Designation:</strong> {b.designation}</span>}
                      <span className="detail-item"><strong className="detail-label">Email:</strong> {b.email}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {anniversaries.length > 0 && (
            <div className="birthday-anniversary-card anniversary-card">
              <div className="card-icon-wrapper">
                <div className="icon-circle">
                  <Cake size={24} className="icon-gold" />
                </div>
              </div>
              <div className="card-content-wrapper">
                <div className="card-header-row">
                  <span className="emoji-cake">🎉</span>
                  <h3 className="card-title-text">Work Anniversary (DOJ)</h3>
                </div>
                {anniversaries.map((a, i) => (
                  <div key={i} className="employee-celebration-block">
                    <h2 className="employee-name-text">{a.name}</h2>
                    <div className="employee-details-row">
                      <span className="detail-item"><strong className="detail-label">DOJ:</strong> {formatDateShort(a.doj)}</span>
                      {a.designation && <span className="detail-item"><strong className="detail-label">Designation:</strong> {a.designation}</span>}
                      <span className="detail-item"><strong className="detail-label">Email:</strong> {a.email}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                <button className="btn-search" onClick={handleSearch} disabled={searchLoading}>
                  <i className="search-icon"></i> {searchLoading ? 'Searching...' : 'Search'}
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
    )};
