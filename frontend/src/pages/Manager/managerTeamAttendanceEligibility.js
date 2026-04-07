/**
 * Mirrors backend manager_utils._norm_circle / _emp_type_canon for NHQ + Engineering gate.
 */
export function managerCanViewNhqEngineeringTeamAttendance(scope) {
  if (!scope) return false;
  const circle = (scope.circle || "").trim().toLowerCase();
  let t = (scope.emp_type || "").trim().toLowerCase().replace(/-/g, " ");
  t = t.split(/\s+/).join(" ");
  if (t === "hr" || t === "human resource" || t === "human resources") t = "hr";
  else if (t === "account" || t === "accounts" || t === "accountant") t = "accounts";
  return circle === "nhq" && t === "engineering";
}
