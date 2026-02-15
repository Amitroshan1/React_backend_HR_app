import React, { useState, useEffect, useRef } from 'react';
import { Search, Calendar, ArrowLeft, User, CreditCard, Briefcase, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import './Archive.css';

const ArchiveEmployees = () => {
  const navigate = useNavigate();
  const [archivedEmployees, setArchivedEmployees] = useState([]);
  const [filteredEmployees, setFilteredEmployees] = useState([]);
  
  // Filter states
  const [employeeType, setEmployeeType] = useState('');
  const [circle, setCircle] = useState('');
  const [email, setEmail] = useState('');
  
  // Searchable dropdown states
  const [typeSearch, setTypeSearch] = useState('');
  const [circleSearch, setCircleSearch] = useState('');
  
  const [showTypeList, setShowTypeList] = useState(false);
  const [showCircleList, setShowCircleList] = useState(false);
  
  // Hover card state
  const [hoveredEmployee, setHoveredEmployee] = useState(null);
  const [hoveredField, setHoveredField] = useState('');
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const [showHoverCard, setShowHoverCard] = useState(false);
  
  // Refs
  const hoverCardRef = useRef(null);
  const hoverTimerRef = useRef(null);
  
  const employeeTypes = ['Engineer', 'Accountant', 'HR', 'Manager'];
  const circles = ['Mumbai', 'Delhi', 'Gurugram'];
  
  // Check if email filter is active
  const isEmailFilterActive = email.trim() !== '';
  
  // Check if employeeType or circle filter is active
  const isTypeOrCircleFilterActive = employeeType !== '' || circle !== '';

  // Load archived employees from localStorage
  useEffect(() => {
    const loadArchivedEmployees = () => {
      const archived = localStorage.getItem('archivedEmployees');
      if (archived) {
        try {
          const parsed = JSON.parse(archived);
          setArchivedEmployees(parsed);
          setFilteredEmployees(parsed);
        } catch (error) {
          console.error('Error loading archived employees:', error);
          localStorage.setItem('archivedEmployees', JSON.stringify([]));
          setArchivedEmployees([]);
          setFilteredEmployees([]);
        }
      } else {
        localStorage.setItem('archivedEmployees', JSON.stringify([]));
        setArchivedEmployees([]);
        setFilteredEmployees([]);
      }
    };
    
    loadArchivedEmployees();
    
    window.addEventListener('storage', loadArchivedEmployees);
    window.addEventListener('employeeArchived', loadArchivedEmployees);
    
    return () => {
      window.removeEventListener('storage', loadArchivedEmployees);
      window.removeEventListener('employeeArchived', loadArchivedEmployees);
    };
  }, []);

  // Filter employees when filters change
  useEffect(() => {
    filterEmployees();
  }, [employeeType, circle, email, archivedEmployees]);

  const filterEmployees = () => {
    let filtered = [...archivedEmployees];

    if (email.trim()) {
      filtered = filtered.filter(emp =>
        emp.email.toLowerCase() === email.toLowerCase().trim()
      );
    } else if (employeeType && circle) {
      filtered = filtered.filter(emp =>
        emp.employeeType === employeeType && emp.circle === circle
      );
    } else if (employeeType) {
      filtered = filtered.filter(emp => emp.employeeType === employeeType);
    } else if (circle) {
      filtered = filtered.filter(emp => emp.circle === circle);
    }

    setFilteredEmployees(filtered);
  };

  // Handle mouse enter on employee field
  const handleMouseEnter = (employee, field, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoverPosition({
      x: rect.left,
      y: rect.bottom + 10
    });
    setHoveredEmployee(employee);
    setHoveredField(field);
    
    // Clear any existing timer
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    
    // Show hover card immediately
    setShowHoverCard(true);
  };

  // Handle mouse leave from employee field
  const handleMouseLeave = (e) => {
    // Check if mouse is moving to hover card
    const relatedTarget = e.relatedTarget;
    if (relatedTarget && hoverCardRef.current && hoverCardRef.current.contains(relatedTarget)) {
      return; // Don't hide if moving to hover card
    }
    
    // Start timer to hide hover card
    hoverTimerRef.current = setTimeout(() => {
      setShowHoverCard(false);
      setHoveredEmployee(null);
    }, 150);
  };

  // Handle mouse enter on hover card
  const handleHoverCardEnter = () => {
    // Clear hide timer when entering hover card
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
  };

  // Handle mouse leave from hover card
  const handleHoverCardLeave = () => {
    // Start timer to hide hover card
    hoverTimerRef.current = setTimeout(() => {
      setShowHoverCard(false);
      setHoveredEmployee(null);
    }, 150);
  };

  // Handle card click (for future navigation)
  const handleCardClick = (section, e) => {
    e.stopPropagation(); // Prevent event bubbling
    if (hoveredEmployee) {
      console.log(`Navigate to ${section} for employee:`, hoveredEmployee.name);
      // In future, navigate to separate pages here
      // navigate(`/archive/${hoveredEmployee.id}/${section}`);
    }
  };

  const resetFilters = () => {
    setEmployeeType('');
    setCircle('');
    setEmail('');
    setTypeSearch('');
    setCircleSearch('');
  };

  // Handle row click to navigate to ExitEmployee page (only for row, not cells)
  const handleRowClick = (employee, e) => {
    // Don't navigate on row click - only navigate from specific clickable areas
    // This prevents accidental navigation when clicking cells
    return false;
  };

  // Handle field click - only show hover card, don't navigate
  const handleFieldClick = (e, employee) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverPosition({
      x: rect.left,
      y: rect.bottom + 10
    });
    setHoveredEmployee(employee);
    setShowHoverCard(true);
  };

  return (
    <div className="archive-container">
      <div className="archive-wrapper">
        {/* Back Button */}
        <button className="back-button" onClick={() => navigate('/exit-employees')}>
          <ArrowLeft size={20} />
          <span>Back to Exit Employees</span>
        </button>

        {/* Title */}
        <div className="title-section">
          <h1 className="page-title">Archive Employees</h1>
          <p className="page-subtitle">View exited employees archive</p>
        </div>

        {/* Filters */}
        <div className="filters-section">
          <div className="filter-row">
            {/* Employee Type */}
            <div className="filter-group">
              <label>Employee Type</label>
              <div className="custom-select">
                <input
                  type="text"
                  placeholder="Select or type"
                  className="filter-input"
                  value={typeSearch !== '' ? typeSearch : employeeType}
                  onFocus={() => !isEmailFilterActive && setShowTypeList(true)}
                  onChange={(e) => {
                    if (!isEmailFilterActive) {
                      setTypeSearch(e.target.value);
                      if (e.target.value === '') {
                        setEmployeeType('');
                      }
                      setShowTypeList(true);
                    }
                  }}
                  disabled={isEmailFilterActive}
                  style={{
                    cursor: isEmailFilterActive ? 'not-allowed' : 'text',
                    backgroundColor: isEmailFilterActive ? '#f5f5f5' : 'white',
                    opacity: isEmailFilterActive ? 0.6 : 1
                  }}
                />

                {showTypeList && !isEmailFilterActive && (
                  <div className="dropdown-list">
                    <div
                      className="dropdown-item"
                      onClick={() => {
                        setEmployeeType('');
                        setTypeSearch('');
                        setShowTypeList(false);
                      }}
                    >
                      All Types
                    </div>

                    {employeeTypes
                      .filter(type =>
                        type.toLowerCase().includes(typeSearch.toLowerCase())
                      )
                      .map(type => (
                        <div
                          key={type}
                          className="dropdown-item"
                          onClick={() => {
                            setEmployeeType(type);
                            setTypeSearch('');
                            setShowTypeList(false);
                          }}
                        >
                          {type}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            {/* Circle */}
            <div className="filter-group">
              <label>Circle</label>
              <div className="custom-select">
                <input
                  type="text"
                  placeholder="Select or type"
                  className="filter-input"
                  value={circleSearch !== '' ? circleSearch : circle}
                  onFocus={() => !isEmailFilterActive && setShowCircleList(true)}
                  onChange={(e) => {
                    if (!isEmailFilterActive) {
                      setCircleSearch(e.target.value);
                      if (e.target.value === '') {
                        setCircle('');
                      }
                      setShowCircleList(true);
                    }
                  }}
                  disabled={isEmailFilterActive}
                  style={{
                    cursor: isEmailFilterActive ? 'not-allowed' : 'text',
                    backgroundColor: isEmailFilterActive ? '#f5f5f5' : 'white',
                    opacity: isEmailFilterActive ? 0.6 : 1
                  }}
                />

                {showCircleList && !isEmailFilterActive && (
                  <div className="dropdown-list">
                    <div
                      className="dropdown-item"
                      onClick={() => {
                        setCircle('');
                        setCircleSearch('');
                        setShowCircleList(false);
                      }}
                    >
                      All Circles
                    </div>

                    {circles
                      .filter(cir =>
                        cir.toLowerCase().includes(circleSearch.toLowerCase())
                      )
                      .map(cir => (
                        <div
                          key={cir}
                          className="dropdown-item"
                          onClick={() => {
                            setCircle(cir);
                            setCircleSearch('');
                            setShowCircleList(false);
                          }}
                        >
                          {cir}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>

            <span className="or-text">
              <p className="or">Or</p>
            </span>

            {/* Email */}
            <div className="filter-group email-filter">
              <label>Search by Email</label>
              <div className="email-input-wrapper">
                <Search className="email-icon" size={18} />
                <input
                  type="email"
                  placeholder="Enter email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="email-input"
                  disabled={isTypeOrCircleFilterActive}
                  style={{
                    cursor: isTypeOrCircleFilterActive ? 'not-allowed' : 'text',
                    backgroundColor: isTypeOrCircleFilterActive ? '#f5f5f5' : 'white',
                    opacity: isTypeOrCircleFilterActive ? 0.6 : 1,
                  }}
                />
              </div>
            </div>

            <button className="reset-button" onClick={resetFilters}>
              Reset
            </button>
          </div>

          <div className="results-count">
            Showing {filteredEmployees.length} of {archivedEmployees.length} archived employees
          </div>
        </div>

        {/* Table */}
        <div className="table-container">
          <table className="employees-table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Circle</th>
                <th>Employee Type</th>
                <th>Email</th>
              </tr>
            </thead>

            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan="5" className="no-data">
                    No archived employees found
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(emp => (
                  <tr 
                    key={emp.id}
                    className="employee-row"
                  >
                    <td 
                      className="hoverable-cell"
                      onMouseEnter={(e) => handleMouseEnter(emp, 'id', e)}
                      onMouseLeave={handleMouseLeave}
                      onClick={(e) => handleFieldClick(e, emp)}
                    >
                      {emp.employeeId}
                    </td>
                    
                    <td 
                      className="hoverable-cell employee-name"
                      onMouseEnter={(e) => handleMouseEnter(emp, 'name', e)}
                      onMouseLeave={handleMouseLeave}
                      onClick={(e) => handleFieldClick(e, emp)}
                    >
                      {emp.name}
                    </td>

                    <td
                      className="hoverable-cell"
                      onMouseEnter={(e) => handleMouseEnter(emp, 'circle', e)}
                      onMouseLeave={handleMouseLeave}
                      onClick={(e) => handleFieldClick(e, emp)}
                    >
                      <span className="circle-badge">{emp.circle}</span>
                    </td>

                    <td
                      className="hoverable-cell"
                      onMouseEnter={(e) => handleMouseEnter(emp, 'type', e)}
                      onMouseLeave={handleMouseLeave}
                      onClick={(e) => handleFieldClick(e, emp)}
                    >
                      <span className="type-badge">
                        {emp.employeeType}
                      </span>
                    </td>

                    <td 
                      className="hoverable-cell employee-email"
                      onMouseEnter={(e) => handleMouseEnter(emp, 'email', e)}
                      onMouseLeave={handleMouseLeave}
                      onClick={(e) => handleFieldClick(e, emp)}
                    >
                      {emp.email}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hover Card - Horizontal Layout */}
      {showHoverCard && hoveredEmployee && (
        <div 
          ref={hoverCardRef}
          className="hover-card hover-card-horizontal"
          style={{
            left: `${hoverPosition.x}px`,
            top: `${hoverPosition.y}px`
          }}
          onMouseEnter={handleHoverCardEnter}
          onMouseLeave={handleHoverCardLeave}
        >
          <div className="hover-card-content-horizontal">
            <div 
              className="card-section-horizontal" 
              onClick={(e) => handleCardClick('profile', e)}
            >
              <User size={16} />
              <div>
                <h5>Profile</h5>
                <p>View employee details</p>
              </div>
            </div>
            
            <div 
              className="card-section-horizontal" 
              onClick={(e) => handleCardClick('bank-details', e)}
            >
              <CreditCard size={16} />
              <div>
                <h5>Bank Details</h5>
                <p>Account information</p>
              </div>
            </div>
            
            <div 
              className="card-section-horizontal" 
              onClick={(e) => handleCardClick('previous-company', e)}
            >
              <Briefcase size={16} />
              <div>
                <h5>Previous Company</h5>
                <p>Work history</p>
              </div>
            </div>
            
            <div 
              className="card-section-horizontal" 
              onClick={(e) => handleCardClick('documents', e)}
            >
              <FileText size={16} />
              <div>
                <h5>Documents</h5>
                <p>View all documents</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArchiveEmployees;