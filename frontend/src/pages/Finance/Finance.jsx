import { useCallback, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeIndianRupee,
  FileSpreadsheet,
  Receipt,
  Scale,
  ScrollText,
  Wallet,
} from "lucide-react";
import { FinanceClaims } from "./FinanceClaims";
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
      {view === "expenses" ? <ExpenseView /> : null}
      {view === "claims" ? <FinanceClaims /> : null}
      {view === "fnf" ? <FnfView /> : null}
      {view === "client" ? <ClientView /> : null}
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

  const queue = [
    {
      key: "expenses",
      title: "Reimbursements",
      value: summary ? s.claims_to_pay : "—",
      hint: summary ? `${s.claims_on_hold || 0} on hold` : "Approved claims",
      icon: <Wallet size={18} />,
      tone: "teal",
    },
    {
      key: "tax",
      title: "Tax proofs",
      value: summary ? s.tax_pending : "—",
      hint: "Waiting for a decision",
      icon: <Receipt size={18} />,
      tone: "blue",
    },
    {
      key: "fnf",
      title: "Full and final",
      value: summary ? s.fnf_open : "—",
      hint: "Not paid yet",
      icon: <Scale size={18} />,
      tone: "amber",
    },
    {
      key: "claims",
      title: "Claims",
      value: summary ? inr(s.ytd_expenses) : "—",
      hint: "Year to date",
      icon: <ScrollText size={18} />,
      tone: "ink",
    },
  ];

  const modules = [
    {
      key: "payroll",
      title: "Payroll control",
      text: "Department cost and late leave payments. Accounts still edits salary.",
      icon: <BadgeIndianRupee size={20} />,
    },
    {
      key: "tax",
      title: "Tax queue",
      text: "Approve or reject declarations and year-end proofs.",
      icon: <Receipt size={20} />,
    },
    {
      key: "expenses",
      title: "Reimbursements",
      text: "Pay or hold a claim after every line is approved.",
      icon: <Wallet size={20} />,
    },
    {
      key: "claims",
      title: "Claims",
      text: "Approve or reject claim lines and download each claim sheet.",
      icon: <ScrollText size={20} />,
    },
    {
      key: "fnf",
      title: "Full and final",
      text: "Review exit settlements and mark them paid.",
      icon: <Scale size={20} />,
    },
    {
      key: "client",
      title: "Client sheet",
      text: "Download the client attendance workbook for a circle.",
      icon: <FileSpreadsheet size={20} />,
    },
  ];

  return (
    <>
      <div className="finx-queue">
        {queue.map((card) => (
          <button key={card.title} type="button" className={`finx-queue-card tone-${card.tone}`} onClick={() => onOpen(card.key)}>
            <span className="finx-queue-icon">{card.icon}</span>
            <span className="finx-queue-copy">
              <span className="finx-queue-title">{card.title}</span>
              <strong>{card.value ?? "—"}</strong>
              <span className="finx-queue-hint">{card.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <header className="finx-head">
        <div>
          <p className="finx-kicker">Finance</p>
          <h1>{period || "This month"}</h1>
        </div>
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
            <ArrowUpRight size={16} />
          </button>
        ))}
      </div>
    </>
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

function ClientView() {
  const [departments, setDepartments] = useState([]);
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
      setDepartments(data.departments || []);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load departments");
    }
  }, []);

  useRefreshOnNavigate(load);

  const circles = departments.find((item) => item.department === dept)?.circles || [];

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
      <div className="finx-form">
        <label>
          Department
          <select value={dept} onChange={(e) => { setDept(e.target.value); setCircle(""); }}>
            <option value="">Select</option>
            {departments.map((item) => (
              <option key={item.department} value={item.department}>{item.department}</option>
            ))}
          </select>
        </label>
        <label>
          Circle
          <select value={circle} onChange={(e) => setCircle(e.target.value)}>
            <option value="">Select</option>
            {circles.map((name) => (
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
