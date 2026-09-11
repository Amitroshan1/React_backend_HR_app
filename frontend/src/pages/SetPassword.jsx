import React from 'react';
import { Link } from 'react-router-dom';
import { AppFooter } from '../components/layout/AppFooter';

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
  padding: '24px 16px',
};

const SetPassword = () => (
  <div style={pageShellStyle}>
    <div style={pageBodyStyle}>
      <div style={{ maxWidth: 480, background: '#fff', borderRadius: 12, padding: 28, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <h2 style={{ margin: '0 0 12px', color: '#2c3e50' }}>Password login removed</h2>
        <p style={{ color: '#475569', lineHeight: 1.55, margin: '0 0 16px' }}>
          HRMS accounts no longer use a password. Sign in with your work email; we send a one-time OTP.
          The same OTP flow is used to view payslip and tax declaration.
        </p>
        <Link to="/" style={{ color: '#2563eb', fontWeight: 600 }}>Go to sign in</Link>
      </div>
    </div>
    <AppFooter />
  </div>
);

export default SetPassword;
