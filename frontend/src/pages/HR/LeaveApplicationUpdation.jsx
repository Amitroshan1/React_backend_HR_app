import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { usePagedList } from "../../hooks/usePagedList";
import Pager from "../../components/Pager";
import { isPagedScreenEnabled } from "../../utils/pagedScreens";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Calculator,
  CalendarRange,
  Check,
  Edit3,
  Hourglass,
  Search,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import "./LeaveApplicationUpdation.css";
import { formatDate, formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import { HRApplyLeaveOnBehalf } from "./HRApplyLeaveOnBehalf";
import { HRLeavePolicyCard, HRLeavePolicyPanel } from "./HRLeavePolicyPanel";
import { HRApprovedLeaves } from "./HRApprovedLeaves";

const API_BASE = "/api/HumanResource";

const REQUEST_TYPE_OPTIONS = [
  { value: "all", label: "All (Leave + WFH)" },
  { value: "leave", label: "Leave Only" },
  { value: "wfh", label: "WFH Only" },
];
const LEAVE_TYPES = [
  "Privilege Leave",
  "Casual Leave",
  "Half Day Leave",
  "Compensatory Leave",
  "Optional Leave",
];

const getAuthHeaders = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const STATUS_FILTERS = ["All", "Pending", "Approved", "Rejected"];

const normalizeRequestStatus = (raw) =>
  String(raw ?? "")
    .trim()
    .toLowerCase();

const rowKey = (row) =>
  row?.row_key || `${String(row?.request_type || "leave").toLowerCase()}-${row?.id}`;

const matchesStatusFilter = (row, statusFilter) => {
  if (statusFilter === "All") return true;
  return normalizeRequestStatus(row?.status) === normalizeRequestStatus(statusFilter);
};

const UPDATION_PER_PAGE = 25;

async function fetchUpdationPage(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
  });
  const res = await fetch(`${API_BASE}/leave-updation/requests?${qs.toString()}`, {
    headers: getAuthHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || "Failed to fetch requests");
  return data;
}

const selectUpdationRows = (body) => (Array.isArray(body?.requests) ? body.requests : []);
const selectUpdationMeta = (body) => ({
  counts: body?.counts || null,
  pendingOnBehalf: Array.isArray(body?.pending_on_behalf) ? body.pending_on_behalf : [],
});

const parseAuditAction = (actionText) => {
  const raw = String(actionText || "");
  const chunks = raw.split("|");
  const details = [];

  const pushDetail = (label, fromVal, toVal) => {
    details.push({
      label,
      from: String(fromVal ?? "-"),
      to: String(toVal ?? "-"),
    });
  };

  for (const chunk of chunks) {
    if (!chunk || chunk === "LEAVE_UPDATION") continue;
    if (chunk.startsWith("status:")) {
      const [fromVal, toVal] = chunk.replace("status:", "").split("->");
      pushDetail("Status", fromVal, toVal);
    } else if (chunk.startsWith("paid:")) {
      const [fromVal, toVal] = chunk.replace("paid:", "").split("->");
      pushDetail("Paid Days", fromVal, toVal);
    } else if (chunk.startsWith("lwp:")) {
      const [fromVal, toVal] = chunk.replace("lwp:", "").split("->");
      pushDetail("LWP", fromVal, toVal);
    } else if (chunk.startsWith("dates:")) {
      const value = chunk.replace("dates:", "");
      const parts = value.split(",");
      if (parts[0]) {
        const [fromVal, toVal] = parts[0].split("->");
        pushDetail("Start Date", fromVal, toVal);
      }
      if (parts[1]) {
        const [fromVal, toVal] = parts[1].split("->");
        pushDetail("End Date", fromVal, toVal);
      }
    } else if (chunk.startsWith("approved_by:")) {
      details.push({
        label: "Approved by Admin",
        from: null,
        to: chunk.replace("approved_by:", "").trim() || "-",
      });
    } else if (chunk.startsWith("reason:")) {
      details.push({
        label: "Reason",
        from: null,
        to: chunk.replace("reason:", "").trim() || "-",
      });
    }
  }
  return details;
};

export const LeaveApplicationUpdation = ({
  onBack,
  empTypeOptions = [],
  circleOptions = [],
  initialContext = null,
}) => {
  const [filters, setFilters] = useState({
    request_type: initialContext?.request_type || "all",
    emp_type: "",
    circle: "",
  });
  const [statusFilter, setStatusFilter] = useState(
    initialContext?.status ? initialContext.status.charAt(0).toUpperCase() + initialContext.status.slice(1) : "All"
  );
  const [allRows, setAllRows] = useState([]);
  const [pendingOnBehalf, setPendingOnBehalf] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editRow, setEditRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [onBehalfEmployee, setOnBehalfEmployee] = useState(null);
  const [onBehalfCandidates, setOnBehalfCandidates] = useState([]);
  const [onBehalfSearchLoading, setOnBehalfSearchLoading] = useState(false);
  const [onBehalfSearchError, setOnBehalfSearchError] = useState("");
  const [onBehalfFilters, setOnBehalfFilters] = useState({
    emp_type: empTypeOptions[0] || "",
    circle: circleOptions[0] || "",
  });
  const [page, setPage] = useState("main");
  const [pageNotice, setPageNotice] = useState("");
  const pageTopRef = useRef(null);
  const [form, setForm] = useState({
    leave_type: "",
    start_date: "",
    end_date: "",
    status: "Pending",
    reason: "",
  });

  const paged = useMemo(() => isPagedScreenEnabled("hrLeaveUpdation"), []);
  // Dropdown filters apply on "Search", as before; status pills apply straight away.
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const listFilters = useMemo(() => ({
    request_type: appliedFilters.request_type,
    emp_type: appliedFilters.emp_type,
    circle: appliedFilters.circle,
    ...(initialContext?.admin_id ? { admin_id: String(initialContext.admin_id) } : {}),
    ...(statusFilter !== "All" ? { status: statusFilter.toLowerCase() } : {}),
  }), [appliedFilters, initialContext?.admin_id, statusFilter]);
  const list = usePagedList({
    fetchList: fetchUpdationPage,
    select: selectUpdationRows,
    selectMeta: selectUpdationMeta,
    filters: listFilters,
    perPage: UPDATION_PER_PAGE,
    skip: !paged,
  });

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filters.request_type) params.set("request_type", filters.request_type);
      if (filters.emp_type) params.set("emp_type", filters.emp_type);
      if (filters.circle) params.set("circle", filters.circle);
      if (initialContext?.admin_id) params.set("admin_id", String(initialContext.admin_id));
      const statusParam = statusFilter === "All" ? "all" : statusFilter.toLowerCase();
      if (statusParam !== "all") params.set("status", statusParam);
      const res = await fetch(`${API_BASE}/leave-updation/requests?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to fetch requests");
      }
      setAllRows(data.requests || []);
      setPendingOnBehalf(data.pending_on_behalf || []);
    } catch (err) {
      setAllRows([]);
      setPendingOnBehalf([]);
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, [filters.request_type, filters.emp_type, filters.circle, statusFilter, initialContext?.admin_id]);

  useEffect(() => {
    setOnBehalfFilters((prev) => ({
      emp_type: prev.emp_type || empTypeOptions[0] || "",
      circle: prev.circle || circleOptions[0] || "",
    }));
  }, [empTypeOptions, circleOptions]);

  useRefreshOnNavigate(() => {
    // The paged list loads itself and refetches when its filters change.
    if (paged) return;
    fetchRows();
  });

  const refreshRows = paged ? list.reload : fetchRows;
  const runSearch = () => {
    if (!paged) {
      fetchRows();
      return;
    }
    setAppliedFilters(filters);
    list.reload();
  };

  const searchEmployeesForOnBehalf = useCallback(async () => {
    if (!onBehalfFilters.emp_type || !onBehalfFilters.circle) {
      setOnBehalfSearchError("Select employee type and circle.");
      return;
    }
    setOnBehalfSearchLoading(true);
    setOnBehalfSearchError("");
    try {
      const params = new URLSearchParams({
        emp_type: onBehalfFilters.emp_type,
        circle: onBehalfFilters.circle,
      });
      const res = await fetch(`${API_BASE}/employee/search?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Employee search failed");
      }
      setOnBehalfCandidates(data.employees || []);
      if ((data.employees || []).length === 0) {
        setOnBehalfSearchError("No employees found for the selected filters.");
      }
    } catch (err) {
      setOnBehalfCandidates([]);
      setOnBehalfSearchError(err.message || "Network error");
    } finally {
      setOnBehalfSearchLoading(false);
    }
  }, [onBehalfFilters.emp_type, onBehalfFilters.circle]);

  const openPage = useCallback((next) => {
    setPage(next);
    if (next !== "main") setPageNotice("");
  }, []);

  useEffect(() => {
    pageTopRef.current?.scrollIntoView({ block: "start" });
  }, [page]);

  const onBehalfLabel = onBehalfEmployee
    ? `${onBehalfEmployee.first_name || onBehalfEmployee.email || "Employee"} (${onBehalfEmployee.emp_id || onBehalfEmployee.id})`
    : "";

  const openEditor = (row) => {
    setSuccessMessage("");
    setEditRow(row);
    setForm({
      leave_type: row.leave_type || "Privilege Leave",
      start_date: row.start_date || "",
      end_date: row.end_date || "",
      status: row.status || "Pending",
      reason: row.reason || "",
    });
    setAuditRows([]);
    setAuditLoading(true);
    const isWfh = String(row.request_type || "").toLowerCase() === "wfh";
    const auditUrl = isWfh
      ? `${API_BASE}/leave-updation/wfh-requests/${row.id}/audit`
      : `${API_BASE}/leave-updation/requests/${row.id}/audit`;
    fetch(auditUrl, {
      headers: getAuthHeaders(),
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success) setAuditRows(data.audit || []);
      })
      .finally(() => setAuditLoading(false));
  };

  useEffect(() => {
    if (!initialContext?.ref_id || allRows.length === 0) return;
    const match = allRows.find((r) => rowKey(r) === initialContext.ref_id);
    if (match) openEditor(match);
  }, [allRows, initialContext?.ref_id]);

  // Paged: the linked request may not be on the first page, so ask for it by key once.
  const refLookupRef = useRef(false);
  useEffect(() => {
    if (!paged || !initialContext?.ref_id || refLookupRef.current) return;
    refLookupRef.current = true;
    fetchUpdationPage({ ...listFilters, page: 1, per_page: 1, ref: initialContext.ref_id })
      .then((body) => {
        const match = body?.pagination
          ? body.ref_row
          : selectUpdationRows(body).find((r) => rowKey(r) === initialContext.ref_id);
        if (match) openEditor(match);
      })
      .catch(() => {});
  }, [paged, initialContext?.ref_id, listFilters]);

  const closeEditor = () => {
    setEditRow(null);
    setSaving(false);
  };

  const needsSaveConfirmation = () => {
    if (!editRow) return false;
    const wasApproved = normalizeRequestStatus(editRow.status) === "approved";
    const willReject = normalizeRequestStatus(form.status) === "rejected";
    const datesShortened =
      wasApproved &&
      form.start_date &&
      form.end_date &&
      editRow.start_date &&
      editRow.end_date &&
      (form.start_date > editRow.start_date || form.end_date < editRow.end_date);
    const typeChanged =
      String(editRow.request_type || "").toLowerCase() !== "wfh" &&
      form.leave_type &&
      editRow.leave_type &&
      form.leave_type !== editRow.leave_type;
    return wasApproved && (willReject || datesShortened || typeChanged);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editRow?.id || editRow.admin_pending) return;
    if (needsSaveConfirmation()) {
      const isWfh = String(editRow.request_type || "").toLowerCase() === "wfh";
      const msg = isWfh
        ? "This approved WFH request will be changed (after Admin approval, if your change needs it). Managers and the employee will be notified by email. Continue?"
        : "This approved leave will be reversed and recalculated, with the balance restored or adjusted (after Admin approval, if your change needs it). Managers and the employee will be notified by email. Continue?";
      if (!window.confirm(msg)) return;
    }
    setSaving(true);
    setError("");
    setSuccessMessage("");
    try {
      const reasonText = String(form.reason || "").trim();
      if (reasonText && reasonText.length > 255) {
        setError("Reason must be at most 255 characters.");
        setSaving(false);
        return;
      }
      const isWfh = String(editRow.request_type || "").toLowerCase() === "wfh";
      const editUrl = isWfh
        ? `${API_BASE}/leave-updation/wfh-requests/${editRow.id}`
        : `${API_BASE}/leave-updation/requests/${editRow.id}`;
      const payload = isWfh
        ? {
            start_date: form.start_date,
            end_date: form.end_date,
            status: form.status,
            reason: form.reason,
          }
        : form;
      const res = await fetch(editUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to update request");
      }
      if (data.pending_approval) {
        setSuccessMessage(data.message || "Sent to Admin for approval.");
      } else {
        setSuccessMessage(
          isWfh ? "WFH request updated successfully." : "Leave request updated successfully."
        );
        if (!isWfh) {
          window.dispatchEvent(new CustomEvent("leaveDataUpdated"));
        }
      }
      closeEditor();
      await refreshRows();
    } catch (err) {
      setError(err.message || "Network error");
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => {
    if (paged) {
      const counts = list.meta?.counts;
      if (!counts) return null;
      return { total: counts.all, pending: counts.pending, approved: counts.approved, rejected: counts.rejected };
    }
    const total = allRows.length;
    const pending = allRows.filter((r) => matchesStatusFilter(r, "Pending")).length;
    const approved = allRows.filter((r) => matchesStatusFilter(r, "Approved")).length;
    const rejected = allRows.filter((r) => matchesStatusFilter(r, "Rejected")).length;
    return { total, pending, approved, rejected };
  }, [allRows, list.meta, paged]);

  const displayRows = useMemo(
    () => (paged ? list.rows : allRows.filter((r) => matchesStatusFilter(r, statusFilter))),
    [allRows, list.rows, paged, statusFilter],
  );
  const listLoading = paged ? list.loading : loading;
  const listError = paged ? list.error?.message || "" : "";
  const waitingOnBehalf = paged ? list.meta?.pendingOnBehalf || [] : pendingOnBehalf;

  if (page === "policy") {
    return (
      <div className="leave-application-updation-page" ref={pageTopRef}>
        <div className="leave-application-updation-shell lx-subpage">
          <button type="button" className="lau-back-btn" onClick={() => openPage("main")}>
            <ArrowLeft size={16} /> Back to Leave/WFH updation
          </button>
          <HRLeavePolicyPanel
            onCancel={() => openPage("main")}
            onSaved={(message) => {
              setPageNotice(message);
              openPage("main");
            }}
          />
        </div>
      </div>
    );
  }

  if (page === "approved") {
    return (
      <div className="leave-application-updation-page" ref={pageTopRef}>
        <div className="leave-application-updation-shell lx-subpage is-wide">
          <button type="button" className="lau-back-btn" onClick={() => openPage("main")}>
            <ArrowLeft size={16} /> Back to Leave/WFH updation
          </button>
          <HRApprovedLeaves empTypeOptions={empTypeOptions} circleOptions={circleOptions} />
        </div>
      </div>
    );
  }

  if (page === "onBehalf") {
    return (
      <div className="leave-application-updation-page" ref={pageTopRef}>
        <div className="leave-application-updation-shell lx-subpage">
          <button type="button" className="lau-back-btn" onClick={() => openPage("main")}>
            <ArrowLeft size={16} /> Back to Leave/WFH updation
          </button>
          <section className="lob-card">
            <div className="lob-head">
              <span className="lob-icon"><UserPlus size={20} /></span>
              <div className="lob-copy">
                <h3>Apply leave on behalf</h3>
                <p>Search an employee, then apply backdated or future leave with preview and policy checks.</p>
              </div>
            </div>

            <ul className="lob-features">
              <li><span><Search size={15} /></span>Find any employee by type and circle</li>
              <li><span><CalendarRange size={15} /></span>Backdated or future dates</li>
              <li><span><Calculator size={15} /></span>Live paid days and LWP preview</li>
              <li><span><ShieldCheck size={15} /></span>Checked against company policy</li>
            </ul>

            <div className="lob-steps">
              <div className={`lob-step${onBehalfEmployee ? " is-done" : " is-active"}`}>
                <div className="lob-step-label">
                  <span className="lob-step-num">{onBehalfEmployee ? <Check size={13} /> : 1}</span>
                  Find the employee
                  {onBehalfCandidates.length > 0 ? (
                    <span className="lob-count">{onBehalfCandidates.length} found</span>
                  ) : null}
                </div>
                <div className={`lob-search${onBehalfCandidates.length > 0 ? " has-employee" : ""}`}>
                  <label className="lob-field">
                    <span>Employee type</span>
                    <select
                      value={onBehalfFilters.emp_type}
                      onChange={(e) => setOnBehalfFilters((p) => ({ ...p, emp_type: e.target.value }))}
                    >
                      {empTypeOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label className="lob-field">
                    <span>Circle</span>
                    <select
                      value={onBehalfFilters.circle}
                      onChange={(e) => setOnBehalfFilters((p) => ({ ...p, circle: e.target.value }))}
                    >
                      {circleOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  {onBehalfCandidates.length > 0 ? (
                    <label className="lob-field is-employee">
                      <span>Employee</span>
                      <select
                        value={onBehalfEmployee?.id || ""}
                        onChange={(e) => {
                          const picked = onBehalfCandidates.find((emp) => String(emp.id) === e.target.value);
                          setOnBehalfEmployee(picked || null);
                        }}
                      >
                        <option value="">Select employee</option>
                        {onBehalfCandidates.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.first_name || emp.email} ({emp.emp_id || emp.id})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="lob-find"
                    onClick={searchEmployeesForOnBehalf}
                    disabled={onBehalfSearchLoading}
                  >
                    <Search size={16} aria-hidden />
                    {onBehalfSearchLoading ? "Searching…" : "Find employees"}
                  </button>
                </div>
                {onBehalfSearchError ? <div className="lob-error">{onBehalfSearchError}</div> : null}
              </div>

              <div className={`lob-step${onBehalfEmployee ? " is-active" : ""}`}>
                <div className="lob-step-label">
                  <span className="lob-step-num">2</span>
                  Apply leave
                </div>
                <HRApplyLeaveOnBehalf
                  embedded
                  adminId={onBehalfEmployee?.id || null}
                  employeeLabel={onBehalfLabel}
                  onSuccess={async (json) => {
                    const who = onBehalfLabel || "the employee";
                    setPageNotice(
                      json?.pending_approval
                        ? `Leave for ${who} sent to Admin for approval. It will be applied once an Admin approves it.`
                        : `Leave applied on behalf of ${who}.`
                    );
                    setOnBehalfEmployee(null);
                    openPage("main");
                    await refreshRows();
                  }}
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="leave-application-updation-page" ref={pageTopRef}>
      <div className="leave-application-updation-shell">
        <button type="button" className="lau-back-btn" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>
        <div className="lau-header-card">
          <h2>Leave/WFH Application Updation</h2>
          <p>HR can update Leave/WFH dates, reason, and status (leave balances auto-adjust including reversals). HR changes wait for Admin approval; an Admin's own changes apply straight away.</p>
          {initialContext?.status === 'pending' ? (
            <p className="lau-inbox-hint">Showing pending queue from HR Inbox{initialContext.ref_id ? ` — opened ${initialContext.ref_id}` : ''}.</p>
          ) : null}
        </div>

        {pageNotice ? (
          <div className="lx-notice" role="status">
            <Check size={16} />
            <span>{pageNotice}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setPageNotice("")}><X size={15} /></button>
          </div>
        ) : null}

        <div className="lx-actions">
          <HRLeavePolicyCard onEdit={() => openPage("policy")} />

          <section className="lx-action">
            <div className="lx-action-top">
              <span className="lob-icon"><UserPlus size={20} /></span>
              <div className="lx-action-copy">
                <h3>Apply leave on behalf</h3>
                <p>Search an employee, then apply backdated or future leave with preview and policy checks.</p>
              </div>
            </div>
            <div className="lx-action-foot">
              <button type="button" className="lp-btn is-sky" onClick={() => openPage("onBehalf")}>
                Apply leave <ArrowRight size={16} />
              </button>
            </div>
          </section>

          <section className="lx-action">
            <div className="lx-action-top">
              <span className="lob-icon ap-icon"><BadgeCheck size={20} /></span>
              <div className="lx-action-copy">
                <h3>Approved leaves</h3>
                <p>Leave and WFH approved by L1, with L2 shown as pending or approved. Filter by month, type and circle.</p>
              </div>
            </div>
            <div className="lx-action-foot">
              <button type="button" className="lp-btn is-green" onClick={() => openPage("approved")}>
                Approved leaves <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </div>

        <div className="lau-filters">
          <div>
            <label>Request Type</label>
            <select
              value={filters.request_type}
              onChange={(e) => setFilters((p) => ({ ...p, request_type: e.target.value }))}
            >
              {REQUEST_TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Employee Type</label>
            <select value={filters.emp_type} onChange={(e) => setFilters((p) => ({ ...p, emp_type: e.target.value }))}>
              <option value="">All</option>
              {empTypeOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Circle</label>
            <select value={filters.circle} onChange={(e) => setFilters((p) => ({ ...p, circle: e.target.value }))}>
              <option value="">All</option>
              {circleOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
          <button type="button" className="lau-search-btn" onClick={runSearch} disabled={listLoading}>
            <Search size={16} /> {listLoading ? "Loading..." : "Search"}
          </button>
        </div>

        <div className="lau-stats">
          {STATUS_FILTERS.map((status) => {
            const count = !stats
              ? null
              : status === "All"
                ? stats.total
                : status === "Pending"
                  ? stats.pending
                  : status === "Approved"
                    ? stats.approved
                    : stats.rejected;
            const label = status === "All" ? "Total" : status;
            return (
              <button
                key={status}
                type="button"
                className={`lau-stat-pill ${statusFilter === status ? "active" : ""}`}
                onClick={() => setStatusFilter(status)}
              >
                {count == null ? label : `${label}: ${count}`}
              </button>
            );
          })}
        </div>

        {(error || listError) && <div className="lau-error">{error || listError}</div>}
        {successMessage && <div className="lau-success">{successMessage}</div>}

        {waitingOnBehalf.length > 0 ? (
          <section className="lau-waiting" aria-label="Leave waiting for Admin approval">
            <div className="lau-waiting-head">
              <Hourglass size={16} aria-hidden />
              <h3>Leave applied by HR, waiting for Admin</h3>
              <span className="lau-waiting-count">{waitingOnBehalf.length}</span>
            </div>
            <ul>
              {waitingOnBehalf.map((item) => (
                <li key={item.request_id}>
                  <div className="lau-waiting-who">
                    <strong>{item.employee_name}</strong>
                    <small>{item.emp_id || "-"}</small>
                  </div>
                  <span>{item.leave_type}</span>
                  <span>{formatDate(item.start_date)} to {formatDate(item.end_date)}</span>
                  <span className={`lau-status ${normalizeRequestStatus(item.status)}`}>{item.status}</span>
                  <small className="lau-waiting-by">Sent by {item.requested_by_name || "HR"}</small>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="lau-table-wrap">
          <table className="lau-table">
            <thead>
              <tr>
                <th>Emp</th>
                <th>Type</th>
                <th>Period</th>
                <th>Status</th>
                <th>Paid</th>
                <th>LWP</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={rowKey(row)}>
                  <td>
                    <div className="lau-emp-name">{row.employee_name || "-"}</div>
                    <small>{row.emp_id || "-"} • {row.circle || "-"}</small>
                  </td>
                  <td>{row.leave_type || (String(row.request_type).toLowerCase() === "wfh" ? "Work From Home" : "-")}</td>
                  <td>{formatDate(row.start_date)} to {formatDate(row.end_date)}</td>
                  <td>
                    <span className={`lau-status ${normalizeRequestStatus(row.status)}`}>
                      {row.status || "-"}
                    </span>
                  </td>
                  <td>{row.deducted_days == null ? "-" : row.deducted_days}</td>
                  <td>{row.extra_days == null ? "-" : row.extra_days}</td>
                  <td>
                    {row.admin_pending ? (
                      <span className="lau-admin-wait" title="HR's change is waiting for Admin approval">
                        <Hourglass size={13} aria-hidden /> Waiting for Admin
                      </span>
                    ) : (
                      <button type="button" className="lau-edit-btn" onClick={() => openEditor(row)}>
                        <Edit3 size={14} /> Update
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!listLoading && displayRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="lau-empty">No requests found for selected filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {paged && list.total > 0 ? (
          <Pager
            page={list.page}
            pages={list.pages}
            total={list.total}
            perPage={list.perPage}
            onPage={list.setPage}
            loading={list.loading}
            noun="requests"
          />
        ) : null}
      </div>

      {editRow && (
        <div className="lau-modal-backdrop" onClick={closeEditor}>
          <div className="lau-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{String(editRow.request_type || "").toLowerCase() === "wfh" ? `Update WFH #${editRow.id}` : `Update Leave #${editRow.id}`}</h3>
            {editRow.admin_pending ? (
              <p className="lau-admin-wait is-block">
                <Hourglass size={14} aria-hidden /> A change to this request is waiting for Admin approval. You can edit it again once the Admin decides.
              </p>
            ) : null}
            <form onSubmit={handleSave}>
              <div className="lau-grid">
                {String(editRow.request_type || "").toLowerCase() !== "wfh" && (
                  <div>
                    <label>Leave Type</label>
                    <select value={form.leave_type} onChange={(e) => setForm((p) => ({ ...p, leave_type: e.target.value }))}>
                      {LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label>Status</label>
                  <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                    <option value="Pending">Pending</option>
                    <option value="Approved">Approved</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                </div>
                <div>
                  <label>Start Date</label>
                  <input type="date" value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} required />
                </div>
                <div>
                  <label>End Date</label>
                  <input type="date" value={form.end_date} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))} required />
                </div>
              </div>
              <div>
                <label>Reason</label>
                <textarea
                  rows={3}
                  value={form.reason}
                  onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
                  placeholder="Update reason (optional)"
                  maxLength={255}
                />
              </div>
              <div className="lau-modal-actions">
                <button type="button" className="lau-cancel" onClick={closeEditor}>Cancel</button>
                <button type="submit" className="lau-save" disabled={saving || editRow.admin_pending}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
            <div className="lau-audit-section">
              <h4>Audit Trail</h4>
              {auditLoading ? (
                <p>Loading audit history...</p>
              ) : auditRows.length === 0 ? (
                <p>No updates recorded yet.</p>
              ) : (
                <div className="lau-audit-table-wrap">
                  <table className="lau-audit-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Updated By</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditRows.map((a) => (
                        <tr key={a.id}>
                          <td>{formatDateTimeDDMMYYYY(a.created_at, "-")}</td>
                          <td>{a.performed_by || "-"}</td>
                          <td className="lau-audit-action">
                            <div className="lau-audit-chips">
                              {parseAuditAction(a.action).map((d, idx) => (
                                <div key={`${a.id}-${idx}`} className="lau-audit-chip">
                                  <span className="lau-chip-label">{d.label}</span>
                                  {d.from == null ? (
                                    <span className="lau-chip-value">{d.to}</span>
                                  ) : (
                                    <>
                                      <span className="lau-chip-from">{d.from}</span>
                                      <span className="lau-chip-arrow">{"->"}</span>
                                      <span className="lau-chip-to">{d.to}</span>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
