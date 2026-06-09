import React from 'react';
import './EmployeeIdentityDocsPanel.css';
import {
  maskAadhaar,
  maskPan,
  maskBankAccount,
} from '../pages/Profile/utils/documentIdentity';

const ID_DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png';

/**
 * Read-only identity + document summary for HR / Accounts employee views.
 */
export default function EmployeeIdentityDocsPanel({ documents = {}, onViewFile }) {
  const d = documents || {};
  const hasIdentity =
    d.aadhaar_number ||
    d.pan_number ||
    d.bank_account_number ||
    d.bank_name ||
    d.bank_branch_code ||
    d.ifsc_code;

  const fileRows = [
    { key: 'aadhaar_front', label: 'Aadhaar (Front)' },
    { key: 'aadhaar_back', label: 'Aadhaar (Back)' },
    { key: 'pan_front', label: 'PAN (Front)' },
    { key: 'pan_back', label: 'PAN (Back)' },
    { key: 'passbook_front', label: 'Passbook / Cheque (Front)' },
    { key: 'appointment_letter', label: 'Appointment Letter' },
  ];

  const hasFiles = fileRows.some((r) => d[r.key]);
  if (!hasIdentity && !hasFiles) {
    return <p className="no-docs">No documents uploaded yet.</p>;
  }

  return (
    <div className="emp-identity-docs">
      {d.aadhaar_number && (
        <div className="emp-identity-docs__block">
          <h5>Aadhaar</h5>
          <p className="emp-identity-docs__meta">
            <span>Number</span>
            <strong>{maskAadhaar(d.aadhaar_number)}</strong>
          </p>
        </div>
      )}
      {d.pan_number && (
        <div className="emp-identity-docs__block">
          <h5>PAN</h5>
          <p className="emp-identity-docs__meta">
            <span>Number</span>
            <strong>{maskPan(d.pan_number)}</strong>
          </p>
        </div>
      )}
      {(d.bank_account_number || d.bank_name || d.bank_branch_code || d.ifsc_code) && (
        <div className="emp-identity-docs__block">
          <h5>Bank</h5>
          {d.bank_account_number && (
            <p className="emp-identity-docs__meta">
              <span>Account</span>
              <strong>{maskBankAccount(d.bank_account_number)}</strong>
            </p>
          )}
          {d.bank_name && (
            <p className="emp-identity-docs__meta">
              <span>Bank</span>
              <strong>{d.bank_name}</strong>
            </p>
          )}
          {d.bank_branch_code && (
            <p className="emp-identity-docs__meta">
              <span>Branch Code</span>
              <strong>{d.bank_branch_code}</strong>
            </p>
          )}
          {d.ifsc_code && (
            <p className="emp-identity-docs__meta">
              <span>IFSC</span>
              <strong>{d.ifsc_code}</strong>
            </p>
          )}
        </div>
      )}

      <div className="emp-identity-docs__files">
        <h5>Uploaded files</h5>
        <div className="emp-identity-docs__grid">
          {fileRows.map((row) => (
            <div key={row.key} className="emp-identity-docs__file-row">
              <div className="emp-identity-docs__file-meta">
                <span>{row.label}</span>
                <span>{d[row.key] ? 'Available' : 'Not uploaded'}</span>
              </div>
              {d[row.key] && onViewFile && (
                <button
                  type="button"
                  className="emp-identity-docs__view-btn"
                  onClick={() => onViewFile(d[row.key])}
                >
                  View
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { ID_DOC_ACCEPT };
