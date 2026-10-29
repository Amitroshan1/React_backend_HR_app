import { useEffect } from 'react';
import EmployeeChangeRequests from '../Admin/EmployeeChangeRequests';

export const HR_REQUEST_HISTORY_SEEN_KEY = 'hr_request_history_seen_at';

export function markRequestHistorySeen() {
  try {
    localStorage.setItem(HR_REQUEST_HISTORY_SEEN_KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
}

export function getRequestHistorySeenAt() {
  try {
    return localStorage.getItem(HR_REQUEST_HISTORY_SEEN_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Standalone Request History for HR (Admin approve/reject outcomes).
 */
export default function HrRequestHistory({ onBack }) {
  useEffect(() => {
    markRequestHistorySeen();
  }, []);

  return (
    <EmployeeChangeRequests
      mode="hr"
      onBack={onBack}
      backLabel="Back to Updates"
      title="Request history"
      description="Every request HR has sent — written requests, signups, exits, rehires, leave/WFH changes, probation decisions, and profile changes — including Admin approvals and rejections."
    />
  );
}
