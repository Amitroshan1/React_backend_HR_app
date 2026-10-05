# 07 — Attendance engine & regularization

**Audience:** developers changing calendar day status, credited working days, payroll absence totals, or attendance regularization.  
**Core module:** `website/attendance_engine.py` (shared rules — **not** a Flask blueprint)  
**Consumers:** employee calendar (`/api/leave/attendance/*`), HR 360 / Excel (`Human_resource.py`), Accounts totals  
**Related:** [03 Punch](./03-DASHBOARD-PUNCH-GEO.md) · [04 Leave](./04-LEAVE-WFH-COMPOFF.md) · [06 HR](./06-HR-CORE.md) · [08 Biometric](./08-BIOMETRIC.md) · [ATTENDANCE_SSE.md](../ATTENDANCE_SSE.md)

---

## 1. Purpose

`attendance_engine` is the **single source of truth** for interpreting a month of attendance:

| Concern | Function |
|---------|----------|
| Weekend rules | Saturday working only for HR/Accounts; Sunday always off |
| Full vs half day from punch | **8 hours** (`FULL_DAY_WORK_SECONDS`) |
| Holidays | Mandatory vs optional from `HolidayCalendar` |
| Leave / WFH display | Approved / pending on calendar |
| Employee “credited working days” | `calculate_credited_working_days` |
| Accounts expected / absent | `calculate_accounts_totals` |

Raw **punch create/close** stays in module **03** (web) and **08** (biometric). This module decides **what a day means** once punches + leave + holidays exist.

---

## 2. Roles

| Actor | How they use attendance |
|-------|-------------------------|
| Employee | Month calendar + summary; submit **regularization** for past absences |
| HR | Employee 360 attendance strip; Excel export; approve/reject regularization; optional punch edit (module **06**) |
| Accounts | Payroll inputs via `calculate_accounts_totals` (module **09**) |
| Manager (NHQ Eng) | Team punch list (module **05**) — not the engine calendar |

---

## 3. Key data

| Source | Role |
|--------|------|
| `Punch` / `PunchSession` | Presence + `today_work` duration |
| `LeaveApplication` | Approved/pending leave spans |
| `WorkFromHomeApplication` | Approved/pending WFH spans |
| `HolidayCalendar` | Public / optional holidays |
| `AttendanceRegularization` | Employee request → HR creates approved leave |
| `Admin.emp_type` | Weekend Saturday rule |

### Day status codes (`resolve_day_status`)

| Status | Meaning |
|--------|---------|
| `PRESENT` | Closed punch with ≥ 8h work (or labeled Present) |
| `HALF_DAY` | Punch work &lt; 8h |
| `PENDING_PUNCH_OUT` | Punch in, no out |
| `LEAVE` | Approved leave (incl. half-day leave flag in details) |
| `LEAVE_PENDING` | (used in some displays) pending leave |
| `WFH_APPROVED` / `WFH_PENDING` | WFH covering the day |
| `HOLIDAY` / `HOLIDAY_OPTIONAL` | Calendar holiday |
| `WEEKEND` | Non-working weekend for emp_type |
| `ABSENT` | Working day with no qualifying presence/leave/WFH |

`status_display_label()` maps codes to UI strings. Punch days may also set `details.wfh` when WFH overlaps a punch.

---

## 4. Business rules

### 4.1 Weekend

```text
Sunday            → always non-working
Saturday          → non-working UNLESS emp_type in ("Human Resource", "Accounts")
Mon–Fri           → working (unless holiday)
```

### 4.2 Punch → full / half

`punch_work_seconds(p)` prefers `today_work` (`HH:MM:SS`); else `punch_out - punch_in`.

- `≥ 8h` → full (`PRESENT` / `worked_full_dates`)  
- `&lt; 8h` → `HALF_DAY` / `worked_half_dates`  
- Open session → `PENDING_PUNCH_OUT` (not credited as full day)

### 4.3 Priority when resolving a day

Rough order inside `resolve_day_status`:

1. If **punch exists** → present / half / pending-out (+ WFH details)  
2. Else if **holiday** → HOLIDAY / HOLIDAY_OPTIONAL  
3. Else if **weekend non-working** → WEEKEND  
4. Else (leave/WFH/absent) — future vs past use approved WFH/leave before ABSENT  

Optional leave taken dates interact with credited-day bridging (sandwich-style unpaid bridges in `calculate_credited_working_days`).

### 4.4 Month context window

`load_attendance_month_context(admin_id, year, month, emp_type, today)`:

- Loads punches, holidays, leave, WFH for the month (holidays from the **employee's company** calendar, so it is correct with or without a JWT)  
- `working_days_end`: for **current** month = today; past months = month end; future = before first day  
- Precomputes paid/unpaid leave units, WFH dates, worked sets  

**Always use this loader** for calendar/exports — don’t reimplement leave+punch merges ad hoc.

### 4.5 Credited working days (employee summary)

`calculate_credited_working_days(ctx)` → `(total_working_days, unpaid_leave_days)`.

Used by `GET /api/leave/attendance/summary` for the attendance page card. Includes logic for sandwich/absent bridges between leave/absent stretches — change only with payroll/HR sign-off.

### 4.6 Accounts totals

`calculate_accounts_totals(ctx)` → expected working days + absent/LOP oriented totals for payroll. Consumed from Accounts paths (module **09**).

### 4.7 Regularization

**Employee** (`/api/leave/regularization`):

| Rule | Detail |
|------|--------|
| Past dates only | `start_date < today` (IST) |
| Backdate window | `max_regularization_backdate_days` (default **30**) |
| Reason | ≥ 20 chars |
| Overlap | No second **Pending** overlapping request |
| Types | Same leave types as apply (PL/CL/half/comp) |

**HR approve** (`PATCH /api/HumanResource/leave-updation/regularizations/<id>`):

- Reject → status Rejected + comment  
- Approve → `create_proxy_leave_application(..., status="Approved")` + link `leave_application_id` + debit balances via proxy service  
- Subject to HR on-behalf date policy (`_validate_hr_on_behalf_dates`)

This is **not** manager leave approve — it is HR converting absence into approved leave.

---

## 5. API catalog

### 5.1 Employee (`/api/leave`)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/attendance/summary?month=&year=` | Calendar + credited days + avg punch times |
| GET | `/attendance/download` | Excel/export for self |
| GET | `/regularization` | Own regularization requests |
| POST | `/regularization` | Submit past-absence request |

### 5.2 HR (`/api/HumanResource`)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/employee/profile` / display-details attendance strip | Uses `load_attendance_month_context` + `resolve_day_status` |
| GET | `/employee/attendance-download/<admin_id>` | Per-employee Excel |
| GET | `/download-excel` | Bulk circle/type attendance export |
| Punch admin | `/employee/punch/<admin_id>` … | Edit/delete day punches (module **06**) |
| GET | `/leave-updation/regularizations` | HR queue |
| PATCH | `/leave-updation/regularizations/<id>` | `{ action: approve\|reject, hr_comment? }` |
| GET | `/leave-updation/policy` | Includes `max_regularization_backdate_days` |

### 5.3 Realtime (not day status)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/attendance/events` | SSE; does **not** write Punch — see [ATTENDANCE_SSE.md](../ATTENDANCE_SSE.md) |

### 5.4 Biometric day rollup

Device logs → `biometric` day tables / rebuild commands — module **08**. Engine still reads **`Punch`** rows produced by the bridge.

---

## 6. Main flows

### 6.1 Employee month calendar

```text
Attendance.jsx
  → GET /api/leave/attendance/summary?month&year
  → load_attendance_month_context + build_month_calendar
  → UI paints status per day
```

### 6.2 Regularization

```text
Leaves.jsx (or attendance UI)
  → POST /api/leave/regularization { leave_type, dates, reason }
  → HR Attendance Regularization
  → PATCH …/regularizations/:id { action: "approve" }
  → Approved LeaveApplication + balance debit
  → Calendar shows LEAVE on those days
```

### 6.3 HR export

```text
HR download-excel / attendance-download
  → generate_attendance_excel (…)
  → engine context per employee
```

---

## 7. Frontend map

| UI | APIs |
|----|------|
| `/attendance` → `Attendance.jsx` | `/api/leave/attendance/summary`, download |
| `/leaves` regularization section | `/api/leave/regularization` |
| HR `HRAttendanceRegularization.jsx` | `/leave-updation/regularizations` |
| HR employee detail / 360 | profile attendance arrays |
| `AttendanceEventsProvider` | SSE `/api/attendance/events` |

---

## 8. Jobs

| Job | Relation |
|-----|----------|
| Auto punch-out (10h) | Closes sessions → affects `today_work` / PENDING_PUNCH_OUT (module **03**/**17**) |
| Biometric finalization | Writes/updates Punch for NHQ (module **08**) |
| Leave accrual | Separate from day status (module **06**/**17**) |

No dedicated “rebuild calendar” job — calendar is computed on read from live tables.

---

## 9. Config

| Source | Keys |
|--------|------|
| Code | `FULL_DAY_WORK_SECONDS = 8h`, `HR_ACCOUNTS_EMP_TYPES` |
| `leave_settings.json` | `max_regularization_backdate_days`, `block_on_payroll_locked` (proxy/approve) |
| DB | `HolidayCalendar`, office not required for day status |

Changing the **8h** threshold or Saturday rule affects employee cards, HR Excel, and Accounts — coordinate all three.

---

## 10. How to change safely

1. **All new calendar consumers must call `attendance_engine`** — do not copy STATUS if/else into React or Accounts.  
2. Prefer extending `resolve_day_status` / loaders over one-off status strings in exporters.  
3. After HR punch edits, ensure aggregates (`today_work`) are recomputed so half/full day stays correct.  
4. Regularization approve must go through `create_proxy_leave_application` so sandwich/LOP match leave apply.  
5. Biometric-only presence without Punch row will show ABSENT in the engine — bridge must create Punch.  
6. SSE is orthogonal: never rely on it to persist attendance.  
7. Add unit tests when changing credited-day or accounts formulas (`tests/` attendance-related).

---

## 11. Related modules

| # | Boundary |
|---|----------|
| 03 | Creating web punches / geo |
| 04 | Leave/WFH applications feeding the engine |
| 05 | Manager team punches (list, not engine) |
| 06 | HR punch CRUD, regularization review, holidays CRUD |
| 08 | Biometric → Punch |
| 09 | Payroll using `calculate_accounts_totals` |

---

## 12. Quick test checklist

- [ ] Employee calendar: weekend vs HR/Accounts Saturday  
- [ ] Punch &lt; 8h → HALF_DAY; ≥ 8h → PRESENT  
- [ ] Open punch → PENDING_PUNCH_OUT  
- [ ] Approved leave day → LEAVE without punch  
- [ ] Approved WFH → WFH_APPROVED (and punch geo may bypass — module 03)  
- [ ] Holiday mandatory vs optional labels  
- [ ] Regularization rejects future dates; enforces 30-day window  
- [ ] HR approve regularization → leave appears + balance drops  
- [ ] Attendance Excel matches calendar statuses for a known month  
