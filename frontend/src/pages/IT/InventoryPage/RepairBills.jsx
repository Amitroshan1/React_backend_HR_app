import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  createRepairBillAPI,
  downloadRepairBillsExcelAPI,
  fetchRepairBillLaptopCodesAPI,
  fetchRepairBillPriorCountAPI,
  fetchRepairBillsAPI,
  toastITApiFailure,
} from "../Data";
import "./RepairBills.css";

const ISSUE_OPTIONS = ["Hardware", "Software", "Battery", "Screen", "Keyboard", "Charging", "Other"];
const AMOUNT_STATUS = ["Paid", "Unpaid", "Partial", "Waived"];
const WORKING_STATUS = ["Working", "Not Working", "In Repair", "Pending"];

const emptyForm = () => ({
  engineer_name: "",
  laptop_code: "",
  issue_type: "",
  date_of_repairing: "",
  amount_status: "",
  working_status: "",
  bill_amount: "",
  repair_count: "",
  remarks: "",
  file: "",
  file_name: "",
});

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const readAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });

export default function RepairBills() {
  const [tab, setTab] = useState("add");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [month, setMonth] = useState(currentMonth);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [kpis, setKpis] = useState({ total_bills: 0, total_amount: 0, paid_amount: 0, unpaid_count: 0 });
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [priorHint, setPriorHint] = useState(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchRepairBillsAPI({ month, q: debouncedSearch });
      setRows(data.bills || []);
      setKpis(data.kpis || { total_bills: 0, total_amount: 0, paid_amount: 0, unpaid_count: 0 });
    } catch (err) {
      toastITApiFailure(err, "Could not load repair bills");
    } finally {
      setLoading(false);
    }
  }, [month, debouncedSearch]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  useEffect(() => {
    const code = form.laptop_code.trim();
    if (code.length < 1) {
      setSuggestions([]);
      setPriorHint(null);
      return undefined;
    }
    const t = window.setTimeout(async () => {
      try {
        const [codesRes, priorRes] = await Promise.all([
          fetchRepairBillLaptopCodesAPI(code),
          fetchRepairBillPriorCountAPI(code),
        ]);
        setSuggestions(codesRes.codes || []);
        setPriorHint(priorRes.prior_count ?? 0);
        setForm((prev) =>
          prev.repair_count === "" && prev.laptop_code.trim() === code
            ? { ...prev, repair_count: String((priorRes.prior_count || 0) + 1) }
            : prev
        );
      } catch {
        setSuggestions([]);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [form.laptop_code]);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setForm((prev) => ({ ...prev, file: "", file_name: "" }));
      return;
    }
    try {
      const data = await readAsDataURL(file);
      setForm((prev) => ({ ...prev, file: data, file_name: file.name }));
    } catch (err) {
      toastITApiFailure(err, "Could not read file");
    }
  };

  const onSave = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await createRepairBillAPI({
        engineer_name: form.engineer_name,
        laptop_code: form.laptop_code,
        issue_type: form.issue_type,
        date_of_repairing: form.date_of_repairing,
        amount_status: form.amount_status,
        working_status: form.working_status,
        bill_amount: form.bill_amount,
        repair_count: form.repair_count,
        remarks: form.remarks,
        file: form.file,
        file_name: form.file_name,
      });
      toast.success("Repair bill saved");
      setForm(emptyForm());
      setPriorHint(null);
      setSuggestions([]);
    } catch (err) {
      toastITApiFailure(err, "Could not save repair bill");
    } finally {
      setSaving(false);
    }
  };

  const onExcel = async () => {
    try {
      await downloadRepairBillsExcelAPI({ month, q: debouncedSearch });
    } catch (err) {
      toastITApiFailure(err, "Could not download Excel");
    }
  };

  const monthLabel = useMemo(() => {
    if (!month) return "All months";
    const [y, m] = month.split("-");
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleString("en-IN", { month: "long", year: "numeric" });
  }, [month]);

  return (
    <div className="rb-page">
      <header className="rb-top">
        <div>
          <h1>Repair Bill</h1>
          <p>Record repair work, bills, and attachments. Every field is optional.</p>
        </div>
        <div className="rb-tabs">
          <button type="button" className={tab === "add" ? "is-on" : ""} onClick={() => setTab("add")}>
            Add bill
          </button>
          <button type="button" className={tab === "history" ? "is-on" : ""} onClick={() => setTab("history")}>
            History
          </button>
        </div>
      </header>

      {tab === "add" && (
        <form className="rb-card" onSubmit={onSave}>
          <div className="rb-grid">
            <label>
              Engineer Name
              <input value={form.engineer_name} onChange={(e) => setField("engineer_name", e.target.value)} />
            </label>
            <label className="rb-suggest">
              Laptop Code
              <input
                list="rb-laptop-codes"
                value={form.laptop_code}
                onChange={(e) => setField("laptop_code", e.target.value)}
              />
              <datalist id="rb-laptop-codes">
                {suggestions.map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
              {priorHint != null && form.laptop_code.trim() && (
                <span className="rb-hint">Previous repairs for this code: {priorHint}</span>
              )}
            </label>
            <label>
              Issue Type
              <input
                list="rb-issue-types"
                value={form.issue_type}
                onChange={(e) => setField("issue_type", e.target.value)}
              />
              <datalist id="rb-issue-types">
                {ISSUE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
            </label>
            <label>
              Date of Repairing
              <input type="date" value={form.date_of_repairing} onChange={(e) => setField("date_of_repairing", e.target.value)} />
            </label>
            <label>
              Amount Status
              <select value={form.amount_status} onChange={(e) => setField("amount_status", e.target.value)}>
                <option value="">Select</option>
                {AMOUNT_STATUS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
            <label>
              Working Status
              <select value={form.working_status} onChange={(e) => setField("working_status", e.target.value)}>
                <option value="">Select</option>
                {WORKING_STATUS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
            <label>
              Bill Amount
              <input type="number" min="0" step="0.01" value={form.bill_amount} onChange={(e) => setField("bill_amount", e.target.value)} />
            </label>
            <label>
              Repair Count
              <input type="number" min="0" step="1" value={form.repair_count} onChange={(e) => setField("repair_count", e.target.value)} />
            </label>
            <label className="rb-span">
              Remarks
              <textarea rows={3} value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} />
            </label>
            <label className="rb-span">
              File upload
              <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={onFile} />
              {form.file_name && <span className="rb-hint">{form.file_name}</span>}
            </label>
          </div>
          <div className="rb-actions">
            <button type="button" className="rb-ghost" onClick={() => { setForm(emptyForm()); setPriorHint(null); }}>
              Clear
            </button>
            <button type="submit" className="rb-primary" disabled={saving}>
              {saving ? "Saving…" : "Save bill"}
            </button>
          </div>
        </form>
      )}

      {tab === "history" && (
        <section className="rb-history">
          <div className="rb-kpis">
            <article><span>Bills</span><strong>{kpis.total_bills}</strong></article>
            <article><span>Total amount</span><strong>{kpis.total_amount}</strong></article>
            <article><span>Paid</span><strong>{kpis.paid_amount}</strong></article>
            <article><span>Unpaid / open</span><strong>{kpis.unpaid_count}</strong></article>
          </div>
          <div className="rb-toolbar">
            <input
              type="search"
              placeholder="Search engineer, laptop, issue…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            <button type="button" className="rb-ghost" onClick={() => { setMonth(""); setSearch(""); }}>
              All months
            </button>
            <button type="button" className="rb-primary" onClick={onExcel}>
              Download Excel {month ? `· ${monthLabel}` : ""}
            </button>
          </div>
          <div className="rb-table-wrap">
            <table className="rb-table">
              <thead>
                <tr>
                  <th>Engineer</th>
                  <th>Laptop</th>
                  <th>Issue</th>
                  <th>Date</th>
                  <th>Amount status</th>
                  <th>Working</th>
                  <th>Amount</th>
                  <th>Count</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={9}>Loading…</td></tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr><td colSpan={9}>No repair bills for this filter.</td></tr>
                )}
                {!loading && rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.engineer_name || "—"}</td>
                    <td>{row.laptop_code || "—"}</td>
                    <td>{row.issue_type || "—"}</td>
                    <td>{row.date_of_repairing || "—"}</td>
                    <td>{row.amount_status || "—"}</td>
                    <td>{row.working_status || "—"}</td>
                    <td>{row.bill_amount != null ? row.bill_amount : "—"}</td>
                    <td>{row.repair_count != null ? row.repair_count : "—"}</td>
                    <td>
                      {row.file_url ? (
                        <a href={row.file_url} target="_blank" rel="noreferrer">
                          {row.file_name || "Open"}
                        </a>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
