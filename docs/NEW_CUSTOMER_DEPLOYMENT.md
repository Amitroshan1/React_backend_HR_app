# New customer onboarding (shared-DB SaaS)

**Primary architecture:** one app, one database, row isolation via `tenant_id`.  
See [SHARED_DB_MULTI_TENANCY.md](./SHARED_DB_MULTI_TENANCY.md) for the design freeze and phase plan.

> **Legacy:** database-per-company (`hrms_*` provision) is retired as the default path.  
> Enable only with `SILO_PROVISION_LEGACY=1` for dedicated-hosting exceptions. See § Legacy silo below.

---

## Shared-DB — register a company (Phase 1+)

On the platform instance (`SHOW_DEPLOYMENT_GUIDE=1`):

1. Open **Admin → Customers**
2. **Register company** (name + subscription plan)
3. Backend creates a **`tenants`** row (and keeps `deployed_customers` as a UI bridge)
4. Status defaults to **Active** (no separate MySQL DB to wait for)
5. Later phases: seed first tenant admin, scope all business tables by `tenant_id`

Same login URL for all companies. Isolation is `admins.tenant_id` + JWT `tenant_id` claim (Phase 1 foundation).

### Platform env (shared app)

```env
SHOW_DEPLOYMENT_GUIDE=1
CUSTOMER_PLAN=essential
# Optional fallback when a tenant has no plan set; prefer tenants.plan
```

Do **not** set `SILO_PROVISION_LEGACY` unless you intentionally need a separate DB.

---

## Legacy silo (optional — not primary)

Only when a customer must run on a dedicated DB/host:

```env
SILO_PROVISION_LEGACY=1
PROVISION_ENABLED=1
PROVISION_MYSQL_HOST=localhost
PROVISION_MYSQL_PORT=3306
PROVISION_MYSQL_USER=root
PROVISION_MYSQL_PASSWORD=********
PROVISION_UPLOADS_ROOT=/var/hrms/uploads
PROVISION_ARTIFACTS_DIR=/var/hrms/artifacts
PROVISION_BASE_DOMAIN=yourdomain.com
```

Then **Admin → Customers → Provision** (and `.env` download) reappear. Without MySQL admin credentials, provision runs as dry-run (artifacts only).

### Local silo folders (this repo)

See `deploy/` — reserved for dedicated-hosting layouts; not required for shared-DB SaaS.

---

## Checklist (shared-DB)

- [ ] Platform instance running with `SHOW_DEPLOYMENT_GUIDE=1`
- [ ] Company registered → `tenants` row exists
- [ ] Existing users still login (backfilled `admins.tenant_id=1`)
- [ ] New JWTs include `tenant_id` claim
- [ ] Plan shown matches `tenants.plan` (or `CUSTOMER_PLAN` fallback)

## Checklist (legacy silo only)

- [ ] `SILO_PROVISION_LEGACY=1` and `PROVISION_ENABLED=1`
- [ ] Server/VPS if not sharing master MySQL
- [ ] `POST /api/admin/customers/:id/provision` completed
- [ ] Customer `.env` with unique secrets and `SHOW_DEPLOYMENT_GUIDE=0`
- [ ] DNS / reverse proxy for customer URL

---

## Related docs

| Doc | Purpose |
|-----|---------|
| [SHARED_DB_MULTI_TENANCY.md](./SHARED_DB_MULTI_TENANCY.md) | Design freeze + phase roadmap |
| `deploy/README.md` | Legacy folder layout for dedicated hosts |
