/** Client-side identity / bank field validation and display masking. */

export const INITIAL_DOCUMENT_META = {
  aadhaarNumber: '',
  panNumber: '',
  bankAccountNumber: '',
  bankName: '',
  bankBranchCode: '',
  ifscCode: '',
};

export function digitsOnly(value, maxLen) {
  const s = String(value || '').replace(/\D/g, '');
  return maxLen != null ? s.slice(0, maxLen) : s;
}

export function normalizePan(value) {
  return String(value || '').trim().toUpperCase().slice(0, 10);
}

export function normalizeIfsc(value) {
  return String(value || '').trim().toUpperCase().slice(0, 11);
}

export function isValidAadhaar(value) {
  const n = digitsOnly(value, 12);
  return n.length === 12;
}

export function isValidPan(value) {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(normalizePan(value));
}

export function isValidIfsc(value) {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizeIfsc(value));
}

export function isValidBankAccount(value) {
  const n = digitsOnly(value, 18);
  return n.length >= 9 && n.length <= 18;
}

export function normalizeBankBranchCode(value) {
  return String(value || '').trim().toUpperCase().slice(0, 20);
}

export function isValidBankBranchCode(value) {
  const code = normalizeBankBranchCode(value).replace(/\s/g, '');
  return code.length >= 2 && code.length <= 20 && /^[A-Z0-9]+$/.test(code);
}

export function isBankIdentityComplete(meta) {
  return (
    isValidBankAccount(meta?.bankAccountNumber) &&
    String(meta?.bankName || '').trim().length >= 2 &&
    isValidBankBranchCode(meta?.bankBranchCode) &&
    isValidIfsc(meta?.ifscCode)
  );
}

export function maskAadhaar(value) {
  const n = digitsOnly(value, 12);
  if (n.length < 4) return '—';
  return `XXXX-XXXX-${n.slice(-4)}`;
}

export function maskPan(value) {
  const p = normalizePan(value);
  if (p.length !== 10) return '—';
  return `XXXXX${p.slice(-4)}`;
}

export function maskBankAccount(value) {
  const n = digitsOnly(value, 18);
  if (n.length < 4) return '—';
  return `${'X'.repeat(Math.max(0, n.length - 4))}${n.slice(-4)}`;
}

/** Map API documents object → documentMeta state */
export function documentMetaFromApi(docs = {}) {
  return {
    aadhaarNumber: docs.aadhaar_number || '',
    panNumber: docs.pan_number || '',
    bankAccountNumber: docs.bank_account_number || '',
    bankName: docs.bank_name || '',
    bankBranchCode: docs.bank_branch_code || '',
    ifscCode: docs.ifsc_code || '',
  };
}

/** Validate documents section; returns error map keyed by field name */
export function validateDocumentSection(files, documentMeta) {
  const errors = {};

  if (!isValidAadhaar(documentMeta.aadhaarNumber)) {
    errors.aadhaarNumber = 'Enter a valid 12-digit Aadhaar number.';
  } else {
    if (!files.aadharFront) errors.aadharFront = 'Aadhaar front image is required.';
    if (!files.aadharBack) errors.aadharBack = 'Aadhaar back image is required.';
  }

  if (!isValidPan(documentMeta.panNumber)) {
    errors.panNumber = 'Enter a valid PAN (e.g. ABCDE1234F).';
  } else {
    if (!files.panFront) errors.panFront = 'PAN front image is required.';
    if (!files.panBack) errors.panBack = 'PAN back image is required.';
  }

  if (!isBankIdentityComplete(documentMeta)) {
    if (!isValidBankAccount(documentMeta.bankAccountNumber)) {
      errors.bankAccountNumber = 'Enter a valid bank account number (9–18 digits).';
    }
    if (!String(documentMeta.bankName || '').trim()) {
      errors.bankName = 'Bank name is required.';
    }
    if (!isValidBankBranchCode(documentMeta.bankBranchCode)) {
      errors.bankBranchCode = 'Enter a valid bank branch code (2–20 characters).';
    }
    if (!isValidIfsc(documentMeta.ifscCode)) {
      errors.ifscCode = 'Enter a valid IFSC code.';
    }
  } else if (!files.passbookFront) {
    errors.passbookFront = 'Passbook or cheque front image is required.';
  }

  if (!files.appointmentLetter) {
    errors.appointmentLetter = 'Appointment letter is required.';
  }

  return errors;
}
