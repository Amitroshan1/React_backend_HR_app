import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Receipt, Calendar, Plus, FileText, Trash2, CheckCircle } from 'lucide-react';
import './Claims.css';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { formatDate } from '../../utils/dateFormat';
import { useUser } from '../../components/layout/UserContext';

const API_BASE_URL = "/api/leave";

const isTravelRangeValid = (from, to) => Boolean(from && to && from <= to);

const isDateInTravelRange = (date, from, to) =>
  Boolean(date && from && to && date >= from && date <= to);

const travelRangeError = (from, to) => {
  if (!from || !to) return 'Please set Travel From and Travel To dates first.';
  if (from > to) return 'Travel From cannot be after Travel To.';
  return null;
};

const buildEmployeeDefaults = (userData) => {
  const user = userData?.user || {};
  const employee = userData?.employee || {};
  const name =
    (user.name || '').trim() ||
    (user.first_name || '').trim() ||
    (user.user_name || '').trim();
  return {
    employeeName: name,
    designation: (user.designation || employee.designation || '').trim(),
    employeeId: (user.emp_id || '').trim(),
    email: (user.email || '').trim(),
  };
};

export const Claims = () => {
  const { userData, loadingUser, refreshUserData } = useUser();
  const [claims, setClaims] = useState([]); // Local list of expense items to be submitted
  const [submittedClaims, setSubmittedClaims] = useState([]); // Claims from backend
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const fileInputRefs = useRef({});
  
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
    setClaimForm((prev) => {
      const next = { ...prev, [id]: value };
      if (id === 'travelFrom' || id === 'travelTo') {
        const { travelFrom, travelTo, expenseDate } = next;
        if (
          expenseDate &&
          travelFrom &&
          travelTo &&
          !isDateInTravelRange(expenseDate, travelFrom, travelTo)
        ) {
          next.expenseDate = '';
        }
      }
      return next;
    });
  };

  const travelDatesReady = Boolean(claimForm.travelFrom && claimForm.travelTo);
  const travelRangeIsValid = isTravelRangeValid(claimForm.travelFrom, claimForm.travelTo);

  const outOfRangeClaimIds = useMemo(() => {
    if (!travelRangeIsValid) return new Set();
    return new Set(
      claims
        .filter(
          (c) =>
            !isDateInTravelRange(
              c.date,
              claimForm.travelFrom,
              claimForm.travelTo
            )
        )
        .map((c) => c.id)
    );
  }, [claims, claimForm.travelFrom, claimForm.travelTo, travelRangeIsValid]);

  const applyEmployeeDefaults = useCallback(() => {
    const defaults = buildEmployeeDefaults(userData);
    setClaimForm((prev) => ({
      ...prev,
      ...defaults,
    }));
  }, [userData]);

  useEffect(() => {
    if (!loadingUser) {
      applyEmployeeDefaults();
    }
  }, [loadingUser, applyEmployeeDefaults]);

  const handleFileChange = (e, index) => {
    const file = e.target.files[0];
    if (index !== undefined) {
      // For existing claims in the list
      const updatedClaims = [...claims];
      updatedClaims[index].attachFile = file;
      setClaims(updatedClaims);
    } else {
      // For new claim form
      setClaimForm((prev) => ({ ...prev, attachFile: file }));
    }
  };

  const fetchClaims = async () => {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/claim-expense`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const text = await res.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch (e) {
        throw new Error(`Server error (${res.status}). Check backend logs.`);
      }

      if (!res.ok) {
        throw new Error(json.message || 'Failed to fetch claims');
      }

      if (json.success && json.claims) {
        // Flatten claims to show all items
        const allItems = [];
        json.claims.forEach(claim => {
          claim.items.forEach((item, idx) => {
            allItems.push({
              id: `${claim.id}-${idx}`,
              claimId: claim.id,
              sr_no: item.sr_no,
              country: claim.country_state,
              date: item.date,
              purpose: item.purpose,
              amount: item.amount,
              currency: item.currency,
              status: item.status,
              file: item.file,
              travelFrom: claim.travel_from_date,
              travelTo: claim.travel_to_date,
            });
          });
        });
        setSubmittedClaims(allItems);
      }
    } catch (err) {
      setError(err.message);
      console.error('Error fetching claims:', err);
    } finally {
      setLoading(false);
    }
  };

  useRefreshOnNavigate(() => {
    refreshUserData();
    fetchClaims();
  });

  const handleAddToClaim = () => {
    const rangeErr = travelRangeError(claimForm.travelFrom, claimForm.travelTo);
    if (rangeErr) {
      alert(rangeErr);
      return;
    }

    if (!claimForm.expenseDate || !claimForm.purpose || !claimForm.amount) {
      alert('Please fill in Date, Purpose, and Amount');
      return;
    }

    if (
      !isDateInTravelRange(
        claimForm.expenseDate,
        claimForm.travelFrom,
        claimForm.travelTo
      )
    ) {
      alert(
        `Expense date must be between ${formatDate(claimForm.travelFrom)} and ${formatDate(claimForm.travelTo)}.`
      );
      return;
    }

    const newClaim = {
      id: Date.now(),
      sr_no: claims.length + 1,
      country: claimForm.country || 'N/A',
      date: claimForm.expenseDate,
      purpose: claimForm.purpose,
      amount: parseFloat(claimForm.amount),
      currency: claimForm.currency,
      attachFile: claimForm.attachFile,
      status: 'pending'
    };

    setClaims([...claims, newClaim]);

    // Reset only expense-specific fields
    setClaimForm(prev => ({
      ...prev,
      expenseDate: '',
      purpose: '',
      amount: '',
      attachFile: null,
    }));
    
    // Reset file input
    if (fileInputRefs.current.newClaim) {
      fileInputRefs.current.newClaim.value = '';
    }
  };

  const handleRemoveClaim = (id) => {
    setClaims(claims.filter(c => c.id !== id).map((c, idx) => ({ ...c, sr_no: idx + 1 })));
  };

  const handleSubmitFinalClaim = async () => {
    // Validation
    if (claims.length === 0) {
      alert("Please add at least one expense item");
      return;
    }

    if (!claimForm.employeeName || !claimForm.designation || !claimForm.employeeId || 
        !claimForm.email || !claimForm.projectName || !claimForm.travelFrom || !claimForm.travelTo) {
      alert('Please fill in all employee and travel details');
      return;
    }

    const rangeErr = travelRangeError(claimForm.travelFrom, claimForm.travelTo);
    if (rangeErr) {
      alert(rangeErr);
      return;
    }

    if (outOfRangeClaimIds.size > 0) {
      alert(
        `${outOfRangeClaimIds.size} expense item(s) fall outside the travel period. Remove or update them before submitting.`
      );
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    const token = localStorage.getItem('token');
    if (!token) {
      alert("Please login again");
      setSubmitting(false);
      return;
    }

    try {
      // Prepare FormData
      const formData = new FormData();
      
      // Header fields
      formData.append('employee_name', claimForm.employeeName);
      formData.append('designation', claimForm.designation);
      formData.append('emp_id', claimForm.employeeId);
      formData.append('email', claimForm.email);
      formData.append('project_name', claimForm.projectName);
      formData.append('country_state', claimForm.country || 'N/A');
      formData.append('travel_from_date', claimForm.travelFrom);
      formData.append('travel_to_date', claimForm.travelTo);

      // Expenses array
      const expenses = claims.map(c => ({
        sr_no: c.sr_no,
        date: c.date,
        purpose: c.purpose,
        amount: c.amount,
        currency: c.currency
      }));
      formData.append('expenses', JSON.stringify(expenses));

      // Files — keyed by row index so sparse rows (e.g. 1, 3, 6) map correctly
      claims.forEach((c, index) => {
        if (c.attachFile) {
          formData.append(`attachments_${index}`, c.attachFile);
        }
      });

      const res = await fetch(`${API_BASE_URL}/claim-expense`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const text = await res.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch (e) {
        throw new Error(`Server error (${res.status}). Check backend logs.`);
      }

      if (!res.ok) {
        throw new Error(json.message || 'Failed to submit expense claim');
      }

      if (json.success) {
        setSuccessMessage('Expense claim submitted successfully!');
        resetForm();
        setClaims([]);
        await fetchClaims();
        // Clear file inputs
        Object.values(fileInputRefs.current).forEach(ref => {
          if (ref) ref.value = '';
        });
      }
    } catch (err) {
      setError(err.message);
      console.error('Error submitting claim:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    const defaults = buildEmployeeDefaults(userData);
    setClaimForm({
      ...defaults,
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
  };


  const totalAmount = claims.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);


  return (
    <div className="claims-dashboard-container">
      {error && <div className="claims-error">{error}</div>}
      {successMessage && <div className="claims-success">{successMessage}</div>}

      {/* Main Form Card */}
      <div className="claims-card claims-form-card">
        <div className="claims-card-header">
          <h2 className="claims-section-title">Expense Claim Form</h2>
        </div>

        <div className="claims-card-body">
          <div className="claims-form-grid">
            <div className="claims-form-group">
              <label className="claims-label" htmlFor="employeeName">Employee Name</label>
              <input className="claims-input claims-input-disabled" type="text" id="employeeName" value={claimForm.employeeName} readOnly disabled placeholder={loadingUser ? 'Loading...' : '—'} />
            </div>
            <div className="claims-form-group">
              <label className="claims-label" htmlFor="designation">Designation</label>
              <input className="claims-input claims-input-disabled" type="text" id="designation" value={claimForm.designation} readOnly disabled placeholder={loadingUser ? 'Loading...' : '—'} />
            </div>
            <div className="claims-form-group">
              <label className="claims-label" htmlFor="employeeId">Employee ID</label>
              <input className="claims-input claims-input-disabled" type="text" id="employeeId" value={claimForm.employeeId} readOnly disabled placeholder={loadingUser ? 'Loading...' : '—'} />
            </div>
            <div className="claims-form-group">
              <label className="claims-label" htmlFor="email">Email</label>
              <input className="claims-input claims-input-disabled" type="email" id="email" value={claimForm.email} readOnly disabled placeholder={loadingUser ? 'Loading...' : '—'} />
            </div>
          </div>

          <div className="claims-form-grid">
            <div className="claims-form-group">
              <label className="claims-label" htmlFor="projectName">Project Name</label>
              <input className="claims-input" type="text" id="projectName" value={claimForm.projectName} onChange={handleInputChange} placeholder="Enter project" />
            </div>
            <div className="claims-form-group">
              <label className="claims-label" htmlFor="country">Country/State</label>
              <input className="claims-input" type="text" id="country" value={claimForm.country} onChange={handleInputChange} placeholder="Enter location" />
            </div>
            <div className="claims-form-group">
              <label className="claims-label" htmlFor="travelFrom">Travel From</label>
              <input
                className="claims-input"
                type="date"
                id="travelFrom"
                value={claimForm.travelFrom}
                max={claimForm.travelTo || undefined}
                onChange={handleInputChange}
              />
            </div>
            <div className="claims-form-group">
              <label className="claims-label" htmlFor="travelTo">Travel To</label>
              <input
                className="claims-input"
                type="date"
                id="travelTo"
                value={claimForm.travelTo}
                min={claimForm.travelFrom || undefined}
                onChange={handleInputChange}
              />
            </div>
          </div>

          <hr className="claims-divider" />

          <h4 className="claims-subtitle">Expense Details</h4>
          <div className="claims-expense-grid">
            <div className="claims-form-group claims-col-sr">
              <label className="claims-label">Sr. No.</label>
              <input className="claims-input claims-input-disabled" type="text" value={claims.length + 1} disabled readOnly />
            </div>
            <div className="claims-form-group claims-col-date">
              <label className="claims-label">Date</label>
              <input
                className="claims-input"
                type="date"
                id="expenseDate"
                value={claimForm.expenseDate}
                min={travelRangeIsValid ? claimForm.travelFrom : undefined}
                max={travelRangeIsValid ? claimForm.travelTo : undefined}
                disabled={!travelRangeIsValid}
                onChange={handleInputChange}
              />
              {!travelDatesReady && (
                <span className="claims-field-hint">Set travel dates first</span>
              )}
              {travelDatesReady && !travelRangeIsValid && (
                <span className="claims-field-hint claims-field-hint--error">
                  Travel From must be on or before Travel To
                </span>
              )}
              {travelRangeIsValid && (
                <span className="claims-field-hint">
                  Between {formatDate(claimForm.travelFrom)} and {formatDate(claimForm.travelTo)}
                </span>
              )}
            </div>
            <div className="claims-form-group claims-col-purpose">
              <label className="claims-label">Purpose/Description</label>
              <input className="claims-input" type="text" id="purpose" value={claimForm.purpose} onChange={handleInputChange} placeholder="Enter purpose" />
            </div>
            <div className="claims-form-group claims-col-amount">
              <label className="claims-label">Amount</label>
              <input className="claims-input" type="number" id="amount" value={claimForm.amount} onChange={handleInputChange} placeholder="0.00" />
            </div>
            <div className="claims-form-group claims-col-currency">
              <label className="claims-label">Currency</label>
              <select className="claims-input" id="currency" value={claimForm.currency} onChange={handleInputChange}>
                <option value="INR">INR</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>

          <div className="claims-action-footer">
            <div className="claims-form-group">
              <label className="claims-label" htmlFor="attachFile">Attach Supporting Receipt</label>
              <div className="claims-file-wrap">
                <input
                  type="file"
                  id="attachFile"
                  onChange={handleFileChange}
                  ref={el => fileInputRefs.current.newClaim = el}
                  className="claims-file-input"
                />
                <span className="claims-file-label">
                  {claimForm.attachFile ? claimForm.attachFile.name : 'Choose file...'}
                </span>
              </div>
            </div>
            <button type="button" className="claims-btn-add" onClick={handleAddToClaim}>
              <Plus size={18} /> Add to List
            </button>
          </div>
        </div>
      </div>

      {claims.length > 0 && (
        <div className="claims-card claims-list-card">
          <div className="claims-card-header">
            <h2 className="claims-section-title">Current Claim Items ({claims.length})</h2>
          </div>
          <div className="claims-table-wrap">
            <table className="claims-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Purpose</th>
                  <th>Amount</th>
                  <th>Currency</th>
                  <th>File</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim, index) => (
                  <tr
                    key={claim.id}
                    className={outOfRangeClaimIds.has(claim.id) ? 'claims-row-invalid' : undefined}
                  >
                    <td data-label="#">{claim.sr_no}</td>
                    <td data-label="Date">{formatDate(claim.date)}</td>
                    <td data-label="Purpose">{claim.purpose}</td>
                    <td data-label="Amount"><strong>{claim.amount}</strong></td>
                    <td data-label="Currency">{claim.currency}</td>
                    <td data-label="File">{claim.attachFile ? claim.attachFile.name : '-'}</td>
                    <td className="claims-action-cell" data-label="Action">
                      <button type="button" className="claims-btn-remove" onClick={() => handleRemoveClaim(claim.id)}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="claims-card claims-history-card">
        <div className="claims-card-header">
          <h2 className="claims-section-title">Submitted Claims History</h2>
        </div>
        {loading ? (
          <div className="claims-loading">Loading claims...</div>
        ) : (
          <div className="claims-table-wrap">
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
                {submittedClaims.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="claims-empty">No claims submitted yet.</td>
                  </tr>
                ) : (
                  submittedClaims.map((claim) => (
                    <tr key={claim.id}>
                      <td data-label="#">{claim.sr_no}</td>
                      <td data-label="Country">{claim.country}</td>
                      <td data-label="Date">{formatDate(claim.date)}</td>
                      <td data-label="Purpose">{claim.purpose}</td>
                      <td data-label="Amount"><strong>{claim.amount} {claim.currency}</strong></td>
                      <td data-label="Status">
                        <span className={`claims-status-badge claims-status-${(claim.status || 'pending').toLowerCase()}`}>
                          {(claim.status || 'Pending').toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {claims.length > 0 && (
        <div className="claims-summary-section">
          <div className="claims-total-box">
            <span className="claims-total-label">Total Claim Amount</span>
            <span className="claims-total-value">
              {totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} {claimForm.currency}
            </span>
          </div>
          <button
            type="button"
            className="claims-btn-final"
            onClick={handleSubmitFinalClaim}
            disabled={submitting}
          >
            {submitting ? 'Submitting...' : 'Submit Final Claim Report'}
          </button>
        </div>
      )}
    </div>
  );
}