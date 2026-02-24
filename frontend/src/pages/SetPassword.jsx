import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

const API = '/api/auth/set-password';

const SetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) setError('Invalid or missing reset link.');
  }, [token]);

  const validatePassword = (pwd) => {
    if (!pwd || pwd.length < 8) return 'Password must be at least 8 characters.';
    if (!/[A-Z]/.test(pwd)) return 'Password must contain at least one uppercase letter.';
    if (!/[a-z]/.test(pwd)) return 'Password must contain at least one lowercase letter.';
    if (!/[0-9]/.test(pwd)) return 'Password must contain at least one number.';
    if (!/[!@#$%^&*()_\-+=[\]{};:'",.<>?/\\|]/.test(pwd))
      return 'Password must contain at least one special character.';
    return '';
  };

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
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    const validationError = validatePassword(password);
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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7fa', padding: 20 }}>
        <div style={{ background: '#fff', padding: 32, borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', maxWidth: 400 }}>
          <h2 style={{ margin: '0 0 12px', color: '#2c3e50' }}>Set password</h2>
          <p style={{ color: '#e74c3c', margin: 0 }}>Invalid or missing reset link. Please ask HR to send a new password reset link.</p>
          <a href="/" style={{ display: 'inline-block', marginTop: 16, color: '#3498db' }}>Back to login</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7fa', padding: 20 }}>
      <div style={{ background: '#fff', padding: 32, borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.08)', maxWidth: 400, width: '100%' }}>
        <h2 style={{ margin: '0 0 8px', color: '#2c3e50' }}>Set new password</h2>
        <p style={{ color: '#7f8c8d', fontSize: 14, margin: '0 0 24px' }}>This link expires in 1 hour.</p>
        {message && <p style={{ color: '#27ae60', marginBottom: 16 }}>{message}</p>}
        {error && <p style={{ color: '#e74c3c', marginBottom: 16 }}>{error}</p>}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: '#2c3e50' }}>New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters, with upper, lower, number, special"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #dfe6e9', borderRadius: 8, fontSize: 14 }}
              autoComplete="new-password"
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 500, color: '#2c3e50' }}>Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #dfe6e9', borderRadius: 8, fontSize: 14 }}
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px 16px',
              background: '#3498db',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Updating…' : 'Set password'}
          </button>
        </form>
        <a href="/" style={{ display: 'inline-block', marginTop: 16, color: '#3498db', fontSize: 14 }}>Back to login</a>
      </div>
    </div>
  );
};

export default SetPassword;
