# Platform (vendor master)

This directory documents the **Super Admin / control plane** instance.

## In development

You do **not** need a second clone. Run the existing repo as platform:

1. Set in `backend_HRMS/.env`:
   - `SHOW_DEPLOYMENT_GUIDE=1`
   - `PROVISION_ENABLED=1`
   - `PROVISION_MYSQL_*` (optional for live CREATE DATABASE)
   - `PROVISION_UPLOADS_ROOT` → `…/deploy/uploads`
   - `PROVISION_ARTIFACTS_DIR` → `…/deploy/artifacts`
2. Start backend + frontend as usual.
3. Admin → Customers → Register / Provision.

Master `DATABASE_URI` points at the **registry** database (not `hrms_*` customer DBs).

## On a dedicated server

```text
/var/hrms/platform/React_backend_HR_app/   ← clone of this repo
/var/hrms/platform/.../backend_HRMS/.env   ← master env only
```

Customer traffic never hits this instance except Super Admins.
