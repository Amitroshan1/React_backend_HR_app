# 10 — Tax declaration, TDS & Form16

**Audience:** developers changing investment declarations, Finance review, TDS projection, payroll TDS, or Form16 summary/recon.  
**Core service:** `website/tax_declaration_service.py`  
**Math / policy:** `commands/tds_logic.py`, `tds_settings.py`, `tax_regime_service.py`, `tax_savings_service.py`, `payroll_tds_service.py`  
**Form16:** `form16_service.py`, `form16_variance_service.py`, `traces_import_service.py`  
**HTTP:** employee → **`/api/auth`**; Finance review / any-employee → **`/api/accounts`** (thin wrappers into the same services)  
**UI:** `pages/TaxDeclaration/*`, Payslip tax pages, Accounts tax review tiles  
**Related:** [09 Accounts](./09-ACCOUNTS.md) · [02 Auth](./02-AUTH-AND-SESSION.md) · sensitive OTP · plan `dashboard_payslip`

---

## 1. Purpose

Annual India tax workflow for Section 192:

1. Employee declares investments / HRA / previous employer (old or new regime)  
2. Finance reviews → approve / reject / amend unlock  
3. Year-end **final proof** (actual amounts) after provisional approval  
4. **TDS projection** from CTC + declaration rollups → monthly schedule  
5. **Payroll TDS** on `MonthlyPayroll` uses declaration when payroll-ready  
6. **Form16** computed Part A/B, uploaded certificates, TRACES CSV recon  

One active declaration per employee per financial year (`uq_employee_tax_decl_admin_fy`).

---

## 2. Roles

| Actor | Access |
|-------|--------|
| Employee | Self declaration, docs, final proof, history, own TDS projection, own Form16 summary — JWT + **sensitive OTP** + plan `dashboard_payslip` |
| Finance / Accounts / HR / Admin | Review queue, approve/reject, amend, final-proof review, deadline override, regime override, Form16 upload/TRACES, any-employee projection — `_accounts_reviewer` emp_types |

Accounts blueprint skips its panel guard for `/tax-declaration*` (handlers enforce reviewer vs self). CTC/TDS calc paths still need `account_ctc_breakup` when hit via Accounts (`/tds`, `/tax-rules`).

---

## 3. Key tables / models

| Model | Table | Role |
|-------|-------|------|
| `EmployeeTaxDeclaration` | `employee_tax_declarations` | Header: regime, status, phase, final proof, acceptances, legacy rollups |
| `TaxDeclarationItem` | `tax_declaration_items` | `section_code` / `item_code` / `amount` / `final_amount` |
| `TaxDeclarationDocument` | `tax_declaration_documents` | Proof files; `doc_type` includes `final_proof` |
| `TaxDeclarationApprovalHistory` | `tax_approval_history` | `submit`, `approve`, `reject`, `amend_unlock`, `final_proof_*` |
| `EmployeeAccounts` | `employee_accounts` | Profile `tax_regime` + HR `tax_regime_override*` |
| `Form16` | `form16` | Uploaded PDF + `parsed_*`, `data_source`, `certificate_type` |
| `CTCBreakup` / `MonthlyPayroll` | — | Gross projection; `tds_computed` / `tds_final` |

### Header fields that matter

| Field | Meaning |
|-------|---------|
| `status` | `draft` \| `submitted` \| `approved` \| `rejected` |
| `declaration_phase` | `provisional` (default) \| `final` (after final-proof approve) |
| `final_proof_status` | `draft` \| `submitted` \| `approved` \| `rejected` \| null |
| Legacy rollups | `rent_paid_annual`, `is_metro`, `section_80c_extra`, `section_80d`, `previous_employer_*` — synced from items for TDS |
| Acceptances | `regime_declaration_accepted`, `new_regime_acknowledged`, `final_declaration_accepted` + place/signed |

`is_locked()` → status in `("submitted", "approved")`.

---

## 4. Business rules

### 4.1 Status machine

```text
draft ──submit──► submitted ──Finance──► approved
  ▲                    │                   │
  │                    └──── reject ──► rejected (editable)
  │                                          │
  └──────── amend unlock (Finance) ◄─────────┘
            (clears final-proof; phase → provisional)
```

| Action | Who | Result |
|--------|-----|--------|
| Save draft (`submit=false`) | Employee | `draft` |
| Submit (`submit=true`) | Employee | `submitted`; needs open deadline, CTC, acceptances, caps |
| Approve / reject | Finance | Only from `submitted` |
| Amend unlock | Finance | Only from `approved` → `draft`; history `amend_unlock` |

UI `payroll_ready` = `status == "approved"`.

### 4.2 Final proof (year-end)

| Rule | Detail |
|------|--------|
| Unlock | After declaration `approved` |
| Editable fps | empty / `draft` / `rejected` |
| Submit | → `final_proof_status=submitted` |
| Finance approve | → fps `approved`, `declaration_phase=final` |
| TDS basis | Uses item **`final_amount`** when phase=`final` and fps=`approved`; else provisional `amount` |

### 4.3 Regime

| Rule | Detail |
|------|--------|
| Normalize | String containing `"old"` → `old`; else **`new`** |
| Effective regime | Submitted/approved declaration wins; else HR override; else profile |
| Employee change after submit | Blocked when `block_employee_regime_change_after_submit` |
| Caps / Chapter VI-A | Enforced for **old** regime (`validate_declaration_caps`, projection) |

### 4.4 Caps & schema

- Form UI from `data/tax_declaration_forms/{fy}.json` (`load_form_schema`)  
- Caps / slabs from `data/tax_rules/{fy}_{old|new}.json` (`load_tax_rules`)  
- Rollups apply section caps (80C = EPF annual + extras ≤ `section_80c_cap`, 80D, 80CCD1B, Sec24, LTA, …)

Bundled FYs observed: **2025-26**, **2026-27**.

### 4.5 Deadline

Default: day **25** / month **2** of the FY **end** calendar year (e.g. FY 2026-27 → **2027-02-25**).  
Per-FY overrides: `declaration_deadline_overrides` in the company's TDS settings (Finance PUT; per company — company 1 falls back to `tds_settings.json` until it saves).  
Submit blocked when `is_declaration_submission_open` is false.

### 4.6 Amend limits

Max unlocks per FY: `max_declaration_amendments_per_fy` (default **2**), counted via history action `amend_unlock`.  
Blocked if final proof is currently `submitted`.

### 4.7 TDS pipeline → payroll

```text
items → rollup_items_to_tds_inputs / declaration_tds_inputs_for_row
  → run_tds_projection (slabs, 87A, cess, remaining months)
  → monthly_tds schedule
  → compute_monthly_tds_for_payroll / apply_tds_to_payroll_row
```

| Setting | Effect |
|---------|--------|
| `payroll_tds_approved_only=true` | Payroll uses only **approved** declarations |
| `false` (default in JSON) | Payroll may use **approved** or **submitted** |

Draft / rejected / missing → investment deductions treated as zero; profile regime only.

Lifecycle events (submit, review, amend, final-proof) call `recalculate_payroll_tds_for_financial_year`.

Projection API also merges past months with payroll actuals (`merge_schedule_with_payroll_actuals`) and can emit variance (`build_tds_variance_report` / `POST /tds/variance`).

### 4.8 Form16

| Piece | Behavior |
|-------|----------|
| Computed summary | Part A (YTD payroll) + Part B (projection) — `build_form16_summary` |
| Upload / bulk | Accounts stores `Form16` files |
| TRACES CSV | `parse_traces_csv` → `import_traces_rows` (`data_source=traces`) |
| Recon | `match_status`: `no_uploaded_data` \| `matched` \| `variance` |
| Alert | Email if variance &gt; `form16_variance_tolerance_inr` (default ₹100) when enabled |

---

## 5. API catalog

### 5.1 Employee — `/api/auth`

| Method | Path | Notes |
|--------|------|-------|
| GET/POST | `/tax-declaration/self` | Load / save draft or submit |
| GET | `/tax-declaration/form-schema` | Schema for FY |
| GET | `/tax-declaration/financial-years` | FY list |
| POST | `/tax-declaration/self/documents` | Upload proof |
| DELETE | `/tax-declaration/self/documents/<doc_id>` | Delete |
| GET | `/tax-declaration/self/history` | Own list |
| GET | `/tax-declaration/<decl_id>` | Detail (own or reviewer) |
| GET/POST | `/tax-declaration/self/final-proof` | Final proof get/save-submit |
| GET | `/tax-declaration/deadline` | Deadline payload |
| POST | `/tds/projection` | Own projection (forces viewer) |
| POST | `/tds/variance` | Variance |
| GET | `/form16/summary` (+ `/download`) | Own Form16 summary/PDF |
| GET | `/form16/reconciliation` | Own recon |

Auth Form16/TDS handlers delegate into Accounts implementations with `admin_id` forced to self.

### 5.2 Finance — `/api/accounts`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/tax-declarations` | Review queue (`status` default `submitted`) |
| GET | `/tax-declarations/<id>` | Detail |
| POST | `/tax-declarations/<id>/review` | `approve` / `reject` |
| POST | `/tax-declarations/<id>/amend` | Unlock amendment |
| POST | `/tax-declarations/<id>/final-proof-review` | Approve/reject final proof |
| GET/PUT | `/tax-declaration/deadline` | Read / override |
| POST | `/tax-declaration/backfill-regime` | Sync approved → profile |
| PUT/DELETE | `/employees/<admin_id>/tax-regime-override` | HR override |
| GET | `/tax-rules` | Rules for FY (or list) |
| POST | `/tds/projection`, `/tds/variance` | Any employee if reviewer |
| GET | `/form16/summary/<admin_id>` (+ download, reconciliation) | |
| POST | `/form16/upload`, `/form16/bulk-upload`, `/form16/traces-import` | |
| GET | `/form16/history/<admin_id>` | Uploaded certificates |
| GET/POST | `/tax-declaration/self` (+ final-proof) | Same services (Accounts session) |
| GET | `/tax-declaration/financial-years` | FY list |

Typical errors: **400** validation/caps/deadline; **403** not owner/reviewer; **409** locked / illegal transition / amend limit.

---

## 6. Main flows

### 6.1 Provisional declaration

```text
GET self (+ form-schema)
  → edit items / upload docs
  → POST self submit=true
  → Finance GET /tax-declarations
  → POST …/review approve|reject
  → payroll TDS recalc for FY
```

### 6.2 Amend

```text
Finance POST …/amend (reason, under limit)
  → status draft; employee re-edits and resubmits
```

### 6.3 Final proof

```text
approved → GET/POST self/final-proof (final_amount + proofs)
  → Finance final-proof-review approve
  → phase=final; TDS uses finals; payroll recalc
```

### 6.4 Projection & Form16

```text
Employee: tax-projection page → POST /api/auth/tds/projection
Accounts: same via /api/accounts for any admin_id
Form16: Accounts upload/TRACES → employee summary + recon
```

---

## 7. Frontend map

| UI | Route | API base |
|----|-------|----------|
| Declaration form | `/tax-declaration` | `/api/auth` |
| Final proof | `/tax-declaration/final-proof` | `/api/auth` |
| History / detail | `/tax-declaration/history…` | `/api/auth` |
| Tax projection | `/tax-declaration/tax-projection` | auth TDS + accounts CTC |
| Form16 (employee) | `/tax-declaration/form16` | auth summary + accounts history/file |
| Finance review | Accounts hub → `TaxDeclarationReview*` | `/api/accounts` |
| Company TDS settings | Tax Declaration Review → `TdsSettingsPanel.jsx` (below the deadline box) | `GET/PUT /api/accounts/tds-settings` |

All employee tax routes wrap **`SensitiveDataGate`**. Caps helpers: `taxDeclarationCaps.js`. Review helpers: `taxDeclarationReviewUtils.js`.

---

## 8. Jobs / CLI

No dedicated tax cron or Flask CLI.

Side effects on lifecycle:

- `recalculate_payroll_tds_for_financial_year`  
- Payroll generate/update → `apply_tds_to_payroll_row` / `refresh_payroll_tds_final`  
- Optional `POST …/backfill-regime`  
- Form16 upload → `notify_form16_variance_if_needed`

---

## 9. Config

| Asset | Knobs |
|-------|-------|
| Company TDS settings (`/api/accounts/tds-settings`; company 1 falls back to `data/tds_settings.json`) | `payroll_tds_approved_only`, regime locks, employer TAN/PAN, Form16 tolerance/alert, amend max, deadline defaults/overrides |
| `data/tax_rules/{fy}_{old\|new}.json` | Slabs, rebate 87A, standard deduction, section caps, HRA % |
| `data/tax_declaration_forms/{fy}.json` | Sections/items, `proof_required`, document types |
| Plan | `dashboard_payslip` for employee tax pages |
| Accounts features | `account_ctc_breakup` for `/tds` + `/tax-rules` via Accounts |

---

## 10. How to change safely

1. Prefer **new FY JSON** (rules + forms) over editing `run_tds_projection` for slab/cap/UI changes.  
2. Status / history action strings are FE + email contracts — keep literals stable.  
3. Flipping `payroll_tds_approved_only` changes who gets declaration-based payroll TDS immediately.  
4. Final-proof approve switches TDS basis to finals — expect payroll recalc side effects.  
5. Keep unique `(admin_id, financial_year)`; do not invent parallel open declarations.  
6. Employee auth Form16/TDS must keep forcing `admin_id` to self.  
7. Sensitive OTP + `_payslip_feature_required` must stay on employee paths.  
8. Tests: `test_tds_logic.py`, `test_declaration_deadline.py`, `test_p6_regression.py`, `test_p7_regression.py`.

---

## 11. Related modules

| # | Boundary |
|---|----------|
| 09 | CTC gross, monthly payroll row, compliance Form 24Q |
| 02 | JWT / sensitive data session |
| 15 | Secure file URLs under `tax_declarations/`, `form16/` |
| 18 | Plan feature `dashboard_payslip` |

Package map:

```text
tax_declaration_service.py   # lifecycle HTTP handlers
tax_regime_service.py        # effective regime
tax_savings_service.py       # with/without declaration comparison
commands/tds_logic.py        # run_tds_projection, FY helpers
payroll_tds_service.py       # monthly payroll TDS
tds_settings.py              # JSON policy
form16_* / traces_import_*   # certificates & recon
auth.py                      # employee mounts
Accounts.py                  # Finance mounts + Form16 upload
```

---

## 12. Quick test checklist

- [ ] Draft save then submit → locked; further POST edit returns locked message  
- [ ] Submit past deadline → blocked; Finance deadline override reopens  
- [ ] Old-regime caps reject over-limit 80C / 80D  
- [ ] Finance approve → `payroll_ready`; payroll TDS non-zero when CTC present  
- [ ] Reject → employee can edit again  
- [ ] Amend unlock → draft; third unlock blocked when max=2  
- [ ] Final proof approve → phase `final`; projection `tds_basis` final  
- [ ] Employee projection only for self; Accounts can project others  
- [ ] Form16 recon: matched vs variance beyond ₹100 tolerance  
- [ ] Sensitive gate required on `/tax-declaration*` SPA routes  
