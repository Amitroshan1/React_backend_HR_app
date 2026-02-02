import React, { useState } from 'react';
import { ArrowLeft, Search, Bell, User } from 'lucide-react';
import './UpdateSignUp.css';

export const UpdateSignUp = ({ onBack }) => {
  const [view, setView] = useState('search'); // 'search' or 'edit'
  const [showResults, setShowResults] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  // Mock data matching reference image 0a8c40.png
  const mockEmployees = [
    { id: '10119', name: 'Meghana Kalyankar', email: 'mkalyankar@saffotech.com', username: 'user_4', joiningDate: '2020-02-01', mobile: '9969120315', circle: 'NHQ', type: 'Software Developer' },
    { id: '10277', name: 'Jyoti yadav', email: 'jyoti@saffotech.com', username: 'jyoti_y', joiningDate: '2021-05-12', mobile: '9876543210', circle: 'NHQ', type: 'Software Developer' },
    { id: '10000', name: 'Accounts', email: 'accounts@saffotech.com', username: 'acc_dept', joiningDate: '2019-11-20', mobile: '9123456789', circle: 'NHQ', type: 'Software Developer' },
    { id: '10314', name: 'Shruti naresh sonawane', email: 'shruti@saffotech.com', username: 'shruti_s', joiningDate: '2022-01-15', mobile: '9000000000', circle: 'NHQ', type: 'Software Developer' },
  ];

  const handleSearch = () => setShowResults(true);

  const handleViewDetails = (emp) => {
    setSelectedEmployee(emp);
    setView('edit');
  };

  // --- SUB-VIEW: EDIT DETAILS (Matches Image 0a8c65.png) ---
  if (view === 'edit') {
    return (
      <div className="update-signup-page">
        <div className="top-nav">
          <button className="btn-back-nav" onClick={() => setView('search')}>
            <ArrowLeft size={18} /> Back to Search
          </button>
        </div>

        <div className="content-container">
          <div className="edit-details-card">
            <div className="card-header">
              <h2>Employee Details</h2>
              <p>Update information for {selectedEmployee.name}</p>
            </div>

            <form className="edit-form" onSubmit={(e) => e.preventDefault()}>
              <div className="form-grid">
                <div className="form-group highlighted">
                  <label>UserName</label>
                  <input type="text" defaultValue={selectedEmployee.username} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" defaultValue={selectedEmployee.email} />
                </div>
                <div className="form-group">
                  <label>Employee ID</label>
                  <input type="text" defaultValue={selectedEmployee.id} disabled />
                </div>
                <div className="form-group">
                  <label>Full Name</label>
                  <input type="text" defaultValue={selectedEmployee.name} />
                </div>
                <div className="form-group">
                  <label>Date of Joining</label>
                  <input type="text" defaultValue={selectedEmployee.joiningDate} />
                </div>
                <div className="form-group">
                  <label>Mobile Number</label>
                  <input type="tel" defaultValue={selectedEmployee.mobile} />
                </div>
                <div className="form-group">
                  <label>Circle</label>
                  <select defaultValue={selectedEmployee.circle}>
                    <option value="NHQ">NHQ</option>
                    <option value="Delhi">Delhi</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Employee Type</label>
                  <select defaultValue={selectedEmployee.type}>
                    <option value="Software Developer">Software Developer</option>
                    <option value="Human Resource">Human Resource</option>
                  </select>
                </div>
              </div>

              <div className="form-footer-actions">
                <button type="button" className="btn-delete">Delete Employee</button>
                <button type="submit" className="btn-update-final">Update Details</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN VIEW: SEARCH & TABLE (Matches Image 0a8c40.png) ---
  return (
    <div className="update-signup-page">

      <div className="content-container">
        <button className="btn-back-nav" onClick={onBack}>
          <ArrowLeft size={18} /> Back to Updates
        </button>

        {/* Search Box Section */}
        <div className="search-filter-card">
          <h3>Search Employee</h3>
          <p>Select filters to find employees</p>
          <div className="filter-row">
            <div className="filter-group">
              <label>Employee Type</label>
              <select><option>Software Developer</option></select>
            </div>
            <div className="filter-group">
              <label>Circle</label>
              <select><option>NHQ</option></select>
            </div>
            <button className="btn-search-blue" onClick={handleSearch}>
              <Search size={18} /> Search
            </button>
          </div>
        </div>

        {/* Results Table Section */}
        {showResults && (
          <div className="results-card">
            <div className="results-header">
              <h3>Search Results</h3>
              <p>Software Developer employees in NHQ</p>
            </div>
            <div className="table-wrapper">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Employee ID</th>
                    <th>First Name</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {mockEmployees.map((emp) => (
                    <tr key={emp.id}>
                      <td>{emp.id}</td>
                      <td>{emp.name}</td>
                      <td>
                        <button className="btn-view-details" onClick={() => handleViewDetails(emp)}>
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
