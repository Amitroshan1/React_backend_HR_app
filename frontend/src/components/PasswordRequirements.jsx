import React from 'react';
import { Check, X } from 'lucide-react';
import {
  getPasswordChecks,
  isPasswordStrong,
  passwordsMatch,
} from '../utils/passwordValidation';
import './PasswordRequirements.css';

export function PasswordRequirements({
  password,
  confirmPassword = '',
  showRequirements = true,
  showMatch = true,
}) {
  const checks = getPasswordChecks(password);
  const allMet = isPasswordStrong(password);
  const hasConfirm = confirmPassword.length > 0;
  const match = passwordsMatch(password, confirmPassword);
  const showReqList = showRequirements && password.length > 0;
  const showMatchLine = showMatch && hasConfirm;

  if (!showReqList && !showMatchLine) {
    return null;
  }

  return (
    <div className="pwd-req-wrap">
      {showReqList && (
        <>
          <p className="pwd-req-heading">Password must include:</p>
          <ul className="pwd-req-list" aria-live="polite">
            {checks.map((check) => (
              <li
                key={check.id}
                className={`pwd-req-item ${check.met ? 'pwd-req-item-met' : 'pwd-req-item-unmet'}`}
              >
                <span className="pwd-req-icon" aria-hidden="true">
                  {check.met ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
                </span>
                <span>{check.label}</span>
              </li>
            ))}
          </ul>
          {password && allMet && (
            <p className="pwd-req-all-met">Password meets all requirements.</p>
          )}
        </>
      )}
      {showMatchLine && (
        <p
          className={`pwd-req-match ${match ? 'pwd-req-match-ok' : 'pwd-req-match-bad'}`}
          aria-live="polite"
        >
          <span className="pwd-req-icon" aria-hidden="true">
            {match ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
          </span>
          {match ? 'Passwords match' : 'Passwords do not match'}
        </p>
      )}
    </div>
  );
}

export default PasswordRequirements;
