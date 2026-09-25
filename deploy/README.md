# Deploy layout (legacy silo / dedicated hosting)

> **Primary product path is shared-DB SaaS** — one app, one database, `tenant_id`.  
> See `docs/SHARED_DB_MULTI_TENANCY.md`. This folder is for **optional** dedicated-hosting
> (separate DB/instance per company) when `SILO_PROVISION_LEGACY=1`.

```text
deploy/
├── platform/          Vendor master (this repo when SHOW_DEPLOYMENT_GUIDE=1)
├── artifacts/         Generated {slug}.env files (PROVISION_ARTIFACTS_DIR)
├── uploads/           Per-customer upload roots (PROVISION_UPLOADS_ROOT)
└── customers/         One instance folder per company (runtime only)
    └── _template/     How to spin up a customer instance
```

## Shared-DB (default)

No per-customer folder required. Register companies in **Admin → Customers**;
tenants live in the shared `tenants` table.

## Legacy silo env (master)

```env
SILO_PROVISION_LEGACY=1
PROVISION_ENABLED=1
PROVISION_UPLOADS_ROOT=…/deploy/uploads
PROVISION_ARTIFACTS_DIR=…/deploy/artifacts
```

## What is committed vs not

| Path | In git? |
|------|---------|
| `deploy/**/README.md`, `.gitkeep` | Yes |
| `deploy/artifacts/**` contents | **No** (secrets) |
| `deploy/uploads/**` contents | **No** |
| `deploy/customers/{slug}/` full app copies | **No** |

See root `.gitignore`.
