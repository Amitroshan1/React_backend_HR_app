# 16 — Admin, platform & tenancy

**Audience:** developers changing the Org Admin Command Center, customer/tenant registry, JWT `tenant_id`, or legacy silo provision gates.  
**Blueprint:** `website/Admin.py` → **`/api/admin`** (`admin_bp`)  
**Tenancy:** `models/tenant.py`, `tenant_context.py`  
**UI:** `/admin/*`, `/employees*` → `pages/Admin/`  
**Related:** [01 Architecture](./01-ARCHITECTURE.md) · [02 Auth](./02-AUTH-AND-SESSION.md) · [18 Plans](./18-PLANS-FEATURES-ENV.md) (planned) · [SHARED_DB_MULTI_TENANCY.md](../SHARED_DB_MULTI_TENANCY.md) · [NEW_CUSTOMER_DEPLOYMENT.md](../NEW_CUSTOMER_DEPLOYMENT.md)

> **Locked direction:** one app, one DB, row isolation via `tenant_id`. Silo (DB-per-company) is **legacy exception only**.

---

## 1. Purpose

1. **Org Admin Command Center** — dashboard counts; org-wide leaves / queries / claims / resignations; employee list/detail/punches; deep-links into HR / Accounts / IT  
2. **Platform vendor ops** — register companies as shared-DB **tenants** + plans; deployment guide  
3. **Tenancy Phase 1** — `tenants` table, `admins.tenant_id`, JWT claim `tenant_id`, plan from `tenants.plan`  
4. **Legacy silo** — Provision / env-template only when `SILO_PROVISION_LEGACY=1`

HR **signup** creates people inside a company (module **06**). Admin **Customers** creates a **company/tenant** — do not conflate.

---

## 2. Roles

| Role | Gate | Access |
|------|------|--------|
| Org Admin | JWT `emp_type` ∈ Admin / Administrator / Administration (or contains `super`) | `/admin/*`, `/employees*`, `/api/admin/*` (except platform-only extras) |
| Platform Admin | Org Admin **and** `SHOW_DEPLOYMENT_GUIDE=1` (+ optional `DEPLOYMENT_GUIDE_EMAILS`) | Customers registry, deployment guide, Provision UI when legacy on |
| HR | HR ops | People hire — **not** tenant create |
| Plan panels | `plan_features` + `RequirePanel` | HR / Accounts / IT by plan |

Org Admin bypasses plan panel gates (`is_org_admin` / `isAdminUser`).

Decorator: `_admin_required` on Admin APIs.

---

## 3. Key tables / models

| Model / table | Role |
|---------------|------|
| `tenants` / `Tenant` | Company registry: `name`, `slug`, **`plan`**, `status`, contact, notes, company mailboxes `mailbox_hr` / `mailbox_accounts` / `mailbox_it` / `mailbox_admin` (§4.3) |
| `admins.tenant_id` | FK → tenant; identity for JWT; **backfill default = 1** |
| `deployed_customers` / `DeployedCustomer` | Temporary UI bridge; create/update **syncs** `Tenant` via `_sync_tenant_from_customer` |
| Leaves / queries / claims / resignations / … | Consumed by Admin **read** lists — **not yet** filtered by `tenant_id` (Phase 1 foundation only) |

### Tenant enums

| Field | Values |
|-------|--------|
| `plan` | `basic` \| `essential` \| `enterprise` |
| `status` | `active` \| `suspended` \| `cancelled` \| `provisioning` |

Startup (`__init__.py`): ensure `tenants`, seed **id=1** (`slug=default`, plan from `CUSTOMER_PLAN`), add/backfill `admins.tenant_id=1`.

---

## 4. Business rules

### 4.1 Tenancy Phase 1 (done)

| Piece | Behavior |
|-------|----------|
| JWT | Login sets additional claim **`tenant_id`** (`tenant_id_for_admin(admin)`; NULL → **1**) |
| Helpers | `get_current_tenant_id()`, `tenant_id_for_admin()`, `require_same_tenant()` |
| Trust | **Never** authorize from client body `tenant_id` |
| Plan | `get_plan(tenant_id=…)` prefers `tenants.plan` → else `CUSTOMER_PLAN` → `essential` |
| Customers API | POST/PATCH syncs `Tenant` |
| Silo | Provision / env-template **403** unless `SILO_PROVISION_LEGACY=1` (+ `PROVISION_ENABLED` for provision) |

### 4.2 Not done yet (later phases)

Per-table `tenant_id` filters · composite uniques `(tenant_id, email)` · first-admin seed for new tenants · `uploads/{tenant_id}/` · tenant-aware schedulers (the module rollout has since delivered these; status in the SHARED_DB doc).

**Admin list/dashboard queries are still global** — safe today while production is single-tenant (id=1); **P0** once tenant 2+ has real rows.

Design freeze + rollout order: [SHARED_DB_MULTI_TENANCY.md](../SHARED_DB_MULTI_TENANCY.md).

### 4.4 Cross-company security audit (rollout step 10)

`tests/test_shared_db_multitenancy_security_audit.py` seeds one row per table per company (company 1's text carries the marker `zqleak…`) and has company 2's Admin, HR, Accounts, IT, manager, employee and an anonymous caller hit **every route** with company 1's ids in URL, query and body.

| Check | Fails when |
|-------|-----------|
| `test_route_never_crosses_companies[<rule>]` | 2xx response contains company 1's marker, or company 1's rows changed |
| `test_every_table_is_company_owned_or_declared_global` | A table has no `tenant_id` / FK to a company table / `admin_id` column and is not in `GLOBAL_TABLES` |
| `test_audit_reaches_route_logic` | Positive control: company 1 no longer sees its own data (audit went vacuous) |

Every GET route is called twice: with ids only, and with a date range around the seed dates (for routes that default to "today").

Global on purpose: `tenants`, `deployed_customers`, `audit_logs`, `offboarding_reminder_logs`, `geo_config_*` (geo settings: only the platform company may change them or read their history). Limits (email content, record states the seed does not reach) → module tests.

### 4.3 Platform customers

| Rule | Detail |
|------|--------|
| Register | Creates `DeployedCustomer` + `Tenant` (shared DB — no MySQL CREATE) |
| Plan change | Upgrade-only (higher tier); no silent downgrade |
| List payload | Flags `architecture: shared_db`, `phase: 1`, `silo_provision_legacy` |
| Customer instances | Set `SHOW_DEPLOYMENT_GUIDE=0` so they don’t see vendor Customers UI |
| Company mailboxes | Platform admins set them on Customers. A company admin edits only their own company at `GET/PUT /api/admin/mailboxes` (Admin → Company mailboxes); other roles get 403. Tenant 1 blanks fall back to `.env`; other companies never do |
| Scheduled jobs | Run once per company that is not suspended / cancelled, in that company's scope (module **17** §4.7) |

### 4.4 Legacy silo

Only with `SILO_PROVISION_LEGACY=1`: env-template download + `POST …/provision` → `customer_provisioning.provision_customer` (separate DB, seed admin, uploads, `.env`). Frontend hides Provision unless API returns `silo_provision_legacy: true`.

---

## 5. API catalog (`/api/admin`)

All: JWT + `_admin_required`.

### Dashboard

| Method | Path | Notes |
|--------|------|-------|
| GET | `/dashboard` | Counts + `can_view_deployment_guide`; optional `circle`, `emp_type` |

### Employees

| Method | Path | Notes |
|--------|------|-------|
| GET | `/employees` | Active non-exited; scope filters |
| GET | `/employees/<id>` | Detail (payslips, assets, …) |
| GET | `/employees/<id>/punches` | Punch ledger |

### Org-wide read

| Method | Path |
|--------|------|
| GET | `/leaves` |
| GET | `/queries`, `/queries/<id>` |
| GET | `/claims` |
| GET | `/resignations` |

### Platform (also `_can_view_deployment_guide`)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/deployment-guide/access` | Flag for UI |
| GET | `/deployment-guide` | Checklist payload |
| GET/POST | `/customers` | List / register company → Tenant |
| GET/PATCH | `/customers/<id>` | Detail / update |
| GET | `/customers/<id>/env-template` | Legacy; needs `SILO_PROVISION_LEGACY` |
| POST | `/customers/<id>/provision` | Legacy silo; needs legacy + `PROVISION_ENABLED` |

---

## 6. Main flows

### 6.1 Login tenant claim

```text
auth login → Admin row
  → tenant_id = tenant_id_for_admin(admin)  # default 1
  → JWT additional_claims { email, emp_type, tenant_id }
  → plan_payload(tenant_id=…)
```

### 6.2 Register company (primary)

```text
Platform Admin → POST /api/admin/customers
  → DeployedCustomer + _sync_tenant_from_customer(create=True)
  → Tenant status active (shared DB)
```

Onboarding steps: [NEW_CUSTOMER_DEPLOYMENT.md](../NEW_CUSTOMER_DEPLOYMENT.md).

### 6.3 HR hire vs Admin customer

```text
HR signup     → new Admin person (same tenant)
Admin Customers → new Tenant (company)
```

### 6.4 Legacy silo (exception)

```text
SILO_PROVISION_LEGACY=1 + PROVISION_ENABLED
  → POST …/provision → separate hrms_* DB + seed
```

---

## 7. Frontend map

| Route | Guard | Page |
|-------|-------|------|
| `/admin` | `RequirePanel panel="admin"` → `AdminLayout` | Command Center (`Admin.jsx`) |
| `/admin/customers`, `/deployment-guide`, `/leaves`, `/queries`, `/claims`, `/resignations` | same | Nested under layout |
| `/employees`, `/employee/:id`, `/employee/:id/punches` | `RequirePanel admin` | Outside nested layout |

Hub: `adminHubConfig.js` — department deep-links, time/finance/IT cards, **`ADMIN_PLATFORM_SECTION`** (Customers + Deployment Guide). Platform cards only if dashboard `can_view_deployment_guide`.

`AdminCustomers.jsx`: Provision / `.env` actions only when `silo_provision_legacy: true`. Register and edit forms have a "Company mailboxes" block (`mailbox_hr` / `_accounts` / `_it` / `_admin`); Edit loads current values from `GET /customers/<id>` (`tenant.mailboxes`) and sends mailbox keys only once loaded or typed.

---

## 8. Jobs / CLI

**None** dedicated to tenants. No tenant CLI. Daily HR jobs run per company in `tenant_scope` (module **17** §4.7). Seed/backfill runs at app create. Legacy provision is on-demand API only.

---

## 9. Config

| Env / flag | Effect |
|------------|--------|
| `SHOW_DEPLOYMENT_GUIDE=1` | Platform Customers + guide |
| `DEPLOYMENT_GUIDE_EMAILS` | Optional email allow-list |
| `SILO_PROVISION_LEGACY=1` | Unlocks Provision + env-template |
| `PROVISION_ENABLED=1` | Second gate for silo provision |
| `PROVISION_MYSQL_*`, `PROVISION_UPLOADS_ROOT`, … | Legacy silo |
| `CUSTOMER_PLAN` | Fallback plan when tenant plan missing |

**JWT claim:** `tenant_id` (int; default **1**).

Full plan feature matrix → module **18**. Keys used for panels: `hr_panel`, `account_panel`, `it_panel`, query/payroll/dashboard flags, etc. Plans: `basic` / `essential` / `enterprise`.

Also: [DEPLOYMENT_GUIDE_ENV.md](../DEPLOYMENT_GUIDE_ENV.md).

---

## 10. How to change safely

1. Never authorize from client-supplied `tenant_id` — JWT / `admins.tenant_id` only.  
2. Keep silo behind **both** `SILO_PROVISION_LEGACY` and `PROVISION_ENABLED`; don’t re-enable Provision UI without the API flag.  
3. Prefer mutating **`tenants`**; treat `DeployedCustomer` as bridge until retired.  
4. Plan upgrades: higher tier only.  
5. Adding multi-tenant data without filters on Admin/org queries is a **P0** leak once tenant 2+ exists.  
6. Customer instances: `SHOW_DEPLOYMENT_GUIDE=0`.  
7. Do not “fix” isolation by Phase 1 alone — business tables still lack filters.  
8. Keep HR signup vs Admin Customers responsibilities separate.
9. New route or table → run the security audit (§4.4). Put a table in `GLOBAL_TABLES` only when it is truly platform-wide, with the reason in a comment.

---

## 11. Related modules

| # | Boundary |
|---|----------|
| 01 | Shared-DB decision, `/api/admin` map |
| 02 | Login JWT `tenant_id`, `plan_payload` |
| 06 | HR people signup / exit |
| 11 / 12 | Admin claims & queries lists |
| 17 | Schedulers (per-company runs, company scope) |
| 18 | Full plan features / `RequirePanel` / env catalog |

```text
Admin.py                 # /api/admin
models/tenant.py
tenant_context.py
models/deployed_customer.py
customer_provisioning.py # legacy silo only
plan_features.py         # plan resolution
auth.py                  # JWT tenant_id claim
pages/Admin/             # SPA
docs/SHARED_DB_*.md      # design freeze
docs/NEW_CUSTOMER_*.md   # onboarding
```

---

## 12. Quick test checklist

- [ ] Non-Admin emp_type → `/api/admin/*` **403**  
- [ ] Login JWT includes `tenant_id` (default 1 for backfilled admins)  
- [ ] `SHOW_DEPLOYMENT_GUIDE=0` → no Customers / guide cards  
- [ ] POST `/customers` creates Tenant + list shows shared_db / phase 1  
- [ ] Without `SILO_PROVISION_LEGACY` → provision/env-template **403**; UI hides Provision  
- [ ] Plan upgrade allowed; downgrade rejected  
- [ ] HR signup creates person, not a new Tenant  
- [ ] Admin employee list excludes exited / inactive  
- [ ] Dashboard `can_view_deployment_guide` matches env + email allow-list  
- [ ] Client body `tenant_id` ignored for authorization
- [ ] `pytest tests/test_shared_db_multitenancy_security_audit.py` all green  
