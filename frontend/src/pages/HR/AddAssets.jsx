import React, { useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import './AddAssets.css';

export const AddAssets = ({ onBack }) => {
  const [showDetails, setShowDetails] = useState(false);
  const [employeeId, setEmployeeId] = useState('10317');

  const handleSearch = () => {
    if (employeeId.trim() !== "") {
      setShowDetails(true);
    }
  };

  return (
    <div className="assets-page-wrapper">
      <div className="assets-container">
        {/* Back Button positioned above the card */}
        <button className="btn-back-link" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="assets-card">
          <div className="assets-card-header">
            <h2>Add Assets</h2>
            <Search size={20} className="header-search-icon" />
          </div>

          <div className="search-section">
            <h3>Search Employee</h3>
            <label>Employee ID</label>
            <div className="search-input-group">
              <input 
                type="text" 
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="Enter Employee ID"
              />
              <button className="btn-search-blue" onClick={handleSearch}>
                Search
              </button>
            </div>
            <p className="sub-label">Search to assets</p>
          </div>

          {showDetails && (
            <div className="employee-details-section">
              <h3>Employee Details</h3>
              <table className="details-table">
                <tbody>
                  <tr>
                    <td className="label-cell">Name</td>
                    <td className="value-cell">Prajukta chakrapani podili</td>
                  </tr>
                  <tr>
                    <td className="label-cell">Employee Type</td>
                    <td className="value-cell">Human resource</td>
                  </tr>
                  <tr>
                    <td className="label-cell">Circle</td>
                    <td className="value-cell">NHQ</td>
                  </tr>
                  <tr>
                    <td className="label-cell last-cell"></td>
                    <td className="value-cell">NHQ</td>
                  </tr>
                </tbody>
              </table>

              <div className="assets-footer">
                <button className="btn-add-asset">Add Asset</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
