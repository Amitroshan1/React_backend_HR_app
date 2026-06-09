import { useNavigate, useLocation } from 'react-router-dom';
import { clearAdminDepartmentVisit, isAdminDepartmentPath } from '../../pages/Admin/AdminLayout';
import './AdminReturnBar.css';

export function AdminReturnBar({ visible }) {
  const navigate = useNavigate();
  const location = useLocation();

  if (!visible || !isAdminDepartmentPath(location.pathname)) {
    return null;
  }

  return (
    <div className="admin-return-bar" role="navigation" aria-label="Return to admin">
      <button
        type="button"
        className="admin-return-bar__btn"
        onClick={() => {
          clearAdminDepartmentVisit();
          navigate('/admin');
        }}
      >
        ← Back to Admin Command Center
      </button>
      <span className="admin-return-bar__hint">
        You are working in a department workspace — all admin controls stay in Admin Management.
      </span>
    </div>
  );
}
