/** Shared email format check (local part @ domain.tld). */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export const EMAIL_VALIDATION_MESSAGE =
  'Please enter a valid email address (e.g. name@company.com).';

/** Inline field helper: empty + invalid messages after touch or submit. */
export function getEmailFieldError(email, { touched = false, submitted = false } = {}) {
  const trimmed = (email || '').trim();
  if (!trimmed) {
    return submitted ? 'Email is required.' : '';
  }
  if ((touched || submitted) && !isValidEmail(trimmed)) {
    return EMAIL_VALIDATION_MESSAGE;
  }
  return '';
}
