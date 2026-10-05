# 02 — Auth & session

**Audience:** developers changing login, JWT, idle timeout, sensitive payslip/tax unlock, or anything that depends on `Authorization: Bearer`.  
**Blueprint:** `website/auth.py` → URL prefix **`/api/auth`**  
**Related:** [01-ARCHITECTURE](./01-ARCHITECTURE.md) · [00-INDEX](./00-INDEX.md) · tenancy helpers in `tenant_context.py`

> **Scope of this doc:** identity, OTP login, JWT lifecycle, session refresh, sensitive OTP, login gates.  
> Routes that happen to live on the same blueprint but belong elsewhere are listed in §11 (punch → module 03, tax-self → module 10, profile saves → module 03/HR).

---

## 1. Purpose

Auth answers:

1. Who is this person? (`admins` row)  
2. May they log in right now? (`admin_login_allowed`)  
3. What JWT do we give them? (`sub` = admin id + claims)  
4. How long may they stay idle? (15 vs 60 minutes by `emp_type`)  
5. How do they unlock payslip/tax after already being logged in? (second OTP → `X-Sensitive-Token`)

There is **no password login** in production path. Password endpoints return **410** and tell the client to use email OTP.

---

## 2. Roles who can access

| Actor | Auth behavior |
|-------|----------------|
| Any active employee | Email OTP login; JWT for SPA |
| Exited employee | Login only if `exit_login_until` date is still ≥ today |
| Inactive (`is_active=False`) | Blocked |
| HR / Accounts / IT / Inventory | Same login; **longer idle timeout** (60 min) |
| Everyone | Must complete **sensitive OTP** again for payslip/tax screens |

Panel access (HR/IT/Admin/…) is **not** decided only at login — it uses `emp_type` + plan features after the token exists (see modules 01 and 18).

---

## 3. Key tables / models

| Table / model | Role |
|---------------|------|
| `admins` (`Admin`) | Canonical user; `email`, `emp_type`, `mobile`, `is_active`, `is_exited`, `exit_login_until`, **`tenant_id`** |
| `otps` (`OTP`) | One-time codes; `channel` = `email` (login) or `sensitive` (payslip/tax); stores **hash**, not plaintext |
| `tenants` | Plan/tenant registry; login resolves `tenant_id` for JWT (Phase 1) |

OTP row fields that matter:

- `identifier` — normalized email  
- `otp_hash` — SHA-256 of code  
- `expires_at`, `is_used`, `attempts`, `admin_id`

---

## 4. Business rules & edge cases

### 4.1 Login channel

- **Email only** today. Phone/SMS detection exists but returns **501** (“coming soon”).  
- Identifier is whitespace-stripped; DB email match ignores spaces inside stored emails.

### 4.2 OTP constants (`auth.py`)

| Constant | Value | Meaning |
|----------|-------|---------|
| `OTP_TTL_MINUTES` | 5 | Login + sensitive OTP lifetime |
| `OTP_MAX_ATTEMPTS` | 5 | Wrong codes then OTP invalidated |
| `OTP_RESEND_SECONDS` | 60 | Cooldown for **sensitive** resend |
| `VERIFY_OTP_IP_LIMIT_PER_HOUR` | 30 | Rate limit verify-otp by IP |
| `SENSITIVE_OTP_IP_LIMIT_PER_HOUR` | 10 | Sensitive request by IP |
| `SENSITIVE_OTP_USER_LIMIT_PER_DAY` | 20 | Sensitive request by user |

### 4.3 Who may authenticate (`admin_login_allowed`)

```text
is_active == False     → deny
not exited             → allow
exited + exit_login_until >= today → allow (grace)
else                   → deny
```

Used on: request-otp, verify-otp, session/refresh.

### 4.4 JWT claims (access token)

Issued by `_issue_login_token(admin)`:

| Claim / field | Source |
|---------------|--------|
| `sub` (identity) | `str(admin.id)` |
| `email` | trimmed admin email |
| `emp_type` | `admin.emp_type` |
| `tenant_id` | `tenant_id_for_admin(admin)` → default **1** |
| `exp` / `iat` / … | Flask-JWT-Extended |

Response body also includes:

```json
{
  "success": true,
  "token": "<jwt>",
  "session_timeout_minutes": 15,
  "tenant_id": 1,
  "plan": "enterprise",
  "plan_label": "Enterprise",
  "features": ["hr_panel", "..."]
}
```

`plan` / `features` come from `plan_payload(tenant_id=…)` (tenant plan preferred over `CUSTOMER_PLAN`).

### 4.5 Idle / session timeout

Backend (`session_timeout.py`) and frontend (`utils/sessionTimeout.js`) must stay aligned:

| emp_type (normalized) | Idle / JWT lifetime |
|-----------------------|---------------------|
| hr, human resource(s), account(s), accountant, it, it department, inventory | **60 minutes** |
| Everyone else (incl. Admin, Manager, staff) | **15 minutes** |

Frontend:

- Stores `lastActivityAt` in `localStorage`  
- On activity, throttled `POST /api/auth/session/refresh` (every **2 minutes** max) to slide JWT  
- If idle past timeout → clear token → redirect `/`

### 4.6 Sensitive session (payslip / tax)

- Requires existing login JWT.  
- Second OTP (`channel=sensitive`) → short-lived **`sensitive_token`** in **sessionStorage** (not localStorage).  
- Client sends header: `X-Sensitive-Token: …` via `authHeaders()` in `sensitiveDataAuth.js`.  
- UI gate: `SensitiveDataGate` on payslip/tax routes.  
- Server can return `code: SENSITIVE_AUTH_REQUIRED` when token missing/expired.

### 4.7 Deprecated password APIs

| Endpoint | Status |
|----------|--------|
| `POST /api/auth/validate-user` | **410** — use OTP |
| `POST /api/auth/set-password` | **410** — passwords removed |

Public route `/set-password` still exists in the SPA but the API refuses password set.

---

## 5. API catalog (auth / session)

Base URL: **`/api/auth`**

Auth column: **Public** = no JWT · **JWT** = `@jwt_required()`

### 5.1 Login OTP

#### `POST /request-otp` — Public

Send login OTP email.

**Body:**

```json
{ "identifier": "user@company.com" }
```

(`email` alias accepted.)

**Success 200:**

```json
{
  "success": true,
  "channel": "email",
  "message": "OTP sent to us***@company.com. …",
  "expires_in": 300,
  "resend_after": 0
}
```

**Errors:**

| Status | When |
|--------|------|
| 400 | Missing / invalid email format |
| 404 | No admin with that email |
| 403 | Inactive / exited without grace |
| 501 | Phone identifier (SMS not enabled) |

Invalidates previous unused email OTPs for that identifier before creating a new one. Emails via `send_login_otp_email`.

---

#### `POST /verify-otp` — Public (rate-limited)

Verify login OTP → issue JWT.

**Body:**

```json
{ "identifier": "user@company.com", "otp": "123456" }
```

**Success 200:** `_issue_login_token` payload (token + plan + tenant_id + session_timeout_minutes).

**Errors:**

| Status | When |
|--------|------|
| 400 | Missing fields, bad OTP format, no active OTP, expired, wrong code |
| 403 | Login not allowed |
| 404 | Account missing |
| 429 / rate-limit body | Too many verifies from IP |
| 501 | SMS channel |

On success, OTP row marked `is_used=True`.

---

#### `POST /session/refresh` — JWT

Re-issue token while user is active (idle policy).

**Headers:** `Authorization: Bearer <token>`  
**Body:** empty / ignored  

**Success 200:** same shape as verify-otp (`_issue_login_token`).  
**401/403/404:** invalid identity, inactive, missing admin.

Frontend: `refreshSessionToken()` in `utils/sessionTimeout.js`.

---

### 5.2 Sensitive OTP (payslip / tax unlock)

#### `POST /sensitive/request-otp` — JWT

**Body:** `{}`  

**Success 200:** message + `expires_in` + `resend_after` (60s).  
**Rate limits:** IP + per-user daily.  
**400:** no email on account; too-soon resend (`retry_after`).

#### `POST /sensitive/verify-otp` (alias `/sensitive/verify`) — JWT

**Body:** `{ "otp": "123456" }`  

**Success 200:** includes `sensitive_token`, `expires_in` (from `sensitive_session_payload`).  

#### `POST /sensitive/revoke` — JWT

Client-side clear symmetry; returns `{ "success": true }`. Real revoke is clearing sessionStorage.

---

### 5.3 Deprecated

| Method | Path | Response |
|--------|------|----------|
| POST | `/validate-user` | 410 + `use_otp: true` |
| POST | `/set-password` | 410 + `use_otp: true` |

---

### 5.4 Shared helpers often called after login

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/employee/homepage` | JWT | Shell data for `UserContext` (user, punch summary, leave balances, managers, …). Failures: 401/500. |
| GET | `/master-options` | JWT | Departments + circles for dropdowns; departments filtered by plan for queries. |
| GET | `/news-feed` | JWT | Dashboard news (posts, birthdays, anniversaries of the caller's company only). |

Full homepage / profile field catalog → module **03** (employee shell) when written; do not treat homepage as “login only.”

---

## 6. Main flows

### 6.1 Email OTP login

```text
HeroSection (HomePage)
  → POST /request-otp { identifier }
  → user reads email
  → POST /verify-otp { identifier, otp }
  → localStorage.token = data.token
  → localStorage.lastActivityAt = now
  → setPlanContext(plan, features)
  → refreshUserData (GET /employee/homepage)
  → navigate /dashboard
```

### 6.2 Idle session slide

```text
User clicks / types / scrolls (AppLayout)
  → update lastActivityAt
  → every ≥2 min: POST /session/refresh
  → replace localStorage.token
Timer: if now - lastActivityAt > idleMs(emp_type)
  → clear token + sensitive + plan context → /
```

### 6.3 Sensitive unlock

```text
Open /payslip or /tax-declaration*
  → SensitiveDataGate
  → POST /sensitive/request-otp
  → POST /sensitive/verify-otp
  → sessionStorage sensitive_token
  → subsequent APIs: Authorization + X-Sensitive-Token
```

### 6.4 Token identity resolution on server

Most routes use `get_jwt_identity()` → `admin.id`.  
Some resolve by claim email first (`_resolve_jwt_admin` for sensitive).  
**Never** trust a client-posted `admin_id` for “who am I.”

---

## 7. Frontend map

| File | Responsibility |
|------|----------------|
| `pages/HeroSection.jsx` | Login UI: request-otp / verify-otp |
| `pages/HomePage.jsx` | Landing hosting hero login |
| `pages/SetPassword.jsx` | Legacy page; API returns 410 |
| `components/layout/AppLayout.jsx` | Requires token; idle check; session refresh; panel redirects |
| `components/layout/UserContext.jsx` | Loads homepage after login |
| `utils/sessionTimeout.js` | Idle ms + refreshSessionToken + JWT parse helpers |
| `utils/sensitiveDataAuth.js` | Sensitive token storage + headers |
| `utils/planFeatures.js` | Stores plan/features from login response |
| `components/security/SensitiveDataGate.jsx` | Blocks payslip/tax until sensitive OTP |
| `components/security/RequirePanel.jsx` | Panel gates using emp_type + features |

**Storage keys:**

| Key | Where | Purpose |
|-----|-------|---------|
| `token` | localStorage | Access JWT |
| `lastActivityAt` | localStorage | Idle clock |
| `sensitive_token` / `sensitive_token_expires` | sessionStorage | Payslip/tax unlock |
| plan/features keys | via `planFeatures` utils | UI gating |

---

## 8. Jobs / schedulers

None specific to issuing OTP/JWT. Offboarding may clear expired `exit_login_until` elsewhere (module 06 / 17).

---

## 9. Config / `.env`

| Variable | Effect on auth |
|----------|----------------|
| `JWT_SECRET_KEY` | Signs access tokens (required in prod) |
| `SECRET_KEY` | Flask secret |
| `ZEPTO_*` | Sending login / sensitive OTP emails |
| `CUSTOMER_PLAN` | Fallback plan in login payload if tenant plan missing |
| `CORS_ORIGINS` | Must include SPA origin or browser blocks `/api/auth/*` |

OTP TTLs are **code constants**, not env (change in `auth.py` if needed).

---

## 10. How to change safely

1. **Changing claims** — update `_issue_login_token` **and** any frontend that reads JWT (`empTypeFromToken`, tenant checks). Old tokens lack new claims until refresh/login.  
2. **Timeout policy** — change **both** `session_timeout.py` and `sessionTimeout.js`.  
3. **Do not re-enable password login** without a full security review; clients already assume OTP.  
4. **OTP hashing** — always store hash; never log plaintext OTP in production logs.  
5. **Login allow rules** — keep using `admin_login_allowed`; don’t invent a second exit check only in the UI.  
6. **Sensitive vs login OTP** — different `channel` values; don’t mix rows.  
7. **Tenant** — authorization must use JWT `tenant_id` / DB `admins.tenant_id`, never a body field.  
8. **Rate limits** — if login is abused, tune constants near the top of the OTP section in `auth.py`.

---

## 11. Same blueprint, other handbook modules

These are registered on `/api/auth` but documented elsewhere:

| Area | Paths (prefix `/api/auth`) | Handbook |
|------|----------------------------|----------|
| Punch / geo | `/employee/punch-in`, `/punch-out`, `/location-check`, `/geo/client-config` | **03** |
| Tax / Form16 / TDS (employee self) | `/tax-declaration/*`, `/form16/*`, `/tds/*` | **10** |
| Profile / education / docs | `/employee/profile`, `/employee`, `/education*`, `/upload-*`, `/policies/*` | **03** / HR |
| Pincode helper | `/pincode/<pincode>` | Profile utils |

When adding a **new login concern**, keep it near the OTP/JWT section. When adding employee self-service that is not identity, prefer the domain blueprint (`leave`, `HumanResource`, …) unless there is a strong reason to stay on `auth`.

---

## 12. Related modules

| Module | Link |
|--------|------|
| Architecture | [01-ARCHITECTURE](./01-ARCHITECTURE.md) |
| Punch & geo | 03 (next after auth) |
| Admin / tenancy | 16 |
| Plans & env | 18 |
| Shared-DB design | [../SHARED_DB_MULTI_TENANCY.md](../SHARED_DB_MULTI_TENANCY.md) |

---

## 13. Quick test checklist (auth)

- [ ] Request OTP with valid email → mail received within TTL  
- [ ] Verify OTP → JWT has `email`, `emp_type`, `tenant_id`  
- [ ] Login response includes `plan` / `features`  
- [ ] Inactive / exited (no grace) → 403  
- [ ] Activity keeps session; idle past timeout → redirected to `/`  
- [ ] `/session/refresh` with valid token returns new token  
- [ ] Sensitive OTP unlocks payslip; revoke/clear blocks again  
- [ ] `validate-user` / `set-password` return 410  
