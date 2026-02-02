import React, { useState, useRef, useEffect } from 'react';
import { Receipt, Calendar, Plus, FileText, Trash2, CheckCircle } from 'lucide-react';
import './Claims.css';

export const Claims = () => {
  const [claims, setClaims] = useState([]);
  const [claimForm, setClaimForm] = useState({
    employeeName: '',
    designation: '',
    employeeId: '',
    email: '',
    projectName: '',
    country: '',
    travelFrom: '',
    travelTo: '',
    expenseDate: '',
    purpose: '',
    amount: '',
    currency: 'INR',
    attachFile: null,
  });

  const handleInputChange = (e) => {
    const { id, value } = e.target;
    setClaimForm((prev) => ({ ...prev, [id]: value }));
  };

  const handleFileChange = (e) => {
    setClaimForm((prev) => ({ ...prev, attachFile: e.target.files[0] }));
  };

  const handleSubmitClaim = (addMore = false) => {
    // Basic Validation
    if (!claimForm.expenseDate || !claimForm.purpose || !claimForm.amount || !claimForm.country) {
      alert("Please fill in all required expense details");
      return;
    }

    const newClaim = {
      id: Date.now(),
      country: claimForm.country,
      date: claimForm.expenseDate,
      purpose: claimForm.purpose,
      amount: claimForm.amount,
      currency: claimForm.currency,
      status: 'pending'
    };

    setClaims([...claims, newClaim]);

    if (addMore) {
      // Reset only the expense-specific fields
      setClaimForm(prev => ({
        ...prev,
        expenseDate: '',
        purpose: '',
        amount: '',
        attachFile: null,
      }));
    } else {
      // Full Reset
      resetForm();
      alert("Expense claim submitted successfully!");
    }
  };

  const resetForm = () => {
    setClaimForm({
      employeeName: '', designation: '', employeeId: '', email: '',
      projectName: '', country: '', travelFrom: '', travelTo: '',
      expenseDate: '', purpose: '', amount: '', currency: 'INR', attachFile: null,
    });
  };


  const totalAmount = claims.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);

  return (
    <div className="claims-page-container">
      {/* <div className="claims-header">
        <h1>Expense Claims</h1>
        <p>Submit and track your expense claims</p>
      </div> */}

      {/* Main Form Card */}
      <div className="claims-card">
        <div className="card-header">
          <Receipt className="icon-primary" />
          <h3>Expense Claim Form</h3>
        </div>

        <div className="card-body">
          {/* Employee Information Section */}
          <div className="form-section-grid">
            <div className="form-group">
              <label htmlFor="employeeName">Employee Name</label>
              <input type="text" id="employeeName" value={claimForm.employeeName} onChange={handleInputChange} placeholder="Enter name" />
            </div>
            <div className="form-group">
              <label htmlFor="designation">Designation</label>
              <input type="text" id="designation" value={claimForm.designation} onChange={handleInputChange} placeholder="Enter designation" />
            </div>
            <div className="form-group">
              <label htmlFor="employeeId">Employee ID</label>
              <input type="text" id="employeeId" value={claimForm.employeeId} onChange={handleInputChange} placeholder="Enter ID" />
            </div>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input type="email" id="email" value={claimForm.email} onChange={handleInputChange} placeholder="Enter email" />
            </div>
          </div>

          <div className="form-section-grid">
            <div className="form-group">
              <label htmlFor="projectName">Project Name</label>
              <input type="text" id="projectName" value={claimForm.projectName} onChange={handleInputChange} placeholder="Enter project" />
            </div>
            <div className="form-group">
              <label htmlFor="country">Country/State</label>
              <input type="text" id="country" value={claimForm.country} onChange={handleInputChange} placeholder="Enter location" />
            </div>
            <div className="form-group">
              <label htmlFor="travelFrom">Travel From</label>
              <input type="date" id="travelFrom" value={claimForm.travelFrom} onChange={handleInputChange} />
            </div>
            <div className="form-group">
              <label htmlFor="travelTo">Travel To</label>
              <input type="date" id="travelTo" value={claimForm.travelTo} onChange={handleInputChange} />
            </div>
          </div>

          <hr className="divider" />

          {/* Specific Expense Details */}
          <h4 className="section-subtitle">Expense Details</h4>
          <div className="expense-details-grid">
            <div className="form-group col-sr">
              <label>Sr. No.</label>
              <input type="text" value={claims.length + 1} disabled className="input-disabled" />
            </div>
            <div className="form-group col-date">
              <label>Date</label>
              <input type="date" id="expenseDate" value={claimForm.expenseDate} onChange={handleInputChange} />
            </div>
            <div className="form-group col-purpose">
              <label>Purpose/Description</label>
              <input type="text" id="purpose" value={claimForm.purpose} onChange={handleInputChange} placeholder="Enter purpose" />
            </div>
            <div className="form-group col-amount">
              <label>Amount</label>
              <input type="number" id="amount" value={claimForm.amount} onChange={handleInputChange} placeholder="0.00" />
            </div>
            <div className="form-group col-currency">
              <label>Currency</label>
              <select id="currency" value={claimForm.currency} onChange={handleInputChange}>
                <option value="INR">INR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>

          <div className="action-footer">
            <div className="form-group">
              <label htmlFor="attachFile">Attach Supporting Receipt</label>
              <div className="file-input-wrapper">
                <input type="file" id="attachFile" onChange={handleFileChange} />
                <span className="file-custom-label">
                   {claimForm.attachFile ? claimForm.attachFile.name : 'Choose file...'}
                </span>
              </div>
            </div>
            <button className="btn-submit-more" onClick={() => handleSubmitClaim(true)}>
              <Plus size={18} /> Add to List
            </button>
          </div>
        </div>
      </div>

      {/* Submitted Claims Table Card */}
      <div className="claims-card table-card">
        <div className="card-header">
          <FileText className="icon-primary" />
          <h3>Submitted Claims List</h3>
        </div>
        <div className="table-responsive">
          <table className="claims-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Country</th>
                <th>Date</th>
                <th>Purpose</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {claims.length === 0 ? (
                <tr>
                  <td colSpan="6" className="table-empty">No claims added yet.</td>
                </tr>
              ) : (
                claims.map((claim, index) => (
                  <tr key={claim.id}>
                    <td>{index + 1}</td>
                    <td>{claim.country}</td>
                    <td>{claim.date}</td>
                    <td>{claim.purpose}</td>
                    <td><strong>{claim.amount} {claim.currency}</strong></td>
                    <td>
                      <span className={`status-badge ${claim.status}`}>
                        {claim.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* {claims.length > 0 && (
          <div className="final-submit-area">
             <button className="btn-final" onClick={() => handleSubmitClaim(false)}>
               Submit Final Claim Report
             </button>
          </div>
        )} */}

{claims.length > 0 && (
  <div className="summary-section">
    <div className="total-box">
      <div className="total-label">Total Claim Amount</div>
      <div className="total-value">
        {totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} {claimForm.currency}
      </div>
    </div>
    <div className="final-actions">
      <button className="btn-final" onClick={() => handleSubmitClaim(false)}>
        Submit Final Claim Report
      </button>
    </div>
  </div>
)}
      </div>
    </div>
  );
}