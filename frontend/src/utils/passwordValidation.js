export const PASSWORD_SPECIAL_RE = /[!@#$%^&*()_\-+[\]{};:'",.<>/?\\|]/;

export const PASSWORD_RULES = [
  {
    id: 'length',
    label: 'At least 8 characters',
    test: (pwd) => (pwd || '').length >= 8,
    error: 'Password must be at least 8 characters long.',
  },
  {
    id: 'upper',
    label: 'One uppercase letter (A–Z)',
    test: (pwd) => /[A-Z]/.test(pwd || ''),
    error: 'Password must contain at least one uppercase letter.',
  },
  {
    id: 'lower',
    label: 'One lowercase letter (a–z)',
    test: (pwd) => /[a-z]/.test(pwd || ''),
    error: 'Password must contain at least one lowercase letter.',
  },
  {
    id: 'number',
    label: 'One number (0–9)',
    test: (pwd) => /[0-9]/.test(pwd || ''),
    error: 'Password must contain at least one number.',
  },
  {
    id: 'special',
    label: 'One special character (!@#$%...)',
    test: (pwd) => PASSWORD_SPECIAL_RE.test(pwd || ''),
    error: 'Password must contain at least one special character.',
  },
];

export function getPasswordChecks(password) {
  return PASSWORD_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.test(password),
  }));
}

export function isPasswordStrong(password) {
  return getPasswordChecks(password).every((check) => check.met);
}

export function validatePasswordStrength(password) {
  const failed = PASSWORD_RULES.find((rule) => !rule.test(password));
  return failed ? failed.error : '';
}

export function passwordsMatch(password, confirmPassword) {
  return Boolean(password && confirmPassword && password === confirmPassword);
}

export function canSubmitPasswordForm(password, confirmPassword) {
  return isPasswordStrong(password) && passwordsMatch(password, confirmPassword);
}
