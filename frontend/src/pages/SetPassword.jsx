import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppFooter } from '../components/layout/AppFooter';
import PasswordRequirements from '../components/PasswordRequirements';
import {
  canSubmitPasswordForm,
  passwordsMatch,
  validatePasswordStrength,
} from '../utils/passwordValidation';

const API = '/api/auth/set-password';

const pageShellStyle = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: '#f5f7fa',
};

const pageBodyStyle = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const cardStyle = {
  background: '#fff',
  padding: 32,
  borderRadius: 12,
  boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
  maxWidth: 440,
  width: '100%',
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #dfe6e9',
  borderRadius: 8,
  fontSize: 14,
  boxSizing: 'border-box',
};

const SetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const formReady = useMemo(
    () => canSubmitPasswordForm(password, confirmPassword),
    [password, confirmPassword]
  );

  const confirmInputStyle = useMemo(() => {
    if (!confirmPassword) return inputStyle;
    return {
      ...inputStyle,
      borderColor: passwordsMatch(password, confirmPassword) ? '#10b981' : '#f87171',
    };
  }, [password, confirmPassword]);

  useEffect(() => {
    if (!token) setError('Invalid or missing reset link.');
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setError('');
    if (!token) {
      setError('Invalid or missing reset link.');
      return;
    }
    if (!password || !confirmPassword) {
      setError('Please fill both password fields.');
      return;
    }
    if (!passwordsMatch(password, confirmPassword)) {
      setError('Passwords do not match.');
      return;
    }
    const validationError = validatePasswordStrength(password);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password,
          confirm_password: confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage(data.message || 'Password updated. You can now log in.');
        setPassword('');
        setConfirmPassword('');
      } else {
        setError(data.message || 'Failed to set password.');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div style={pageShellStyle}>
        <div style={pageBodyStyle}>
          <div style={cardStyle}>
            <h2 style={{ margin: '0 0 12px', color: '#2c3e50' }}>Set password</h2>
            <p style={{ color: '#e74c3c', margin: 0 }}>Invalid or missing reset link. Please ask HR to send a new password reset link.</p>
            <a href="/" style={{ display: 'inline-block', marginTop: 16, color: '#3498db' }}>Back to login</a>
          </div>
        </div>
        <AppFooter />
      </div>
    );
  }

  return (
    <div style={pageShellStyle}>
      <div style={pageBodyStyle}>
        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 8px', color: '#2c3e50' }}>Set new password</h2>
          <p style={{ color: '#7f8c8d', fontSize: 14, margin: '0 0 24px' }}>
            This link expires in 1 hour. Requirements update as you type.
          </p>
          {message && <p style={{ color: '#27ae60', marginBottom: 16 }}>{message}</p>}
          {error && <p style={{ color: '#e74c3c', marginBottom: 16 }}>{error}</p>}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: '#2c3e50' }}>New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password"
                style={inputStyle}
                autoComplete="new-password"
              />
              <PasswordRequirements
                password={password}
                confirmPassword={confirmPassword}
                showMatch={false}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: '#2c3e50' }}>Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                style={confirmInputStyle}
                autoComplete="new-password"
              />
              {confirmPassword.length > 0 && (
                <PasswordRequirements
                  password={password}
                  confirmPassword={confirmPassword}
                  showRequirements={false}
                  showMatch
                />
              )}
            </div>
            <button
              type="submit"
              disabled={loading || !formReady}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: loading || !formReady ? '#cbd5e1' : '#3498db',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 15,
                fontWeight: 600,
                cursor: loading || !formReady ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Updating…' : 'Set password'}
            </button>
          </form>
          <a href="/" style={{ display: 'inline-block', marginTop: 16, color: '#3498db', fontSize: 14 }}>Back to login</a>
        </div>
      </div>
      <AppFooter />
    </div>
  );
};

export default SetPassword;
