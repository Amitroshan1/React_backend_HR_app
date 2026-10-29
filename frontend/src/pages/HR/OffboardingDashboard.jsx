import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LogOut, Archive } from 'lucide-react';
import SeparationRequests from './SeparationRequests';
import './offboarding-ui.css';

const OffboardingDashboard = ({
  onBack,
  onOpenExitEmployee,
  onOpenSeparationDetail,
}) => {
  const navigate = useNavigate();

  return (
    <section className="obx">
      <header className="obx-head">
        <div>
          <button type="button" className="obx-back" onClick={onBack}>
            <ArrowLeft size={16} />
            Back
          </button>
          <h1>Offboarding</h1>
          <p>Review resignations, NOC clearances, and submit ready exits to Admin.</p>
        </div>
        <div className="obx-actions">
          <button type="button" className="obx-btn" onClick={() => navigate('/archive-employees')}>
            <Archive size={16} />
            Archive
          </button>
          {typeof onOpenExitEmployee === 'function' ? (
            <button type="button" className="obx-btn obx-btn--primary" onClick={onOpenExitEmployee}>
              <LogOut size={16} />
              Exit employee
            </button>
          ) : null}
        </div>
      </header>

      <SeparationRequests
        embedded
        onOpenDetail={(id) => onOpenSeparationDetail?.(id)}
      />
    </section>
  );
};

export default OffboardingDashboard;
