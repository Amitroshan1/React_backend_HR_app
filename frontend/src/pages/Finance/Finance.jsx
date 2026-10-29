import { useCallback, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeIndianRupee,
  BookOpen,
  FileSpreadsheet,
  Receipt,
  Scale,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import { FinanceClaims } from "./FinanceClaims";
import { FinanceCtcPolicy } from "./FinanceCtcPolicy";
import { useRefreshOnNavigate } from "../../hooks/useRefreshOnNavigate";
import { TaxDeclarationReview } from "../TaxDeclaration/TaxDeclarationReview";
import { TaxDeclarationReviewDetail } from "../TaxDeclaration/TaxDeclarationReviewDetail";
import { hasFeature } from "../../utils/planFeatures";
import "./Finance.css";

const API = "/api/finance";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

function inr(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function Finance() {
  const [view, setView] = useState("home");
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [taxId, setTaxId] = useState(null);

  const loadSummary = useCallback(async () => {
    try {
      const data = await readJson(await fetch(`${API}/summary`, { headers: authHeaders() }));
      setSummary(data.data || {});
      setError("");
    } catch (err) {
      setError(err.message || "Could not load finance summary");
    }
  }, []);

  useRefreshOnNavigate(loadSummary, [view]);

  const open = (next) => {
    setError("");
    setView(next);
  };

  return (
    <div className="finx">
      {view !== "home" && view !== "tax" && view !== "taxDetail" ? (
        <button type="button" className="finx-back" onClick={() => open("home")}>
          <ArrowLeft size={16} />
          Back to Finance
        </button>
      ) : null}
      {error ? <p className="finx-error">{error}</p> : null}
      {view === "home" ? <FinanceHome summary={summary} onOpen={open} /> : null}
      {view === "payroll" ? <PayrollView /> : null}
      {view === "tax" ? (
        <TaxDeclarationReview
          apiBase="/api/accounts"
          queue="finance"
          showCompanySettings={false}
          onBack={() => open("home")}
          onOpenDetail={(id) => {
            setTaxId(id);
            setView("taxDetail");
          }}
        />
      ) : null}
      {view === "taxDetail" && taxId ? (
        <TaxDeclarationReviewDetail
          apiBase="/api/accounts"
          declId={taxId}
          onBack={() => open("tax")}
        />
      ) : null}
      {view === "expenses" || view === "claims" ? <FinanceClaims /> : null}
      {view === "fnf" ? <FnfView /> : null}
      {view === "client" ? <ClientView /> : null}
      {view === "purchase" ? <PurchaseView /> : null}
      {view === "ctc" ? <CtcApprovalsView /> : null}
      {view === "payrollBatches" ? <PayrollBatchQueue /> : null}
      {view === "ctcPolicy" ? <FinanceCtcPolicy /> : null}
    </div>
  );
}

function FinanceHome({ summary, onOpen }) {
  const s = summary || {};
  const generated = Number(s.payslips_generated || 0);
  const pending = Number(s.payslips_pending || 0);
  const staff = generated + pending;
  const slipPct = staff > 0 ? Math.round((generated / staff) * 100) : 0;
  const period = summary ? `${s.month || ""} ${s.year || ""}`.trim() : "";

  const modules = [
    {
      key: "ctc",
      title: "CTC approval queue",
      text: "Accounts drafts waiting to publish",
      count: Number(s.ctc_pending || 0),
      icon: <ShieldCheck size={20} />,
    },
    {
      key: "payrollBatches",
      title: "Payroll approvals",
      text: "Batches waiting on Finance",
      count: Number(s.payroll_batch_pending || 0),
      icon: <FileSpreadsheet size={20} />,
    },
    {
      key: "payroll",
      title: "Payroll control",
      text: "Late leave payments this month",
      count: Number(s.extra_payments || 0),
      icon: <BadgeIndianRupee size={20} />,
    },
    {
      key: "tax",
      title: "Tax queue",
      text: "Verified declarations waiting on Finance",
      count: Number(s.tax_pending || 0),
      icon: <Receipt size={20} />,
    },
    {
      key: "claims",
      title: "Claims",
      text: "Lines to review or claims to pay",
      count: Number(s.claims_open || 0),
      icon: <ScrollText size={20} />,
    },
    {
      key: "fnf",
      title: "Full and final",
      text: "Open exit settlements",
      count: Number(s.fnf_open || 0),
      icon: <Scale size={20} />,
    },
    {
      key: "purchase",
      title: "Purchase requests",
      text: Number(s.purchase_waiting_manager || 0)
        ? `${Number(s.purchase_waiting_manager)} still with manager`
        : "Budget approvals after manager confirm",
      count: Number(s.purchase_pending || 0),
      icon: <ShoppingCart size={20} />,
    },
    {
      key: "client",
      title: "Client sheet",
      text: "Download the client attendance workbook",
      count: null,
      icon: <FileSpreadsheet size={20} />,
    },
  ];

  return (
    <>
      <header className="finx-head">
        <div>
          <p className="finx-kicker">Finance</p>
          <h1>{period || "This month"}</h1>
        </div>
        <button type="button" className="finx-policy-btn" onClick={() => onOpen("ctcPolicy")}>
          <BookOpen size={16} />
          CTC Policy
        </button>
      </header>

      <button type="button" className="finx-hero" onClick={() => onOpen("payroll")}>
        <div className="finx-hero-main">
          <span>Payroll this month</span>
          <strong>{summary ? inr(s.gross) : "—"}</strong>
          <em>{summary ? `Net ${inr(s.net)}` : "Gross on file"}</em>
        </div>
        <div className="finx-hero-side">
          <div className="finx-progress-label">
            <span>Payslips generated</span>
            <strong>{summary ? `${generated} of ${staff}` : "—"}</strong>
          </div>
          <div className="finx-progress" aria-hidden="true">
            <span style={{ width: `${slipPct}%` }} />
          </div>
          <span className="finx-hero-link">
            Open payroll
            <ArrowUpRight size={16} />
          </span>
        </div>
      </button>

      <div className="finx-modules">
        {modules.map((item) => (
          <button key={item.key + item.title} type="button" className="finx-module" onClick={() => onOpen(item.key)}>
            <span className="finx-module-icon">{item.icon}</span>
            <span className="finx-module-copy">
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </span>
            {item.count != null ? (
              <strong className={`finx-module-count${item.count === 0 ? " is-zero" : ""}`}>
                {item.count}
              </strong>
            ) : (
              <ArrowUpRight size={16} />
            )}
          </button>
        ))}
      </div>
    </>
  );
}

function CtcApprovalsView() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await readJson(await fetch(`${API}/ctc-approvals`, { headers: authHeaders() }));
      setItems(data.items || []);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load CTC queue");
    }
  }, []);

  useRefreshOnNavigate(load);

  const decide = async (id, action) => {
    try {
      setBusyId(id);
      setError("");
      await readJson(
        await fetch(`${API}/ctc-approvals/${id}/decide`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ action, reason }),
        })
      );
      setReason("");
      await load();
    } catch (err) {
      setError(err.message || "Decision failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="finx-panel">
      <h2>CTC approval queue</h2>
      <p className="finx-queue-hint">
        Approving publishes live CTC for payroll, annexure PDF, and TDS. Rejecting leaves the last approved structure in place.
      </p>
      {error ? <p className="finx-error">{error}</p> : null}
      <label className="finx-reject-label">
        Reject reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required when you reject" />
      </label>
      <table className="finx-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Old CTC</th>
            <th>New CTC</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={6}>No CTC drafts waiting.</td></tr>
          ) : items.map((row) => (
            <tr key={row.id}>
              <td>
                {row.kind === "statutory_adopt"
                  ? `Adopt ${row.pack_id || "pack"}${row.recalc_count ? ` + ${row.recalc_count} recalc` : ""}`
                  : `${row.employee_name || "Employee"} ${row.emp_id ? `(${row.emp_id})` : ""}`}
              </td>
              <td>{String(row.kind || "").replaceAll("_", " ")}</td>
              <td>{String(row.status || "").replaceAll("_", " ")}</td>
              <td>{row.old_annual_ctc ? inr(row.old_annual_ctc) : "—"}</td>
              <td>{row.new_annual_ctc ? inr(row.new_annual_ctc) : "—"}</td>
              <td>
                {row.status === "pending_finance" ? (
                  <span className="finx-ctc-actions">
                    <button type="button" disabled={busyId === row.id} onClick={() => decide(row.id, "approve")}>
                      Approve
                    </button>
                    <button type="button" disabled={busyId === row.id} onClick={() => decide(row.id, "reject")}>
                      Reject
                    </button>
                  </span>
                ) : (
                  <span>Waiting on {String(row.status || "").replaceAll("_", " ")}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PayrollBatchQueue() {
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await readJson(await fetch(`${API}/payroll-batches`, { headers: authHeaders() }));
      setItems(data.items || []);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load payroll queue");
    }
  }, []);

  useRefreshOnNavigate(load);

  const openDetail = async (id) => {
    try {
      const data = await readJson(await fetch(`${API}/payroll-batches/${id}`, { headers: authHeaders() }));
      setDetail(data);
    } catch (err) {
      setError(err.message || "Could not load batch");
    }
  };

  const decide = async (id, action) => {
    try {
      setBusyId(id);
      setError("");
      await readJson(
        await fetch(`${API}/payroll-batches/${id}/decide`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ action, reason }),
        })
      );
      setReason("");
      setDetail(null);
      await load();
    } catch (err) {
      setError(err.message || "Decision failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="finx-panel">
      <h2>Payroll approval queue</h2>
      <p className="finx-queue-hint">
        Approve or reject a circle and department batch. The notice mail does not include employee names or amounts.
      </p>
      {error ? <p className="finx-error">{error}</p> : null}
      <label className="finx-reject-label">
        Reject comment (stays in the app)
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional for reject" />
      </label>
      <table className="finx-table">
        <thead>
          <tr>
            <th>Circle</th>
            <th>Department</th>
            <th>Month</th>
            <th>Employees</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={5}>No payroll batches waiting.</td></tr>
          ) : items.map((row) => (
            <tr key={row.id}>
              <td>{row.circle}</td>
              <td>{row.emp_type}</td>
              <td>{row.month} {row.year}</td>
              <td>{row.member_count}</td>
              <td>
                <button type="button" className="finx-btn" onClick={() => openDetail(row.id)}>Open</button>
                <button type="button" className="finx-btn finx-btn--ok" disabled={busyId === row.id} onClick={() => decide(row.id, "approve")}>Approve</button>
                <button type="button" className="finx-btn finx-btn--no" disabled={busyId === row.id} onClick={() => decide(row.id, "reject")}>Reject</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail?.batch ? (
        <div style={{ marginTop: 20 }}>
          <h3>{detail.batch.circle} · {detail.batch.emp_type} · {detail.batch.month} {detail.batch.year}</h3>
          <table className="finx-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>EmpID</th>
                <th>Days</th>
                <th>Gross</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {(detail.members || []).map((row) => (
                <tr key={row.id || row.admin_id}>
                  <td>{row.name}</td>
                  <td>{row.empId}</td>
                  <td>{Number(row.actual_working_days || 0).toFixed(1)}</td>
                  <td>{inr(row.gross_salary_for_month)}</td>
                  <td>{inr(row.net_salary_final)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function PayrollView() {
  const [rows, setRows] = useState([]);
  const [extras, setExtras] = useState([]);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const payroll = await readJson(await fetch(`${API}/payroll`, { headers: authHeaders() }));
      const extra = await readJson(await fetch(`${API}/extra-payments`, { headers: authHeaders() }));
      setRows(payroll.departments || []);
      setExtras(extra.items || []);
      setLabel(`${payroll.month || ""} ${payroll.year || ""}`.trim());
      setError("");
    } catch (err) {
      setError(err.message || "Could not load payroll");
    }
  }, []);

  useRefreshOnNavigate(load);

  return (
    <div className="finx-panel">
      <h2>Payroll cost {label}</h2>
      {error ? <p className="finx-error">{error}</p> : null}
      <table className="finx-table">
        <thead>
          <tr>
            <th>Department</th>
            <th>Employees on payroll</th>
            <th>Gross</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={4}>No payroll rows for this month yet.</td></tr>
          ) : rows.map((row) => (
            <tr key={row.department}>
              <td>{row.department}</td>
              <td>{row.employees}</td>
              <td>{inr(row.gross)}</td>
              <td>{inr(row.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Extra approval payment</h3>
      <table className="finx-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Dates</th>
            <th>Days</th>
            <th>Approved on</th>
          </tr>
        </thead>
        <tbody>
          {extras.length === 0 ? (
            <tr><td colSpan={4}>No late leave approvals this month.</td></tr>
          ) : extras.map((row) => (
            <tr key={row.id}>
              <td>{row.employee_name} {row.emp_id ? `(${row.emp_id})` : ""}</td>
              <td>{row.start_date} to {row.end_date}</td>
              <td>{row.days}</td>
              <td>{row.approved_on}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpenseView() {
  const [payout, setPayout] = useState("to_pay");
  const [claims, setClaims] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await readJson(await fetch(`${API}/expense-claims?payout=${payout}`, { headers: authHeaders() }));
      setClaims(data.claims || []);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load claims");
    }
  }, [payout]);

  useRefreshOnNavigate(load, [payout]);

  const act = async (id, action) => {
    try {
      setBusyId(id);
      await readJson(await fetch(`${API}/expense-claims/${id}/payout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ action }),
      }));
      await load();
    } catch (err) {
      setError(err.message || "Could not update this claim");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="finx-panel">
      <h2>Reimbursements</h2>
      <div className="finx-filters">
        {[
          ["to_pay", "To pay"],
          ["hold", "On hold"],
          ["paid", "Paid"],
        ].map(([key, label]) => (
          <button key={key} type="button" className={payout === key ? "active" : ""} onClick={() => setPayout(key)}>
            {label}
          </button>
        ))}
      </div>
      {error ? <p className="finx-error">{error}</p> : null}
      {claims.length === 0 ? <p>No claims in this list.</p> : null}
      <ul className="finx-list">
        {claims.map((claim) => (
          <li key={claim.id}>
            <div>
              <strong>{claim.employee_name}</strong>
              <span>{claim.emp_id} · {claim.project_name}</span>
              <span>{claim.travel_from_date} to {claim.travel_to_date} · {claim.line_count} lines</span>
            </div>
            <div className="finx-list-side">
              <strong>{inr(claim.total_amount)}</strong>
              {payout !== "paid" ? (
                <div className="finx-actions">
                  <button type="button" disabled={busyId === claim.id} onClick={() => act(claim.id, "paid")}>Mark paid</button>
                  {payout !== "hold" ? (
                    <button type="button" className="secondary" disabled={busyId === claim.id} onClick={() => act(claim.id, "hold")}>Hold</button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FnfView() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await readJson(await fetch(`${API}/fnf`, { headers: authHeaders() }));
      setRows(data.settlements || []);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load settlements");
    }
  }, []);

  useRefreshOnNavigate(load);

  const markPaid = async (id) => {
    try {
      setBusyId(id);
      await readJson(await fetch(`${API}/fnf/${id}/paid`, {
        method: "POST",
        headers: authHeaders(),
      }));
      await load();
    } catch (err) {
      setError(err.message || "Could not mark this settlement paid");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="finx-panel">
      <h2>Full and final</h2>
      {error ? <p className="finx-error">{error}</p> : null}
      {rows.length === 0 ? <p>No settlements on file.</p> : null}
      <ul className="finx-list">
        {rows.map((row) => (
          <li key={row.id}>
            <div>
              <strong>{row.employee_name || "Employee"}</strong>
              <span>{row.emp_id} · last day {row.last_working_day}</span>
              <span>Status: {row.status}</span>
            </div>
            <div className="finx-list-side">
              <strong>{inr(row.net_payable)}</strong>
              {row.open ? (
                <button type="button" disabled={busyId === row.id} onClick={() => markPaid(row.id)}>Mark paid</button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PurchaseView() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [remarks, setRemarks] = useState({});
  const [inbox, setInbox] = useState("pending");

  const load = useCallback(async () => {
    try {
      const status = inbox === "pending" ? "pending_finance" : inbox === "manager" ? "pending_manager" : "";
      const query = status ? `?inbox=finance&status=${status}` : "?inbox=finance";
      const data = await readJson(await fetch(`/api/inventory-purchase${query}`, { headers: authHeaders() }));
      setRows(data.requests || []);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load purchase requests");
    }
  }, [inbox]);

  useRefreshOnNavigate(load, [inbox]);

  const act = async (id, action) => {
    try {
      setBusyId(id);
      await readJson(await fetch(`/api/inventory-purchase/${id}/finance-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ action, remarks: remarks[id] || "" }),
      }));
      await load();
    } catch (err) {
      setError(err.message || "Could not update this request");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="finx-panel">
      <h2>Purchase requests</h2>
      <p>IT and Inventory raise the same queue. You can see manager-pending items, but budget approval is only after the manager confirms.</p>
      {error ? <p className="finx-error">{error}</p> : null}
      <div className="finx-form" style={{ marginBottom: 16 }}>
        <label>
          Queue
          <select value={inbox} onChange={(e) => setInbox(e.target.value)}>
            <option value="pending">Waiting on finance</option>
            <option value="manager">Waiting on manager</option>
            <option value="all">All visible</option>
          </select>
        </label>
      </div>
      {rows.length === 0 ? <p>No purchase requests in this queue.</p> : null}
      <ul className="finx-list">
        {rows.map((row) => (
          <li key={row.id}>
            <div>
              <strong>{row.request_no} · {row.title}</strong>
              <span>{row.source_label || "Inventory"} · {row.requested_by_name} · {row.item_name || row.category} · Qty {row.quantity}</span>
              <span>{row.estimated_amount != null ? inr(row.estimated_amount) : "No estimate"} · {row.status_label}</span>
              <span>{row.justification}</span>
              {row.attachments?.length ? (
                <span>
                  {row.attachments.map((file) => (
                    <a key={file.url || file.name} href={file.url} target="_blank" rel="noreferrer" style={{ marginRight: 8 }}>{file.name}</a>
                  ))}
                </span>
              ) : null}
              {row.status === "pending_finance" ? (
                <textarea
                  placeholder="Remark (required to reject)"
                  value={remarks[row.id] || ""}
                  onChange={(e) => setRemarks((current) => ({ ...current, [row.id]: e.target.value }))}
                  rows={2}
                />
              ) : null}
            </div>
            <div className="finx-list-side">
              {row.status === "pending_finance" ? (
                <>
                  <button type="button" disabled={busyId === row.id} onClick={() => act(row.id, "approve")}>Approve budget</button>
                  <button type="button" disabled={busyId === row.id} onClick={() => act(row.id, "reject")}>Reject</button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClientView() {
  const [departments, setDepartments] = useState([]);
  const [circles, setCircles] = useState([]);
  const [dept, setDept] = useState("");
  const [circle, setCircle] = useState("");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await readJson(await fetch(`${API}/client-options`, { headers: authHeaders() }));
      const deptList = Array.isArray(data.departments) && data.departments.length && typeof data.departments[0] === "string"
        ? data.departments
        : (data.departments || []).map((item) => item.department).filter(Boolean);
      const circleList = Array.isArray(data.circles)
        ? data.circles
        : (data.departments || []).flatMap((item) => item.circles || []);
      setDepartments([...new Set(deptList)]);
      setCircles([...new Set(circleList)]);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load departments");
    }
  }, []);

  useRefreshOnNavigate(load);

  const download = async () => {
    if (!hasFeature("account_for_client")) {
      setError("The client attendance sheet is not included in this plan.");
      return;
    }
    if (!dept || !circle || !month) {
      setError("Choose a department, circle, and month.");
      return;
    }
    try {
      setBusy(true);
      setError("");
      const params = new URLSearchParams({ emp_type: dept, circle, month });
      const response = await fetch(`/api/accounts/download-excel-client?${params}`, { headers: authHeaders() });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || contentType.includes("application/json")) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Could not download the sheet");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Client_Attendance_${circle}_${dept}_${month}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Could not download the sheet");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="finx-panel">
      <h2>Client attendance sheet</h2>
      <p>This is the same sheet Accounts and HR download. Days that were not fully approved stay unpaid.</p>
      {error ? <p className="finx-error">{error}</p> : null}
      <div className="finx-form finx-form--client">
        <label>
          Circle
          <select value={circle} onChange={(e) => setCircle(e.target.value)}>
            <option value="">Select circle</option>
            {circles.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Department
          <select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">Select department</option>
            {departments.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <button type="button" disabled={busy} onClick={download}>{busy ? "Downloading…" : "Download"}</button>
      </div>
    </div>
  );
}
