import React from 'react';
import './EmployeeIdentityDocsPanel.css';
import {
  maskAadhaar,
  maskPan,
  maskBankAccount,
  mergeIdentityDocuments,
  formatIdentityDisplay,
} from '../pages/Profile/utils/documentIdentity';

const ID_DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png';

function MetaField({ label, value, mono = false }) {
  return (
    <div className="emp-identity-docs__field">
      <span className="emp-identity-docs__field-label">{label}</span>
      <span
        className={`emp-identity-docs__field-value${mono ? ' emp-identity-docs__field-value--mono' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

function FileRow({ label, filePath, onViewFile }) {
  const available = Boolean(filePath);
  return (
    <div
      className={`emp-identity-docs__file-row${
        available ? '' : ' emp-identity-docs__file-row--empty'
      }`}
    >
      <div className="emp-identity-docs__file-main">
        <span className="emp-identity-docs__file-label">{label}</span>
        <span
          className={`emp-identity-docs__status${
            available ? ' emp-identity-docs__status--ok' : ''
          }`}
        >
          {available ? 'Available' : 'Not uploaded'}
        </span>
      </div>
      {available && onViewFile && (
        <button
          type="button"
          className="emp-identity-docs__view-btn"
          onClick={() => onViewFile(filePath)}
        >
          View
        </button>
      )}
    </div>
  );
}

/**
 * Read-only identity + document summary for HR / Accounts employee views.
 * When showFullDetails is true, identity numbers are shown in full (Accounts verification).
 */
export default function EmployeeIdentityDocsPanel({
  documents = {},
  accountsProfile = null,
  showFullDetails = false,
  onViewFile,
}) {
  const d = mergeIdentityDocuments(documents, accountsProfile || {});

  const hasIdentity =
    d.aadhaar_number ||
    d.pan_number ||
    d.bank_account_number ||
    d.bank_name ||
    d.bank_branch_code ||
    d.ifsc_code;

  const hasFiles =
    d.aadhaar_front ||
    d.aadhaar_back ||
    d.pan_front ||
    d.pan_back ||
    d.passbook_front ||
    d.appointment_letter;

  if (!hasIdentity && !hasFiles) {
    return <p className="emp-identity-docs__empty">No documents uploaded yet.</p>;
  }

  const fmtAadhaar = (v) => formatIdentityDisplay(v, maskAadhaar, showFullDetails);
  const fmtPan = (v) => formatIdentityDisplay(v, maskPan, showFullDetails);
  const fmtAccount = (v) => formatIdentityDisplay(v, maskBankAccount, showFullDetails);

  return (
    <div className="emp-identity-docs">
      <section className="emp-identity-docs__block">
        <h5 className="emp-identity-docs__title">Aadhaar Card</h5>
        <MetaField label="Aadhaar Number" value={fmtAadhaar(d.aadhaar_number)} mono />
        <div className="emp-identity-docs__files">
          <FileRow label="Front" filePath={d.aadhaar_front} onViewFile={onViewFile} />
          <FileRow label="Back" filePath={d.aadhaar_back} onViewFile={onViewFile} />
        </div>
      </section>

      <section className="emp-identity-docs__block">
        <h5 className="emp-identity-docs__title">PAN Card</h5>
        <MetaField label="PAN Number" value={fmtPan(d.pan_number)} mono />
        <div className="emp-identity-docs__files">
          <FileRow label="Front" filePath={d.pan_front} onViewFile={onViewFile} />
          <FileRow label="Back" filePath={d.pan_back} onViewFile={onViewFile} />
        </div>
      </section>

      <section className="emp-identity-docs__block emp-identity-docs__block--wide">
        <h5 className="emp-identity-docs__title">Bank Account</h5>
        <div className="emp-identity-docs__fields emp-identity-docs__fields--bank">
          <MetaField label="Account Number" value={fmtAccount(d.bank_account_number)} mono />
          <MetaField label="Bank Name" value={d.bank_name || '—'} />
          <MetaField label="Branch Code" value={d.bank_branch_code || '—'} mono />
          <MetaField label="IFSC" value={d.ifsc_code || '—'} mono />
        </div>
        <div className="emp-identity-docs__files emp-identity-docs__files--single">
          <FileRow
            label="Passbook / Cheque"
            filePath={d.passbook_front}
            onViewFile={onViewFile}
          />
        </div>
      </section>

      <section className="emp-identity-docs__block">
        <h5 className="emp-identity-docs__title">Appointment Letter</h5>
        <div className="emp-identity-docs__files emp-identity-docs__files--single">
          <FileRow
            label="Appointment Letter"
            filePath={d.appointment_letter}
            onViewFile={onViewFile}
          />
        </div>
      </section>
    </div>
  );
}

export { ID_DOC_ACCEPT };
