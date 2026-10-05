# 06 — HR core

**Audience:** developers changing the HR panel: hire, people records, leave admin, exit/offboarding, master data.  
**Blueprint:** `website/Human_resource.py` → **`/api/HumanResource`** (~130+ routes)  
**Also mounted on this blueprint:** geo analytics (`geo_analytics_api.register_geo_analytics_routes`)  
**Related blueprints:** biometric HR reports → `/api/hr/biometric` (module **08**); employee leave self-service → `/api/leave` (module **04**)  
**UI hub:** `/hr` and `/updates` → `pages/HR/Hr.jsx` + module groups in `hrModuleGroups.js`  
**Related:** [05 Manager](./05-MANAGER-APPROVALS.md) · [04 Leave](./04-LEAVE-WFH-COMPOFF.md) · [07 Attendance](./07-ATTENDANCE-ENGINE.md) · [08 Biometric](./08-BIOMETRIC.md)

> This file is the **map of the HR control plane**. Subsystems that are product-large (ATS, assessment, compensation) are catalogued here with main routes; deepen them in later handbook pages if needed.

---

## 1. Purpose

HR operations for the company:

1. **Hire & onboard** — signup, bulk import, ATS, assessment invites, probation decisions  
2. **People** — search/profile/update, org chart, circle transfers, managers  
3. **Time & leave (admin)** — balances, proxy/backdated leave, regularization review, holidays, accrual monitor, HR punch edits  
4. **Exit** — mark exit, archive/rehire, offboarding dashboard, letters, NOC, ex-employee docs  
5. **Admin & setup** — departments/circles (`MasterData`), office locations, news feed, geo analytics, policies  

Compensation / workforce-plan APIs exist but the Pay tab is currently **hidden** in UI (`HR_SHOW_PAY_MODULES = false`).

---

## 2. Roles & access

### 2.1 Blueprint guard (`@hr.before_request`)

Almost all `/api/HumanResource/*` calls:

1. Require JWT (except public paths below)  
2. Require `can_access_hr_operations(claims)` → **HR role or org Admin**  
3. Extra plan features:
   - Assessment paths → `hr_assessment_invite`  
   - Ex-employee docs → `hr_ex_employee_docs`  
   - POST `/master/*` → `hr_add_dept_circle`  

**Public / exempt paths:**

| Path fragment | Why |
|---------------|-----|
| `/assessment/public…` | Candidate takes test without HR JWT |
| `/ats/public/offer…` | Offer accept link |
| `/holidays/user` | Employee holiday calendar |
| `/ex-employee-documents/public/<token>…` | Tokenized ex-employee download |

Many mutating routes also use `@hr_required` decorator (stricter role check in-handler).

### 2.2 Frontend

`RequirePanel panel="hr"` on `/hr`, `/updates`, archive/exit routes. Module tiles filtered by plan features in `Hr.jsx`.

---

## 3. Key models (by domain)

| Domain | Models / services |
|--------|-------------------|
| Identity | `Admin`, `Employee` details, education/family/prev company |
| Master data | `MasterData` (department, circle, …) |
| Holidays | `HolidayCalendar` |
| Locations | `Location` (geofence offices) |
| Leave admin | `LeaveApplication`, `LeaveBalance`, `WorkFromHomeApplication`, `AttendanceRegularization`, `LeaveAccrualLog` |
| Exit | `EmployeeArchive`, `EmployeeExitHistory`, offboarding services, letters |
| ATS | `JobRequisition`, `Candidate`, `Offer` (+ services) |
| Assessment | `AssessmentInvite` |
| Policies | `HRPolicyDocument`, acknowledgments |
| Comp / workforce | cycles, proposals, bands, merit matrix, headcount budgets |
| News | news feed models |
| Circle | `EmployeeCircleHistory` |
| Ex-docs | `ExEmployeeDocShare` / files |
| Managers | `ManagerContact` (often updated via HR Update Manager UI → Admin/HR helpers) |

---

## 4. Business rules (high signal)

### 4.1 Signup / hire

- `POST /signup` creates `Admin` (+ related rows), welcome email, optional link from ATS `candidate_id`.  
- Bulk import: template → preview → commit (`employee_import_service`).  
- Password reset endpoints exist but product login is **email OTP** (module **02**); treat reset as legacy/ops.

### 4.2 Mark exit

`POST /mark-exit` — requires email, exit dates, reason; drives `is_exited`, archive, F&F draft hooks, login grace (`exit_login_until`), checklist. Use `offboarding_service` helpers; support `force_override` carefully.

### 4.3 Leave updation (HR admin)

Under `/leave-updation/*`:

- List/preview/create proxy or backdated leave (limits from `leave_settings.json`)  
- PATCH leave/WFH (approve/adjust as HR)  
- Review **regularizations** (employee → HR)  
- Proxy report + audit trails  

Employee self-apply remains `/api/leave` (module **04**). Manager approve remains `/api/manager` (module **05**).

### 4.4 HR punch override

`/employee/punch/<admin_id>` GET/POST/DELETE and `/sessions` — HR can view/edit punches for an employee (attendance corrections). Distinct from employee web punch (`/api/auth/employee/punch-*`).

### 4.5 Plan feature gates

Changing HR tiles: update `plan_features.py` **and** frontend allow-lists in `Hr.jsx` / module groups.

---

## 5. API catalog (grouped)

Base: **`/api/HumanResource`**. Assume **JWT + HR/Admin** unless marked Public.

### 5.1 Dashboard & inbox

| Method | Path | Notes |
|--------|------|-------|
| GET | `/dashboard` | HR home metrics |
| GET | `/inbox` | Unified HR inbox items |
| GET | `/designations` | Designation list helper |

UI: `HRInbox.jsx`, dashboard section of `Hr.jsx`.

---

### 5.2 Hire & onboard

| Method | Path | Notes |
|--------|------|-------|
| POST | `/signup` | Create employee |
| GET/POST | `/employees/import/template\|preview\|commit` | Bulk Excel import |
| GET | `/employees/active` | Active headcount helpers |
| ATS | `/ats/requisitions`, `/ats/candidates`, stages, offer, PDF, send | Full hiring pipeline |
| Public | `/ats/public/offer`, `/ats/public/offer/accept` | Token offer accept |
| GET | `/ats/candidates/<id>/hire-progress`, `signup-payload` | Bridge to signup |
| Assessment HR | `/assessment/invite`, `/invites…`, evaluate, recording, selfie | Plan: `hr_assessment_invite` |
| Assessment Public | `/assessment/public/*` | Candidate test runtime |
| GET/POST | `/probation-reviews`, `/probation-decision` | Confirm/extend after probation |
| GET | `/employees/<id>/confirmation-letter/pdf` | PDF |

UI: `SignUp.jsx`, `BulkEmployeeImport.jsx`, `HRATS.jsx`, `HRAssessmentInvite.jsx`, `HRProbationReviews.jsx`, `ConfirmationRequest.jsx`, public `OfferAcceptPublic`, `AssessmentTestPublic`.

---

### 5.3 People & org

| Method | Path | Notes |
|--------|------|-------|
| GET | `/search`, `/display-details`, `/download-excel` | Workforce lists/export |
| GET | `/employee/profile/<admin_id>` | Rich profile |
| GET/PUT | `/employee/<emp_id>` | By emp_id string |
| GET/PUT | `/employee/by-email/<email>` | By email |
| GET | `/employee/lookup`, `/employee/search` | Typeahead |
| GET | `/org-chart`, `/org-chart/export` | Structure |
| GET | `/circle-transfers` | Transfers list |
| GET | `/employee/by-email/…/circle-history` | History |
| Master | `/master/options`, `/master/<type>` CRUD | Dept/circle (POST gated by plan) |
| Assets (legacy HR) | `/employee/<id>/assets`, `/assign-asset`, `/assets/<id>` PUT | Prefer IT module for new work |

UI: `UpdateSignUp.jsx`, `OrgChart.jsx`, `CircleTransferHistory.jsx`, `AddDeptCircle.jsx`, `HREmployee360.jsx`, `UpdateManager.jsx` (ManagerContact CRUD via **`/api/query/api/managers/…`** — lives on the query blueprint, not HumanResource).

---

### 5.4 Time, leave admin, holidays, locations

| Method | Path | Notes |
|--------|------|-------|
| GET/PUT | `/leave-balance/<employee_id>` | Read/adjust balances |
| GET | `/employees/<id>/compoff/ledger` | CompOff admin view |
| Leave updation | `/leave-updation/policy`, `requests`, `preview`, `PATCH`, `audit`, `wfh-requests`, `regularizations`, `proxy-report` | HR leave control plane |
| Holidays | `/holidays` CRUD, `/seed-year`, `/holidays/user` (employee) | Calendar |
| GET | `/leave-accrual/summary` | Accrual monitor |
| Punch admin | `/employee/punch/<admin_id>` + `/sessions`, attendance-download | Manual corrections |
| Locations | `/locations` GET/POST/DELETE | Geofence offices |

UI: `LeaveApplicationUpdation.jsx`, `HRApplyLeaveOnBehalf.jsx`, `HRAttendanceRegularization.jsx`, `HRProxyLeaveReport.jsx`, `UpdateLeave.jsx`, `LeaveAccrualSummary.jsx`, `HolidayCalendar.jsx`, `AddLocation.jsx`; biometric UI → module **08**.

---

### 5.5 Exit & offboarding

| Method | Path | Notes |
|--------|------|-------|
| POST | `/mark-exit` | Process exit |
| GET | `/employee-archive`, `/archive/employee/<id>` | Archive list/profile |
| POST | `/archive/employee/<id>/rejoin` | Rehire |
| PATCH | `/archive/employee/<id>/rehire-policy` | Policy flags |
| GET | `/employees/<id>/exit-checklist`, `exit-history` | Checklist / history |
| GET | `/offboarding/dashboard`, `/offboarding/analytics/export` | Ops dashboard |
| Letters | `…/relieving-letter/pdf`, `experience-letter/pdf` | PDFs |
| Exit interview | `/employees/<id>/exit-interview` GET/PATCH | |
| NOC | `/noc`, `/noc/upload`, `/noc-requests…` | HR NOC ops |
| Ex-docs | `/ex-employee-documents/send`, `history`, `public/<token>…` | Plan-gated |

UI: `ExitEmployee.jsx`, `OffboardingDashboard.jsx`, `Archive/*`, `ExEmployeeDocumentSharing.jsx`, public `ExEmployeeDocumentsPublic.jsx`.

---

### 5.6 Policies, news, compensation, workforce

| Method | Path | Notes |
|--------|------|-------|
| Policies | `/policies` CRUD, upload, stats | Policy center |
| News | `/news-feed` POST/GET/DELETE | Announcements; `news_feeds.tenant_id` — history/delete and the email list are limited to the caller's company, new posts take the caller's company |
| Compensation | `/compensation/cycles`, `proposals`, `bands`, `merit-matrix` | Hidden Pay tab |
| Workforce | `/workforce-plan`, `/budgets` | Hidden Pay tab |

UI: `HRPolicyCenter.jsx`, `AddNewsFeed.jsx`, `HRCompensation.jsx`, `HRWorkforcePlan.jsx` (pay modules gated off).

---

### 5.7 Geo analytics

Registered via `register_geo_analytics_routes(hr, …)` — paths under `/api/HumanResource/…` for geo monitoring (see `geo_analytics_api.py`). UI: `GeoAnalytics.jsx`. Punch geo engine itself → module **03**.

---

### 5.8 Password legacy

| Method | Path | Notes |
|--------|------|-------|
| POST | `/send-password-reset`, `/reset-password` | Prefer OTP login; keep for ops compatibility |

---

## 6. Main flows

### 6.1 New hire

```text
ATS candidate → offer accept (public) → signup-payload
  → HR Sign Up POST /signup
  → welcome email → employee OTP login
```

Or: Bulk import commit → many Admins.

### 6.2 Exit

```text
ExitEmployee / Offboarding
  → GET exit-checklist
  → POST /mark-exit
  → archive + letters + NOC + login grace
```

### 6.3 HR leave correction

```text
Leave Application Updation
  → preview → POST leave-updation/requests (proxy/backdate)
  or PATCH existing leave/WFH
  → regularization PATCH approve → may create LeaveApplication
```

### 6.4 Optional holiday / office setup

```text
Holiday Calendar CRUD → affects leave sandwich / Optional Leave
Add Locations → geofence for punch
Add Dept/Circle → MasterData → queries & ManagerContact scopes
```

### 6.5 Company (tenant) scope of master data

Departments/circles (`MasterData`), the holiday calendar and HR policies belong to **one company** (`tenant_id`). Use the helpers in `master_data_tenancy.py`:

| Helper | Use |
|--------|-----|
| `master_query(tid)` | Departments / circles lists, dropdowns, add-employee validation |
| `holiday_query(tid)` | Holiday CRUD, leave sandwich, Optional Leave, attendance engine, Excel |
| `policy_query(tid)` | Policy center, employee pending / acknowledge, policy file access |
| `tenant_for_admin_id(id)` | Company of the employee a calculation is for |

- `tid=None` = caller's JWT company. Calculations **for an employee** (leave days, attendance month, Optional Leave on behalf) pass that employee's company, so schedulers without a JWT stay correct.
- Another company's department, holiday or policy id → **404**.
- Same name allowed once per company (`uq_master_tenant_type_name`, `uq_holiday_calendar_tenant_year_name`).
- A new company starts with **no** departments/circles; its HR adds them before adding employees. Holidays auto-seed per company from `HOLIDAY_DATE_TEMPLATES`.
- Office locations are per company too: `location_query(tid)` (HR list/add/delete; 404 across companies). The punch geofence only matches the employee's own company offices (module **03**).
- Assessment invites (`assessment_invites.tenant_id`): use `ats_service.assessment_invite_query()` for HR list / detail / evaluate / delete / recording / selfie (404 across companies). Public token routes stay token-based.

### 6.6 Company scope of hiring, workforce plan and pay setup

Requisitions, candidates, headcount budgets, increment cycles, CTC bands and the merit matrix have `tenant_id` (startup migrations `ensure_recruitment_tenant_ids`, `ensure_compensation_tenant_ids`; existing rows → company 1, candidates follow their requisition).

| Helper | Use |
|--------|-----|
| `ats_service.requisition_query(tid)` / `candidate_query(tid)` | ATS lists, workforce plan open requisitions, signup completion |
| `ats_service.get_requisition(id)` / `get_candidate(id)` | By-id ATS routes; raise `ATSNotFound` → route answers **404** |
| `compensation_band_service.band_query(tid)`, `band_for_position(..., tenant_id=)` | Band list/upsert and CTC checks (offers, add employee, increment proposals) |
| `merit_matrix_service.entry_query(tid)`, `compensation_service.cycle_query(tid)` | Merit matrix, increment cycles |

- `tid=None` = caller's company; checks **for an employee** (`band_for_admin`, merit suggestion) use that employee's company.
- Same key allowed once per company: budgets `uq_headcount_budget_tenant_year_circle_dept`, bands `uq_comp_band_tenant_circle_dept_grade`, merit `uq_merit_matrix_tenant_circle_dept_rating`.
- Workforce plan headcount counts only the company's employees; `/designations` and the ex-employee share history are per company too.

---

## 7. Frontend map

| Area | Entry |
|------|-------|
| Hub | `Hr.jsx` + `hrModuleGroups.js` (Hire / People / Leave / Exit / Admin tabs) |
| Routes | `/hr`, `/updates`, `/archive-employees`, `/exit-employees` |
| Biometric | `BiometricAttendance*.jsx` → **`/api/hr/biometric`** (not HumanResource) |
| Leave policy | Leave/WFH Application Updation → `HRLeavePolicyPanel.jsx` (`GET/PUT /leave-updation/policy`) |
| Geo analytics | `GeoAnalytics.jsx`; config save, history and engine mode shown only when the API returns `can_manage` (platform company) |
| Public | `/offer-accept`, `/assessment/:token`, `/ex-employee-documents` |

---

## 8. Jobs / schedulers

Leave accrual, offboarding reminders, assessment cleanup — see module **17** and services (`leave_accrual`, `offboarding_service`). HR UI “Leave Accrual Monitor” reads job outcomes via `/leave-accrual/summary`.

---

## 9. Config

| Source | Effect |
|--------|--------|
| Plan features | `hr_panel`, `hr_assessment_invite`, `hr_ex_employee_docs`, `hr_add_dept_circle`, … |
| Leave settings (per company, `PUT /leave-updation/policy`; company 1 falls back to `leave_settings.json`) | HR backdate days, payroll lock, proxy flags |
| Zepto / `EMAIL_HR` | Notifications |
| `UPLOADS_ROOT` | Policy files, NOC, assessment media |

---

## 10. How to change safely

1. Respect `_hr_plan_guard` — don’t add public HR mutators without an explicit allowlist.  
2. Prefer **services** (`hire_service`, `offboarding_service`, `ats_service`, …) over growing `Human_resource.py` further.  
3. Signup / exit touch many tables — wrap in transactions; test archive + rehire.  
4. Leave updation must stay consistent with manager approve debit rules (modules **04**/**05**).  
5. HR punch edits: always `recompute_punch_aggregate`.  
6. When adding a hub tile: `hrModuleGroups.js` + plan feature + API guard.  
7. Biometric device APIs are **not** in this file — use module **08**.  
8. File downloads: use secure/signed patterns; never open raw uploads anonymously except tokenized public flows.
9. Never query `MasterData`, `HolidayCalendar` or `HRPolicyDocument` directly — go through `master_data_tenancy.py` (§6.5); tests in `tests/test_shared_db_multitenancy_master_data_module.py`.
10. Same for ATS, budgets and pay setup (§6.6): use the scoped helpers, never `Candidate.query.get(...)`. After adding a route or table, run `tests/test_shared_db_multitenancy_security_audit.py` (module **16** §4.4).

---

## 11. Related modules

| # | Split |
|---|--------|
| 04 / 05 | Employee + manager leave (not HR proxy) |
| 07 | Attendance engine / day status |
| 08 | Biometric ADMS + HR biometric UI |
| 09 | Accounts payroll (HR compensation is proposal-side) |
| 13 | Performance (manager/employee); HR probation decision here |
| 14 | IT assets (HR assign-asset is legacy overlap) |
| 16 | Admin platform customers (not HR people admin) |

---

## 12. Quick test checklist

- [ ] Non-HR JWT → 403/plan forbidden on `/dashboard`  
- [ ] Signup creates login-able Admin (OTP)  
- [ ] Mark exit → archive list shows employee; login blocked or grace works  
- [ ] Leave updation backdate respects `max_hr_backdate_days`  
- [ ] Regularization approve creates/links leave  
- [ ] Holiday + location CRUD visible in punch/leave behavior  
- [ ] Company B never sees company A's departments, circles, holidays or policies; A's ids → 404 for B  
- [ ] Assessment invite gated by plan feature  
- [ ] Ex-employee public token download works without HR JWT  
- [ ] Org chart loads; circle history after transfer  
