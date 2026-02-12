import React, { useEffect } from 'react';
import './Toast.css';

export const Toast = ({ message, type = 'success', onClose, hideIcon, hideClose }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 3000); // Disappears after 3 seconds

    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`toast toast--${type}`}>
      {!hideIcon && <span className="toast__icon">{type === 'success' ? '✅' : '❌'}</span>}
      <p className="toast__message">{message}</p>
      {!hideClose && <button className="toast__close" onClick={onClose}>&times;</button>}
    </div>
  );
};
