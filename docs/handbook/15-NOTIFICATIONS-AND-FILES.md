# 15 — Notifications & files

**Audience:** developers changing in-app alerts, unread badges, private upload delivery, or signed/JWT file URLs.  
**Notifications:** `website/notifications.py` → **`/api/notifications`**  
**Shared files:** `website/files.py` → **`/api/files`** + `secure_file_service.py`  
**Also:** domain download routes (Accounts `/file/`, query/claim/day-use, gated `/static/uploads/`)  
**UI:** Headers badge, `useFloatingNotifications`, `secureFileUrl.js`, `openBlobFile.js`, `SensitiveDataGate`  
**Related:** [12 Queries](./12-QUERIES.md) · [14 IT day-use](./14-IT-ITAM.md) · [09 Accounts](./09-ACCOUNTS.md) · [10 Tax](./10-TAX-DECLARATION.md) · [02 Auth](./02-AUTH-AND-SESSION.md) · [ATTENDANCE_SSE.md](../ATTENDANCE_SSE.md)

> In-app **Notification** rows ≠ email ≠ attendance **SSE**. Three different channels.

---

## 1. Purpose

1. **In-app notifications** — DB inbox for badges/toasts (mainly `query` + `daily_checkout`)  
2. **Private file delivery** — JWT and/or HMAC-signed URLs; never anonymous `/static/uploads`  
3. **Sensitive salary/tax docs** — same OTP gate as Payslip/Tax routes (`require_sensitive_for_employee`)  
4. **Domain-specific downloads** — query attachments, claim receipts, day-use PDFs, leave letters  

Email (`email.py` / Zepto) remains the out-of-band channel for leave, claims, probation, etc. Most of those do **not** write `Notification` rows.

---

## 2. Roles

| Actor | Notifications | Files |
|-------|---------------|-------|
| Employee | Query replies/close; own day-use events | Own profile/KYC; own payslip/form16/tax (after sensitive OTP); own query files; day-use docs if requester |
| Dept inbox staff | Query unread badge | Query attachments via query file route |
| Manager | Mostly **email** for leave/claims (not Notification rows) | Claim line files via `/api/manager/.../files/` |
| IT / Inventory | `daily_checkout` notifs | Day-use docs; privileged prefixes |
| Privileged (HR / Accounts / Admin / IT panel) | As recipients when listed | Broader `authorize_upload_access` |

---

## 3. Key tables / storage

| Asset | Role |
|-------|------|
| `notifications` / `Notification` | `recipient_admin_id`, `notif_type`, `title`, `body`, `entity_type`, `entity_id`, `is_read`, `created_at` |
| Disk under `UPLOADS_ROOT` (or `backend_HRMS/uploads`) | Private files; prefixes like `payslips/`, `form16/`, `tax_declarations/`, `expenses/`, `queries/`, `daily_checkout/`, `profile/`, `signatures/`. New files of every writer go under `tenants/{owner company id}/<same prefix>/…` (same root as before); older files keep the bare prefix |
| Domain tables | Ownership for auth (PaySlip, Form16, Query.photo, claim `Attach_file`, …) |

### Cited strings

| Field | Values in use |
|-------|----------------|
| `notif_type` | `"query"` (default), `"daily_checkout"` |
| `entity_type` | `"query"`, `"daily_checkout"` |
| `entity_id` | Query id or day-use request id |

---

## 4. Business rules

### 4.1 Notification producers

| Event | Recipients | Also email? |
|-------|------------|-------------|
| Query created | Department staff (`_department_recipients`, exclude creator) | Yes (`notify_query_event` created) |
| Dept reply | Query owner | No (in-app only) |
| Employee reply | Department staff | No |
| Query closed | Owner (skip if actor is owner) | Yes |
| Day-use create / return-request / overdue | IT/inventory staff (`notify_it_staff`) | Outbox / email path |

Always scoped to `recipient_admin_id` of the target admin. List/mark-read only for current JWT user.

**Company (tenant) scope:** notifications are per recipient, so they never cross companies once the producer picks the right people. Query and Day-use producers only pick department / IT staff of the query's (request's) company; the query inbox badge (`query_unread_count` / `query_new_count`) only counts the caller's company's queries.

### 4.2 Unread counts

`GET /unread-count`:

| Field | Meaning |
|-------|---------|
| `unread_count` | All unread rows for the user |
| `query_unread_count` / `query_new_count` | Via `count_department_query_unread` (inbox badge) |

Header Query shortcut typically shows **query** unread, not total.

### 4.3 Mark-read

`POST /mark-read` body: `ids` **or** `all=true` (optional `type` filter).  
Per-query: `POST /api/query/queries/<id>/mark-read` (module **12**).

### 4.4 File access channels

| Channel | When |
|---------|------|
| `GET /api/files/content/<rel>` | JWT + `authorize_upload_access` |
| `GET /api/files/signed/<rel>?exp=&sig=` | HMAC only (img tags without Authorization) |
| `POST /api/files/sign` | Mint signed URL |
| `GET /api/files/resolve?path=` | Legacy static path → signed URL |
| `GET /api/accounts/file/<rel>` | Accounts; mirrors payslip/form16/tax rules |
| Domain routes | Query / manager claim / day-use documents / leave letters |
| `GET /static/uploads/<path>` | Proxied to Flask `serve_upload_with_request_auth` — **nginx must not serve disk directly** |

Anonymous static access is blocked.

### 4.5 Prefix rules (`authorize_upload_access`)

**Company check first:** `upload_in_admin_tenant()` (`upload_tenancy.py`) denies any file owned by another company — for every role, including privileged — before the rules below. Ownership: `tenants/{id}/…` folder, else traced from the record (payslip/Form 16 row, tax declaration, signature/profile owner, Day-use request, NOC, expense line, query attachment, asset, policy, ex-employee share, news post); untraceable files belong to tenant 1. Accounts `/file/` applies the same check (404). Prefix rules then run on the path inside `tenants/{id}/`; payslip / Form 16 row lookups use the full stored key (`tenants/2/payslips/…`), in `authorize_upload_access`, `/api/files/content` and Accounts `/file/` alike.

| Prefix | Rule |
|--------|------|
| `payslips/`, `form16/`, `tax_declarations/` | Owner or privileged + **sensitive OTP** |
| `signatures/`, `daily_checkout/` | Owner or privileged |
| Profile KYC (`profile/...` docs) | Owner or privileged |
| Profile photos | Any logged-in user of the same company (org directory) |
| `expenses/` | Privileged always; authenticated users who already know the path (managers via UI) |
| `queries/` | Prefer **query file route**; generic serve restricted |

### 4.6 Sensitive OTP overlap

Payslip / Form16 / tax paths need **both**:

1. SPA `SensitiveDataGate` (route unlock)  
2. Server `require_sensitive_for_employee` on file serve  

### 4.7 Not attendance SSE

`GET /api/attendance/events` is real-time punch updates ([ATTENDANCE_SSE.md](../ATTENDANCE_SSE.md)). It does **not** use the `notifications` table. SSE failures never roll back attendance writes.

---

## 5. API catalog

### 5.1 `/api/notifications`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` or `` | List; `?type=&limit=` (default 20). Prefer **trailing slash** `/api/notifications/` — redirect can drop `Authorization` |
| GET | `/unread-count` | Totals above |
| POST | `/mark-read` | `ids` or `all` (+ optional `type`) |

### 5.2 `/api/files`

| Method | Path | Auth |
|--------|------|------|
| GET | `/content/<rel>` | JWT + authorize (+ sensitive when needed) |
| GET | `/signed/<rel>` | Valid `exp` + `sig` |
| POST | `/sign` | JWT → mint signed URL |
| GET | `/resolve` | JWT → legacy path → signed URL |

### 5.3 Other download APIs (pointers)

| Area | Route |
|------|-------|
| Accounts | `GET /api/accounts/file/<rel>` |
| Query | `GET /api/query/queries/<id>/files/<filename>` |
| Claims | `GET /api/manager/claim-requests/<id>/files/<line_item_id>` |
| Day-use | `GET /api/it/daily-checkout/requests/<id>/documents/<doc_type>` |
| Leave letters / NOC / attendance Excel | `/api/leave/...` (own/generated) |

---

## 6. Main flows

### 6.1 Query alert

```text
Create/reply/close
  → Notification row(s) + optional email
  → Headers poll /unread-count
  → Open inbox / chat → mark-read
```

### 6.2 Login toasts

```text
AppLayout → useFloatingNotifications
  → GET /api/notifications/?limit=15
  → toast up to 3 unread where type !== "query"
```

Query replies intentionally skip login toasts (header + chat badges instead).

### 6.3 Open a private file

```text
secureFileUrl / openBlobFile
  → payslip|form16|tax_* → Accounts /file/ or /api/files/content/
  → Authorization header (or signed URL for <img>)
  → blob open/download (popup-safe)
```

Cache-bust with `withFileCacheBust` (`_=`), **not** `?t=` on signed URLs (breaks HMAC).

---

## 7. Frontend map

| Piece | Location | Role |
|-------|----------|------|
| Header badge | `Headers.jsx` | Poll unread ~30s; Query shortcut |
| Login toasts | `useFloatingNotifications.js` | Non-query unread |
| Toast util | `utils/notify.js` | UI notifications (not DB) |
| Mark-read | `Queries.jsx`, `DepartmentQueryInbox.jsx` | + `queryNotificationsUpdated` |
| URL helpers | `secureFileUrl.js` | content / Accounts / signed / cache-bust |
| Blob open | `openBlobFile.js` | Auth fetch → blob |
| Sensitive gate | `SensitiveDataGate.jsx` | Payslip/tax routes |
| Payslip DL | `Payslip.jsx` | Direct Accounts `/file/` |
| Manager claims | `ManagerClaimDetails.jsx` | Manager file API |

---

## 8. Jobs

**No** scheduler dedicated to the `notifications` table.

| Job | Effect |
|-----|--------|
| `daily_checkout_jobs` → overdue | Creates `notif_type="daily_checkout"` (+ emails) |
| Probation / leave reminders / etc. | **Email only** |

**One-off: move legacy uploads into `tenants/{id}/`** (`upload_relocation.py`, not scheduled):

| Command | Effect |
|---------|--------|
| `flask uploads-relocate` | Dry run: rows / files / bytes per kind and what is skipped (`--kind`, `--tenant`, `--list-kinds`) |
| `flask uploads-relocate --apply` | Copies each file next to itself (same root) under `tenants/{owner}/`, SHA-256 check, updates rows in one transaction; old files kept; writes a manifest to `instance/upload_relocation/` |
| `flask uploads-relocate-cleanup MANIFEST [--apply]` | Deletes an old file only if every copy is identical and no row still uses it |
| `flask uploads-relocate-rollback MANIFEST [--apply]` | Before cleanup: rows back to old keys, copies removed |

Owner = the company `upload_tenancy` already traces, so access does not change. Skipped (left as is): untraceable owner, missing file, different file at the new path, new key too long for the column. Query attachments move folder only (`Query.photo` keeps bare names). Family photo filenames (`family_details.photo_filename`) move when a matching file is on disk. IT photos are not files until the next upload (older rows still store the image data itself). Back up DB + upload folders first. Until cleanup, an old path with no row left is still served to the company whose `tenants/{id}/` copy exists (to neither company when more than one copy exists).

---

## 9. Config

| Key | Role |
|-----|------|
| `UPLOADS_ROOT` | Absolute private uploads root (prod) |
| `FILE_SIGN_TTL_SECONDS` | Signed URL TTL (default **3600**) |
| `JWT_SECRET_KEY` / `SECRET_KEY` | HMAC for file signatures |
| `ZEPTO_*` / `EMAIL_*` | Out-of-band email |
| nginx | Proxy `/static/uploads/` to Flask; SSE path buffering off ([ATTENDANCE_SSE.md](../ATTENDANCE_SSE.md)) |

---

## 10. How to change safely

1. Always use trailing slash on `GET /api/notifications/` from the browser (redirect drops Authorization).  
2. Do not cache-bust signed URLs with `?t=` — use `withFileCacheBust`.  
3. Prefer domain download routes for queries/claims; don’t loosen `queries/` on generic `/api/files`.  
4. Changing `notif_type` / `entity_type` literals breaks badge filters and login toast filtering.  
5. Keep Accounts `/file/` rules in parity with `authorize_upload_access` for payslip/form16/tax.  
6. Sensitive: UI gate alone is not enough — server must still call `require_sensitive_for_employee`.  
7. Never instruct nginx to serve upload directories as static files.  
8. Do not conflate Notification rows with attendance SSE.
9. New upload writers: use `tenant_upload_path(root, "<folder>/<name>", owner_tenant_id)` (returns the absolute path and the `tenants/{id}/…` key to store). Pass the **owner's** company (employee / requester / invite), not the uploader's, and keep reader folder checks on the path inside `tenants/{id}/` (`split_tenant_rel`). Otherwise the file is treated as tenant 1 and other companies cannot open their own uploads. Tests: `tests/test_shared_db_multitenancy_uploads.py`.

---

## 11. Related modules

| # | Boundary |
|---|----------|
| 12 | Primary `"query"` producer + query file route |
| 14 | `"daily_checkout"` notifs + PDFs |
| 09 / 10 | Payslip / Form16 / tax URLs + OTP |
| 11 | Expense receipts + manager file route |
| 02 | JWT + sensitive session |
| 03 / 08 | Attendance SSE (orthogonal) |

```text
notifications.py
models/notification.py
files.py
secure_file_service.py
sensitive_data_auth.py
email.py                          # parallel channel
frontend: Headers, useFloatingNotifications, secureFileUrl, openBlobFile
```

---

## 12. Quick test checklist

- [ ] `GET /api/notifications/` with Bearer works; without trailing slash may 401 after redirect  
- [ ] Query create → dept staff get unread; badge shows `query_unread_count`  
- [ ] Mark-read clears badge; per-query mark-read works from chat  
- [ ] Login toasts show day-use unread, not query replies  
- [ ] Payslip file without sensitive OTP → denied; after OTP → OK  
- [ ] Signed URL works in `<img>`; expired/tampered `sig` → denied  
- [ ] Anonymous `/static/uploads/...` blocked  
- [ ] Query attachment only via query file route for non-privileged  
- [ ] Manager can open claim receipt for team member; stranger cannot  
- [ ] Cache-bust does not invalidate signed HMAC  
- [ ] HR/Accounts of company B → 403 on company A's payslip/NOC/claim path via `/api/files/*`, 404 via `/api/accounts/file/*`
- [ ] Company B emails (HR CC, IT/Accounts mailboxes) go to `tenants.mailbox_*` of company B, never to the `.env` mailboxes (`company_mailbox`, module **17** §4.7)  
- [ ] After `flask uploads-relocate --apply`: employees still open their payslip / Form 16 / claim receipt / photo; re-running the dry run shows 0 rows and 0 files (tests: `test_shared_db_multitenancy_upload_relocation.py`)  
