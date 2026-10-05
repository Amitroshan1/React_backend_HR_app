# 09 — Accounts, payroll & CTC

**Audience:** developers changing CTC structure, monthly payroll generation, payable days, payroll status locks, FnF/loans, compliance exports, or Accounts panel UX.  
**Blueprint:** `website/Accounts.py` → **`/api/accounts`**  
**Supporting services:** `payroll_governance_service`, `payroll_lifecycle_service`, `payroll_tds_service`, `ctc_*`, `utility.calculate_monthly_payroll_from_ctc_and_attendance`  
**Pure logic:** `commands/payroll_logic.py`, `payroll_governance_logic.py`, `payroll_lifecycle_logic.py`, `ctc_breakup_logic.py`  
**UI hub:** `/account` → `pages/Account/Account.jsx`  
**Employee salary views:** `/payslip` → `Payslip.jsx` (+ Form16 / tax projection)  
**Related:** [07 Attendance](./07-ATTENDANCE-ENGINE.md) · [06 HR](./06-HR-CORE.md) · Tax → module **10** · Claims → module **11**

> Large control plane. This page maps **CTC + monthly payroll + governance + lifecycle**. Tax declaration review and expense-claim settlement APIs live on the same blueprint but are detailed in modules **10** / **11**.

---

## 1. Purpose

Accounts owns money-side employment data:

1. **CTC breakup** — structure fixed/variable pay; forward & reverse calculate; annexure PDF; revisions / arrears  
2. **Monthly payroll** — CTC gross × payable days → earnings; statutory deductions + TDS; Accounts overrides  
3. **Governance** — `draft → reviewed → paid → locked` with audit log  
4. **Lifecycle** — loans, leave encashment, FnF settlements, salary revision queue  
5. **Compliance exports** — PF ECR, ESIC, PT, Form 24Q, bank NEFT file  
6. **Documents** — upload PaySlip / Form16 PDFs; bank/PAN/UAN profile  
7. **Panel extras** — expense claim review, tax declaration review, Accounts NOC (pointers below)

Employee self-service reads CTC / uploaded slips / generated payroll PDF via the same `/api/accounts` paths (with plan + sensitive OTP gates).

---

## 2. Roles & access

### 2.1 Blueprint guard (`_accounts_plan_guard`)

| Rule | Detail |
|------|--------|
| Default | JWT + `can_access_accounts_panel` → feature `account_panel` |
| Payroll paths | Also need `account_payroll` (`/payroll`, `/payroll-summary`) |
| CTC / TDS calc | Also need `account_ctc_breakup` (`/ctc-breakup`, `/tds`, `/tax-rules`) |
| Profile shared with HR | `/employee-accounts-profile` → `can_access_employee_accounts_module` |
| Client Excel | `/download-excel-client` → `can_access_for_client_export` |

**Self-service bypasses** (handlers still enforce own vs privileged + sensitive auth):

| Path pattern | Why |
|--------------|-----|
| `/payslip/history/<id>` | Employee Payslip page |
| `/ctc-breakup/<id>` (+ `/pdf`) | Own CTC view / annexure |
| `/form16/history/<id>` | Own Form16 |
| `/file/...` | Authenticated file download |
| `/payroll/<id>/download` | Needs `account_panel` in plan; non-Accounts users limited to own row |
| `/tax-declaration*` | Guarded inside tax handlers (module **10**) |

### 2.2 Role helpers

| Helper | Who |
|--------|-----|
| `_accounts_can_access_any_profile` | Accounts / HR / Admin emp_types — view any employee |
| `accounts_department_required` | Accounts-only NOC queue |

### 2.3 Frontend

`RequirePanel panel="account"` on `/account`. Tiles / bulk payroll gated with `hasFeature('account_payroll' | 'account_ctc_breakup' | …)`. Sensitive salary docs go through `SensitiveDataGate` / OTP (`sensitive_data_auth`).

---

## 3. Key tables / models

| Model | Table | Role |
|-------|-------|------|
| `CTCBreakup` | `ctc_breakups` | **One row per** `admin_id` — earnings + employer costs + include flags |
| `CTCBreakupRevision` | `ctc_breakup_revisions` | Effective-dated snapshots (history / arrears) |
| `MonthlyPayroll` | `monthly_payrolls` | Unique `(admin_id, month_num, year)` — computed + `*_final` |
| `PayrollAuditLog` | `payroll_audit_logs` | `regenerate`, `deductions_update`, `status_change`, `statutory_bonus_run` |
| `PaySlip` | `payslips` | **Uploaded** PDF archive — not the computed payroll row |
| `Form16` | (form16) | Uploaded Form 16 files (+ optional parse) |
| `EmployeeAccounts` | `employee_accounts` | Bank, PAN, UAN, PF/ESI/PRAN, tax regime / override |
| `EmployeeSalaryLoan` | `employee_salary_loans` | `active` → `closed`; EMI recovery |
| `FnfSettlement` | `fnf_settlements` | Exit settlement snapshot + status |

### Net pay (concept)

```text
gross = gross_salary_for_month
      + arrears_gross_final
      + leave_encashment_final
      + reimbursement_final
      + statutory_bonus_final

deductions = epf + esic + ptax + lwf + loan_recovery + tds   (finals)

net_salary_final = max(0, gross − deductions)
```

(`recompute_payroll_deduction_totals` / related helpers keep totals consistent after edits.)

---

## 4. Business rules

### 4.1 Payable days (attendance → payroll)

Payroll does **not** invent attendance. Flow:

```text
load_attendance_month_context
  → calculate_accounts_totals          # module 07
  → sandwich / Sunday credit rules
  → normalize_payable_days(raw, calendar_days)
  → MonthlyPayroll.actual_working_days
```

Entry points: `calculate_actual_working_days_for_payroll` → `calculate_actual_working_days_Accounts` in `utility.py`.

| Idea | Rule |
|------|------|
| One-day rate | `ctc.gross_salary / calendar_days` |
| Month gross | `one_day_salary × payable_days` |
| Current month | Span capped to **today IST** |
| Proration | `payroll_earnings_factor(payable_days, calendar_days)` for EPF/ESIC/reimbursement-style heads |
| Sandwich | Weekend continuous absence can drop Sunday credit (`calculate_weekend_continuous_absence_penalty`) |

Changing weekend / half-day rules in module **07** changes payroll money — coordinate both.

### 4.2 Payroll generate vs list

| Operation | Behavior |
|-----------|----------|
| `POST /payroll/generate` | Full recompute from CTC + attendance; **overwrites finals**; blocked if status ∈ `reviewed`/`paid`/`locked` (**409**) |
| `POST /payroll/list` | Lazy-creates missing rows the same calculator; **does not** overwrite finals on existing rows (except repair / missing TDS paths) |
| `PUT /payroll/deductions-update` | Edit finals / AWD only while **`draft`** |

After generate: `payroll_tds.apply_tds_to_payroll_row` + audit `regenerate`.

### 4.3 Status machine

Constants in `payroll_governance_logic.py`:

```text
draft  →  reviewed  →  paid  →  locked
   ↑_________|
```

| From | Allowed to |
|------|------------|
| `draft` | `reviewed` |
| `reviewed` | `draft` (reopen), `paid` |
| `paid` | `locked` |
| `locked` | — |

`READONLY_STATUSES` = `reviewed` | `paid` | `locked` — no deductions edit / regenerate until reopened to `draft`.  
Bulk transition: `POST /payroll/status` → `transition_payroll_status`.

### 4.4 CTC forward vs reverse

| Mode | Entry | Idea |
|------|-------|------|
| Forward | `POST /ctc-breakup/calculate` → `_ctc_calculate` | Basic+DA → HRA % → allowance heads → gross; employer PF/ESIC/gratuity/…; employee EPF/ESIC/PT |
| Reverse | `POST /ctc-breakup/reverse-calculate` | Binary-search **Basic** to hit target **fixed** annual CTC; DA/allowances fixed; variable pay **excluded** from solve |
| Persist | `PUT /ctc-breakup` | Upsert row; optional revision when `effective_from` set |
| Policy | `GET`/`PUT /ctc-policy`, `GET`/`PUT /tds-settings` | Per company (`company_settings`, namespaces `ctc` / `tds`); company 1 falls back to `ctc_settings.json` / `tds_settings.json` until it saves. New companies: defaults, employer name = company name |

Basic+DA typically constrained to ~**40–50%** of monthly fixed CTC (`basic_min/max_pct_of_ctc`).

### 4.5 Statutory formulas (high signal)

Exact numbers live in `ctc_breakup_logic` / `_CTC_RULES` / `lwf_rules.json` — treat as code-owned:

| Head | Typical rule |
|------|----------------|
| EPF employee | On Basic+DA; &lt; ₹15k → 12%; else `epf_mode` `min` (₹1800) or `percent`; + VPF |
| Employer PF / Admin / EDLI | Wage capped 15k; Admin/EDLI optional via include flags |
| ESIC | If gross &lt; ₹21 001 → EE 0.75% / ER 3.25%; else 0 |
| PT | State slabs (default **MH** via `default_ptax_state`) |
| LWF | State / month from `lwf_rules.json` or policy yearly÷12 |
| Gratuity (CTC cost) | (Basic+DA)/26×15 yearly |
| TDS | Declaration + YTD payroll → `compute_monthly_tds_for_payroll` (prefer **approved** declaration) |
| Statutory bonus (payout) | `POST /payroll/statutory-bonus-run` — monthly prorated or annual |

### 4.6 Arrears

1. Preview: `POST /ctc-breakup/arrears-preview` → `compute_salary_arrears` (Δgross × payable days when a payroll row exists).  
2. Apply: `POST /payroll/apply-arrears` → sets `arrears_gross_*` on **editable** rows only.

### 4.7 Loans & FnF

| Concern | Rule |
|---------|------|
| Loan EMI | `loan_emi_for_month` = min(emi, balance); loaded on generate |
| Balance drop | Only when deductions update sends `apply_loan_balance` → `apply_loan_recovery_after_payroll` |
| Leave encashment | Preview from PL (+ optional CL) × one-day salary |
| FnF | `compute_fnf_settlement` — pending salary, encashment, gratuity (≥5 yrs), notice/loan/other |
| FnF statuses | `draft` \| `finalized` \| `paid` \| `settled` \| `completed` |

### 4.8 PaySlip upload vs MonthlyPayroll

| Artifact | Meaning |
|----------|---------|
| `PaySlip` row | Scanned/uploaded PDF for a month |
| `MonthlyPayroll` | Engine-calculated amounts + downloadable generated PDF |

Dashboard “Payslips Generated” counts **uploads**, not `MonthlyPayroll` rows.

---

## 5. API catalog

Prefix: **`/api/accounts`**. Auth: JWT unless noted. Privileged vs self enforced per handler.

### 5.1 CTC

| Method | Path | Notes |
|--------|------|-------|
| GET/PUT | `/ctc-policy` | The company's CTC settings |
| GET/PUT | `/tds-settings` | The company's employer name / TAN / PAN, TDS and declaration rules |
| POST | `/ctc-breakup/calculate` | Forward |
| POST | `/ctc-breakup/reverse-calculate` | Reverse |
| PUT | `/ctc-breakup` | Persist |
| GET | `/ctc-breakup/<admin_id>` | Get (+ sensitive) |
| GET | `/ctc-breakup/<admin_id>/pdf` | Annexure PDF |
| GET | `/ctc-breakup/revisions/<admin_id>` | Revisions |
| GET | `/ctc-breakup/history/<admin_id>` | History |
| POST | `/ctc-breakup/arrears-preview` | Arrears preview |

### 5.2 Payroll

| Method | Path | Notes |
|--------|------|-------|
| POST | `/payroll/generate` | Full recompute; **409** if locked status |
| POST | `/payroll/list` | Bulk list + lazy create |
| PUT | `/payroll/deductions-update` | Override finals / AWD; **409** if not draft |
| POST | `/payroll/status` | Bulk status transition |
| POST | `/payroll/statutory-bonus-run` | Bonus payout |
| GET | `/payroll/audit/<payroll_id>` | Audit trail |
| POST | `/payroll/history` | History filter |
| GET | `/payroll/<payroll_id>/download` | Generated PDF |
| POST | `/payroll/apply-arrears` | Apply arrears |
| GET | `/payroll-summary` | Dashboard stats |
| GET/POST | `/payroll/loans` | List / create |
| PUT | `/payroll/loans/<id>` | Update |
| POST | `/payroll/leave-encashment-preview` | Encashment |
| POST | `/payroll/fnf-preview` | FnF preview |
| GET/POST | `/payroll/fnf-settlements` | List / save |
| PATCH | `/payroll/fnf-settlements/<id>` | Status |
| GET | `/payroll/fnf-settlements/<id>/pdf` | FnF PDF |
| GET/PATCH | `/pending-salary-revisions…` | HR→Accounts revision queue |

### 5.3 Profile, roster, documents

| Method | Path |
|--------|------|
| GET/PUT | `/employee-accounts-profile` |
| GET | `/employee-documents/<admin_id>` |
| GET | `/employee-type-count`, `/employees-by-type-circle`, `/employee-type-circle-summary` |
| GET | `/download-excel`, `/download-excel-client` |
| POST | `/payslip/upload`, `/payslip/bulk-upload` |
| GET | `/payslip/history/<admin_id>` |
| DELETE | `/payslip/<payslip_id>` |
| POST | `/form16/upload`, `/form16/bulk-upload` |
| GET | `/form16/history/<admin_id>` |
| GET | `/file/<path>` |

### 5.4 Compliance

| Method | Path |
|--------|------|
| GET | `/compliance/pf-ecr` |
| GET | `/compliance/esic-statement` |
| GET | `/compliance/pt-summary` |
| GET | `/compliance/pt-remittance-calendar` |
| GET | `/compliance/form-24q` |
| GET | `/compliance/bank-file` |

### 5.5 Pointers (same blueprint, other handbook pages)

| Area | Paths | Module |
|------|-------|--------|
| Expense claims | `/expense-claims`, `…/excel`, `…/line-items/<id>/action` | **11** |
| Tax declaration / TDS UI | `/tax-declaration*`, `/tax-declarations*`, `/tax-rules`, `/tds/*`, Form16 summary/recon/traces, regime override | **10** |
| NOC | `/noc-requests*` | Offboarding / NOC (with HR/IT) |

---

## 6. Main flows

### 6.1 CTC setup

```text
GET /ctc-policy
  → POST calculate | reverse-calculate
  → PUT /ctc-breakup  (± effective_from → revision)
  → optional annexure PDF
```

### 6.2 Monthly payroll run

```text
Pick dept/circle employees
  → POST /payroll/list          # create drafts
  → edit via /payroll/deductions-update
  → optional /payroll/generate  # full refresh
  → POST /payroll/status        # draft→reviewed→paid→locked
  → GET /compliance/bank-file (etc.)
```

### 6.3 Arrears after revision

```text
CTC change + effective_from
  → arrears-preview
  → apply-arrears on draft months
```

### 6.4 Exit / FnF

```text
leave-encashment-preview / fnf-preview
  → POST fnf-settlements (draft)
  → PATCH status → PDF
```

---

## 7. Frontend map

| UI | Entry | Key APIs |
|----|-------|----------|
| Accounts hub | `/account` → `Account.jsx` | `/payroll-summary`, type-circle summary, NOC, tax count |
| Employees by type/circle | view `employees` | `/employees-by-type-circle`, profile, documents |
| CTC breakup | `ctcBreakup` | `/ctc-policy`, calculate/reverse, PUT, revisions, arrears, PDF |
| Bulk payroll | `bulkPayroll` | `/payroll/list`, deductions-update, status, statutory-bonus, history |
| Payroll history | `payrollHistory` | `/payroll/history`, download |
| Lifecycle / loans / FnF | handlers still call APIs (menu may restore to employees) | loans, fnf-*, encashment, pending revisions |
| Compliance | `complianceExports` handlers | `/compliance/*` |
| Payslip / Form16 upload | `addPayslip`, bulk*, `addForm16` | upload + history |
| Expense claims | `expenseClaims` | `/expense-claims*` → **11** |
| Tax review | `taxDeclarations` | → **10**; includes the company TDS & employer settings panel (`/tds-settings`) |
| Employee Payslip | `/payslip` | history, CTC, `/auth/employee/homepage` payroll history, file / payroll download |
| Form16 / tax projection | sibling Payslip pages | accounts Form16 + `/api/auth/tds/projection` |

`API_BASE_URL = '/api/accounts'` throughout Accounts UI.

---

## 8. Jobs / CLI

**No dedicated payroll cron.** Runs are request-driven from the Accounts UI / API.

Payable-day quality depends on punch close, leave approval, biometric finalization (modules **03**, **04**, **08**, **17**).

Formula / governance changes: prefer unit tests on pure modules:

- `tests/test_payroll_payable_days.py`  
- `tests/test_payroll_governance_logic.py`  
- `tests/test_payroll_lifecycle_logic.py`  
- `tests/test_ctc_breakup_logic.py` / `test_ctc_advanced_logic.py`  
- `tests/test_arrears_logic.py` / `test_payroll_ytd.py`

---

## 9. Config

| Source | Knobs |
|--------|-------|
| `website/data/ctc_settings.json` | PT state, HRA %, basic % of CTC, include PF admin / EDLI / bonus / LWF, bonus %, LWF yearly, conveyance/medical caps |
| `ctc_settings.py` | Load/save/merge defaults |
| `_CTC_RULES` in `Accounts.py` | EPF/ESIC thresholds used by calculate paths |
| `data/lwf_rules.json` | State LWF months/amounts |
| TDS settings / tax rules | Declaration statuses for “payroll ready” TDS |
| Plan features | `account_panel`, `account_payroll`, `account_ctc_breakup`, `payslip_payroll_history`, … |

---

## 10. How to change safely

1. **Status machine** — Keep `VALID_TRANSITIONS` and UI buttons in sync; never silently edit `reviewed`/`paid`/`locked`.  
2. **Payable days** — Change only through `attendance_engine` + `normalize_payable_days` / sandwich helpers; add payable-days tests.  
3. **Generate vs list** — Generate overwrites finals; list must not casually overwrite Accounts edits.  
4. **TDS** — YTD excludes the current month row; respect manual `tds_final` unless AWD forces refresh.  
5. **Reverse CTC** — Only Basic is solved; do not fold variable CTC into the fixed target.  
6. **PaySlip ≠ MonthlyPayroll** — Do not use upload counts as “payroll completed”.  
7. **Loan balance** — Do not auto-reduce on generate without explicit `apply_loan_balance`.  
8. **Self-service bypass list** — If you add employee salary routes, update `_accounts_plan_guard` or Payslip breaks on Basic plans.  
9. **Prefer pure logic modules** for formula edits; keep Flask handlers thin.  
10. HR compensation proposals / bands (module **06**) feed Accounts CTC — they do not replace `ctc_breakups`.

---

## 11. Related modules

| # | Boundary |
|---|----------|
| 07 | `calculate_accounts_totals` / weekends / absences → payable days |
| 06 | Hire, exit, compensation proposals → Accounts executes CTC/payroll |
| 04 | Leave balances for encashment; payroll lock may block leave changes |
| 10 | Tax declaration, TDS projection UI, Form16 reconciliation |
| 11 | Expense claims create/approve; Accounts settles line items |
| 18 | Plan features gating Accounts panel |

Package map:

```text
Accounts.py                 # HTTP surface
payroll_governance_service  # status + audit + bonus apply
payroll_lifecycle_service   # loans, FnF, bank file helpers
payroll_tds_service         # monthly TDS onto payroll row
utility.py                  # monthly payroll calculator + AWD
commands/payroll_*_logic    # pure status / payable / FnF
commands/ctc_breakup_logic  # pure CTC math
ctc_settings.py + data/ctc_settings.json
models: ctc_*, monthly_payroll, employee_accounts, loans, fnf, audit
```

---

## 12. Quick test checklist

- [ ] Forward CTC calculate → PUT → GET matches heads + employer costs  
- [ ] Reverse CTC hits target fixed annual within tolerance; variable excluded from solve  
- [ ] Generate payroll: `actual_working_days` matches attendance_engine for a known month  
- [ ] Generate blocked (**409**) when status is `reviewed`/`paid`/`locked`  
- [ ] Deductions update only in `draft`; reopen `reviewed` → `draft` works  
- [ ] Status path draft→reviewed→paid→locked; illegal transition rejected  
- [ ] Arrears preview + apply only touches editable months  
- [ ] Loan EMI on generate; balance drops only with `apply_loan_balance`  
- [ ] FnF preview/save/PDF for exited employee with ≥5 yrs (gratuity path)  
- [ ] Compliance bank-file / PF export returns rows for paid month  
- [ ] Employee `/payslip` sees own CTC/history; other employees **403**  
- [ ] Uploaded PaySlip count ≠ MonthlyPayroll row count on dashboard  
