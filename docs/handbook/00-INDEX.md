# HRMS Developer Handbook — Index

This folder is the **developer handbook** for the Solviotec / React HRMS monorepo.  
Each module doc is written for engineers who need to understand, change, and safely extend the system.

**How to use:** read [01-ARCHITECTURE](./01-ARCHITECTURE.md) first, then follow modules in order (or jump via the table below).

---

## Status legend

| Status | Meaning |
|--------|---------|
| Done | Full handbook page exists |
| Next | Recommended next write |
| Planned | Outline locked; not written yet |

---

## Module catalog

| # | Document | Status | Primary backend | Primary frontend |
|---|----------|--------|-----------------|------------------|
| 00 | [INDEX](./00-INDEX.md) (this file) | Done | — | — |
| 01 | [Architecture](./01-ARCHITECTURE.md) | Done | `website/__init__.py`, `app.py` | `App.jsx`, Vite |
| 02 | [Auth & session](./02-AUTH-AND-SESSION.md) | Done | `auth.py` (login/OTP/JWT) | `HeroSection`, `AppLayout`, session utils |
| 03 | [Dashboard, punch & geo](./03-DASHBOARD-PUNCH-GEO.md) | Done | `auth` punch + `geo_*` + `punch_auto_close` | `Dashboard.jsx` |
| 04 | [Leave, WFH & Comp-off](./04-LEAVE-WFH-COMPOFF.md) | Done | `leave_attendence.py`, `compoff_utils` | `Leaves/`, `Wfh/` |
| 05 | [Manager approvals](./05-MANAGER-APPROVALS.md) | Done | `manager.py`, `manager_utils` | `Manager/` |
| 06 | [HR core](./06-HR-CORE.md) | Done | `Human_resource.py` (+ geo analytics) | `HR/` |
| 07 | [Attendance engine & regularization](./07-ATTENDANCE-ENGINE.md) | Done | `attendance_engine.py`, leave/HR regularization | `Attendance/`, HR regularization |
| 08 | [Biometric](./08-BIOMETRIC.md) | Done | `biometric/`, `/iclock` | HR Biometric pages |
| 09 | [Accounts, payroll & CTC](./09-ACCOUNTS.md) | Done | `Accounts.py` + payroll services | `Account/`, Payslip |
| 10 | [Tax declaration](./10-TAX-DECLARATION.md) | Done | tax_* on `auth` + Accounts | `TaxDeclaration/` |
| 11 | [Claims / expenses](./11-CLAIMS.md) | Done | leave/Accounts/manager (+ Admin list) | `Claims/`, Manager, Account |
| 12 | [Queries](./12-QUERIES.md) | Done | `query.py` | `Query/`, IT OpenTicket, Admin |
| 13 | [Performance & probation](./13-PERFORMANCE-PROBATION.md) | Done | `performance_api`, `probation_api` | Performance + Manager + HR |
| 14 | [IT / ITAM / parcels / day-use](./14-IT-ITAM.md) | Done | `it.py`, `daily_checkout/`, `itam/` | `IT/` |
| 15 | [Notifications & files](./15-NOTIFICATIONS-AND-FILES.md) | Done | `notifications.py`, `files.py`, `secure_file_service` | Headers, secureFileUrl |
| 16 | [Admin, platform & tenancy](./16-ADMIN-PLATFORM-TENANCY.md) | Done | `Admin.py`, `tenant_*` | `Admin/` |
| 17 | [Schedulers & background jobs](./17-SCHEDULERS.md) | Done | `scheduler.py`, `__init__` APScheduler | — (CLI / ops) |
| 18 | [Plans, features & env](./18-PLANS-FEATURES-ENV.md) | Done | `plan_features.py` | `RequirePanel`, `planFeatures.js` |
| ZZ | [Glossary](./ZZ-GLOSSARY.md) | Done | — | — |

---

## Related docs (do not duplicate)

| Topic | Location |
|-------|----------|
| Shared-DB multi-tenancy design | [../SHARED_DB_MULTI_TENANCY.md](../SHARED_DB_MULTI_TENANCY.md) |
| New customer / onboarding | [../NEW_CUSTOMER_DEPLOYMENT.md](../NEW_CUSTOMER_DEPLOYMENT.md) |
| Deployment env keys | [../DEPLOYMENT_GUIDE_ENV.md](../DEPLOYMENT_GUIDE_ENV.md) |
| Attendance SSE / nginx | [../ATTENDANCE_SSE.md](../ATTENDANCE_SSE.md) |
| ITAM P0–P3 | [../itam/](../itam/) |
| Deploy folder layout | [../../deploy/README.md](../../deploy/README.md) |

---

## Template every module doc follows

1. Purpose  
2. Roles who can access  
3. Key tables / models  
4. Business rules & edge cases  
5. API catalog (method, path, auth, body, responses, errors)  
6. Main flows (sequences)  
7. Frontend routes & which APIs they call  
8. Jobs / schedulers (if any)  
9. Config / `.env`  
10. How to change safely  
11. Related modules  

---

## Writing order (agreed)

We write **one module at a time**. After each doc, review before starting the next.

1. Architecture (done)  
2. Auth & session (done)  
3. Dashboard / punch / geo (done)  
4. Leave / WFH / Comp-off (done)  
5. Manager approvals (done)  
6. HR core (done)  
7. Attendance engine (done)  
8. Biometric (done)  
9. Accounts, payroll & CTC (done)  
10. Tax declaration (done)  
11. Claims / expenses (done)  
12. Queries (done)  
13. Performance & probation (done)  
14. IT / ITAM / parcels / day-use (done)  
15. Notifications & files (done)  
16. Admin, platform & tenancy (done)  
17. Schedulers & background jobs (done)  
18. Plans, features & env (done)  
ZZ. Glossary (done)  

Catalog complete (modules 01–18 + glossary).

---

## Repo map (one glance)

```text
React_backend_HR_app/
├── backend_HRMS/          Flask API (create_app, blueprints, models)
│   ├── app.py             Dev entry: create_app() + run
│   ├── website/           Package: routes, services, models
│   ├── tests/             pytest
│   └── .env               Local secrets (not committed)
├── frontend/              React 19 + Vite SPA
│   └── src/pages/         Role panels & employee screens
├── docs/                  Ops + design docs
│   └── handbook/          ← developer handbook (this folder)
└── deploy/                Optional legacy silo layout
```
