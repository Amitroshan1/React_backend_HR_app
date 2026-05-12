import { DepartmentNocPanel } from "../DepartmentNocPanel";

/** Reporting manager panel only — MANAGER department_key rows via /api/manager */
export const NocRequests = (props) => <DepartmentNocPanel apiBase="/api/manager" {...props} />;
