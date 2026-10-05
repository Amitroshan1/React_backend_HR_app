# 04 — Leave, WFH & Comp-off

**Audience:** developers changing employee leave apply, WFH requests, balances, sandwich rules, or comp-off ledger.  
**Blueprint:** `website/leave_attendence.py` → **`/api/leave`**  
**UI:** `frontend/src/pages/Leaves/`, `frontend/src/pages/Wfh/`  
**Related:** [03 Punch](./03-DASHBOARD-PUNCH-GEO.md) (approved WFH unlocks geo) · Manager approve → module **05** · HR proxy/accrual → module **06** · Attendance engine → **07**

> **Same blueprint, other docs:** expense claims → **11**; separation / NOC / letters → HR/offboarding (**06**); attendance regularization employee submit is covered briefly here, HR review in **06**/**07**.

---

## 1. Purpose

Employee self-service for:

1. Viewing **PL / CL / CompOff** balances and leave history  
2. **Applying** leave (with sandwich / LOP preview fields)  
3. **WFH** apply / list / cancel  
4. **Comp-off ledger** (gains, expiry, usage)  
5. Optional holidays for Optional Leave  
6. **Attendance regularization** requests (employee → HR)

**Balance deduction happens on manager Approve**, not at apply time (apply only computes `deducted_days` / `extra_days` / sandwich split).

---

## 2. Roles

| Actor | What they do here |
|-------|-------------------|
| Employee | Apply/cancel pending leave & WFH; view balances & ledger; submit regularization |
| Reporting manager | Approve/reject via `/api/manager` (module **05**) — not these `/api/leave` routes |
| HR | Accrual, proxy leave, holiday calendar, regularization review (module **06**) |

---

## 3. Key tables / models

| Model | Table | Role |
|-------|-------|------|
| `LeaveBalance` | `leave_balances` | Remaining + total + used for PL / CL / Comp |
| `LeaveApplication` | `leave_applications` | Leave requests |
| `WorkFromHomeApplication` | `work_from_home_applications` | WFH requests |
| `CompOffGain` | `comp_off_gains` | One credit unit (typically Sunday work); 30-day expiry |
| `AttendanceRegularization` | `attendance_regularizations` | Past absence → ask HR to create leave |
| `HolidayCalendar` | (master) | Optional holidays for Optional Leave |

### LeaveApplication fields

| Column | Meaning |
|--------|---------|
| `leave_type` | See §4.1 |
| `status` | `Pending` \| `Approved` \| `Rejected` \| `Cancelled` |
| `start_date` / `end_date` | Inclusive range |
| `reason` | Max **255** chars (`LEAVE_REASON_MAX_LEN`) |
| `deducted_days` | Paid days preview / later deducted |
| `extra_days` | LOP / unpaid portion |
| `requested_deducted_days` | Working days against requested type |
| `sandwich_pl_days` | Sandwich non-working days charged to PL |
| `applied_by_admin_id` / `applied_on_behalf` | HR/manager proxy apply |

### CompOffGain

- `gain_date`, `expiry_date` (= gain + **30** days)  
- `used` 0..1 (fraction consumed)  
- `dedupe_key` unique for Sunday auto-gain (`{admin_id}:{date}:sunday`)

Effective balance: `compoff_utils.get_effective_comp_balance` (non-expired, unused).

---

## 4. Business rules

### 4.1 Leave types (employee apply)

| `leave_type` | Rules (apply) |
|--------------|----------------|
| **Privilege Leave** | Working + sandwich days; if balance short → remainder as `extra_days` (LOP) |
| **Casual Leave** | Max **2 working days** per application; needs enough CL balance; sandwich from PL/LWP separately |
| **Half Day Leave** | Single calendar day only; **0.5** day; prefers CL then PL; else LOP `extra_days` |
| **Compensatory Leave** | Effective CompOff balance; max **2 working days** / application; max **2 applications per calendar month** (Pending+Approved); sandwich rules apply |
| **Optional Leave** | **Once per calendar year**; single day; date must be an **optional holiday** in company calendar; may overlap other leave types |

Frontend maps UI “Casual + Half Day” → backend `Half Day Leave`.

### 4.2 Dates & overlap

- Format `YYYY-MM-DD`; end ≥ start.  
- Employee apply: **no past** start/end (`Asia/Kolkata` “today”).  
- Cannot overlap another **Pending/Approved** leave (except Optional Leave special case).  
- Cannot overlap **Pending/Approved** WFH (and vice versa).  
- Leave reason: **≥ 20** and ≤ 255 characters.  
- WFH reason: required, ≤ 255 (no 20-char minimum on backend).

### 4.3 Sandwich policy

For types that use `_compute_working_and_sandwich_days`:

- **Working days** → charge against requested leave type  
- **Sandwich (non-working in range)** → deduct from **PL** if available, else LWP (`extra_days`)  
- Half Day overrides to fixed 0.5 (no sandwich span)

Exact weekend/holiday calendar logic lives in helpers inside `leave_attendence.py` / utility — change carefully and test with NHQ vs field `emp_type` calendars.

Holidays are **per company**: sandwich days, the Optional Leave date check (self and HR on behalf) and `GET /optional-holidays` use the employee's company calendar (`tenant_id=` on the helpers, see module **06** §6.5).

### 4.4 Status & cancel

| Action | Rule |
|--------|------|
| Employee cancel leave | Only if `Pending` → `Cancelled` |
| Employee cancel WFH | Only if `Pending` → `Cancelled` |
| Approve/Reject | Manager APIs; **balances move on Approve** |

### 4.5 Comp-off constants (`compoff_utils.py`)

| Constant | Value |
|----------|-------|
| `COMP_OFF_VALID_DAYS` | 30 |
| `MAX_COMPOFF_DAYS_PER_APPLICATION` | 2 |
| `MAX_COMPOFF_APPLICATIONS_PER_MONTH` | 2 |

Sunday gains are typically created by a scheduler/job from punches; ledger API exposes credits + usage.

### 4.6 Link to punch

`is_wfh_allowed` (module **03**) is true only for **Approved** WFH (or approved leave type WFH) covering today — **Pending does not** bypass geofence.

### 4.7 Regularization (employee)

- `POST /api/leave/regularization` — request HR to convert past absence into leave.  
- Backdate window from `leave_settings.json` → `max_regularization_backdate_days` (default 30).  
- Status workflow completed by HR (not this handbook’s deep dive).

### 4.8 Leave settings (per company)

Each company's own values (`company_settings`, namespace `leave`; HR edits via `PUT /api/HumanResource/leave-updation/policy`, UI: "Company leave policy" panel on HR → Leave/WFH Application Updation, `HRLeavePolicyPanel.jsx`). Company 1 falls back to `website/data/leave_settings.json` until it saves; other companies start from the defaults in `leave_settings.py`:

- `max_hr_backdate_days` (HR proxy)  
- `block_on_payroll_locked`  
- `max_regularization_backdate_days`  
- `manager_on_behalf_allowed`  
- `contract_leave_accrual_default`

---

## 5. API catalog (`/api/leave`)

All routes below: **JWT** required. Identity = JWT `email` → `Admin`.

### 5.1 Balances & history

#### `GET /LeaveDetails`

**Success:**

```json
{
  "success": true,
  "summary": { "PL": 10, "CL": 2, "COMPOFF": 1 },
  "applications": [
    {
      "id": 1,
      "leave_type": "Casual Leave",
      "reason": "...",
      "start_date": "2026-09-26",
      "end_date": "2026-09-26",
      "status": "Pending",
      "deducted_days": 1,
      "extra_days": 0,
      "created_at": "..."
    }
  ]
}
```

`COMPOFF` uses **effective** balance (gains), not only `leave_balances.compensatory_leave_balance`.

---

#### `GET /compoff/ledger`

**Success:** `{ "success": true, "ledger": { ... } }` from `build_compoff_ledger` (credits, expiry, pending apps, history).

---

#### `GET /optional-holidays`

Upcoming/relevant optional holidays for Optional Leave picker.

---

### 5.2 Apply / cancel leave

#### `POST /apply`

**Body:**

```json
{
  "leave_type": "Privilege Leave",
  "start_date": "2026-09-26",
  "end_date": "2026-09-27",
  "reason": "at least twenty characters…"
}
```

**Success:** typically 200/201 with message + application id (see response in code).  
**Errors:** 400 validation; **409** overlap leave/WFH; balance/type-specific messages.

Creates row with `status="Pending"`; emails managers via `send_leave_applied_email` when configured.

---

#### `POST /requests/<leave_id>/cancel`

Only owner + `Pending` → `Cancelled`. **409** otherwise.

---

### 5.3 WFH

#### `POST /wfh`

**Body:** `{ "start_date", "end_date", "reason" }`  

**Success 201:** `{ success, message, email_sent, wfh_id }`  
Emails managers: `send_wfh_approval_email_to_managers`.

#### `GET /wfh`

List current user’s WFH applications (newest first).

#### `POST /wfh/<wfh_id>/cancel`

Owner + `Pending` only.

---

### 5.4 Attendance (related, light)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/attendance/summary` | Month/range attendance summary for self |
| GET | `/attendance/download` | Export |

Deep day-status rules → module **07**.

---

### 5.5 Regularization

| Method | Path | Notes |
|--------|------|-------|
| GET | `/regularization` | Own requests (limit 100) |
| POST | `/regularization` | Create pending request |

---

### 5.6 Also on this blueprint (other modules)

| Paths | Handbook |
|-------|----------|
| `/claim-expense` GET/POST | **11 Claims** |
| `/seperation*`, `/noc-document`, `/relieving-letter`, `/experience-letter`, `/exit-interview` | **06** offboarding |

---

## 6. Main flows

### 6.1 Apply leave

```text
Leaves.jsx / ApplyLeaveModal
  → GET /LeaveDetails (+ optional-holidays)
  → POST /apply
  → status Pending
  → Manager POST /api/manager/leave-requests/:id/action
  → Approved → balance deduction (manager module)
```

### 6.2 Apply WFH

```text
Wfh.jsx → POST /wfh → Pending
  → Manager /api/manager/wfh-requests/:id/action
  → Approved → punch geo may treat as WFH day (module 03)
```

### 6.3 Comp-off

```text
Sunday work / job → CompOffGain (30d)
  → GET /compoff/ledger
  → Apply Compensatory Leave (limits)
  → On approve → consume gains oldest-first (compoff_utils)
```

---

## 7. Frontend map

| Path / file | APIs |
|-------------|------|
| `/leaves` → `Leaves.jsx` | `LeaveDetails`, `apply`, cancel, regularization, optional holidays |
| `ApplyLeaveModal.jsx` | Leave type UX, half-day mapping, optional leave |
| `/leaves/comp-off` → `CompOffLedger.jsx` | `compoff/ledger` |
| `/wfh` → `Wfh.jsx` | `POST/GET /wfh`, cancel |

Manager UI for approvals: `Manager/` comps `LeaveRequests`, `WFHRequests` → module **05**.

---

## 8. Jobs / schedulers

| Concern | Where |
|---------|-------|
| Sunday CompOffGain creation | Scheduler / punch-related job (see **17**, `compoff_utils`) |
| CompOff expiry reminders | `reminder_sent_at` on gains |
| Pending leave reminders | `pending_reminder_sent_at` on applications |

---

## 9. Config

| Source | Keys |
|--------|------|
| `company_settings` (`leave`) / `website/data/leave_settings.json` (company 1 until it saves) | backdate, payroll lock, regularization window, proxy flags — per company |
| Email | Zepto + manager routing in `email.py` |
| Holiday calendar | DB via HR APIs |

No dedicated `.env` for leave types; calendar and balances are data-driven.

---

## 10. How to change safely

1. **Balance mutations** belong on **approve/reject/cancel restore** paths — don’t deduct on `POST /apply` unless product changes deliberately.  
2. Keep frontend leave type strings in sync with backend (`Privilege Leave`, etc.).  
3. Changing sandwich rules → retest PL/CL/CompOff + LOP `extra_days` for multi-day spans.  
4. CompOff: respect monthly application cap and gain expiry; use `compoff_utils` helpers, don’t invent parallel balance math.  
5. Overlap checks must stay mutual (leave ↔ WFH).  
6. Proxy / HR backdated leave uses different rules (`leave_settings`, HR routes) — don’t weaken employee “no past dates” without an explicit HR path.  
7. Reason max length is DB `String(255)` — changing UI max without migration will 500 on insert.

---

## 11. Related modules

| # | Topic |
|---|--------|
| 03 | Punch uses approved WFH |
| 05 | Manager leave/WFH approve & balance debit |
| 06 | HR leave accrual, proxy apply, holidays |
| 07 | Attendance status including leave/WFH days |
| 11 | Claims on same blueprint |
| 17 | CompOff Sunday job / reminders |

---

## 12. Quick test checklist

- [ ] `GET /LeaveDetails` shows PL/CL/CompOff  
- [ ] Apply CL &gt; 2 working days rejected  
- [ ] Apply overlapping leave/WFH → 409  
- [ ] Optional Leave: only optional holiday date; once per year  
- [ ] Half day → single date, 0.5  
- [ ] CompOff: no balance / over monthly cap rejected  
- [ ] Cancel pending leave/WFH works; approved cannot cancel  
- [ ] Approve path (manager) reduces balance; reject does not  
- [ ] Approved WFH today → punch `wfh_approved` true (module 03)  
