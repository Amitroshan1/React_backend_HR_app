import { useNavigate } from 'react-router-dom';
import {
  clearAdminDepartmentVisit,
} from '../pages/Admin/AdminLayout';

const ADMIN_DEPT_SESSION = 'adminDeptVisit';

/** True when the user entered this workspace from Admin Command Center. */
export function isAdminVisitActive() {
  try {
    return sessionStorage.getItem(ADMIN_DEPT_SESSION) === '1';
  } catch {
    return false;
  }
}

/**
 * Context-aware back navigation for pages shared between Admin and departments.
 *
 * When opened from Admin Command Center → return to /admin and clear the visit flag.
 * Otherwise → department fallback (route string or onFallback callback).
 */
export function useAdminVisitNav({
  fallbackTo = '/hr',
  fallbackLabel = 'Back to Updates',
  onFallback = null,
  adminTo = '/admin',
  adminLabel = 'Back to Command Center',
} = {}) {
  const navigate = useNavigate();
  const fromAdmin = isAdminVisitActive();

  const backLabel = fromAdmin ? adminLabel : fallbackLabel;

  const goBack = (navOptions = {}) => {
    if (fromAdmin) {
      clearAdminDepartmentVisit();
      navigate(adminTo, navOptions);
      return;
    }
    if (typeof onFallback === 'function') {
      onFallback();
      return;
    }
    navigate(fallbackTo, navOptions);
  };

  return {
    fromAdmin,
    backTo: fromAdmin ? adminTo : fallbackTo,
    backLabel,
    goBack,
  };
}
