# 08 — Biometric (ADMS / iClock)

**Audience:** developers changing device ingest, PIN→employee mapping, biometric→`PunchSession` bridge, NHQ day close, or HR biometric reports.  
**Primary package:** `website/biometric/`  
**Device prefix:** `/iclock` (no JWT)  
**HR reports:** `/api/hr/biometric`  
**Primary UI:** `frontend/src/pages/HR/BiometricAttendance.jsx` (+ detail drawer)  
**Related:** [03 Punch](./03-DASHBOARD-PUNCH-GEO.md) · [07 Attendance engine](./07-ATTENDANCE-ENGINE.md) · [ATTENDANCE_SSE.md](../ATTENDANCE_SSE.md) · module **17** schedulers

---

## 1. Purpose

Office face/fingerprint devices (eSSL AiFace ERIS / ZKTeco-style **ADMS**) push attendance into HRMS without the web punch UI.

Pipeline:

```text
Device  →  GET/POST /iclock/cdata (+ getrequest)
        →  biometric_logs (raw, idempotent)
        →  attendance_bridge → Punch / PunchSession (source=biometric)
        →  biometric_day_state + biometric_attendance_day (rollups)
        →  NHQ last-scan sync (18:00–21:00 IST) closes / bumps OUT
        →  attendance_engine (module 07) reads Punch like any other day
```

**Does not:**

- Call `auth.punch_in` / `auth.punch_out`
- Apply geofence
- Treat device “IN/OUT state” as authoritative (every scan is an event; first scan opens IN; later scans update activity / last scan)
- Replace web punch for non-device employees

HR **Biometric Attendance** UI is a **read-only** reporting layer over `biometric_attendance_day` / `biometric_logs`. It never talks to the device and never writes punches.

---

## 2. Roles

| Actor | Access |
|-------|--------|
| Biometric device | Unauthenticated ADMS HTTP to `/iclock/*` (serial + optional IP allowlist) |
| Employee (web) | Sees resulting sessions on Dashboard; NHQ UX prefers device (module **03**) |
| HR | JWT + HR plan feature → `/api/hr/biometric/*` summary, detail, devices, Excel |
| Ops / CLI | Flask commands: finalize, rebuild days, reprocess mapping, audit |
| Scheduler | Last-scan sync, catch-up, mapping reprocess (section 8) |

---

## 3. Key tables / models

| Model | Table | Role |
|-------|-------|------|
| `BiometricDevice` | `biometric_devices` | Registered SN; `allowed_ips`; `last_seen_at` / `last_data_push_at` |
| `BiometricEmployeeMap` | `biometric_employee_map` | Consistency check only — **cannot** override `Admin.emp_id` |
| `BiometricLog` | `biometric_logs` | Immutable-ish raw ADMS events + bridge status |
| `BiometricDayState` | `biometric_day_state` | Per admin+date: `first_scan_at` / `last_scan_at`; `open` \| `finalized` \| `auto_closed` |
| `BiometricAttendanceDay` | `biometric_attendance_day` | HR read model: PIN + date → first/last + `total_scans` JSON |
| `Punch` / `PunchSession` | (attendance) | Authoritative presence; biometric sets `source=biometric` |

### Identity invariant

```text
device_user_id  ==  Admin.emp_id  (exact string, preserve leading zeros)
                →  Admin.id
                →  Punch.admin_id / PunchSession
```

`BiometricEmployeeMap` must agree (`device_user_id == map.emp_id == Admin.emp_id` and `map.admin_id == Admin.id`) when present; it never remaps a PIN to a different employee.

### `BiometricLog.status` (common)

| Status | Meaning |
|--------|---------|
| `received` | Stored; waiting / mid-bridge |
| `processed` | Applied to a session (or NHQ activity / OUT bump) |
| `duplicate` | Same idempotency key already stored |
| `failed` | Bad payload / max sessions / bridge exception |
| `unknown_device` | (conceptually) rejected at device resolve — often soft-OK with no row |
| `unknown_employee` / `invalid_mapping` / `ambiguous_employee_mapping` / `employee_inactive` | Mapping failures (reprocessable) |
| `unmapped_permanent` | Exhausted reprocess attempts |
| `ignored` | e.g. on leave |
| `ignored_open_web_session` / `ignored_open_session` | Blocked by another open session |
| `ignored_day_closed` | NHQ day already closed; scan may still feed late OUT bump |

Idempotency key = SHA-256 of `SN|PIN|datetime|state|verify|work|…` (`make_idempotency_key`).

---

## 4. Business rules

### 4.1 Device admission

`resolve_device` (`device_manager.py`):

1. Valid serial format  
2. Row in `biometric_devices` with `is_active`  
3. Optional env `BIOMETRIC_ALLOWED_SERIALS` — if set, SN must be listed  
4. Optional IP: `device.allowed_ips` and/or `BIOMETRIC_REQUIRE_IP_ALLOWLIST`  

Unknown / denied devices still get plain-text **`OK\n`** (so the device does not flood), but **no** attendance is stored.

### 4.2 ATTLOG ingest

- Parser does **not** map device state codes to IN/OUT.  
- Valid lines → `biometric_logs` with `status=received`.  
- Same transaction: `process_received_logs_for_device` → bridge + day rollup.  
- `OPERLOG` / options / heartbeat: touch `last_seen_at` only (no punches).  
- Protocol errors: log + still return `OK\n` when possible.

### 4.3 Bridge — open / subsequent scans

`process_biometric_log` (`attendance_bridge.py`):

| Situation | Result |
|-----------|--------|
| PIN not resolvable | Mapping failure status; no session |
| Full-day leave (`is_on_leave`) | `ignored` / `on_leave` |
| No open session | Open `PunchSession` (`source=biometric`, `location_status*_in=biometric_device`); **clock_in = earliest machine scan that day** |
| Same-day subsequent scan | Update `BiometricDayState.last_scan_at`; may rewind `clock_in` earlier; **does not close** |
| Same-day open **web** session | **Supersede** → convert to biometric IN (earliest of web IN and scan); all circles |
| Cross-day stale open | Finalize / force-close, then allow new IN |
| NHQ day already finalized / closed bio OUT | Prefer bump OUT to later scan; else `ignored_day_closed` |
| Max 8 closed sessions that day | `failed` / `max_sessions_per_day` |
| Duplicate open race | Keep earliest open; treat scan as subsequent |

**Never** opens a second concurrent open session for one employee.

### 4.4 NHQ scope

`scope.py`: **both** must match:

1. `Admin.circle` equivalent to **NHQ**  
2. Device serial in `BIOMETRIC_NHQ_SERIALS` (env/config; default includes production SN)

NHQ policy affects:

- Day finalization / last-scan sync  
- Skip same-day **10h auto-close** (wait for last-scan / sync window)  
- After closed bio session, later machine scans can still move **OUT** forward  

Non-NHQ biometric sessions still use **10h** auto-close when overdue (prefer `last_scan_at` when present).

### 4.5 NHQ OUT = last scan (Option A)

Primary path is **continuous last-scan sync**, not a single 20:00 cron:

| Piece | Behavior |
|-------|----------|
| Window | **18:00–21:00 IST**, every **5s** |
| Action | Close open NHQ bio session at latest later scan; or bump closed OUT |
| Single-scan day | Not closed in the 5s window; **catch-up** (`force` + `allow_single_scan_out`) at **21:05** and **06:10** sets OUT = that scan |
| Legacy | `finalize_biometric_day` (OUT ≤ 20:00) + `extend_*` (after 20:00) remain for CLI / tests |

`BiometricDayState.status` → `finalized` when sync closes/bumps.

### 4.6 Web ↔ biometric interaction (summary)

Aligned with module **03**:

- Same-day biometric **overrides** open web IN (earliest presence wins).  
- NHQ: biometric last scan can override a prior web punch-out.  
- Dashboard may warn NHQ employees to use the device; outside+reason web punch still allowed.  
- Open NHQ biometric session: client 10h deadline may be suppressed (`is_nhq_biometric`).

### 4.7 HR reporting labels

| `attendance_status` | Meaning |
|---------------------|---------|
| `applied_to_punch` | At least one log that day has `punch_session_id` |
| `not_applied_to_punch` | Mapped scans but not linked (ignored/leave/etc.) |
| `unmapped` | No `admin_id` / permanent unmapped |

### 4.8 Mapping reprocess

Daily job retries `unknown_employee` / `invalid_mapping` / `ambiguous_employee_mapping` / `employee_inactive`. After **7** attempts → `unmapped_permanent` (never invents a punch).

### 4.9 Company (tenant) scope

Rules live in `biometric/tenancy.py`.

- **Device → company:** `biometric_devices.tenant_id` (NULL = tenant 1). Devices are registered directly in the DB; to give a company its device, set this column to its tenant id.
- **PIN mapping:** `resolve_biometric_employee` / `find_employee_map` only match employees of the **device's** company, so the same `emp_id` in two companies is not "ambiguous".
- **Read model:** `biometric_attendance_day.tenant_id` = device's company; unique key `uq_bio_att_day_tenant_pin_date` on `(tenant_id, device_user_id, attendance_date)`.
- **HR views** (`/api/hr/biometric/*`): day rows, devices, employee day and unmapped-day logs are limited to the caller's company (logs via the device serial; tenant 1 also sees logs from serials not registered to any device). Another company's employee → 404.
- Scheduler, finalization and reprocess run across companies; they key off `admin_id` + device, so they stay correct.
- Startup migration `ensure_biometric_tenant_ids` adds both columns, backfills day rows from the employee's company and swaps the unique key.

---

## 5. API catalog

### 5.1 Device (no auth) — blueprint `biometric_bp` → `/iclock`

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| GET | `/iclock/health` | Ops liveness JSON | `{ success, module, phase, message }` |
| GET/POST | `/iclock/cdata` | ADMS data exchange | `text/plain` `OK` / `OK:<n>` |
| GET/POST | `/iclock/cdata.aspx` | Alias for ASP.NET-style devices | same |
| GET | `/iclock/getrequest` | Command poll (empty queue) | `OK\n` |
| GET | `/iclock/getrequest.aspx` | Alias | same |

**`/iclock/cdata` dispatch** (`process_cdata_request`):

| Input | Handler |
|-------|---------|
| POST ATTLOG / attlog-like body | Store logs → bridge → commit |
| options / registry | `build_options_response` + touch seen |
| operlog | Ack only |
| GET / heartbeat | Touch `last_seen_at` |

Query/form: `SN` (required), `table=ATTLOG`, etc.

### 5.2 HR reporting — `biometric_hr_bp` → `/api/hr/biometric`

Auth: `Authorization: Bearer <JWT>` + `can_access_hr_operations`.

| Method | Path | Query | Success |
|--------|------|-------|---------|
| GET | `/summary` | `date` **or** `month=YYYY-MM` **or** `start`/`end`; optional `emp_id`, `emp_type`, `circle`, `admin_id`, `page`, `per_page` | `{ success, rows[], total, page, per_page, total_pages }` |
| GET | `/employee/<admin_id>/day/<YYYY-MM-DD>` | — | `{ success, scans[], … }` |
| GET | `/unmapped/<device_user_id>/day/<YYYY-MM-DD>` | — | scans for unmapped PIN |
| GET | `/devices` | — | `{ devices[], online_timeout_seconds }` — Online from `last_seen_at` only |
| GET | `/export` | same date filters as summary | Excel attachment |

Date precedence: `date` > `start`/`end` > `month`.

**Does not** write `biometric_logs`, punches, or contact devices.

---

## 6. Main flows

### 6.1 First scan of the day → Check In

```text
ATTLOG line (PIN + time)
  → BiometricLog received
  → resolve Admin by emp_id
  → open PunchSession (source=biometric)
  → BiometricDayState open (first=last=scan)
  → recompute_punch_aggregate
  → upsert biometric_attendance_day
  → queue_attendance_updated (SSE best-effort)
```

### 6.2 Mid-day scans

```text
Same PIN, open bio session
  → last_scan_at advances
  → clock_in may rewind to earlier scan
  → session stays OPEN (no OUT yet)
```

### 6.3 NHQ evening close

```text
18:00–21:00 IST every 5s:
  sync_all_nhq_biometric_last_scans
    → OUT = latest NHQ-device scan after clock_in
    → day_state finalized

21:05 + 06:10 catch-up (force, allow_single_scan_out):
  → single-scan days get OUT = that scan
```

### 6.4 HR views a day

```text
UI GET /api/hr/biometric/summary
  → biometric_attendance_day (+ labels from logs)
Detail drawer → /employee/.../day/... or /unmapped/.../day/...
```

---

## 7. Frontend map

| UI | Route / entry | APIs |
|----|---------------|------|
| HR → Biometric Attendance | `Hr.jsx` view `biometric_attendance` | `GET /api/hr/biometric/summary`, `/devices`, `/export` |
| Day detail drawer | `BiometricAttendanceDetail.jsx` | `/employee/:id/day/:date` or `/unmapped/:pin/day/:date` |
| Device Online/Offline chip | `deviceStatusDisplay.js` | `/devices` (`last_seen_at` vs timeout) |
| Employee Dashboard | module **03** | Consumes sessions; may show NHQ / biometric warnings — **not** `/api/hr/biometric` |

Refresh in HR UI re-queries the API only; it does **not** poll the physical device.

---

## 8. Jobs / CLI

### Scheduler (`__init__.py` + `scheduler.py`)

| Job id | When | Function |
|--------|------|----------|
| `biometric_last_scan_sync` | every **5s** (no-ops outside window) | `sync_all_nhq_biometric_last_scans` (18–21 IST) |
| `biometric_last_scan_catchup_evening` | cron **21:05** | force + `allow_single_scan_out` |
| `biometric_last_scan_catchup_morning` | cron **06:10** | same catch-up |
| `biometric_mapping_reprocess` | cron **06:20** | `reprocess_mapping_failure_logs` |
| `auto_punch_out_scan` | every 2 min | 10h close; **skips** same-day NHQ bio open (module **03**/`punch_auto_close`) |

### Flask CLI

| Command | Purpose |
|---------|---------|
| `flask biometric-finalize-day [--date YYYY-MM-DD] [--dry-run] [--no-catchup]` | Legacy 20:00 cutoff batch |
| `flask biometric-rebuild-attendance-days` | Rebuild `biometric_attendance_day` from logs |
| `flask biometric-reprocess-mapping` | Retry mapping failures |
| `flask biometric-mapping-audit` | Audit map / emp_id consistency |

---

## 9. Config / `.env`

| Key | Purpose |
|-----|---------|
| `BIOMETRIC_NHQ_SERIALS` | Comma-separated SNs under NHQ last-scan / finalize policy |
| `BIOMETRIC_ALLOWED_SERIALS` | Optional global SN allowlist (in addition to DB) |
| `BIOMETRIC_REQUIRE_IP_ALLOWLIST` | Force IP check even when `allowed_ips` empty |
| `BIOMETRIC_DEVICE_ONLINE_TIMEOUT_SECONDS` | HR Online/Offline (default **180**) |
| `BIOMETRIC_DEBUG_LOG` | Verbose cdata request logging (or Flask debug) |

DB: register devices in `biometric_devices` before production traffic. Optional `biometric_employee_map` rows for audit consistency.

Timezone for NHQ windows / cutoffs: **Asia/Kolkata** (`IST` in `datetime_utils`).

---

## 10. How to change safely

1. **Never** call web `punch_in`/`punch_out` from biometric — use `punch_aggregate` / `close_punch_session` only.  
2. Keep **exact-string** `emp_id` matching; do not int-cast PINs (leading zeros).  
3. Device protocol handlers should keep returning plain **`OK`** on soft failures so buffers clear; log reasons server-side.  
4. Changing NHQ window or single-scan rules: update `finalization.py` **and** scheduler jobs together; cover with `tests/test_biometric_day_finalization.py`.  
5. Bridge rules are dense — add cases to `tests/test_biometric_attendance_bridge.py` / `test_biometric_iclock_cdata.py`.  
6. HR reporting must stay **read-only**; do not create punches from `hr_views`.  
7. SSE publish failures must not roll back log/session commits ([ATTENDANCE_SSE.md](../ATTENDANCE_SSE.md)).  
8. After mapping/emp_id fixes, rely on reprocess job or CLI — do not manually invent `PunchSession` rows for ghost PINs.  
9. Attendance calendar (module **07**) only sees biometric presence once the **bridge** wrote `Punch` — raw logs alone show ABSENT.
10. Any new PIN → employee lookup or HR biometric query must apply the tenant clauses from `biometric/tenancy.py` (§4.9); keep them tolerant of an `Admin` model without `tenant_id` (isolated tests stub it).

---

## 11. Related modules

| # | Boundary |
|---|----------|
| 03 | Web punch, geo, NHQ dashboard warnings, 10h auto-close interaction |
| 07 | Day status / credited days from resulting `Punch` |
| 06 | HR punch CRUD (separate from biometric reports) |
| 15 / SSE | Real-time UI after bio open/close |
| 17 | Scheduler registration detail |

Package layout:

```text
website/biometric/
  routes.py              # /iclock
  service.py             # cdata dispatch + ATTLOG store
  parser.py / validators.py / device_manager.py
  mapping.py             # PIN → Admin.id
  attendance_bridge.py   # logs → PunchSession
  finalization.py        # NHQ last-scan / legacy finalize
  day_rollup.py          # biometric_attendance_day
  hr_views.py            # /api/hr/biometric
  reprocess.py / scope.py / models.py
  tenancy.py             # device → company, tenant clauses
```

---

## 12. Quick test checklist

- [ ] Registered SN POST ATTLOG → `biometric_logs` + open `PunchSession` `source=biometric`  
- [ ] Unknown SN → `OK` response, no attendance  
- [ ] PIN ≠ any `emp_id` → `unknown_employee` (or reprocessable status)  
- [ ] Second same-day scan updates `last_scan_at`, does not open second session  
- [ ] Open web + biometric same day → session becomes biometric; earliest IN  
- [ ] Employee on full-day leave → log ignored  
- [ ] NHQ admin + NHQ SN: after evening sync, OUT ≈ last scan; day_state `finalized`  
- [ ] Single-scan NHQ day closed by catch-up (not left open forever)  
- [ ] Non-NHQ biometric still subject to 10h auto-close when overdue  
- [ ] HR summary / export / device Online match DB; refresh does not hit device  
- [ ] Duplicate ATTLOG line → `duplicate`, no second session  
- [ ] Same PIN in two companies → each device maps to its own company's employee; HR views of one company never show the other's rows/devices  
