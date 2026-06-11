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

/** Parse EmployeeAccounts.bank_details multiline text into identity fields. */
export function parseBankDetailsText(text) {
  const out = {};
  if (!text || typeof text !== 'string') return out;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    const val = trimmed.slice(idx + 1).trim();
    if (!val) continue;
    if (key === 'account') out.bank_account_number = val;
    else if (key === 'bank') out.bank_name = val;
    else if (key === 'branch code') out.bank_branch_code = val;
    else if (key === 'ifsc') out.ifsc_code = val;
  }
  return out;
}

/** Merge UploadDoc API payload with Accounts profile fallbacks (PAN, bank_details). */
export function mergeIdentityDocuments(documents = {}, accountsProfile = {}) {
  const d = { ...(documents || {}) };
  const pan = String(accountsProfile.pan || '').trim();
  if (!d.pan_number && pan) d.pan_number = pan;

  const bank = parseBankDetailsText(accountsProfile.bank_details);
  if (!d.bank_account_number && bank.bank_account_number) {
    d.bank_account_number = bank.bank_account_number;
  }
  if (!d.bank_name && bank.bank_name) d.bank_name = bank.bank_name;
  if (!d.bank_branch_code && bank.bank_branch_code) {
    d.bank_branch_code = bank.bank_branch_code;
  }
  if (!d.ifsc_code && bank.ifsc_code) d.ifsc_code = bank.ifsc_code;

  return d;
}

export function formatIdentityDisplay(value, maskFn, showFull) {
  if (!value) return '—';
  return showFull ? String(value) : maskFn(value);
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

export const DOCUMENT_ERROR_KEYS = [
  'aadhaarNumber', 'aadharFront', 'aadharBack',
  'panNumber', 'panFront', 'panBack',
  'bankAccountNumber', 'bankName', 'bankBranchCode', 'ifscCode', 'passbookFront',
  'appointmentLetter',
];

export function hasUploadedFile(file) {
  return file != null && String(file).trim() !== '';
}

/** Validate documents section; returns error map keyed by field name */
export function validateDocumentSection(files, documentMeta) {
  const f = files || {};
  const meta = documentMeta || {};
  const errors = {};

  if (!isValidAadhaar(meta.aadhaarNumber)) {
    errors.aadhaarNumber = 'Enter a valid 12-digit Aadhaar number.';
  } else {
    if (!hasUploadedFile(f.aadharFront)) errors.aadharFront = 'Aadhaar front image is required.';
    if (!hasUploadedFile(f.aadharBack)) errors.aadharBack = 'Aadhaar back image is required.';
  }

  if (!isValidPan(meta.panNumber)) {
    errors.panNumber = 'Enter a valid PAN (e.g. ABCDE1234F).';
  } else {
    if (!hasUploadedFile(f.panFront)) errors.panFront = 'PAN front image is required.';
    if (!hasUploadedFile(f.panBack)) errors.panBack = 'PAN back image is required.';
  }

  if (!isBankIdentityComplete(meta)) {
    if (!isValidBankAccount(meta.bankAccountNumber)) {
      errors.bankAccountNumber = 'Enter a valid bank account number (9–18 digits).';
    }
    if (String(meta.bankName || '').trim().length < 2) {
      errors.bankName = 'Bank name is required (at least 2 characters).';
    }
    if (!isValidBankBranchCode(meta.bankBranchCode)) {
      errors.bankBranchCode = 'Enter a valid bank branch code (2–20 letters or numbers).';
    }
    if (!isValidIfsc(meta.ifscCode)) {
      errors.ifscCode = 'Enter a valid 11-character IFSC code (e.g. SBIN0001234).';
    }
  } else if (!hasUploadedFile(f.passbookFront)) {
    errors.passbookFront = 'Passbook or cheque front image is required.';
  }

  if (!hasUploadedFile(f.appointmentLetter)) {
    errors.appointmentLetter = 'Appointment letter is required.';
  }

  return errors;
}
