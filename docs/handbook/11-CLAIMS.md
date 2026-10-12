# 11 — Claims / expenses

**Audience:** developers changing expense claim submit, manager review, Accounts line actions, receipts, or Excel export.  
**Models:** `website/models/expense.py` — `ExpenseClaimHeader`, `ExpenseLineItem`  
**Employee API:** `leave_attendence.py` → **`/api/leave/claim-expense`**  
**Manager API:** `manager.py` → **`/api/manager/claim-requests*`**  
**Accounts API:** `Accounts.py` → **`/api/accounts/expense-claims*`**  
**Admin read:** `Admin.py` → **`/api/admin/claims`**  
**UI:** `/claims` (`Claims.jsx`), Manager claim inbox/detail, Accounts `expenseClaims`, `/admin/claims`  
**Related:** [05 Manager](./05-MANAGER-APPROVALS.md) · [09 Accounts](./09-ACCOUNTS.md) · [04 Leave](./04-LEAVE-WFH-COMPOFF.md) (same leave blueprint for submit)

> **HR has no claim APIs.** HR may be CC’d on submission email only.

---

## 1. Purpose

Travel / expense reimbursement:

1. Employee submits a **claim header + line items** (optional receipts)  
2. Manager can **bulk-approve/reject all Pending lines**  
3. Accounts can **approve/reject individual Pending lines**, export Excel, open receipts  
4. Org Admin can **list** claims org-wide (read-only)

There is **no separate “Paid” status** in code. Manager and Accounts both write the same line `status` (`Pending` → `Approved` / `Rejected`). Whichever side acts first on a Pending line wins; the other gets **409**.

---

## 2. Roles

| Stage | Who | Gate |
|-------|-----|------|
| Submit / own history | Any logged-in employee | JWT; SPA feature `dashboard_claims` (Basic plans off) |
| Manager review | L1–L3 on employee’s `ManagerContact` (+ optional self-approval roles) | `/api/manager` + `_is_manager_for_target` |
| Accounts action | Accounts panel users | `account_panel` via Accounts plan guard |
| Org-wide read | Admin emp_types | `/api/admin/claims` |
| HR | Email CC only | No routes |

---

## 3. Key tables / models

| Model | Table | Role |
|-------|-------|------|
| `ExpenseClaimHeader` | `expense_claim_header` | Trip/meta: name, project, country/state, travel dates — **no status column** |
| `ExpenseLineItem` | `expense_line_item` | `sr_no`, `date`, `purpose`, `amount`, `currency`, `Attach_file`, **`status`**, `rejection_reason` |

### Line status (stored)

`"Pending"` (default) | `"Approved"` | `"Rejected"`

### Header status (derived only — serializers)

Same helper pattern in manager / Accounts / Admin:

| Lines | Derived header |
|-------|----------------|
| All Approved | `Approved` |
| All Rejected | `Rejected` |
| Any Pending | `Pending` |
| Mix Approved + Rejected (no Pending) | `Partially Approved` |
| No lines | `Pending` |

Functions: `manager._claim_status`, `Accounts._claim_status_from_line_items`, `Admin._claim_status_from_items` — keep them identical.

---

## 4. Business rules

### 4.1 Submit (`POST /api/leave/claim-expense`)

- Multipart form: header fields + `expenses` JSON array (≥1 item)  
- Travel from ≤ to; each line `date` must fall in the travel window  
- Lines created with `status="Pending"`  
- Optional file per line: form key `attachments_{index}` → `static/uploads/tenants/{claimant company}/expenses/{emp_id}_{header.id}_{sr}_{filename}`; `Attach_file` stores that `tenants/…` key (`VARCHAR(300)`). Older rows hold `expenses/<name>` or a bare name; `claim_attach_storage_name` handles all three  
- Email: `send_claim_submission_email` (Accounts TO; managers + HR CC)  
- **No** employee edit / cancel / revoke endpoints after submit

### 4.2 Manager bulk action

`POST /api/manager/claim-requests/<id>/action` with `{ "action": "approve" | "reject" }`:

- Only lines with `status == "Pending"` flip  
- All pending lines get the **same** new status  
- If none pending → **409** `"No pending line items to update"`  
- Does **not** require / set `rejection_reason`  
- No decision email (silent)  
- Self-approval may write audit via `_append_self_approval_audit_if_needed`

### 4.3 Accounts per-line action

`POST /api/accounts/expense-claims/line-items/<id>/action`:

| Rule | Detail |
|------|--------|
| Action | `approve` \| `reject` |
| Reject | **`rejection_reason` required** |
| Only Pending | Else **409** |
| Email | `send_claim_line_item_decision_email` to employee |

Still sets `"Approved"` / `"Rejected"` — not a payout ledger status.

### 4.4 Race / ordering

Manager bulk and Accounts per-line **compete for Pending**. Typical product intent is manager then Accounts, but the API does not enforce a two-stage machine. If manager already Approved a line, Accounts cannot act.

### 4.5 Receipts & Excel

| Path | Behavior |
|------|----------|
| Manager file | `GET …/claim-requests/<id>/files/<line_item_id>` (watermark PDF path when applicable) |
| Accounts file | `GET /api/accounts/file/<path>` for `expenses/…` |
| Excel | `GET …/expense-claims/<id>/excel` → `generate_expense_claim_excel` using template `website/templates/Expenses_Claim_Form_FT.xlsx` |

### 4.6 Admin employee detail caveat

Admin employee payload may show claim status from the **first line only** — do not treat as the derived header status. Prefer `/api/admin/claims` list serializers that use `_claim_status_from_items`.

---

## 5. API catalog

### 5.1 Employee — `/api/leave`

| Method | Path | Notes |
|--------|------|-------|
| POST | `/claim-expense` | Multipart submit |
| GET | `/claim-expense` | Own claims (`admin_id` from JWT user) |

### 5.2 Manager — `/api/manager`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/claim-requests` | `?status=` default `Pending`; `all` allowed |
| GET | `/claim-requests/<claim_id>` | Detail + lines |
| GET | `/claim-requests/<claim_id>/files/<line_item_id>` | Receipt |
| POST | `/claim-requests/<claim_id>/action` | Bulk approve/reject pending lines |
| GET | `/pending-counts` | Includes `counts.claim` (derived Pending) |

### 5.3 Accounts — `/api/accounts`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/expense-claims` | Filters: status, circle, emp_type, q, month/year, from/to |
| GET | `/expense-claims/<claim_id>/excel` | Excel download |
| POST | `/expense-claims/line-items/<line_item_id>/action` | Per-line approve/reject |
| GET | `/file/<path>` | Protected receipt download |
| GET | `/payroll-summary` | Includes YTD expense amount metric |

### 5.4 Admin — `/api/admin`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/claims` | Org-wide list |
| GET | `/dashboard` | `total_claims`, `pending_claims` (pending **line** count) |

### 5.5 HR — `/api/HumanResource`

**None.**

---

## 6. Main flows

### 6.1 Submit

```text
Claims.jsx
  → POST /api/leave/claim-expense (FormData)
  → header + Pending lines + optional files
  → email Accounts (+ manager/HR CC)
```

### 6.2 Manager

```text
ClaimRequests / ManagerClaimDetails
  → GET /api/manager/claim-requests[/<id>]
  → POST …/action { approve | reject }
  → all Pending lines flip
```

### 6.3 Accounts

```text
Account.jsx → expenseClaims
  → GET /api/accounts/expense-claims
  → POST …/line-items/<id>/action (+ reason on reject)
  → optional Excel / file download
```

---

## 7. Frontend map

| UI | Route / entry | APIs |
|----|---------------|------|
| Employee claims | `/claims` → `Claims.jsx` | `GET/POST /api/leave/claim-expense` |
| Feature gate | Dashboard / AppLayout | `hasFeature("dashboard_claims")` |
| Manager inbox | Manager leave-requests claims tab | `/api/manager/claim-requests` + action |
| Manager detail | `/manager/claims/:claimId` | claim by id, file blob, action |
| Accounts | `Account.jsx` view `expenseClaims` | `/api/accounts/expense-claims*` |
| Org Admin | `/admin/claims` → `AdminClaims.jsx` | `GET /api/admin/claims` |

---

## 8. Jobs / CLI

**None.** No claim cron or Flask command. Manager sprint/stats may tally derived claim statuses for cards only.

---

## 9. Config

| Source | Role |
|--------|------|
| Plan `dashboard_claims` | Show employee Claims nav (off on Basic) |
| Plan `account_panel` | Accounts expense endpoints |
| `MANAGER_SELF_APPROVAL_ROLES` | Optional self-approve claims |
| Email env | `ZEPTO_CC_ACCOUNT`, `ZEPTO_CC_HR`, sender |
| Excel template | `website/templates/Expenses_Claim_Form_FT.xlsx` |
| Upload root | `static/uploads/tenants/{id}/expenses` (legacy `static/uploads/expenses`) |

---

## 10. How to change safely

1. **Do not invent a “Paid” status** without a schema + dual-stage workflow (manager vs Accounts) and UI updates — today both sides share one field.  
2. Keep all three derived-status helpers in sync.  
3. Manager list scans headers then filters by team — watch performance at scale (see module **05**).  
4. Adding employee cancel must define what happens to Pending lines already under manager/Accounts action.  
5. Align rejection_reason: Accounts requires it; manager currently does not.  
6. Excel export depends on the FT template file being present in deploy.  
7. Attachment helpers live in `expense_utils.py` — use them for path normalization.  
8. Updating handbook **05** wording: “manager ≠ paid” is product intent; implementation is still shared Approved/Rejected.

---

## 11. Related modules

| # | Boundary |
|---|----------|
| 04 | Submit lives on leave blueprint |
| 05 | Manager claim inbox / bulk action / pending counts |
| 09 | Accounts list, Excel, per-line action, dashboard YTD expenses |
| 16 | Admin org-wide claims list |

```text
models/expense.py
expense_utils.py          # attach path helpers
leave_attendence.py       # submit + own GET
manager.py                # list/detail/files/bulk action
Accounts.py               # list/excel/per-line + file
Admin.py                  # org list
email.py                  # submission + Accounts decision
```

---

## 12. Quick test checklist

- [ ] Submit with ≥1 line + travel window → Pending lines + email  
- [ ] Line date outside travel → **400**  
- [ ] Manager approve → all Pending → Approved; second action → **409**  
- [ ] Manager reject bulk → Rejected without reason still succeeds  
- [ ] Accounts reject without reason → **400**; with reason → email employee  
- [ ] After manager Approved, Accounts action on that line → **409**  
- [ ] Derived header: mix Approved+Rejected → `Partially Approved`  
- [ ] Receipt download works for manager file route and Accounts `/file/`  
- [ ] Excel download returns file when template present  
- [ ] Basic plan: Claims nav hidden (`dashboard_claims`)  
- [ ] Non-manager cannot act on another employee’s claim → **403**  
