# ZZ — Glossary

**Audience:** anyone reading modules **01–18** who needs a quick definition, alias list, or status string.  
**Not a product doc** — terms as used in **this codebase**.  
**Canonical modules** win when this page conflicts; keep aliases in sync with `plan_features.py`, `manager_utils.py`, `employment_status.py`.

---

## A. People & org

| Term | Meaning |
|------|---------|
| **Admin** | Row in `admins` — every login identity (employee or privileged). Not “only Org Admin”. |
| **admin_id** | Primary key of `admins`; JWT identity is usually this id as string. |
| **emp_id** | Human employee code (badge / biometric PIN match). Exact-string match; do not int-cast (leading zeros). |
| **emp_type** | Department / role string on `admins` (and often `ManagerContact.user_type`). **Not** employment status. |
| **circle** | Location / org unit on `admins` (and `MasterData` type `circle`). Drives geofence offices, holidays, managers, policies. |
| **MasterData** | HR-maintained lists: `department` and `circle` names (`master_type`). |
| **Org Admin** | `emp_type` ∈ Admin / Administrator / Administration, or contains `super`. Bypasses panel plan gates. |
| **Manager (access)** | Assignment via `ManagerContact` (L1–L3), not merely `emp_type == Manager`. |
| **Platform Admin** | Org Admin on vendor master with `SHOW_DEPLOYMENT_GUIDE` (Customers / deployment guide). |

### emp_type aliases (normalize before compare)

Canonical buckets used by `plan_features` / `manager_utils._emp_type_canon` / FE `planFeatures.js`:

| Bucket | Accepted strings (case-insensitive; `-` → space) |
|--------|--------------------------------------------------|
| **HR** | `hr`, `human resource`, `human resources` (+ “human resource” substring on BE) |
| **Accounts** | `account`, `accounts`, `accountant` (BE: starts with `account` / contains `accounts`) |
| **IT** | `it`, `it department` |
| **Inventory** | `inventory` (IT panel + IT query inbox; not a raise-query target) |
| **Org Admin** | `admin`, `administrator`, `administration`; or contains `super` |
| **Manager** | Often `manager` / `managers`; real access still needs `ManagerContact` / `has_manager_access` |

Sensitive salary viewers (`sensitive_data_auth`): account(s)/accountant, hr / human resource(s), admin.

Weekend Saturday **working** for attendance engine: exact `"Human Resource"` or `"Accounts"` only (`HR_ACCOUNTS_EMP_TYPES`).

### Circles

| Term | Meaning |
|------|---------|
| **NHQ** | National / HQ circle string (matched case-insensitively via `circles_equivalent`). Special: biometric last-scan policy, manager team attendance (NHQ + Engineering), often primary geofence. |
| **City / other circles** | Data-driven names from MasterData (e.g. regional offices) — not hardcoded in glossary. |
| **circles_equivalent** | Trim + lower compare of two circle labels. |
| **Circle transfer** | HR move of employee between circles; history in `employee_circle_history`. |

Query raise targets (canonical): **Human Resource**, **IT**, **Accounts** — plan-filtered (module **12** / **18**).

---

## B. Employment vs probation

| Term | Meaning |
|------|---------|
| **employment_status** | `probation` \| `on_role` \| `contract` on the employee (aliases: onrole, permanent, confirmed → on_role; contractor → contract). |
| **On Role** | Confirmed permanent employment (`on_role`). |
| **Probation (employment)** | Default ~**6** months from DOJ (`PROBATION_MONTHS`) unless dates overridden. |
| **ProbationReview** | Manager → HR clearance cycle (separate from monthly performance). |
| Review statuses | `reminder_sent` → `manager_submitted` → `hr_confirmed` \| `hr_extended` \| `hr_failed` |
| Manager recs | `confirm` \| `extend` \| `not_recommend` |
| HR decisions | `confirmed` \| `extended` \| `failed` |

Do not confuse **emp_type** (department) with **employment_status** or **ProbationReview.status**.

---

## C. Attendance & punch

| Term | Meaning |
|------|---------|
| **Punch** | Day-level attendance row (`punch_date` + aggregates). |
| **PunchSession** | One clock-in/out segment under a Punch (`source` web / biometric / …). |
| **today_work** | Aggregated worked seconds for the day (recomputed). |
| **10h cap** | Auto punch-out after **10 hours** on the **open segment** (`punch_auto_close`). |
| **NHQ last-scan** | 18:00–21:00 IST sync: OUT tracks latest NHQ device scan (catch-up 21:05 / 06:10). |
| **ADMS / iClock** | Device push protocol under `/iclock` (eSSL / ZKTeco-style). |
| **PIN** | Device user id → mapped to `emp_id` / admin. |
| **Geofence** | Office polygon/radius check on web punch; outside → reason (min chars). |
| **WFH geo bypass** | Approved WFH can allow punch outside fence (module **03**). |
| **GEO_ENGINE_MODE** | `LEGACY` \| `SHADOW` \| `V2` — execution mode for punch geo. |
| **SSE** | Server-Sent Events for live attendance (`/api/attendance/events`). |
| **Regularization** | HR/attendance correction path (module **07**). |

### Calendar day status codes (`attendance_engine`)

| Code | UI label (typical) |
|------|--------------------|
| `PRESENT` | Present (may show WFH if overlapping) |
| `HALF_DAY` | Half Day |
| `PENDING_PUNCH_OUT` | Pending Punch Out |
| `ABSENT` | Absent |
| `LEAVE` / `LEAVE_PENDING` | On Leave / Leave Pending |
| `WFH_APPROVED` / `WFH_PENDING` | Work From Home / WFH Pending |
| `HOLIDAY` / `HOLIDAY_OPTIONAL` | Public / Optional Holiday |
| `WEEKEND` | Weekend |

---

## D. Leave, WFH, Comp-off

| Term | Meaning |
|------|---------|
| **PL** | Privilege Leave — balance + accrual; type string `"Privilege Leave"`. |
| **CL** | Casual Leave — `"Casual Leave"`; monthly apply caps in UI. |
| **Comp Off / Compensatory Leave** | `"Compensatory Leave"`; gained from Sunday work (`CompOffGain`). |
| **CompOffGain** | Credit row: gain_date, expiry (~**30** days), used, dedupe_key. |
| **Max CompOff** | ~2 gains/month create; ~2 applications/month; ~2 days/application (see `compoff_utils`). |
| **Accrual day** | PL/CL credit on calendar day **20**; Jan 1 year reset (PL carry cap **45**). |
| **WFH** | Work From Home application — no leave-balance debit. |
| **Sandwich** | Leave spanning weekends/holidays may inflate LOP / extra days (module **04**). |
| **LOP** | Loss of pay (unpaid leave units in attendance/payroll context). |
| Application status | Usually `Pending` \| `Approved` \| `Rejected` (title case common). |

---

## E. Claims, queries, tickets

| Term | Meaning |
|------|---------|
| **Claim / expense** | `ExpenseLineItem` (+ headers); statuses **Pending / Approved / Rejected** (no Paid in shared model). |
| **Query** | Internal ticket (`query.py`) — employee ↔ department inbox. |
| Query status | `New` \| `Open` \| `Closed` (and similar). |
| **OpenTicket** | IT UI name for **Query** — **not** a separate `ITSupportTicket` product. |
| **Notification** | In-app `notifications` row (≠ email ≠ attendance SSE). |

---

## F. Payroll, tax, CTC

| Term | Meaning |
|------|---------|
| **CTC** | Cost to company breakup / structure used by payroll. |
| **Payroll row status** | `draft` → `reviewed` → `paid` → `locked` (reopen reviewed→draft). |
| **AWD** | Attendance / payable-day related override fields in payroll edit. |
| **FnF** | Full and final settlement (`draft` / `finalized` / `paid` / `settled` / `completed`). |
| **Tax declaration** | Employee draft → submitted → approved/rejected (+ final proof); feeds TDS. |
| **Form 16** | Annual tax certificate download path (Accounts / sensitive OTP). |
| **Sensitive OTP** | Step-up auth for payslip/tax (`X-Sensitive-Token`, ~10 min). |

---

## G. IT / ITAM / day-use / offboarding

| Term | Meaning |
|------|---------|
| **ITAM** | Inventory / asset lifecycle (P0–P3+ flags `ITAM_*_V1`). |
| **Day-use / daily checkout** | Short-term hardware loan (`/api/it/daily-checkout`). |
| **Parcel** | IT inbound/outbound parcel tracking in IT module. |
| **NOC** | No Objection Certificate — dept clearance in offboarding. |
| **LWD** | Last working day; scheduler disables login after `exit_login_until`. |
| **Resignation** | Exit request; manager/HR + NOC flow. |
| **is_exited / is_active** | Soft exit vs login allowed. |

---

## H. Platform & plans

| Term | Meaning |
|------|---------|
| **Tenant** | Customer org in shared DB (`tenants`); Phase 1: `admins.tenant_id` + JWT claim. |
| **tenant_id** | Prefer JWT / DB — **never** trust client body for authz. |
| **Shared-DB** | One app, one database, row isolation (locked direction). |
| **Silo** | Legacy DB-per-company provision (`SILO_PROVISION_LEGACY`). |
| **Plan** | `basic` \| `essential` \| `enterprise` — product modules, not role. |
| **Feature key** | String in `ALL_FEATURES` (e.g. `it_panel`, `dashboard_payslip`). |
| **CUSTOMER_PLAN** | Env fallback when tenant plan missing. |
| **RequirePanel** | FE route gate for hr/account/it/admin/manager. |

---

## I. Time & ops

| Term | Meaning |
|------|---------|
| **IST** | `Asia/Kolkata` — scheduler TZ and many “today” calculations. |
| **APScheduler** | In-process jobs (`scheduler.py`); multi-worker ⇒ duplicate runs unless idempotent. |
| **ZeptoMail** | Transactional email provider (`ZEPTO_*`). |
| **Uploads root** | `UPLOADS_ROOT` / relative `uploads/` — serve via signed/JWT file APIs, not open static. |

---

## J. Quick “don’t confuse”

| This | Is not |
|------|--------|
| `emp_type` | `employment_status` |
| Org Admin (`emp_type`) | Platform vendor ops (needs deployment guide flag) |
| Manager emp_type | ManagerContact assignment |
| Query / OpenTicket | Separate IT support-ticket product |
| In-app Notification | Email or SSE |
| Punch (day) | PunchSession (segment) |
| Plan feature | ITAM/geo env rollout flag |
| Tenant (company) | Admin (user) |
| CompOffGain | LeaveApplication of type Compensatory Leave (gain vs consume) |

---

## Related

| Doc | Why |
|-----|-----|
| [00 INDEX](./00-INDEX.md) | Module map |
| [01 Architecture](./01-ARCHITECTURE.md) | Mental model |
| [18 Plans](./18-PLANS-FEATURES-ENV.md) | Feature matrix + env |
| [16 Admin](./16-ADMIN-PLATFORM-TENANCY.md) | Tenant / silo |
| [SHARED_DB_MULTI_TENANCY.md](../SHARED_DB_MULTI_TENANCY.md) | Tenancy design |

When adding a new public status string or emp_type alias, update **this glossary** and the owning module handbook in the same change.
