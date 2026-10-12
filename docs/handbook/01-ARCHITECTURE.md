# 01 — Architecture

**Audience:** any developer joining the HRMS codebase.  
**Goal:** understand how the monorepo is wired end-to-end before changing a feature.

Related: [00-INDEX](./00-INDEX.md) · [Shared-DB multi-tenancy](../SHARED_DB_MULTI_TENANCY.md)

---

## 1. Purpose

This product is a **full-stack HRMS** (HR, attendance, payroll-related Accounts, IT assets, manager approvals, queries, tax, etc.) used by employees and internal panels (HR / Accounts / IT / Manager / Admin).

**Current product direction (locked):**

| Decision | Meaning |
|----------|---------|
| Shared-DB SaaS | One app, one database, isolation via `tenant_id` (Phase 1 foundation done) |
| Silo provision | Legacy only (`SILO_PROVISION_LEGACY=1`) — not the primary path |
| Plans | `basic` / `essential` / `enterprise` gate UI modules and some APIs |

---

## 2. High-level stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, React Router 7, Vite 7, Tailwind 4 |
| Backend | Flask 3, Flask-SQLAlchemy, Flask-JWT-Extended, Flask-CORS |
| DB | MySQL (via `pymysql` URI in `.env`) |
| Auth | JWT access tokens in `localStorage` (`token`); OTP login path |
| Email | ZeptoMail (`ZEPTO_*` env) |
| Jobs | Flask-APScheduler (`scheduler.py`) |
| Biometric devices | eSSL ADMS / iClock push under `/iclock` |
| Realtime attendance | SSE under `/api/attendance/events` |

Entry points:

- Backend: `backend_HRMS/app.py` → `create_app()` from `website/__init__.py`
- Dev frontend: `frontend` → `npm run dev` (Vite, usually `:5173`)
- Dev API: Flask `app.run(debug=True)` (usually `:5000`)

Vite proxies `/api`, `/static`, `/select_role` → `http://127.0.0.1:5000` (`frontend/vite.config.js`). Browser calls relative paths like `/api/auth/...`.

---

## 3. Repository layout

```text
React_backend_HR_app/
├── backend_HRMS/
│   ├── app.py                 # create_app(); __main__ runs Flask
│   ├── wsgi.py                # production WSGI entry
│   ├── requirements.txt
│   ├── .env                   # DATABASE_URI, JWT, plans, geo, ITAM flags…
│   ├── tests/                 # pytest
│   └── website/               # Flask application package
│       ├── __init__.py        # create_app, config, blueprints, schema ensures
│       ├── auth.py            # login, profile, punch, tax-self, geo checks
│       ├── leave_attendence.py
│       ├── Human_resource.py  # large HR control plane
│       ├── Accounts.py
│       ├── manager.py
│       ├── Admin.py
│       ├── it.py
│       ├── query.py
│       ├── notifications.py
│       ├── files.py
│       ├── performance_api.py
│       ├── probation_api.py
│       ├── plan_features.py   # subscription feature gates
│       ├── tenant_context.py  # JWT tenant helpers (Phase 1)
│       ├── geo_*.py           # geofence engine + validation
│       ├── scheduler.py
│       ├── models/            # SQLAlchemy models
│       ├── biometric/         # ADMS + HR biometric reporting
│       ├── daily_checkout/    # IT daily asset checkout
│       ├── attendance_realtime/
│       └── itam/              # ITAM flags / contracts
├── frontend/
│   ├── package.json
│   ├── vite.config.js         # /api → :5000 proxy
│   └── src/
│       ├── App.jsx            # route tree + panel gates
│       ├── pages/             # Dashboard, HR, IT, Admin, …
│       ├── components/        # layout, RequirePanel, SensitiveDataGate
│       └── hooks/
├── docs/
│   ├── handbook/              # THIS handbook
│   ├── itam/                  # ITAM rollout docs
│   └── SHARED_DB_MULTI_TENANCY.md
└── deploy/                    # optional legacy silo on-disk layout
```

**Convention:** route blueprints live as top-level modules under `website/`; heavy domain logic often lives in `*_service.py` next to them. Models live under `website/models/`.

---

## 4. Backend application bootstrap (`create_app`)

File: `backend_HRMS/website/__init__.py`

Rough order of work inside `create_app()`:

1. Load `backend_HRMS/.env`
2. Configure Flask / SQLAlchemy / JWT / CORS / upload limits
3. Set product flags (`CUSTOMER_PLAN`, `SHOW_DEPLOYMENT_GUIDE`, `SILO_PROVISION_LEGACY`, ITAM flags, geo defaults)
4. `db.init_app`, migrate, bcrypt, login_manager, jwt
5. Import models (so `db.create_all` / ensures see them)
6. Register blueprints (see §5)
7. Protect `/static/uploads/<path>` via signed URL or JWT
8. Run many `_ensure_*` schema patches (add columns/tables safely on startup)
9. Register CLI commands / scheduler hooks as applicable

**Important for developers:**

- Prefer **idempotent `_ensure_*` helpers** for additive schema changes on existing MySQL DBs (this project historically relies on them more than pure Alembic-only migrations in day-to-day ops).
- `RUN_DB_CREATE_ALL=1` enables `db.create_all()` (dev convenience; be careful in production).
- Do not store secrets in the handbook; read keys from `.env` / `DEPLOYMENT_GUIDE_ENV.md`.

---

## 5. HTTP API surface (blueprints)

All authenticated SPA traffic is under `/api/...` except biometric device push and some public pages.

| URL prefix | Blueprint module | Domain |
|------------|------------------|--------|
| `/api/auth` | `auth.py` | Login, OTP, session refresh, homepage, profile, **punch in/out**, location-check, employee tax-self, Form16 summary helpers |
| `/api/admin` | `Admin.py` | Org admin: employees overview, deployment guide, **customers / tenants bridge** |
| `/api/leave` | `leave_attendence.py` | Leave, WFH, claims submit, separation/NOC, related employee actions |
| `/api/HumanResource` | `Human_resource.py` | HR panel APIs (employees, holidays, inbox, hire/exit, compensation, …) |
| `/api/accounts` | `Accounts.py` | Accounts panel: payroll, CTC, expense review, tax review, … |
| `/api/query` | `query.py` | Employee queries / department inbox |
| `/api/manager` | `manager.py` | Manager approvals (leave, WFH, claims, resignation, team attendance, …) |
| `/api/it` | `it.py` | IT inventory, assets, parcels, tickets, ITAM |
| `/api/it/daily-checkout` | `daily_checkout/views.py` | Daily device checkout / return |
| `/api/notifications` | `notifications.py` | In-app notifications |
| `/api/performance` | `performance_api.py` | Performance cycles / reviews |
| `/api/probation` | `probation_api.py` | Probation reviews |
| `/api/files` | `files.py` | File helpers / signed access patterns |
| `/api/hr/biometric` | `biometric/hr_views.py` | HR biometric attendance reports |
| `/api/attendance` | `attendance_realtime/` | SSE events (does not write Punch) |
| `/iclock` | `biometric/` | Device ADMS push (health, cdata, …) |

**Note:** Punch lives on **`/api/auth/employee/punch-in|punch-out`**, not under a separate attendance blueprint. Attendance *rules* and calendars also appear under HR / engines — see modules 03 and 07.

---

## 6. Authentication & authorization model

### 6.1 JWT

- Issued at login / OTP verify / session refresh via `_issue_login_token` in `auth.py`.
- Typical additional claims: `email`, `emp_type`, **`tenant_id`** (Phase 1).
- Frontend stores token in `localStorage.token` and sends:

```http
Authorization: Bearer <token>
```

- Session lifetime is influenced by `session_timeout` helpers (by `emp_type`).

### 6.2 Role / panel gating

Roles are primarily driven by **`admins.emp_type`** (and related department aliases), not a separate RBAC table.

Frontend:

- `RequirePanel` (`components/security/RequirePanel.jsx`) gates `/hr`, `/account`, `/it`, `/admin`, `/manager`.
- `SensitiveDataGate` wraps payslip / tax routes (extra OTP step via `/api/auth/sensitive/*`).

Backend:

- Route decorators / manual checks on `get_jwt()` claims (`emp_type`, email allowlists for some vendor ops).
- `plan_features.py` → `has_feature` / `requires_plan` / `can_access_*_panel` for subscription gating.

### 6.3 Multi-tenancy (Phase 1)

- Table `tenants`; default seed `id=1`.
- Column `admins.tenant_id` backfilled to `1`.
- JWT claim `tenant_id`; helper `website/tenant_context.py`.
- **Later phases** add `tenant_id` to business tables and query filters. Until then, treat missing tenant filters as a future P0 once multi-tenant data exists.

Details: [SHARED_DB_MULTI_TENANCY.md](../SHARED_DB_MULTI_TENANCY.md) (module 16 will expand APIs).

---

## 7. Subscription plans & features

File: `website/plan_features.py`

**Resolution order:**

1. `tenants.plan` when `tenant_id` is known  
2. `CUSTOMER_PLAN` from `.env`  
3. Fallback `essential`

Plans: `basic` | `essential` | `enterprise`.

Features gate panels and capabilities (examples): `hr_panel`, `account_panel`, `it_panel`, `dashboard_payslip`, `query_all_departments`, payroll/CTC flags, etc.

Login response includes `plan`, `plan_label`, `features` via `plan_payload()`.

Full feature matrix → handbook **18**.

---

## 8. Frontend architecture

### 8.1 Routing

`frontend/src/App.jsx` defines the SPA router:

- Public: `/`, `set-password`, assessment/offer/ex-employee public links  
- Authenticated shell: `AppLayout` children (`/dashboard`, `/leaves`, `/profile`, …)  
- Panel routes wrapped in `RequirePanel`  
- Admin nested under `/admin/*`  
- IT nested under `/it/*`

### 8.2 Data fetching pattern

- Mostly **direct `fetch`** to `/api/...` with Bearer token (no Redux).
- Shared user context: `UserProvider`.
- Attendance SSE: `AttendanceEventsProvider` / `useAttendanceEvents`.

### 8.3 Local vs production

| Env | Frontend | API |
|-----|----------|-----|
| Local | Vite `:5173` | Proxied to Flask `:5000` |
| Production | Built static assets behind nginx | Same origin `/api` → Gunicorn/Flask |

---

## 9. Core domain concepts (mental model)

| Concept | Meaning in this codebase |
|---------|---------------------------|
| **Admin** | Primary user table (`admins`) — employees and privileged users are rows here |
| **emp_type** | Role/department string (e.g. Admin, Human Resource, Accounts, IT, Manager, …) |
| **circle** | Location org unit (e.g. NHQ, city circles) — drives geofence, holidays, policies |
| **Punch / PunchSession** | Day aggregate + one or more clock-in/out sessions (web or biometric source) |
| **WFH / Leave** | Applications with statuses Pending/Approved/Rejected |
| **Geofence** | Office zones; outside → require reason unless approved WFH |
| **Query** | Internal ticket/chat between employee and departments |
| **ITAM** | Asset lifecycle / inventory (feature-flagged rollout) |
| **Tenant** | Customer org in shared DB (SaaS) |

---

## 10. Cross-cutting services (know these exist)

| Area | Modules |
|------|---------|
| Geo validation | `geo_fence_engine.py`, `geo_validation_service.py`, `geo_mode_orchestrator.py`, `geo_fence_config.py` |
| Punch aggregation / auto-close | `punch_aggregate.py`, `punch_auto_close.py` |
| Attendance rules | `attendance_engine.py` |
| Secure uploads | `secure_file_service.py`, protected `/static/uploads` |
| Email | `email.py` + Zepto config |
| Offboarding | `offboarding_service.py` + letter PDF services |
| Payroll / TDS / Form16 | `payroll_*`, `tds_*`, `form16_*`, `tax_*` |

When fixing a bug, check whether logic lives in the **route file** or a **service** before duplicating.

---

## 11. Configuration map (starter)

Loaded mainly in `create_app` from `backend_HRMS/.env`:

| Key | Role |
|-----|------|
| `DATABASE_URI` | SQLAlchemy MySQL URI |
| `SECRET_KEY` / `JWT_SECRET_KEY` | App + JWT signing |
| `CORS_ORIGINS` | Allowed browser origins |
| `CUSTOMER_PLAN` | Plan fallback |
| `SHOW_DEPLOYMENT_GUIDE` | Vendor Admin customers UI |
| `SILO_PROVISION_LEGACY` | Enable legacy DB-per-company provision |
| `ZEPTO_*` / `EMAIL_*` | Mail |
| `UPLOADS_ROOT` | Absolute uploads root (prod) |
| `RUN_DB_CREATE_ALL` | Dev `create_all` |
| Geo / ITAM flags | See `geo_fence_config.py`, `itam/flags.py` |

Complete env catalog → handbook **18** + [DEPLOYMENT_GUIDE_ENV.md](../DEPLOYMENT_GUIDE_ENV.md).

---

## 12. Local development (happy path)

1. MySQL running; `DATABASE_URI` points at your DB.  
2. `cd backend_HRMS` → create/activate venv → `pip install -r requirements.txt` → `py app.py`.  
3. `cd frontend` → `npm install` → `npm run dev`.  
4. Open `http://localhost:5173`, log in, confirm Network calls hit `/api/...` and proxy to `:5000`.

Tests: `cd backend_HRMS` → `py -m pytest tests/ -q` (module-specific files under `tests/`).

---

## 13. How to change safely (architecture rules)

1. **Add APIs on the correct blueprint** — don’t dump HR endpoints into `auth.py` unless they are truly employee-self (auth already hosts punch + tax-self for historical reasons).  
2. **Keep JWT as source of identity** — never trust client-supplied `admin_id` / `tenant_id` for authz without verifying against token + DB.  
3. **Schema changes** — add model column + `_ensure_*` (or migrate) so existing DBs upgrade on boot.  
4. **Plan gates** — if a panel is plan-limited, update `plan_features.py` **and** frontend `RequirePanel` / feature checks.  
5. **Geo / punch** — do not call `geo_fence_engine` directly from new attendance code; go through validation/orchestrator patterns used by punch.  
6. **Uploads** — never expose raw `/static/uploads` from nginx without Flask auth; use signed URLs.  
7. **Multi-tenant future** — new business tables should plan for `tenant_id` (see shared-DB doc).  

---

## 14. Related modules (reading order)

| Next | Why |
|------|-----|
| [02 Auth & session](./02-AUTH-AND-SESSION.md) | How tokens are issued and what claims mean |
| 03 Punch & geo | Highest-complexity employee daily path |
| 16 Admin & tenancy | Customers / tenants control plane |
| 18 Plans & env | Feature flags and configuration |
| [ZZ Glossary](./ZZ-GLOSSARY.md) | emp_type aliases, statuses, shared terms |

---

## 15. Out of scope for this page

Per-endpoint request/response schemas, punch edge cases, leave state machines, ITAM transitions — those belong in modules **02–18**. This page is the **map**, not the atlas for every route.
