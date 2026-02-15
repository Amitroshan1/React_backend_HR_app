import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Archive, Search, AlertCircle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import './ExitEmployee.css';

// initial employees (module-level so it's not re-created on every render)
const initialEmployees = [
  { id: 1, employeeId: 'EMP001', name: 'Rajesh Kumar', circle: 'Mumbai', employeeType: 'Engineer', email: 'rajesh.kumar@company.com' },
  { id: 2, employeeId: 'EMP002', name: 'Priya Sharma', circle: 'Delhi', employeeType: 'Accountant', email: 'priya.sharma@company.com' },
  { id: 3, employeeId: 'EMP003', name: 'Amit Patel', circle: 'Gurugram', employeeType: 'HR', email: 'amit.patel@company.com' },
  { id: 4, employeeId: 'EMP004', name: 'Sneha Desai', circle: 'Mumbai', employeeType: 'Engineer', email: 'sneha.desai@company.com' },
  { id: 5, employeeId: 'EMP005', name: 'Vikram Singh', circle: 'Delhi', employeeType: 'Manager', email: 'vikram.singh@company.com' },
  { id: 6, employeeId: 'EMP006', name: 'Meera Nair', circle: 'Gurugram', employeeType: 'Engineer', email: 'meera.nair@company.com' },
  { id: 7, employeeId: 'EMP007', name: 'Arjun Reddy', circle: 'Mumbai', employeeType: 'Accountant', email: 'arjun.reddy@company.com' },
  { id: 8, employeeId: 'EMP008', name: 'Kavita Rao', circle: 'Delhi', employeeType: 'HR', email: 'kavita.rao@company.com' },
  { id: 9, employeeId: 'EMP009', name: 'Rohit Mehta', circle: 'Gurugram', employeeType: 'Manager', email: 'rohit.mehta@company.com' },
  { id: 10, employeeId: 'EMP010', name: 'Ananya Iyer', circle: 'Mumbai', employeeType: 'Engineer', email: 'ananya.iyer@company.com' },
  { id: 11, employeeId: 'EMP011', name: 'Sanjay Gupta', circle: 'Delhi', employeeType: 'Accountant', email: 'sanjay.gupta@company.com' },
  { id: 12, employeeId: 'EMP012', name: 'Pooja Verma', circle: 'Gurugram', employeeType: 'HR', email: 'pooja.verma@company.com' },
];

const ExitEmployee = ({onBack}) => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Check if employee data was passed from Archive and where we came from
  const employeeFromArchive = location.state?.selectedEmployee;
  const sourceFrom = location.state?.from; // 'archive' or undefined (from HR)
  
  const wrapperRef = useRef(null);

  // close dropdowns when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) {
        setShowTypeList(false);
        setShowCircleList(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const [employees, setEmployees] = useState(initialEmployees);
  const [filteredEmployees, setFilteredEmployees] = useState(initialEmployees);

  const [employeeType, setEmployeeType] = useState('');
  const [circle, setCircle] = useState('');
  const [email, setEmail] = useState('');

  // Searchable dropdown states
  const [typeSearch, setTypeSearch] = useState('');
  const [circleSearch, setCircleSearch] = useState('');

  const [showTypeList, setShowTypeList] = useState(false);
  const [showCircleList, setShowCircleList] = useState(false);

  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const employeeTypes = ['Engineer', 'Accountant', 'HR', 'Manager'];
  const circles = ['Mumbai', 'Delhi', 'Gurugram'];

  // Check if email filter is active
  const isEmailFilterActive = email.trim() !== '';
  
  // Check if employeeType or circle filter is active
  const isTypeOrCircleFilterActive = employeeType !== '' || circle !== '';

  useEffect(() => {
    filterEmployees();
  }, [employeeType, circle, email, employees]);

  // Handle employee data passed from Archive
  useEffect(() => {
    if (employeeFromArchive) {
      setSelectedEmployee(employeeFromArchive);
      setShowConfirm(true);
    }
  }, [employeeFromArchive]);

  const filterEmployees = () => {
    let filtered = [...employees];

    if (email.trim()) {
      // Email search takes priority and searches exact match
      filtered = filtered.filter(emp =>
        emp.email.toLowerCase() === email.toLowerCase().trim()
      );
    } else if (employeeType && circle) {
      // Both filters applied
      filtered = filtered.filter(emp =>
        emp.employeeType === employeeType && emp.circle === circle
      );
    } else if (employeeType) {
      // Only employee type filter
      filtered = filtered.filter(emp => emp.employeeType === employeeType);
    } else if (circle) {
      // Only circle filter
      filtered = filtered.filter(emp => emp.circle === circle);
    }

    setFilteredEmployees(filtered);
  };

  const handleActionClick = (employee) => {
    setSelectedEmployee(employee);
    setShowConfirm(true);
  };

  const handleConfirmExit = async () => {
    if (!selectedEmployee) return;

    await new Promise(resolve => setTimeout(resolve, 500));

    const updatedEmployees = employees.filter(emp => emp.id !== selectedEmployee.id);
    setEmployees(updatedEmployees);

    // Get current archived employees from localStorage
    let archivedEmployees = [];
    const stored = localStorage.getItem('archivedEmployees');
    if (stored) {
      try {
        archivedEmployees = JSON.parse(stored);
      } catch (error) {
        console.error('Error parsing archived employees:', error);
        archivedEmployees = [];
      }
    }

    // Check if employee already exists in archive (prevent duplicates)
    const employeeExists = archivedEmployees.some(emp => emp.id === selectedEmployee.id);
    
    let newArchivedEmployee = null;
    if (!employeeExists) {
      newArchivedEmployee = {
        ...selectedEmployee,
        exitDate: new Date().toISOString()
      };

      archivedEmployees.push(newArchivedEmployee);
    }

    // Save to localStorage
    localStorage.setItem('archivedEmployees', JSON.stringify(archivedEmployees));

    // Dispatch custom event to notify Archive component to reload
    if (newArchivedEmployee) {
      window.dispatchEvent(new CustomEvent('employeeArchived', {
        detail: { archivedEmployee: newArchivedEmployee }
      }));
    } else {
      window.dispatchEvent(new Event('employeeArchived'));
    }

    setShowConfirm(false);
    setSelectedEmployee(null);
    setShowSuccess(true);

    setTimeout(() => setShowSuccess(false), 3000);
  };

  const handleCancelExit = () => {
    setShowConfirm(false);
    setSelectedEmployee(null);
  };

  const resetFilters = () => {
    setEmployeeType('');
    setCircle('');
    setEmail('');
    setTypeSearch('');
    setCircleSearch('');
  };

  return (
    <div className="exit-employee-container" ref={wrapperRef}>
      <div className="exit-employee-wrapper">

        {/* Header */} 

        <div className="header-section">
          <button
            className="back-button"
            aria-label="Back to Updates"
            onClick={() => {
              if (onBack) {
                // Called from Hr.jsx with onBack prop
                onBack();
              } else if (sourceFrom === 'archive') {
                // Called from Archive page — replace history so back doesn't return here
                navigate('/archive-employees', { replace: true });
              } else {
                // Always navigate to Updates to avoid landing on Archive
                // Use replace so we don't add extra history entries
                navigate('/updates', { state: { view: 'updates' }, replace: true });
              }
            }}
          >
            <ArrowLeft size={20} />
            <span>Back to Updates</span>
          </button>

          <button
            className="archive-button"
            aria-label="Open Archive"
            onClick={() => navigate('/archive-employees')}
          >
            <Archive size={20} />
            <span>Archive</span>
          </button>
        </div>

        {/* Title */}

        <div className="title-section">
          <h1 className="page-title">Exit Employees</h1>
          <p className="page-subtitle">Manage and archive exited employees</p>
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
                  // value={typeSearch || employeeType} 
                  value={typeSearch !=='' ? typeSearch : employeeType}
                  onFocus={() => !isEmailFilterActive && setShowTypeList(true)}
                  onChange={(e) => {
                    if (!isEmailFilterActive) {
                      setTypeSearch(e.target.value);
                      // setShowTypeList(true); 
                      if (e.target.value === ''){
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
                  // value={circleSearch || circle}
                  value={circleSearch !== '' ? circleSearch : circle}
                  onFocus={() => !isEmailFilterActive && setShowCircleList(true)}
                  onChange={(e) => {
                    if (!isEmailFilterActive) {
                      setCircleSearch(e.target.value);
                      // setShowCircleList(true);
                      if(e.target.value === ''){
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

            <span className='or-text'>
              <p className='or'>
                Or
              </p>
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
                    // marginTop: 'px'
                  }}
                />
              </div>
            </div>

            <button className="reset-button" onClick={resetFilters}>
              Reset
            </button>
          </div>

          <div className="results-count">
            Showing {filteredEmployees.length} of {employees.length} employees
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
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan="6" className="no-data">
                    No employees found
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(emp => (
                  <tr key={emp.id}>
                    <td>{emp.employeeId}</td>
                    <td className="employee-name">{emp.name}</td>

                    <td>
                      <span className="circle-badge">{emp.circle}</span>
                    </td>

                    <td>
                      <span className="type-badge">{emp.employeeType}</span>
                    </td>

                    <td className="employee-email">{emp.email}</td>

                    <td>
                      <button
                        className="action-button"
                        onClick={() => handleActionClick(emp)}
                      >
                        Exit Employee
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */} 

      {showConfirm && (
        <div className="modal-overlay">
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">

            <div className="modal-icon">
              <AlertCircle size={48} />
            </div>

            <h2 id="confirm-modal-title" className="modal-title">Confirm Exit</h2>

            <p className="modal-message">
              Are you sure you want to exit <strong>{selectedEmployee?.name}</strong>?
            </p>

            <div className="modal-actions">
              <button
                className="modal-button cancel-button"
                onClick={handleCancelExit}
              >
                No
              </button>

              <button
                className="modal-button confirm-button"
                onClick={handleConfirmExit}
              >
                Yes
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Success Toast */} 

      {showSuccess && (
        <div className="success-toast">
          ✓ Employee exited successfully and moved to archive
        </div>
      )}

    </div>
  );
};

export default ExitEmployee; 

