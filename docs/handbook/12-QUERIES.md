# 12 — Queries (employee ticketing)

**Audience:** developers changing raise-a-query, department inbox chat, plan-gated departments, attachments, or query notifications.  
**Blueprint:** `website/query.py` → **`/api/query`**  
**Models:** `website/models/query.py` — `Query`, `QueryReply`  
**UI:** `/queries`, `/queries/inbox`, IT Open Tickets, `/admin/queries`  
**Related:** [15 Notifications](./15-NOTIFICATIONS-AND-FILES.md) (planned) · [18 Plans](./18-PLANS-FEATURES-ENV.md) (planned) · [06 HR](./06-HR-CORE.md) (Update Manager co-located APIs) · [14 IT](./14-IT-ITAM.md) (planned)

> Manager contact CRUD also lives on this blueprint (`/api/query/api/managers/*`) for historical reasons — ticketing rules below; manager mapping is module **05** / **06**.

---

## 1. Purpose

Internal support tickets:

1. Employee **raises** a query to Human Resource / IT / Accounts (plan-gated)  
2. Multi-dept raise creates **one `Query` row per department** (shared attachment filenames)  
3. Department staff use an **inbox** to reply as `DEPARTMENT` and close  
4. Chat-style replies flip status `New` → `Open`; close → `Closed` (terminal)  
5. In-app notifications + email on create/close  

Attachments are filenames in `Query.photo` (JSON text) + files on disk under `uploads/tenants/{owner company}/queries` (older files: `uploads/queries`; downloads check both) — **no** attachment child table.

---

## 2. Roles

| Actor | Can |
|-------|-----|
| Employee (owner) | Create; list `my`; reply as `EMPLOYEE`; close own; mark-read; download own files |
| Department staff | Inbox for their dept; reply as `DEPARTMENT`; close if `_department_staff_can_close` |
| Org admin | Access any inbox via `_can_access_inbox_department` |
| Role shortcuts | HR / Accounts / IT emp_type aliases → matching inbox |
| Org Admin panel | Read-only `GET /api/admin/queries*` (not on query blueprint) |

**Access helpers:** `_can_access_query` (owner **or** matching inbox dept), `_resolve_department_for_inbox`, `_query_belongs_to_inbox`.

**Reply `user_type`:** `"DEPARTMENT"` if inbox dept resolved for viewer, else `"EMPLOYEE"`.

**Reopen:** **No API** — `Closed` is terminal. UI disables reply input when Closed; server currently does **not** reject replies on Closed (UI-only guard).

---

## 3. Key tables / models

| Model | Table | Role |
|-------|-------|------|
| `Query` | `queries` | `title`, `department`, `query_text`, `status` (default `New`), `photo` (JSON filename list), `admin_id`, `created_at` |
| `QueryReply` | `query_replies` | `reply_text`, `user_type` (`EMPLOYEE` \| `DEPARTMENT`), `admin_id`, `query_id` |
| `Notification` | `notifications` | `notif_type="query"`, `entity_type="query"`, `entity_id` |
| `ManagerContact` | — | Updated via co-located `/api/managers/*` routes (not ticket data) |

### Status strings (stored)

| Status | Meaning | UI label |
|--------|---------|----------|
| `New` | Just raised | New |
| `Open` | At least one reply | **In Progress** |
| `Closed` | Closed by owner or dept | Closed |

---

## 4. Business rules

### 4.1 Raise targets & plan gates

Canonical raise departments (`QUERY_DEPARTMENT_CANONICAL`):

`Human Resource` · `IT` · `Accounts`

| Plan features | Employee may raise to |
|---------------|----------------------|
| (neither — Basic) | **Human Resource** only |
| `query_hr_and_accounts` (Essential) | HR + Accounts |
| `query_all_departments` (Enterprise) | HR + IT + Accounts |

`is_allowed_query_department` / `filter_query_departments` / `canonical_query_department` in `plan_features.py`.  
Invalid or plan-forbidden dept → **400** or plan forbidden response.

**Inventory** staff use the **IT** inbox; Inventory is **not** a raise target.

### 4.2 Create

`POST /queries` (multipart or JSON):

- Requires `title`, `query_text`, ≥1 department  
- Multi-dept → one row per canonical dept; shared saved filenames in each row’s `photo`  
- Files: max **2MB** each (`MAX_FILE_SIZE_BYTES`); UUID-prefixed `secure_filename` under upload dir  
- Status starts `New`  
- `notify_query_event(..., "created")` + in-app notifs to `_department_recipients`

### 4.3 Reply / close

| Action | Rule |
|--------|------|
| Reply | `_can_access_query`; if status `New` → set `Open`; notify owner (dept reply) or dept staff (employee reply) |
| Close | Owner **or** `_department_staff_can_close` (hr/accounts/engineering/it/inventory/admin aliases); already Closed → no-op/error path; emails via `notify_query_event("closed")` / `send_query_closed_email` |

### 4.4 Inbox listing

| Endpoint | Audience |
|----------|----------|
| `GET /queries` | Viewer’s resolved inbox; optional `?department=&month=&circle=` |
| `GET /queries/it-inbox` | IT inbox only (Open Tickets page) |
| `GET /queries/my` | Owner’s tickets (paginated) |

Closed queries typically sorted after open ones in UI.

### 4.4a Company (tenant) scope

A query belongs to its **owner's company** (`Query.admin_id` → `Admin.tenant_id`).
`_tenant_queries()` / `_get_tenant_query()` in `query.py` apply it:

- Department inboxes, unread badges and "new query" notification recipients only include the caller's company.
- Details, reply, close, mark-read and attachment download for another company's query → **404** (checked before the 403 department rules).
- `_can_access_query` also rejects department staff of another company.

### 4.5 Email quirks

| Event | Routing (as implemented) |
|-------|--------------------------|
| Created | HR → `ZEPTO_CC_HR`; otherwise → `ZEPTO_CC_ACCOUNT` (**IT created mail also uses Accounts CC today**, not `ZEPTO_CC_IT`) |
| Closed | `get_department_email` → `EMAIL_HR` / `EMAIL_ACCOUNTS` / `EMAIL_IT` / `EMAIL_ADMIN` |
| Company | All these keys resolve per company via `company_mailbox(key)`: `tenants.mailbox_*`, else `.env` for tenant 1 only (module **17** §4.7) |
| Replied | `notify_query_event(action="replied")` exists in docs/signature but is **not called** from reply path |

---

## 5. API catalog

Prefix: **`/api/query`**. All ticketing routes: **`@jwt_required()`**.

### 5.1 Ticketing

| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| POST | `/queries` | `create_query_api` | Multipart `files` + departments |
| GET | `/queries/my` | `my_queries` | Owner list |
| GET | `/queries` | `department_queries` | Inbox |
| GET | `/queries/it-inbox` | `it_department_queries` | IT only |
| GET | `/queries/<id>` | `query_details` | Owner or inbox |
| POST | `/queries/<id>/reply` | `reply_query` | Body `{ reply_text }` → New→Open |
| POST | `/queries/<id>/close` | `close_query_api` | Owner or closable staff |
| POST | `/queries/<id>/mark-read` | `mark_query_notifications_read` | Clear unread |
| GET | `/queries/<id>/files/<filename>` | `download_query_file` | Allow-listed filename |

Errors: **400** validation; **403** unauthorized; **404** missing user/query.

### 5.2 Co-located manager APIs (HR Update Manager)

Mounted oddly as **`/api/query/api/managers/...`** (blueprint prefix + route path):

| Method | Path (full) | Purpose |
|--------|-------------|---------|
| GET | `/api/query/api/managers/employees` | Employee picker |
| GET | `/api/query/api/managers/search` | Search managers |
| GET/POST | `/api/query/api/managers/contact` | Get / upsert `ManagerContact` |

Frontend: `UpdateManager.jsx` with `API_BASE = '/api/query'`. Deep behavior → modules **05** / **06**.

### 5.3 Related other blueprints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/admin/queries`, `/api/admin/queries/<id>` | Org-wide read |
| GET | `/api/auth/master-options` | Departments filtered by `filter_query_departments` |
| GET | `/api/notifications/unread-count` | Includes query unread |

---

## 6. Main flows

### 6.1 Raise

```text
Queries.jsx form
  → POST /api/query/queries (title, depts, text, files)
  → Query row(s) status=New
  → email + in-app to department recipients
```

### 6.2 Employee chat

```text
GET /queries/my → open chat GET /queries/<id>
  → POST reply | close | mark-read
  → multi-dept groups via groupMyQueriesForHistory (frontend)
```

### 6.3 Department inbox

```text
GET /queries (or /it-inbox)
  → reply as DEPARTMENT (New→Open, notify owner)
  → close → emails + Closed
```

### 6.4 Badges

Unread `Notification` rows; `mark-read` clears; UI may emit `queryNotificationsUpdated`.

---

## 7. Frontend map

| UI | Route | API base |
|----|-------|----------|
| Raise + my history | `/queries` → `Queries.jsx` | `/api/query` |
| Department inbox | `/queries/inbox` → `DepartmentQueryInbox.jsx` | `/api/query` |
| IT Open Tickets | `/it/OpenTicket` → `OpenTicket.jsx` | `/api/query` (`it-inbox`) |
| Org Admin | `/admin/queries` → `AdminQueries.jsx` | `/api/admin/queries` |

Helpers: `queryChatHelpers.js` (poll intervals, chat query param, grouping).  
Also: `QueryChatModal.jsx`, `QueryChatAttachmentsBar.jsx`, `QueryListPagination.jsx`.

Keep frontend `QUERY_DEPARTMENT_CANONICAL` aligned with `plan_features.QUERY_DEPARTMENT_CANONICAL`.

---

## 8. Jobs / CLI

**None.** No query cron or Flask command. Legacy `_repair_query_created_at_from_history` may run opportunistically on list loads.

---

## 9. Config

| Key / asset | Role |
|-------------|------|
| `CUSTOMER_PLAN` → plan features | `query_hr_and_accounts`, `query_all_departments` |
| `ZEPTO_CC_HR`, `ZEPTO_CC_ACCOUNT`, `ZEPTO_CC_IT` | Create/close mail (IT CC underused on create) |
| `EMAIL_HR`, `EMAIL_ACCOUNTS`, `EMAIL_IT`, `EMAIL_ADMIN` | Close routing via `get_department_email` |
| Upload dir | Hardcoded `…/uploads` base (not generic `UPLOADS_ROOT`): new files `tenants/{id}/queries/`, legacy `queries/` |
| `MAX_FILE_SIZE_BYTES` | 2MB per file in `query.py` |

---

## 10. How to change safely

1. Keep status literals **`New` / `Open` / `Closed`** and `user_type` **`EMPLOYEE` / `DEPARTMENT`** — UI filters depend on them.  
2. Change raise targets in **both** `plan_features.py` and `Queries.jsx` / helpers.  
3. If adding reopen: new endpoint + clear Closed UI locks; today Closed is terminal.  
4. Prefer server-side reject of replies when Closed for parity with UI.  
5. Fix IT create email to use `ZEPTO_CC_IT` / `EMAIL_IT` if product expects it.  
6. Do not confuse manager `/api/query/api/managers/*` with ticketing.  
7. Attachments = **`photo` JSON + disk** — migrating to a child table needs download + create paths updated together.  
8. Tests: `tests/test_query_department_scope.py` for plan/dept scope.
9. New query lookups go through `_tenant_queries()` / `_get_tenant_query()` — never `Query.query.get(id)` — so another company's ticket stays a 404 (`tests/test_shared_db_multitenancy_queries_biometric_module.py`).

---

## 11. Related modules

| # | Boundary |
|---|----------|
| 15 | Notification unread counts / delivery |
| 18 | Plan feature flags for raise targets |
| 06 / 05 | Manager contact upsert used by HR Update Manager |
| 14 | IT Open Tickets UI over same APIs |
| 16 | Admin org-wide query list |

```text
query.py                 # HTTP + access helpers
models/query.py          # Query, QueryReply
plan_features.py         # QUERY_DEPARTMENT_CANONICAL, gates
email.py                 # notify_query_event, send_query_closed_email
notifications            # badge rows
uploads/tenants/{id}/queries/   # attachment files (legacy: uploads/queries/)
```

---

## 12. Quick test checklist

- [ ] Basic plan: only HR selectable; IT/Accounts raise → plan forbidden  
- [ ] Essential: HR + Accounts; Enterprise: all three  
- [ ] Multi-dept raise → N rows, same attachments list  
- [ ] First reply → status `Open` / UI “In Progress”  
- [ ] Owner and dept can close; second close is safe  
- [ ] Non-owner, wrong dept → **403** on detail/reply  
- [ ] File &gt; 2MB rejected; download allow-lists filename  
- [ ] Inbox mark-read clears query unread badge  
- [ ] Closed chat: UI disables send (even if API would accept)  
- [ ] IT Open Tickets lists only IT-scoped queries  
- [ ] Another company's query → 404 on detail/reply/close/mark-read; its HR inbox and badges never show it  
