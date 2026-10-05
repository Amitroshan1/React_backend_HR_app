# 18 — Plans, features & env

**Audience:** developers adding subscription gates, changing plan matrices, or wiring a new customer’s `.env`.  
**Backend:** `website/plan_features.py`  
**Frontend:** `utils/planFeatures.js`, `components/security/RequirePanel.jsx`  
**Config:** `backend_HRMS/.env` via `create_app` in `__init__.py`  
**Related:** [01 Architecture](./01-ARCHITECTURE.md) · [02 Auth](./02-AUTH-AND-SESSION.md) · [12 Queries](./12-QUERIES.md) · [16 Admin/tenancy](./16-ADMIN-PLATFORM-TENANCY.md) · [DEPLOYMENT_GUIDE_ENV.md](../DEPLOYMENT_GUIDE_ENV.md) · [NEW_CUSTOMER_DEPLOYMENT.md](../NEW_CUSTOMER_DEPLOYMENT.md)

> **Plan ≠ role.** `emp_type` decides *who* can open a panel; `CUSTOMER_PLAN` / `tenants.plan` decides *whether the product includes that module*. Org Admin bypasses panel plan gates.

---

## 1. Purpose

1. **Subscription plans** — `basic` | `essential` | `enterprise`  
2. **Feature flags** — string keys in `ALL_FEATURES`; disable sets per plan  
3. **Panel + route guards** — backend `has_feature` / `can_access_*` / `requires_plan`; frontend `hasFeature` / `RequirePanel`  
4. **Query department allow-list** — plan-scoped raise targets  
5. **Env catalog** — core app, vendor ops, ITAM, geo, provision (pointers; don’t duplicate ITAM/geo handbooks)

---

## 2. Roles vs plans

| Layer | Source | Effect |
|-------|--------|--------|
| Role | JWT `emp_type` (+ manager flag) | HR / Accounts / IT / Admin / Manager / employee |
| Plan | `tenants.plan` → else `CUSTOMER_PLAN` → `essential` | Which features exist for the tenant |
| Org Admin | `emp_type` ∈ Admin / Administrator / Administration or contains `super` | Bypasses **panel** plan checks (`can_access_*_panel` / FE `adminHasFullPanelAccess`) |
| Feature still off | e.g. `hr_assessment_invite` | Even Admin gets **403** on that route if feature missing (HR before_request) |

Manager panel is **role-only** (not a plan feature). Sensitive payslip/tax OTP is separate (`SensitiveDataGate`).

---

## 3. Key tables / storage

| Asset | Role |
|-------|------|
| `tenants.plan` | Preferred plan for JWT `tenant_id` (Phase 1) |
| `app.config["CUSTOMER_PLAN"]` | Fallback when there is no login JWT or the tenant has no valid plan |
| `localStorage.hrms_plan_context` | FE cache: `{ plan, features[] }` from login / profile |
| Login/profile JSON | `plan`, `plan_label`, `features` via `plan_payload(tenant_id=…)` |

No separate “features” table — matrix is code in `plan_features.py`.

---

## 4. Business rules

### 4.1 Plan resolution

```text
get_plan(tenant_id?)
  1. tenants.plan for tenant_id, or (when omitted) for the login JWT's tenant_id
  2. CUSTOMER_PLAN from .env (no login JWT: public routes, schedulers, CLI)
  3. essential
```

The JWT tenant and its plan are cached on the request, so repeated `has_feature()` calls cost one lookup.

Invalid / unknown plan strings → **essential**.

### 4.2 Feature matrix

`features_for_plan` = `ALL_FEATURES − DISABLED_SET` (enterprise = all).

| Feature | Basic | Essential | Enterprise | Typical UI / API |
|---------|:-----:|:---------:|:----------:|------------------|
| `hr_panel` | ✓ | ✓ | ✓ | `/hr`, HR blueprint |
| `hr_add_dept_circle` | ✓ | ✓ | ✓ | HR master POST `/master/` |
| `hr_employee_accounts` | ✓ | ✓ | ✓ | Shared HR/Accounts employee accounts |
| `account_for_client` | ✓ | ✓ | ✓ | For-client attendance export |
| `account_panel` | — | ✓ | ✓ | `/account`, Accounts blueprint |
| `dashboard_payslip` | — | ✓ | ✓ | Dashboard Payslip tile |
| `dashboard_claims` | — | ✓ | ✓ | Dashboard Claims tile |
| `payslip_payroll_history` | — | ✓ | ✓ | Payroll history on Payslip |
| `query_hr_and_accounts` | — | ✓ | ✓ | Raise query → HR + Accounts |
| `it_panel` | — | — | ✓ | `/it`, IT blueprint |
| `dashboard_my_assets` | — | — | ✓ | My Assets / day-use employee |
| `hr_assessment_invite` | — | — | ✓ | Assessment invite APIs/UI |
| `hr_ex_employee_docs` | — | — | ✓ | Ex-employee document sharing |
| `query_all_departments` | — | — | ✓ | Raise → HR + IT + Accounts |
| `account_payroll` | — | — | ✓ | Payroll run routes |
| `account_ctc_breakup` | — | — | ✓ | CTC / TDS rules routes |
| `account_full_employee_view` | — | — | ✓ | Full employee view in Accounts UI |

**Basic query:** neither query feature → raise target **HR only**.  
**Essential:** HR + Accounts.  
**Enterprise:** all three (`QUERY_DEPARTMENT_CANONICAL`).

Comments in code: `hr_employee_accounts` and `account_for_client` stay on **all** plans (not in disable sets).

### 4.3 Panel access (role ∧ plan)

| Helper (BE / FE) | Requires |
|------------------|----------|
| `can_access_hr_operations` / `canAccessHrPanel` | HR role **or** Org Admin; FE also requires `hr_panel` (Admin bypasses) |
| `can_access_accounts_panel` / `canAccessAccountPanel` | `account_panel` + Accounts role (Admin bypass) |
| `can_access_it_panel` / `canAccessItPanel` | `it_panel` + IT/Inventory role (Admin bypass) |
| Shared modules | `can_access_hr_or_accounts_shared` + feature (`hr_employee_accounts`, `account_for_client`) |

### 4.4 Backend guards (examples)

| Blueprint | Guard |
|-----------|--------|
| HR | JWT + `can_access_hr_operations`; path features for assessment / ex-docs / master POST |
| Accounts | JWT + panel (exceptions: self payslip/CTC/form16/file/tax paths); path features for payroll / CTC |
| IT | `can_access_it_panel`; employee assets need `dashboard_my_assets` |
| Query | `filter_query_departments` / `is_allowed_query_department` |

Forbidden body: `plan_forbidden_response` → **403** + `required_feature` + `plan`.

Decorator: `@requires_plan("feature_key")` for one-off routes.

### 4.5 Frontend context

1. Login (`HeroSection`) / user refresh (`UserContext`) → `setPlanContext(plan, features)`  
2. Logout → `clearPlanContext`  
3. `hasFeature(key)` — enterprise always true; else `features.includes`  
4. `RequirePanel` — `/hr`, `/account`, `/it`, `/admin`, `/manager`  
5. `RequireMyAssets` / `RequireItOrSelfAssets` — day-use / my assets

**Trust model:** FE gates UX; **BE must enforce** (never rely on hidden tiles alone).

### 4.6 Server and login plan agree

Login, dashboard `plan_payload()`, every `has_feature()` / `can_access_*` guard and the 403
body all resolve the logged-in tenant's **`tenants.plan`**. `CUSTOMER_PLAN` only applies when
there is no login JWT. Startup logs a warning if tenant 1's `tenants.plan` differs from
`CUSTOMER_PLAN`; change the plan in Admin Customers, not only in `.env`.

---

## 5. API catalog

No dedicated “plans” blueprint. Plan is embedded in auth:

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/…` login / OTP verify | Response includes `plan`, `plan_label`, `features`, `tenant_id` |
| GET | profile / me-style refresh | Same `plan_payload` fields when wired |

Admin Customers PATCH may update `tenants.plan` (module **16**) — does **not** push-update already-logged-in browsers until re-login / profile refresh.

---

## 6. Main flows

### 6.1 Login → gated UI

```text
Login success
  → plan_payload(tenant_id)
  → FE setPlanContext
  → Dashboard tiles / RequirePanel / hasFeature
  → API calls still checked server-side
```

### 6.2 Change sold plan

```text
Update tenants.plan (Admin Customers) — takes effect on the next request, no restart
  (CUSTOMER_PLAN in .env only changes the no-login fallback)
  → users re-login (or refresh profile) to refresh localStorage
  → verify 403 vs 200 on a gated route
```

### 6.3 New feature flag

```text
Add to ALL_FEATURES
  → add to BASIC_DISABLED and/or ESSENTIAL_DISABLED as needed
  → gate BE route + FE tile
  → document in this matrix
```

---

## 7. Frontend routes & checks

| Route / area | Gate |
|--------------|------|
| `/hr/*` | `RequirePanel panel="hr"` |
| `/account/*` | `RequirePanel panel="account"` |
| `/it/*` | `RequirePanel panel="it"` |
| `/admin/*` | `RequirePanel panel="admin"` (role only) |
| `/manager/*` | `RequirePanel panel="manager"` (role / `has_manager_access`) |
| `/daily-assets`, my assets | `RequireMyAssets` / `dashboard_my_assets` |
| `/claims`, payslip nav | `AppLayout` + `dashboard_claims` / `dashboard_payslip` |
| HR tiles | `Hr.jsx` feature filters |
| Accounts tiles | `Account.jsx` `hasFeature` |
| Queries | `Queries.jsx` mirrors BE department filter |

Keep FE department aliases in sync with `plan_features` HR/Accounts/IT alias sets.

---

## 8. Jobs

None. Plan is request-time config. No scheduler reads `CUSTOMER_PLAN` for feature math (jobs are not plan-gated today — module **17**).

---

## 9. Config / `.env` catalog

### 9.1 Core app

| Key | Role |
|-----|------|
| `DATABASE_URI` | MySQL SQLAlchemy URI |
| `SECRET_KEY` | Flask secret |
| `JWT_SECRET_KEY` | JWT signing (default insecure if unset — set in prod) |
| `BASE_URL` | Absolute links / emails |
| `CORS_ORIGINS` | Comma-separated browser origins |
| `UPLOADS_ROOT` | Absolute uploads root (prod) |
| `FILE_SIGN_TTL_SECONDS` | Signed file URL TTL (default 3600) |
| `MAX_CONTENT_LENGTH_MB` | Upload cap (default 100; assessment may raise) |
| `RUN_DB_CREATE_ALL` | `1` → `db.create_all` on boot (dev) |

### 9.2 Plan & vendor platform

| Key | Role |
|-----|------|
| `CUSTOMER_PLAN` | `basic` \| `essential` \| `enterprise` (fallback) |
| `SHOW_DEPLOYMENT_GUIDE` | Vendor Admin Customers + guide |
| `DEPLOYMENT_GUIDE_EMAILS` | Optional allow-list for guide |
| `SILO_PROVISION_LEGACY` | Unlock legacy DB-per-company provision |
| `PROVISION_ENABLED` | Second gate for silo provision |
| `PROVISION_MYSQL_*` | Host/user/password/port for CREATE DATABASE |
| `PROVISION_UPLOADS_ROOT` / `PROVISION_ARTIFACTS_DIR` / `PROVISION_BASE_DOMAIN` | Silo artifact paths |

Shared-DB is primary; silo flags default **off**. Details: [16](./16-ADMIN-PLATFORM-TENANCY.md), [NEW_CUSTOMER_DEPLOYMENT.md](../NEW_CUSTOMER_DEPLOYMENT.md).

### 9.3 Email

| Key | Role |
|-----|------|
| `ZEPTO_API_KEY`, `ZEPTO_BASE_URL`, `ZEPTO_SENDER_*` | ZeptoMail |
| `ZEPTO_CC_HR` / `_ACCOUNT` / `_IT` | CC lists |
| `EMAIL_HR`, `EMAIL_ACCOUNTS`, `EMAIL_IT`, `EMAIL_ADMIN` | Dept mailboxes — **platform company (tenant 1) only**; other companies use `tenants.mailbox_*` (`company_mailbox`, module **16** §4.3) |

### 9.4 Domain flags (not subscription plans)

| Area | Keys | Docs |
|------|------|------|
| ITAM rollout | `ITAM_TRANSITIONS_V1`, `ITAM_TIMELINE_V1`, `ITAM_LIFECYCLE_V1`, `ITAM_API_FIRST_V1`, `ITAM_SELF_SERVICE_V1`, `ITAM_OFFBOARD_GATE_V1` | [14](./14-IT-ITAM.md), `docs/itam/` |
| Geo engine | `GEO_ENGINE_MODE` (`LEGACY`\|`SHADOW`\|`V2`), thresholds in `geo_fence_config.py` | [03](./03-DASHBOARD-PUNCH-GEO.md) |
| Biometric | `BIOMETRIC_NHQ_SERIALS`, allowlists, timeouts | [08](./08-BIOMETRIC.md) |
| Day-use | `DAILY_CHECKOUT_RETURN_HOUR` / `_MINUTE` | [14](./14-IT-ITAM.md) |
| Manager | `MANAGER_SELF_APPROVAL_ROLES` | [05](./05-MANAGER-APPROVALS.md) |
| Auth profile experiments | `AUTH_PROFILE_*`, `AUTH_LEGACY_*` | [02](./02-AUTH-AND-SESSION.md) |
| Org hierarchy | `ORG_HIERARCHY_POSITION_PRIMARY` | HR/org |

Vendor-only enablement notes: [DEPLOYMENT_GUIDE_ENV.md](../DEPLOYMENT_GUIDE_ENV.md).

### 9.5 Frontend env (Vite)

Optional mirrors such as `VITE_ITAM_*` when used — keep in sync with backend ITAM flags. API base is same-origin / Vite proxy (no plan env on FE).

---

## 10. How to change safely

1. **New capability:** add feature key to `ALL_FEATURES` + disable sets; gate **BE and FE**; update this matrix.  
2. **Never** trust only `hasFeature` on the client.  
3. Changing query departments: update `QUERY_DEPARTMENT_CANONICAL` / aliases **and** `Queries.jsx`.  
4. After changing `CUSTOMER_PLAN` or `tenants.plan`, re-login and hit a gated API (expect 403 vs 200).  
5. Org Admin bypass is intentional for panels — do not “fix” plan by logging in as Admin.  
6. Shared modules (`hr_employee_accounts`, `account_for_client`) intentionally skip full Accounts panel — don’t wrap them only in `account_panel`.  
7. Align `tenants.plan` with env until request-time `has_feature` reads JWT `tenant_id`.  
8. ITAM/geo flags are **orthogonal** to subscription plan — enterprise without `ITAM_*=1` still has legacy IT paths only.

---

## 11. Related modules

| # | Topic |
|---|--------|
| 01 | Architecture overview + starter env |
| 02 | Login payload / session |
| 06 / 09 / 14 | Panel-specific feature uses |
| 12 | Query department plan gates |
| 16 | `tenants.plan`, Customers UI |
| 17 | Schedulers (not plan-gated) |

Aliases & shared terms: [ZZ-GLOSSARY](./ZZ-GLOSSARY.md).

---

## Checklist

- [ ] Sold plan matches `tenants.plan` and/or `CUSTOMER_PLAN`  
- [ ] New feature in `ALL_FEATURES` + disable sets + BE + FE  
- [ ] Query targets match plan (basic HR-only / essential HR+Accounts / enterprise all)  
- [ ] Org Admin not used to validate plan restrictions  
- [ ] Customer instances: `SHOW_DEPLOYMENT_GUIDE=0`  
- [ ] Silo provision only with explicit legacy flags  
- [ ] ITAM/geo flags reviewed separately from plan  
- [ ] After plan change: re-login + API smoke on one gated and one ungated route  
