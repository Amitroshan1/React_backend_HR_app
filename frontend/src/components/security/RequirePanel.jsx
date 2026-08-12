import { Navigate } from "react-router-dom";
import { useUser } from "../layout/UserContext";
import {
  canAccessAccountPanel,
  canAccessHrPanel,
  canAccessItPanel,
  isAdminUser,
} from "../../utils/planFeatures";

function canAccessManagerPanel(user) {
  if (isAdminUser(user)) return true;
  if (user?.has_manager_access === true) return true;
  const et = String(user?.emp_type || user?.department || "")
    .trim()
    .toLowerCase();
  return et === "manager" || et === "managers";
}

const PANEL_CHECKS = {
  hr: (user) => canAccessHrPanel(user),
  account: (user) => canAccessAccountPanel(user),
  it: (user) => canAccessItPanel(user),
  admin: (user) => isAdminUser(user),
  manager: (user) => canAccessManagerPanel(user),
};

/**
 * Blocks department panel routes when the logged-in user is not allowed.
 * Unauthorized deep links / URL edits redirect to /dashboard.
 */
export function RequirePanel({ panel, children, fallback = "/dashboard" }) {
  const { userData, loadingUser } = useUser();
  const user = userData?.user;

  if (loadingUser) {
    return (
      <div className="full-height-center">
        <h2 className="loader" />
      </div>
    );
  }

  const check = PANEL_CHECKS[panel];
  if (!check) {
    return <Navigate to={fallback} replace />;
  }

  if (!user || !check(user)) {
    return <Navigate to={fallback} replace />;
  }

  return children;
}
