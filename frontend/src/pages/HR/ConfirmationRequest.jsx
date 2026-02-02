import React from 'react';
import { ArrowLeft, Inbox } from 'lucide-react';
import './ConfirmationRequest.css';

export const ConfirmationRequest = ({ onBack }) => {
  return (
    <div className="conf-request-wrapper">
      <div className="conf-request-container">
        {/* Navigation Tab */}
        <button className="btn-back-tab" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="conf-request-card">
          <div className="conf-request-header">
            <h3>
              <span className="building-emoji">🏢</span> HR Employee Confirmation Requests
            </h3>
          </div>

          <div className="empty-state-container">
            <p>No HR confirmation requests found.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
