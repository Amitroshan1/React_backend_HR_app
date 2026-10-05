# 14 — IT, ITAM, parcels & day-use checkout

**Audience:** developers changing inventory, asset assignment/returns, parcels, ITAM transitions, day-use loans, or IT NOC.  
**Main blueprint:** `website/it.py` → **`/api/it`** (~3k lines — prefer packages for new work)  
**Day-use:** `website/daily_checkout/` → **`/api/it/daily-checkout`**  
**ITAM helpers:** `website/itam/` (+ flags)  
**Models:** `models/it_models.py`, `models/daily_checkout.py`  
**UI hub:** `/it` → `pages/IT/ITPanel.jsx`  
**Related:** [12 Queries](./12-QUERIES.md) (OpenTicket) · [06 HR](./06-HR-CORE.md) (NOC / offboarding) · [docs/itam/](../itam/) (P0–P3 source of truth)

> Large control plane. This page **maps** domains and boundaries. Do **not** duplicate `docs/itam/` — link it for lifecycle contracts, remarks, timeline, and status mapping.

---

## 1. Purpose

IT operations in the HRMS:

1. **Inventory & assets** — catalog items, serialized units, software licenses, office/infra deploy  
2. **Long-term assignment** — assign/return hardware & seats to employees; return-request workflow  
3. **Parcels** — import logs / export shipments (units → `exported`)  
4. **ITAM** — optional phased remarks, timeline, canonical lifecycle (feature flags, default OFF)  
5. **Day-use Assets** — temporary checkout (separate models/API from permanent assignment)  
6. **IT NOC** — offboarding clearance uploads for department IT  
7. **Open Tickets** — UI under `/it/OpenTicket` but data is **Query IT inbox** (module **12**), not `ITSupportTicket`

“Vendor” is a **string field** on inventory forms — there is no vendor module.

---

## 2. Roles

| Actor | Access |
|-------|--------|
| IT / Inventory emp_type + plan `it_panel` | Full `/api/it` + IT panel |
| Org Admin / Super Admin | `can_access_it_panel` |
| Employee | Own assets GET; create return request; day-use self routes if `dashboard_my_assets` |
| IT staff | NOC list/upload (`_ensure_it_staff_admin`) |

Frontend: `RequirePanel panel="it"`; day-use employee path `RequireMyAssets` → `/daily-assets`.

---

## 3. Key tables (by subdomain)

### Inventory / long-term assets

| Model | Role |
|-------|------|
| `ITInventoryItem` | Catalog row; qty; category; vendor string |
| `ITAssetUnit` | Serialized HW; legacy `status`; `is_daily_pool`; P3 `lifecycle_*` |
| `ITSoftwareLicense` | Soft seats |
| `ITAssetAssignment` | Assign/return history |
| `ITInventoryQuantityAssignment` | Qty stock → employee |
| `ITOfficeStockDeployment` | Location deploy (office/infra) |

UI categories (same tables, `inventory_category`): **IT / Office / Transport / Infrastructure**.

### ITAM audit

| Model | Role |
|-------|------|
| `ITAssetTransition` | Append-only transitions / remarks |
| `ITAssetCustody` | Custody records |
| `ITAssetReview` | Reviews on units/items |

### Returns / disposal / parcels / legacy tickets

| Model | Role |
|-------|------|
| `ITAssetReturnRequest` | Employee→IT return workflow |
| `ITRemovedAsset` / `ITDeletedAssetLog` | Removed / delete audit |
| `ITParcelImport` / `ITParcelExport` (+ items) | Parcel movements |
| `ITSupportTicket` | Simple `/tickets` API — **not** OpenTicket UI |

### Day-use (`daily_checkout`)

| Model | Role |
|-------|------|
| `DailyCheckoutRequest` | Request header + status machine |
| `DailyCheckoutAssignment` / `Return` | Fulfillment |
| `DailyCheckoutDocument` | `acceptance` / `return_ack` PDFs |
| `DailyCheckoutEvent` / `Outbox` | Audit + email queue |
| `DailyUnitHold` | Unit lock while out |
| `EmployeeSignature` | Signature capture |

---

## 4. Business rules

### 4.1 Plan / access

Almost all `/api/it` requires `it_panel`. Self-service exceptions: own asset views, create return request, day-use employee endpoints (`EMPLOYEE_OK` in `daily_checkout/views.py`).

### 4.1a Company (tenant) scoping

Every IT query is limited to the caller's company (JWT `tenant_id`). Rules live in `itam/tenancy.py`:

| Table group | Company comes from |
|-------------|--------------------|
| Inventory items, parcel imports/exports, removed/deleted logs, transitions | own `tenant_id` column |
| Units, software licenses, quantity assignments, location deployments | their inventory item |
| Tickets, return requests, assignment history, Day-use requests | the requester / assignee employee |

- Use `it_query(Model)` for lists and `it_get(Model, id)` for by-id lookups (returns `None` → 404 for another company's row). Never use `Model.query.get(id)` on these tables in a route.
- Employee lookups use `tenant_admin_query()` / `get_admin_in_tenant()`; assigning to another company's employee returns 404.
- `record_transition` stamps the inventory item's company, so jobs without a request still write to the right company.
- Day-use `notify_it_staff` only notifies IT staff of the request's company. Scheduler jobs (overdue, PDF retry, outbox) stay cross-company on purpose.
- Unit, asset tag and license codes are unique inside one company (the same serial may exist in another). Generated `INV` / `TKT` / `TRN` / `DEL` numbers start again for each company. IT emails use the company IT mailbox (`company_mailbox("EMAIL_IT")` → `tenants.mailbox_it`, `.env` only for tenant 1); Day-use outbox mail uses the request's company.

### 4.2 Long-term vs day-use (do not mix)

| Concern | Long-term | Day-use |
|---------|-----------|---------|
| API | `/api/it/assignments*`, return-requests | `/api/it/daily-checkout` |
| Unit status while out | `assigned` | `daily_out` + `DailyUnitHold` |
| Pool | Normal available units | `is_daily_pool` + available |

Assigning long-term must respect day-use holds; day-use assign blocks units already out/held.

### 4.3 Legacy unit statuses

`available` · `assigned` · `daily_out` · `repair` · `not-working` · `exported` · `removed_from_it` / `removed` · `dead` / `deleted`

### 4.4 ITAM canonical (flag `ITAM_LIFECYCLE_V1`)

When ON: dual-write `lifecycle_status` + `custody_type` while keeping legacy `status` for filters.  
Canonical set and map: **[STATUS_MAPPING.md](../itam/STATUS_MAPPING.md)**.  
Custody: `EMPLOYEE` · `LOCATION` · `VENDOR` · `NONE`.

Flags (default **OFF**): `ITAM_TRANSITIONS_V1`, `ITAM_TIMELINE_V1`, `ITAM_LIFECYCLE_V1`, plus planned P4–P6 keys in `itam/flags.py`. Dedicated ITAM APIs return **409** when their flag is OFF.

### 4.5 Return requests (long-term)

`pending` → `approved` | `rejected` → `completed` (complete only from `approved`).  
`return_destination` default `"available"`.

### 4.6 Day-use state machine (`daily_checkout/state.py`)

```text
requested → approved → assigned → return_requested → returned
                ↓           ↓            ↑
            rejected    overdue ─────────┘
            cancelled (only from requested|approved)
```

| Rule | Detail |
|------|--------|
| Employee cancel | Only `requested` / `approved` |
| After assign | Must return (no cancel) |
| Overdue job | `assigned` → `overdue` when past `expected_return_at` |
| IT complete-return | From `assigned` / `overdue` / `return_requested` → `returned`; unit back to `available` |
| Docs | Acceptance PDF on assign; return_ack on complete |

### 4.7 Parcels

Export marks linked units `exported` and adjusts inventory quantities. Import is a log/create path for inbound parcels.

### 4.8 OpenTicket ≠ `/api/it/tickets`

| | OpenTicket UI | `ITSupportTicket` |
|--|---------------|-------------------|
| API | `/api/query` IT inbox (module **12**) | `GET/POST /api/it/tickets`, resolve |
| Status | Query `New`/`Open`/`Closed` | `pending` → `completed` |

---

## 5. API catalog (high signal)

Prefix **`/api/it`** unless noted. JWT + plan guard (self exceptions).

### Employees / summary

`GET /summary` · `GET /employees/assigned-assets` · `GET /employees/lookup` · `GET /employees/<emp_id>/assets` · `GET /employees/<emp_id>/return-requests`

### Inventory & units

`GET|POST /inventory/items` · `PATCH /inventory/items/<id>` · `GET /units` · `POST /units/bulk` · `PATCH /units/<id>/status` · `DELETE /units/<id>` · reviews under units/items

### Long-term assignments

`POST /assignments/units` · `POST /assignments/units/<id>/return` · software assign/return/renew · `POST /assignments/inventory-quantity`

### Office / inventory stock deploy

`GET|POST /office-stock/*` and `/inventory-stock/*` (deployments, deploy, return)

### Return requests

`POST|GET /return-requests` · `PATCH .../approve|reject|complete`

### Parcels

`GET|POST /parcels/imports` · `GET|POST /parcels/exports`

### Removed / deleted

`/removed-assets` · `/deleted-logs`

### NOC

`GET /noc-requests` · `POST .../upload` · `GET .../download` (IT staff)

### Legacy tickets

`GET|POST /tickets` · `PATCH /tickets/<id>/resolve` — not OpenTicket page

### ITAM

`GET /itam/meta` · `POST /units/<id>/transitions` · `GET .../timeline[.csv|.xlsx]` · `GET /activity-log[.csv|.xlsx]` · software license timeline · backfill POSTs

### Day-use — **`/api/it/daily-checkout`**

| Method | Path | Who |
|--------|------|-----|
| GET | `/meta`, `/me` | Employee / IT |
| POST | `/signature` | Employee |
| POST/GET | `/requests` | Create / list mine |
| GET | `/inbox` | IT |
| GET | `/requests/<id>` | Owner or IT |
| POST | `.../cancel\|approve\|reject\|assign\|return\|complete-return\|acknowledge` | Per role |
| GET | `/available-units`, `/pool-units` | IT |
| PATCH | `/units/<id>/daily-pool` | IT |
| GET | `.../documents/<doc_type>` | PDF |

---

## 6. Main flows

### 6.1 Catalog → assign

```text
POST inventory/items → POST units/bulk → POST assignments/units
  → unit status assigned (+ ITAM CHECKOUT if flag on)
```

### 6.2 Employee return (long-term)

```text
POST /return-requests (pending)
  → IT approve|reject → complete → asset to return_destination
```

### 6.3 Day-use

```text
Employee POST /daily-checkout/requests (requested)
  → IT approve → assign (daily_out + hold + acceptance PDF)
  → return / overdue → IT complete-return → return_ack + outbox email
```

### 6.4 Parcel export

```text
POST /parcels/exports → units exported + qty adjusted
```

### 6.5 OpenTicket

```text
/it/OpenTicket → GET /api/query/queries/it-inbox → reply/close (module 12)
```

---

## 7. Frontend map

| Route | Page |
|-------|------|
| `/it` | Hub `ITPanel.jsx` |
| `/it/inventory/*` | Inventory (+ parcels, repair, not-working, removed, add-assets, activity-log) |
| `/it/parcels/*` | Redirect → inventory parcels |
| `/it/OpenTicket` | Query IT inbox |
| `/it/ActiveDevices` | Assigned assets |
| `/it/Assets` | Available / assets dashboard |
| `/it/Assets/activity-log` | ITAM activity log |
| `/it/AssetsPage/AddEmployee` | Assign to employee |
| `/it/employee/:empId` | Asset detail (IT or self) |
| `/daily-assets` | Employee day-use |
| `/it/daily-checkout` (+ `/assign/:requestId`) | IT day-use inbox/assign |
| `/it/return-requests` | Long-term returns |
| `/it/noc-requests` | IT NOC |

Client: `pages/IT/Data.js` → `/api/it`; day-use pages → `/api/it/daily-checkout`; ITAM UI under `pages/IT/itam/`.

---

## 8. Jobs / CLI

| Job | Cadence | Actions |
|-----|---------|---------|
| `daily_checkout_jobs` | every **15 min** | `mark_overdue_and_notify`, `retry_pending_pdfs`, `flush_outbox` |

No Flask CLI for day-use/ITAM. ITAM backfills = POST APIs. Offboarding NOC SLA jobs are elsewhere (HR/offboarding), not day-use.

---

## 9. Config

| Key | Role |
|-----|------|
| Plan `it_panel` | IT panel + `/api/it` |
| Plan `dashboard_my_assets` | Employee day-use / my assets |
| `ITAM_TRANSITIONS_V1` | P1 remarks |
| `ITAM_TIMELINE_V1` | P2 timeline |
| `ITAM_LIFECYCLE_V1` | P3 dual-write |
| `ITAM_API_FIRST_V1` / `SELF_SERVICE` / `OFFBOARD_GATE` | Planned P4–P6 (default OFF) |
| Frontend | optional `VITE_ITAM_*` mirrors |

### docs/itam/ (do not copy here)

| Doc | Phase |
|-----|-------|
| [P0_CONTRACTS.md](../itam/P0_CONTRACTS.md) + [P0_ROLLOUT_CHECKLIST.md](../itam/P0_ROLLOUT_CHECKLIST.md) | Contracts, flags, meta |
| [P1_TRANSITIONS.md](../itam/P1_TRANSITIONS.md) | Remark engine |
| [P2_TIMELINE.md](../itam/P2_TIMELINE.md) | History / CSV / backfill |
| [P3_LIFECYCLE.md](../itam/P3_LIFECYCLE.md) | Canonical status + custody |
| [STATUS_MAPPING.md](../itam/STATUS_MAPPING.md) | Legacy ↔ canonical |

---

## 10. How to change safely

1. Prefer `daily_checkout/` and `itam/` packages over growing `it.py`.  
2. Never conflate day-use, return-request, Query, and `ITSupportTicket` statuses.  
3. Keep ITAM flags OFF by default; transitions append-only — rollback = flag off, don’t delete rows.  
4. P3 dual-write: keep legacy `status` when changing `lifecycle_status`.  
5. OpenTicket changes belong in **query** / Query UI, not `ITSupportTicket`.  
6. Parcel export mutates unit status — regression-test inventory counts.  
7. Overdue job only flips `assigned` past `expected_return_at`; preserve outbox dedupe.  
8. Tests: `test_itam_p*_*.py`, `test_daily_checkout_state.py`, `test_shared_db_multitenancy_it_module.py`.  
9. New IT table? Add a rule in `itam/tenancy.py` (own `tenant_id` + `tenant_migrations.IT_TENANT_SOURCES`, or inherit via inventory item / employee).

---

## 11. Related modules

| # | Boundary |
|---|----------|
| 12 | OpenTicket / IT query inbox |
| 06 | Offboarding NOC; HR dept NOC panels |
| 05 | Manager snapshots on day-use when used |
| 02 / 18 | `it_panel`, emp_type, plan gates |
| 17 | `daily_checkout_jobs` scheduler |

```text
it.py                      # inventory, assign, parcels, NOC, ITAM mounts
daily_checkout/            # day-use API + state + PDF/email
itam/                      # flags, transitions, timeline, lifecycle
models/it_models.py
models/daily_checkout.py
docs/itam/                 # P0–P3 contracts
pages/IT/                  # SPA
```

---

## 12. Quick test checklist

- [ ] IT panel blocked without `it_panel` / non-IT emp_type  
- [ ] Create item → bulk units → assign → unit `assigned`  
- [ ] Employee return-request → approve → complete → unit available  
- [ ] Day-use: request → approve → assign → `daily_out`; cancel after assign fails  
- [ ] Overdue: past `expected_return_at` → status `overdue` after job  
- [ ] Complete-return → unit `available`, hold cleared  
- [ ] Parcel export → unit `exported`  
- [ ] ITAM transition API → **409** with flag OFF; works with flag ON  
- [ ] OpenTicket lists Query IT inbox, not `/api/it/tickets`  
- [ ] Employee `/daily-assets` works with `dashboard_my_assets` only  
- [ ] Two companies: each IT user sees only its own inventory, logs, parcels and Day-use inbox; another company's unit/request id → 404  
