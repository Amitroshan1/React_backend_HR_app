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
| `CUSTOMER_PLAN` in `.env` | Fallback when tenant plan missing; prefer `tenants.plan` |

---

## Phase 1 — Foundation (this delivery)

- [x] Design doc (this file)
- [x] `tenants` table + seed tenant id=1
- [x] `admins.tenant_id` + backfill `= 1`
- [x] `tenant_context` helpers
- [x] JWT `tenant_id` claim on login
- [x] Plan resolution prefers tenant plan
- [x] Silo provision not primary (legacy gate)
- [x] Admin Customers creates/syncs `Tenant`

### Acceptance (Phase 1)

- Existing users keep working after restart (all on tenant 1)
- New JWT includes `tenant_id`
- Creating a company in Admin also creates a `tenants` row
- Provision button / API requires explicit legacy flag

---

## Security rules (always)

1. Never trust client-supplied `tenant_id` for authorization — use JWT / server session.  
2. Platform Super Admin (org Admin on platform tenant) may list tenants; tenant users only see their tenant.  
3. Missing tenant filter on a query is a **P0** bug once multi-tenant data exists.
