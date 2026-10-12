# Shared-DB multi-tenancy (SaaS)

**Decision (locked):** one application, one database, row isolation via `tenant_id`.  
**Not the primary path:** silo (database-per-company / `hrms_*` provision).

---

## Phase 0 — Design freeze

### Goals

| Goal | Approach |
|------|----------|
| One login portal | Same app URL for all companies |
| Data isolation | Every business row scoped by `tenant_id` |
| Plans | Stored on `tenants.plan` (`basic` / `essential` / `enterprise`) |
| Onboarding | Platform admin creates a **tenant** (+ first admin), not a MySQL database |

### Core table: `tenants`

| Column | Notes |
|--------|--------|
| `id` | PK |
| `name` | Company display name |
| `slug` | Unique short id (`acme_corp`) |
| `plan` | `basic` \| `essential` \| `enterprise` |
| `status` | `active` \| `suspended` \| `cancelled` |
| `contact_email` | Optional |
| `mailbox_hr` / `mailbox_accounts` / `mailbox_it` / `mailbox_admin` | Optional company mailboxes for HRMS emails (rollout step 9) |
| `created_at` / `updated_at` | Audit |

Default tenant **id = 1** is created for the existing deployment (current Solviotec / production data).

### Identity

- `admins.tenant_id` → FK to `tenants.id` (Phase 1)
- JWT additional claim: `tenant_id`
- Helper: `get_current_tenant_id()` reads JWT (fallback: admin row)

### Uniqueness (later phases)

Today (Phase 1, single backfilled tenant): keep existing global uniques.  
Later: `(tenant_id, email)`, `(tenant_id, emp_id)`, `(tenant_id, mobile)`, …

### Module rollout (after Phase 1)

1. Employees / HR master  
2. Attendance / punch  
3. Leave / WFH  
4. Payroll / CTC  
5. Queries / claims / resignations  
6. IT / ITAM  
7. Biometric (device → tenant)  
8. Uploads `uploads/{tenant_id}/`  
9. Schedulers tenant-aware  
10. Security audit (cross-tenant denial tests)

### Silo retirement

| Silo artifact | Status |
|---------------|--------|
| `POST …/customers/:id/provision` creating `hrms_*` | **Legacy** — disabled unless `SILO_PROVISION_LEGACY=1` |
| `deploy/` folder | Docs only / optional dedicated-hosting later |
| `DeployedCustomer` registry | Temporary UI bridge; syncs to `tenants` on create. Prefer `tenants` as source of truth going forward |
| `CUSTOMER_PLAN` in `.env` | Fallback only: requests without a login JWT (public routes, schedulers, CLI) or a tenant with no valid plan. Logged-in users always get their tenant's `tenants.plan`. Startup logs a warning when tenant 1's plan differs from `CUSTOMER_PLAN` |

---

## Phase 1 — Foundation (this delivery)

- [x] Design doc (this file)
- [x] `tenants` table + seed tenant id=1
- [x] `admins.tenant_id` + backfill `= 1`
- [x] `tenant_context` helpers
- [x] JWT `tenant_id` claim on login
- [x] Plan resolution prefers tenant plan — `get_plan()` with no argument reads the tenant from
  the request's login JWT, so every `has_feature()` / `requires_plan` / panel check, the
  403 `plan_forbidden_response` and the dashboard `plan_payload()` use that tenant's plan
  (cached per request)
- [x] Silo provision not primary (legacy gate)
- [x] Admin Customers creates/syncs `Tenant`

### Acceptance (Phase 1)

- Existing users keep working after restart (all on tenant 1)
- New JWT includes `tenant_id`
- Creating a company in Admin also creates a `tenants` row
- Provision button / API requires explicit legacy flag

---

## Rollout step 1 — Employees / HR master (in progress)

Login decision: one login page for all companies; after OTP verification, a user
who belongs to several tenants picks the company.

- [x] `current_admin()` — caller loaded by JWT identity (admin id), tenant-checked;
      step-up (`sensitive`) tokens never resolve a caller
- [x] All ~140 `Admin.query.filter_by(email=<JWT email>)` caller lookups replaced
- [x] `tenant_admin_query(tenant_id)` — Admin query for one tenant (NULL = tenant 1)
- [x] HR add-employee, CSV import and signup migration set `tenant_id`;
      stubs from another tenant are never taken over
- [x] Registering a company can seed its first Super Admin (`admin_email`, `admin_name`, `admin_mobile`)
- [x] Customer registry restricted to the platform tenant (id 1)
- [x] Login: `/verify-otp` returns `requires_tenant_selection` + a 5-minute
      `tenant_select` token when the email matches several tenants;
      `POST /select-tenant {selection_token, tenant_id}` issues the login JWT
- [x] Typed tokens (`sensitive`, `tenant_select`) rejected by every `@jwt_required` route
- [x] Per-tenant uniques `(tenant_id, email|user_name|mobile|emp_id)`, `tenant_id NOT NULL`
  (`website/tenant_migrations.py`, run at startup; MySQL-tested). The per-tenant index is
  built before the global one is dropped; a column with duplicates inside one tenant keeps
  its global index and logs a warning until the data is fixed. New tenants' first admin
  gets `emp_id` `ADM0001`. HR add / CSV import / update-by-email conflict checks are
  tenant-scoped, as are HR get / update / circle-history by email.
- [x] Suspended / cancelled tenants: login (request-otp, verify-otp, picker, select-tenant)
  refused with `code: "tenant_suspended"`, and existing sessions get 401 on every
  `@jwt_required` route (`register_tenant_guards` in `tenant_context.py`). Tenant 1 is never
  blocked. Biometric mapping keeps using employee-level eligibility so punches are not lost.
- [x] Any URL with `<admin_id>` / `<employee_id>` (always `Admin.id`) answers 404 when the
  employee belongs to another tenant (app-wide `before_request`); `get_admin_in_tenant()` helper
- [x] HR/Admin/Accounts employee lists, search and identifier lookups filtered by tenant
  - [x] **HR module** (`Human_resource.py` + `hr_inbox_service`, `noc_department_service`,
    `offboarding_service` dashboard/analytics, `offboarding_export_service`, `org_chart_service`,
    `circle_transfer_utils` export): dashboard KPIs, active/search/export lists, archive,
    display-details, leave/WFH/regularization lists and approvals (by-id 404 across tenants),
    leave on behalf, proxy report, NOC, circle transfers, lookup by `emp_id`, leave accrual
    summary. Helpers: `admin_tenant_clause()`, `tenant_admin_ids()`, `admin_id_in_tenant()`.
    Services used by schedulers take an optional `tenant_id` (None = all tenants).
    Salary-revision proposals (`compensation_service`) are scoped too.
    ATS, workforce plan, compensation setup, office locations and assessments: rollout step 10.
    Policies, holidays and departments/circles: the master-data item below.
  - [x] **Accounts module** (`Accounts.py` + `tax_declaration_service`, `traces_import_service`,
    `compliance_export_service`, `payroll_lifecycle_service.build_bank_payment_file`):
    every employee id from the body/query goes through `get_admin_in_tenant()` /
    `admin_id_in_tenant()`; bulk payslip/Form 16 uploads and TRACES import match
    `emp_id` / PAN inside the tenant only; employee counts, payroll summary/history,
    expense claims, loans, salary revisions and tax declaration lists are filtered;
    `/payroll/list`, `/payroll/status` and statutory bonus ignore other tenants' ids;
    by-id payroll, payslip, claim line item, loan, F&F settlement, salary revision and
    tax declaration routes answer 404 across tenants; PF ECR, ESIC, PT, Form 24Q and
    bank file exports take a required `tenant_id`.
    CTC policy, TDS settings and the declaration deadline are per company since the
    "Per-company settings" item under rollout step 10.
  - [x] **Admin module** (`Admin.py`, org admin dashboard): dashboard KPIs (employees,
    active today, leaves, queries, claims, resignations, pending counts, IT tickets and
    return requests), the leaves/queries/claims/resignations/employees lists, query detail
    and employee detail/punches are limited to the caller's tenant (by-id 404 across
    tenants). The customer registry and deployment guide stay cross-tenant but only for
    Admins of the platform tenant (id 1). The inventory count uses the tenant's IT stock
    (see IT / ITAM below).
  - [x] **Manager module** (`manager.py`, `manager_utils.py`, manager setup routes in
    `query.py`): `manager_contacts` has a `tenant_id` column (startup migration
    `ensure_manager_contact_tenant_id` adds it and backfills from the linked L1, then L2,
    then L3 manager's tenant, else tenant 1). Every contact lookup (approval chain, manager
    panel, notification emails, probation and pending-leave reminders, NOC mails) uses
    `tenant_manager_contacts()` for the employee's tenant, so two companies with the same
    circle + emp_type never share a manager row. A manager matches a contact by admin id
    only, and only in the same tenant (the old email fallback could match another
    company's manager with the same email). Manager lists, team members, counts and
    probation reviews are limited to the manager's tenant; a by-id leave/WFH/claim/
    resignation/probation record from another tenant returns 404. The setup picker,
    search and contact GET/POST are tenant-scoped; the upsert rejects L1/L2/L3 ids from
    another tenant (404) and stamps new rows with the caller's `tenant_id`.
    Not yet for roles: `/api/query/api/managers/*` requires HR, a company admin, or someone
    already set as L1/L2/L3. A normal employee gets 403. Family-member photos are uploaded at
    `POST /api/HumanResource/family/<id>/photo` into `tenants/{employee company}/family/`.
  - [x] **IT / ITAM module** (`it.py`, `itam/`, `daily_checkout/`): `tenant_id` columns on
    `it_inventory_items`, `it_parcel_exports`, `it_parcel_imports`, `it_removed_assets`,
    `it_deleted_asset_logs` and `it_asset_transitions` (startup migration
    `ensure_it_tenant_ids` adds them and backfills from the inventory item, then the
    creating/owning admin, else tenant 1; new rows take the caller's tenant). Units,
    licenses, quantity assignments and location deployments belong to their inventory
    item's tenant; tickets, return requests, assignment history and Day-use requests belong
    to the requester's tenant. `itam/tenancy.py` holds the rules (`it_query`, `it_get`,
    `it_tenant_clause`). All IT lists, summary counts, parcel/removed/deleted logs, activity
    log, timelines, reviews and the Day-use inbox/pool are tenant-scoped; by-id records
    from another tenant return 404; assignment targets, employee lookups and admin FK
    inputs only resolve employees of the caller's tenant. Transitions take the tenant of
    their inventory item (so scheduler/backfill writes land in the right company).     Day-use
    IT notifications go only to IT staff of the request's company. The ITAM backfill
    endpoints only touch the caller's tenant.
    **Codes are per company.** `INV`, `TKT`, `SW`, `RTR`, `RIT`, `DEL`, `IMP`, `EXP` and `TRN`
    each start at 0001 inside a company (the next number is the latest code in that company,
    not in the whole database). The same unit code, asset tag or license code may exist in
    two companies; a repeat inside one company is still rejected. Startup migration
    `ensure_it_tenant_ids` adds `tenant_id` on units, licenses, tickets and return requests
    (from the inventory item or the requester) and replaces each global unique with
    `(tenant_id, code)`.
    IT emails use the company's IT mailbox (`company_mailbox`, `tenants.mailbox_it`).
  - [x] **Queries, notifications, biometric** (`query.py`, `notifications.py`, news feed,
    `biometric/`): a query belongs to its owner's tenant. Department inboxes, unread
    badges and the "new query" notification recipients only include the caller's
    company; query details, reply, close, mark-read and attachment download for another
    company's query return 404. Notifications were already per-recipient (no change).
    News feed: `news_feeds.tenant_id` (startup migration `ensure_news_feed_tenant_id`,
    existing posts → tenant 1, new posts take the caller's tenant); HR post history /
    delete, the dashboard feed (posts, birthdays, anniversaries) and the announcement
    email list are tenant-scoped.
    Biometric: `biometric_devices.tenant_id` and `biometric_attendance_day.tenant_id`
    (startup migration `ensure_biometric_tenant_ids`: devices → tenant 1, day rows from
    the employee's tenant; the day-row unique key becomes
    `(tenant_id, device_user_id, attendance_date)` = `uq_bio_att_day_tenant_pin_date`
    and the old `(device_user_id, attendance_date)` unique is dropped). A punch's PIN is
    resolved only against employees of the device's company (so duplicate `emp_id`s
    across companies no longer become "ambiguous"); the day read model is kept per
    company; HR biometric views (summary, devices, employee day, unmapped day, logs)
    are tenant-scoped (tenant 1 also sees logs from unregistered serials).
    `biometric/tenancy.py` holds the rules.
    **Onboarding a company's device:** an unassigned device (`tenant_id` NULL) still counts
    as tenant 1. That company's HR claims it with the serial
    (`POST /api/hr/biometric/devices/claim`). The platform company can move a device it
    can see (`PATCH /api/hr/biometric/devices/<id>`).
    Query created/closed emails use the company mailboxes since rollout step 9.
    Biometric scheduler, day finalization and reprocess stay cross-company jobs (they key
    off `admin_id` and the device, so they write to the right employee).
- [x] **Master data (departments, circles, holidays, policies) per tenant**
  (`master_data_tenancy.py`: `master_query`, `holiday_query`, `policy_query`,
  `tenant_for_admin_id`). `tenant_id` on `master_data`, `holiday_calendar` and
  `hr_policy_documents` (startup migration `ensure_master_data_tenant_ids`: existing rows →
  tenant 1; new rows take the caller's tenant). Unique keys become per tenant:
  `master_data (tenant_id, master_type, name)` = `uq_master_tenant_type_name` and
  `holiday_calendar (tenant_id, year, holiday_name)` = `uq_holiday_calendar_tenant_year_name`
  (the old global uniques are dropped after the new ones exist), so two companies can both
  have "Engineering" or "DIWALI".
  Departments/circles: HR list/create/delete, the `/master/options` and
  `/api/auth/master-options` dropdowns, add-employee / CSV import / update validation and the
  "value in use" delete check only see the caller's company; another company's value → 404.
  Holidays: HR list/create/update/delete/seed-year and the employee calendar are
  tenant-scoped (by-id 404); auto-seeding a year creates that company's own rows. Leave
  sandwich days, Optional Leave checks (self and HR on behalf), the attendance month engine
  and attendance Excel exports use the **employee's** company calendar (also correct for
  schedulers, which have no JWT).
  Policies: HR list/update/stats/upload (404 across tenants; upload checks before saving
  the file), employee pending list and acknowledge (404 for another company's policy);
  ack stats count only the policy company's employees; `policies/policy_<id>_…` files are
  denied to users of another company.
  **New companies start empty:** their HR adds departments and circles before adding
  employees (the default holiday template is seeded per company on first view).
  Office locations, assessments and compensation setup: rollout step 10.
  Leave policy settings: per company (rollout step 10, "Per-company settings").

## Rollout step 8 — Uploads per tenant

- [x] **File access is per company** (`upload_tenancy.py`). Every generic download
  (`/api/files/content|sign|resolve`, protected `/static/uploads/*`) and Accounts
  `/api/accounts/file/*` first checks the file's owning company, **before** the role rules,
  so HR / Accounts / IT / Admin of one company can no longer open another company's files
  by path. The owner comes from the `tenants/{id}/` folder, or is traced from the record:
  payslip / Form 16 row, tax declaration, signature / profile owner id, Day-use request,
  NOC upload, department NOC, expense line item, query attachment, legacy asset, policy,
  ex-employee share creator, news post. A file that cannot be traced (orphans, bare legacy
  names) belongs to tenant 1. Profile photos and news files are now visible only inside the
  same company (was: any logged-in user).
- [x] **New per-company folders:** `tenant_upload_rel(rel, tenant_id)` → `tenants/{id}/{rel}`.
  News feed attachments (`tenants/{id}/news/{uuid}/{name}`) and legacy HR asset photos
  (`tenants/{id}/assets/{admin_id}/…`) already use it — both previously collided across
  companies (bare original file name; `assets/{emp_id}` with duplicate emp_ids). The legacy
  asset update route (`PUT /api/HumanResource/assets/<id>`) now 404s across companies.
- [x] **Every upload writer saves new files under `tenants/{id}/`** (inside the root it already
  used) and stores that key, via `upload_tenancy.tenant_upload_path(root, rel, tenant_id)`.
  The company is the **owner's**, not the uploader's:

  | Files | Stored key (new) | Company |
  |-------|------------------|---------|
  | Payslips, Form 16 (single + bulk) | `tenants/{id}/payslips/…`, `tenants/{id}/form16/…` | employee |
  | Tax declaration proofs | `tenants/{id}/tax_declarations/{decl_id}/…` | employee |
  | Expense attachments | `tenants/{id}/expenses/…` | claimant |
  | Profile photos / KYC docs | `tenants/{id}/profile_{admin}_…`, `tenants/{id}/profile/{admin}_…` | employee |
  | NOC, department NOC | `tenants/{id}/noc/…`, `tenants/{id}/noc_department/…` | employee |
  | HR policies | `tenants/{id}/policies/policy_{id}_…` | policy |
  | Signatures, Day-use PDFs | `tenants/{id}/signatures/{admin}/v{n}.png`, `tenants/{id}/daily_checkout/{req}/…` | employee / requester (also when IT regenerates) |
  | Ex-employee shares | `tenants/{id}/ex_employee_docs/{share}/…` | caller (HR route) / leaver (relieving, F&F) |
  | Assessment selfies / recordings | `tenants/{id}/assessment_selfies|assessment_recordings/…` | invite (candidate routes have no company login) |
  | Query attachments | JSON list keeps **bare names**; files go to `uploads/tenants/{id}/queries/` | query owner |

  Readers accept both layouts: folder rules (`secure_file_service.authorize_upload_access`,
  `/api/files/content`, Accounts `/api/accounts/file/*`) match the path **inside** the tenant
  folder, while payslip / Form 16 row lookups use the full stored key, so employees still open
  their own payslip, Form 16 and tax proofs (with the sensitive OTP). Query downloads look in the
  company folder first, then the legacy `uploads/queries/`. Expense helpers
  (`claim_attach_storage_name`) keep `tenants/…` keys as they are. `expense_line_item.Attach_file`
  and `employees.photo_filename` are widened to `VARCHAR(300)` at startup
  (`tenant_migrations.ensure_upload_path_columns`; MySQL / PostgreSQL only).
  `POST /api/auth/upload-profile-file` now 404s for another company's `admin_id` (HR could
  upload a document for any employee id). Existing files keep working where they are (their
  owner is traced from the record) until they are moved with the command below.
- [x] **One-off move of existing files** (`upload_relocation.py`, `flask uploads-relocate`).
  Dry run by default; prints per kind the rows, files and bytes it would move and what it
  skips. `--apply` copies each file **next to itself** (same storage root) to
  `tenants/{owner}/<same path>`, verifies the copy (SHA-256), then updates the rows in one
  transaction; the old files stay. The owner is the same company `upload_tenancy` traces
  (employee, claimant, requester, invite, policy, news post, share creator), so nobody gains or
  loses access. Rows changed between plan and update are left alone; on a failed commit the
  copies are removed. Query attachments only change folder (`Query.photo` keeps bare names).
  A bare legacy news file used by two companies gets one copy per company.
  Left untouched (reported as skipped): owner cannot be traced (e.g. an ex-employee share
  without a creator), file missing on disk, a different file already at the new path, or a new
  key longer than the column. IT photos and receipts (and parcel photos) are no longer stored as
  image data in the database: a new upload is written to `tenants/{company}/itam/…` and the
  screen receives a signed link. Rows that already hold image data still display until
  `flask itam-extract-photos` (dry run; `--apply` writes the files and updates the rows).
  A photo that is not a JPG, PNG, WEBP, GIF or PDF, or is over 8 MB, is left as image data. A photo key
  from another company is dropped on save. Family-member photos have no upload screen; if
  `family_details.photo_filename` holds a path it belongs to that employee's company
  (`family_details.photo_filename` widened to `VARCHAR(300)`), and `uploads-relocate` moves
  the file when it is on disk.
  Filters: `--kind` (repeatable, `--list-kinds`), `--tenant` (repeatable).
  Every applied run writes a manifest (default `instance/upload_relocation/relocate_<utc>.json`,
  git-ignored) with each copy and row change. Then:
  `flask uploads-relocate-cleanup MANIFEST [--apply]` deletes an old file only when every copy
  is identical and no row of any company still uses it;
  `flask uploads-relocate-rollback MANIFEST [--apply]` (before cleanup only) puts the rows
  back and removes the copies. Both are dry runs without `--apply`.
  Until cleanup, an old path is still on disk but no row points at it. Downloading it checks
  which `tenants/{id}/` copies exist: one company keeps access to that old path, and if two
  companies each have a copy (a shared news file) nobody does. After cleanup the old file is
  gone.
  Recommended order in production: back up the DB and upload folders → dry run → `--apply` →
  check payslips / claims / photos in the app → cleanup. Signed links in old emails that
  point to an old path may stop working after the move (the app hands out new links).
  Assessment selfies / recordings (`assessment_selfies|assessment_recordings/assessment_<invite id>_…`)
  belong to the invite's company (rollout step 10).

## Rollout step 9 — Schedulers per tenant

- [x] **Company scope for code without a login** (`tenant_context.tenant_scope(tid)`, a
  context variable). Inside the block `get_current_tenant_id()`, every tenant helper
  (`tenant_admin_query`, `tenant_column_clause`, …), `plan_features.get_plan()` and the
  company mailboxes resolve to that company. It takes precedence over the JWT; outside a
  scope nothing changes.
- [x] **Daily HR jobs run once per company** (`tenant_jobs.py`, `scheduler.run_daily_hr_jobs`).
  `job_tenant_ids()` = tenant 1 plus every tenant that is not `suspended` / `cancelled`.
  For each company, inside its scope: probation reminders, CompOff, leave accrual,
  leave-pending reminder, LWD deactivation, offboarding reminders; then **commit per
  company**, so one company's failure is rolled back and logged without blocking the
  others (was: one global run, one commit). Every job function takes `tenant_id=None`
  (None = all companies, the old behaviour) and filters its `Admin` / row scans with
  `admin_scope(tid)` / `admin_id_scope(column, tid)`.
  The email-sending CLI commands (`probation-reminder`, `probation-sync`, `compoff-process`,
  `leave-pending-reminder`, `offboarding-reminders`) also loop per company in scope
  (`run_in_each_tenant_scope`) and print the summed counts, same output as before.
  Assessment-recording purge stays one global run (it only deletes files by age, no emails).
- [x] **Company mailboxes** (`company_mailbox.py`). All HRMS emails that used
  `ZEPTO_CC_HR` / `EMAIL_HR` / `ZEPTO_CC_ACCOUNT` / `EMAIL_ACCOUNTS` / `ZEPTO_CC_IT` /
  `EMAIL_IT` / `EMAIL_ADMIN` from `.env` now call `company_mailbox(key)`:
  the company's `tenants.mailbox_*` column when set; else the `.env` value **for tenant 1
  only**; else nothing. Another company's emails never go to (or CC) the platform
  company's inboxes; with no mailbox set, HR-addressed mail falls back to the employee /
  managers as each email already did when the `.env` key was empty.
  Startup migration `ensure_tenant_mailbox_columns` adds the four nullable columns;
  tenant 1 keeps using `.env` (unchanged behaviour). Platform admins set them via
  `POST/PATCH /api/admin/customers[/<id>]` with `mailbox_hr`, `mailbox_accounts`,
  `mailbox_it`, `mailbox_admin` (validated, lower-cased, `""` clears); `GET
  /api/admin/customers/<id>` and PATCH return `tenant.mailboxes`.
  A company admin edits only their own company at `GET/PUT /api/admin/mailboxes`
  (Admin panel → Company mailboxes). The body cannot name another company.
  Day-use outbox emails use the request's company IT mailbox; the async
  resignation-revoked email runs in the employee's company scope.
- Stay global on purpose: auto punch-out, biometric sync / catch-up / reprocess (no
  emails; they key off `admin_id` / device) and the Day-use job (its notifications are
  already routed by the request's company).
- [x] Frontend: "Company mailboxes" inputs on the Admin → Customers register and edit forms
  (`AdminCustomers.jsx`). The edit form loads the current values from `GET
  /api/admin/customers/<id>`; the mailbox keys are sent only once loaded (or typed), so a
  failed load never clears saved addresses.
- [x] Company admins edit their own mailboxes at `GET/PUT /api/admin/mailboxes` and
  Admin → Company mailboxes. HR and other roles get 403.

## Rollout step 10 — Security audit

- [x] **Route-by-route cross-company audit** (`tests/test_shared_db_multitenancy_security_audit.py`).
  The test builds the app with every blueprint on in-memory SQLite and seeds **one row per
  table per company**: company 1's row has a marker string (`zqleak…`) in every text
  column, company 2's row neutral text; integer columns hold the company number, so ids and
  references (`admin_id`, `leave_id`, `unit_id`, …) point inside the same company. Both
  companies share the same employee `email` and `emp_id`, as real customers can.
  Then company 2's org admin, HR, Accounts, IT, manager, employee and an anonymous caller
  call **every registered route** (~470 rules, every method) with company 1's ids in the
  URL, the query string and the JSON body. A route fails when
  - a 2xx response contains company 1's marker (read leak), or
  - company 1's rows changed (cross-company write, including a new row whose owner is
    company 1 or whose `tenant_id` is NULL).
  The database is restored after each route. A positive control checks the audit is not
  vacuous: company 1's own HR sees its marker on 50+ GET routes and company 2 gets 2xx on
  400+ GET calls. Email and outgoing HTTP are stubbed.
- [x] **Every table must be tied to a company or declared global.** A table counts as company
  data when it has `tenant_id`, a foreign key to a company table, or an `admin_id` /
  `*_admin_id` column. Anything else must be listed in `GLOBAL_TABLES` in the test, so a new
  table cannot slip in unaudited. Global on purpose: `tenants`, `deployed_customers`,
  `audit_logs`, `offboarding_reminder_logs`, `geo_config_changes`, `geo_config_overrides`;
  no leftovers since the follow-up below. Besides the default query string, every GET route
  is also called with a date range around the seed dates (`from`/`to`, `date_from`/`date_to`,
  `month`, …), so routes that default to "today" still reach the seeded rows.
- [x] **Leaks the audit found, now fixed:**
  - **ATS** (`ats_service.py`): `tenant_id` on `job_requisitions` and `candidates`; requisition
    and candidate lists are per company; `get_requisition` / `get_candidate` raise
    `ATSNotFound`, so hire-progress, stage, assessment, offer, offer-letter PDF, offer email,
    signup payload and requisition update answer **404** for another company's id (was:
    read and changed it); a new candidate's `requisition_id` must be the caller's company's.
    Offer letters, acceptance tokens and signup completion use the same lookup.
  - **Workforce plan** (`workforce_planning_service.py`): `tenant_id` on `headcount_budgets`
    (unique key `(tenant_id, fiscal_year, circle, emp_type)` =
    `uq_headcount_budget_tenant_year_circle_dept`); actual headcount, budgets and open
    requisitions count only the caller's company.
  - **Compensation setup**: `tenant_id` on `increment_cycles`, `merit_matrix_entries`
    (unique `uq_merit_matrix_tenant_circle_dept_rating`) and `compensation_bands` (unique
    `uq_comp_band_tenant_circle_dept_grade`). Lists and upserts are per company; band
    checks on offers, employee CTC and manager increment proposals use the **employee's**
    company bands and merit matrix; a manager's `increment_cycle_id` must be the company's.
  - `GET /api/HumanResource/designations` lists only the company's designations.
  - `GET /api/HumanResource/ex-employee-documents/history` lists only shares created by the
    company's HR.
  - `GET /api/performance/hr/report`, manager queue / summary / review: only the company's
    performance entries (a review of another company's entry → 404).
  Startup migrations `ensure_recruitment_tenant_ids` (requisitions → tenant 1; candidates
  from their requisition, else the hired employee, else tenant 1; budgets → tenant 1) and
  `ensure_compensation_tenant_ids` (rows → tenant 1) add the columns and move the unique
  keys to per company (new index first, then the old global one is dropped).
- **What the audit does not cover:** tables listed as global; leaks that need a specific
  record state the generic seed does not reach (the route answered 4xx for company 2
  before reaching the query); data sent by email; and timing / count side channels.
  Keep module tests for those (`tests/test_shared_db_multitenancy_*_module.py`).
- [x] **Follow-up: office locations, assessments, geo analytics** (the date-range pass found
  the geo analytics leak).
  - **Office locations** (`location.tenant_id`, `master_data_tenancy.location_query`): HR
    list / add / delete are per company (another company's location → 404). The punch and
    location-check geofence (`geo_validation_service`, `auth.resolve_geofence_for_coordinates`)
    only match the employee's own company offices (was: any company's office counted as
    "inside"). Existing rows → tenant 1 (migration in `ensure_master_data_tenant_ids`).
  - **Assessments** (`assessment_invites.tenant_id`, `ats_service.assessment_invite_query`):
    HR list, detail, evaluate, delete, HR report email, recording and selfie are per company
    (404 across companies). Invites sent from ATS take the candidate's company. Public
    token routes are unchanged (the token is the secret). Existing invites take the
    company of the candidate they were sent to, else tenant 1 (migration in
    `ensure_recruitment_tenant_ids`). Selfie / recording files are traced to the invite.
  - **Geo analytics** (`geo_analytics_service`, `geo_shadow_analytics`): every summary,
    breakdown, office / browser health, audit search + CSV export, attempt detail,
    monitoring, alerts, recommendations, security signals and engine comparisons count only
    the company's punch attempts (`tenant_context.admin_owned_clause`: attempts of the
    company's employees; attempts without an employee → tenant 1).
  - **Geo settings are platform-wide**: the geofence config and engine mode apply to every
    company, so only HR of the platform company (tenant 1) may change them or read the
    change history (`PUT /geo-analytics/config`, `PUT /geo-analytics/engine-mode`,
    `GET /geo-analytics/config/history` → 403 for other companies; reading the effective
    config stays allowed). `GET /geo-analytics/config` and `GET /geo-analytics/rollout`
    return `can_manage`; the HR Geo Analytics page (`GeoAnalytics.jsx`) hides the save
    controls, new-value inputs, change history and engine-mode switch when it is false.
- [x] **Per-company settings** (`company_settings.py`, table `company_settings`: one JSON
  document per company and namespace, unique `(tenant_id, namespace)` =
  `uq_company_settings_tenant_namespace`, created at startup). Covers the three settings
  that were one JSON file for everyone:
  - `leave` (`leave_settings.py`): HR backdate days, payroll lock, regularization window,
    manager on behalf, contract accrual. New `PUT /api/HumanResource/leave-updation/policy`
    (HR; validated; returns the same payload as GET).
  - `tds` (`tds_settings.py`): employer name / TAN / PAN, payroll TDS rules, Form 16
    tolerance, amendment limit, declaration deadline default + per-FY overrides. New
    `GET/PUT /api/accounts/tds-settings` (Accounts / HR / Admin); the deadline route
    now changes only the caller's company.
  - `ctc` (`ctc_settings.py`): `/api/accounts/ctc-policy` reads and saves the caller's company.
  Resolution: the company's saved document over the module defaults. **Company 1 keeps
  reading its legacy `website/data/<ns>_settings.json`** until it first saves through the
  API (then the DB row wins; the file is left untouched). Other companies never read the
  file: they start from the module defaults, and the TDS employer name defaults to the
  company's `tenants.name` (no TAN / PAN), so another company's letters no longer print
  the platform company's name. Every loader takes `tenant_id=None` (= caller / `tenant_scope`
  company), so scheduler jobs read the right company. Values are cached per request.
  Employer details on offer / confirmation / relieving letters, F&F, CTC annexure and
  Form 16 use the **document owner's** company (candidate or employee), also on the public
  offer page. Without an app context (unit tests loading a module alone) the modules fall
  back to their file, as before.
  Editors: **Company leave policy** panel on HR → Leave/WFH Application Updation
  (`HRLeavePolicyPanel.jsx`); **Company TDS & employer settings** panel on Accounts → Tax
  Declaration Review (`TdsSettingsPanel.jsx`, below the deadline box; saving refreshes the
  deadline); CTC policy stays on the Accounts CTC breakup page.
- **Adding a route or table:** run the audit file; a new leak shows up as a failing
  `test_route_never_crosses_companies[<rule>]`, a new unlinked table as a failing
  `test_every_table_is_company_owned_or_declared_global`.

---

## Security rules (always)

1. Never trust client-supplied `tenant_id` for authorization — use JWT / server session.  
2. Platform Super Admin (org Admin on platform tenant) may list tenants; tenant users only see their tenant.  
3. Missing tenant filter on a query is a **P0** bug once multi-tenant data exists.
