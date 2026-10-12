# 03 — Dashboard, punch & geo

**Audience:** developers changing Check In/Out, geofence, WFH-vs-reason rules, 10h auto punch-out, or NHQ web-punch UX.  
**Primary routes:** `/api/auth/employee/*` (punch lives on the auth blueprint)  
**Primary UI:** `frontend/src/pages/Dashboard/Dashboard.jsx`  
**Related:** [02-AUTH](./02-AUTH-AND-SESSION.md) · [01-ARCHITECTURE](./01-ARCHITECTURE.md) · Biometric → module **08** · Attendance engine → module **07**

---

## 1. Purpose

Employee daily attendance from the **web**:

1. Acquire GPS → check office geofence  
2. Punch in / out with policy (leave, WFH, outside reason, repeat reason, 10h cap)  
3. Show today’s sessions / hours on the dashboard  
4. Optionally auto-close at **10 hours** per open session  

Biometric device punches are a separate path (`source=biometric`); they interact with web sessions (NHQ rules). Details in module **08**.

---

## 2. Roles

| Actor | Access |
|-------|--------|
| Any logged-in employee | Own punch in/out + location-check |
| NHQ circle | Extra **warning** for in-office web punch (biometric preferred); outside + reason punches go through |
| HR / Admin | View punches via other modules; do not use these employee self APIs as HR tools |

---

## 3. Key tables / models

| Model | Table | Role |
|-------|-------|------|
| `Punch` | `punch` | One row per employee per **calendar date**; aggregates `punch_in` / `punch_out` / `today_work` |
| `PunchSession` | `punch_sessions` | One clock-in → clock-out **segment**; multiple per day allowed (max 8 closed) |
| `Location` | `location` | Office geofence centers (`lat`, `lon`, `radius`, optional `grace`) |
| `GeoPunchAttempt` | (audit) | Written on location-check / punch when audit enabled. HR geo analytics (`/api/HumanResource/geo-analytics/*`) reads only the company's attempts (`admin_owned_clause`); geo config / engine mode are platform-wide, so only the platform company (tenant 1) may change them or read their history (config / rollout GET return `can_manage`; the HR page hides the controls when false) |
| `WorkFromHomeApplication` / leave WFH | — | `is_wfh_allowed()` — approved WFH covering **today** |

### PunchSession fields that matter

| Column | Meaning |
|--------|---------|
| `clock_in` / `clock_out` | Segment bounds (`clock_out` null = open) |
| `is_wfh` | True only when **approved** WFH satisfied outside-geo (or marked as WFH session) |
| `repeat_reason` | Required on 2nd+ punch-in same day; may append `geo: …` notes |
| `extended_hours_reason` | Manual out after 10h, or auto-cap reason |
| `auto_punched_out` | Closed by 10h auto path |
| `source` | `web` \| `biometric` \| `hr` \| `system` |
| `closed_by` | Who closed the session |
| `location_status_in` / `_out` | Geo status at in/out |
| `geo_decision`, `accuracy_m`, `confidence_score`, … | V2 metadata (additive columns) |

Helpers: `open_punch_session_for_admin`, `recompute_punch_aggregate`, `ensure_punch_sessions_backfill` in `punch_aggregate.py`.

---

## 4. Business rules

### 4.1 Hard blocks on punch-in

| Condition | Result |
|-----------|--------|
| On **approved leave** today | 403 — cannot punch |
| Any **open** session today | 400 — punch out first |
| Open session from **previous day** (night shift) | 400 — must punch out that shift first |
| Already **8 closed** sessions today | 400 — max sessions |
| 2nd+ punch-in without `repeat_punch_reason` (≥3 chars) | 400 + `requires_repeat_punch_reason` |

### 4.2 Geofence + WFH + reason

Offices = the employee's company rows in `location` (`master_data_tenancy.location_query()`, company from the JWT); another company's office never counts as inside. Validation goes through **`validate_employee_location`** (`geo_validation_service.py`) — **do not** call `geo_fence_engine` directly from punch routes.

| Situation | Punch allowed? |
|-----------|----------------|
| Inside / near office | Yes (no geo reason) |
| Outside / NO_GPS / uncertain requiring reason | Yes **if** approved WFH **or** `geo_reason` ≥ min chars (default **10**) |
| Pending WFH (not approved) | Does **not** bypass geofence; use written reason |
| `is_wfh: true` without approval | Cleared server-side; treated as needing reason if outside |

`is_wfh_allowed(admin_id)` = approved `WorkFromHomeApplication` **or** approved leave with `leave_type == "WFH"` covering today.

Punch-out outside: same reason rule, unless session already `is_wfh` or WFH approved today.  
**Exception:** `auto_system_punch_out: true` skips live geo reason (scheduler / client auto-cap).

### 4.3 Session source

Web punch sets `PunchSession.source = "web"`.

### 4.4 Ten-hour auto punch-out

| Rule | Detail |
|------|--------|
| Cap | **`SESSION_CAP_SEC = 10 * 3600`** per **open segment** from that segment’s `clock_in` |
| Fresh block | Each new punch-in starts a new 10h clock (prior closed sessions do not reduce remaining time) |
| Client auto | Body flag `auto_system_punch_out: true` — server **refuses** with **409** + `cap_not_due` unless `evaluate_auto_close` says due |
| Clock-out time | Stored at **cap deadline** (`clock_in + 10h`), even if job runs late |
| NHQ biometric open session | `session_auto_close_deadline` may return `null` (10h skip — biometric finalization owns the day) |
| Manual out after 10h | Requires `extended_hours_reason` ≥ 3 chars |

Scheduler: `punch_auto_close` / APScheduler (~every 2 min). Homepage load can also close overdue sessions for the current user.

### 4.5 NHQ web punch (frontend)

| Case | Behavior |
|------|----------|
| NHQ + **no** approved WFH + punch **in** (inside / no geo modal) | Show “use biometric” **warning**; user can Continue |
| NHQ + outside + **valid geo reason** Confirm | Punch **immediately** (modal closes; NHQ warning **not** stacked) — fixed so Confirm is not stuck |
| NHQ + approved WFH | Skip NHQ warning |
| Punch **out** of biometric-sourced open session | Warning that web out may not match NHQ policy |

Backend does **not** hard-block NHQ web punch without WFH.

### 4.6 Geo engine modes

Configured via `GEO_ENGINE_MODE` / `geo_fence_config.py`:

| Mode | Behavior |
|------|----------|
| `LEGACY` | Older distance-to-office logic |
| `SHADOW` (default often) | Legacy decides; V2 compared/audited |
| `V2` | V2 decides; fallback to legacy on error if enabled |

`requires_reason` drives the outside-office modal. Network match is a **confidence booster only** — never grants INSIDE alone.

---

## 5. API catalog

Base: **`/api/auth`**. All require **JWT** unless noted.

### 5.1 `GET /employee/geo/client-config`

Server-driven GPS timing for dashboard poll + punch acquisition + trusted cache.

**Response (shape):** `{ dashboard: {…}, punch: {…}, trustedCache: {…} }`  
Frontend: `services/geoClientConfig.js`.

---

### 5.2 `GET /employee/location-check`

Pre-check before / while preparing punch.

**Query params:** `lat`, `lon`, optional `accuracy` / `accuracy_m`, attempt metadata.

**Response highlights:**

| Field | Meaning |
|-------|---------|
| `in_range` | Treated as inside/near |
| `requires_reason` | UI must collect geo reason |
| `zone` | e.g. `INSIDE`, `OUTSIDE`, `NO_GPS` |
| `geo_decision` | Engine decision |
| `wfh_approved` | Today’s approved WFH |
| `attempt_id` | Audit correlation |
| `timing` | Perf diagnostics |

---

### 5.3 `POST /employee/punch-in`

**Body (typical):**

```json
{
  "lat": 28.61,
  "lon": 77.20,
  "accuracy": 25,
  "accuracy_m": 25,
  "is_wfh": false,
  "geo_reason": null,
  "repeat_punch_reason": null,
  "attempt_id": "optional-uuid"
}
```

(Also accepts measurement fields used by `_geo_payload_from_request`.)

**Success 200:** includes punch times, session payload, `requires_repeat_punch_reason: false`, timing.

**Errors:**

| Status | Flags / meaning |
|--------|-----------------|
| 403 | On leave |
| 400 | Open session; max sessions; need repeat reason (`requires_repeat_punch_reason`); need geo reason (`requires_geo_reason`) |
| 404 | Employee not found |

Creates/uses today’s `Punch`, inserts `PunchSession` with `source=web`, recomputes aggregate.

---

### 5.4 `POST /employee/punch-out`

**Body (typical):**

```json
{
  "lat": 28.61,
  "lon": 77.20,
  "geo_reason": null,
  "extended_hours_reason": null,
  "auto_system_punch_out": false
}
```

**Success 200:** closed session + aggregate.

**Errors:**

| Status | Meaning |
|--------|---------|
| 400 | No open session; geo reason required; extended hours reason required |
| 409 | `auto_system_punch_out` but 10h cap not due (`cap_not_due`, `session_auto_close_at`) |
| 404 | Employee not found |

---

### 5.5 Homepage punch slice

`GET /employee/homepage` (module 02) returns a `punch` object used by the dashboard, including roughly:

- `has_open_session`
- `requires_repeat_punch_reason`
- `sessions` (serialized)
- `punch_in` / `punch_out` display
- `session_auto_close_at` when applicable
- overnight open-shift hints

---

## 6. Main flows

### 6.1 Happy path (inside office)

```text
Dashboard Check In
  → prepareFreshPunchMeasurement (GPS)
  → GET location-check
  → if NHQ & !wfhApproved → warning modal → Continue
  → POST punch-in { lat, lon, is_wfh: false }
  → refresh homepage
```

### 6.2 Outside office (reason)

```text
Check In
  → location-check → requires_reason
  → modal “Outside office — punch in reason”
  → user enters ≥10 chars
  → Confirm → close modal → POST punch-in { geo_reason }
  → (NHQ warning skipped on this path)
```

Same pattern for punch-out with `geoReasonMode: "out"`.

### 6.3 Repeat punch same day

```text
Closed session exists, no open session
  → homepage.requires_repeat_punch_reason
  → repeat reason modal (≥3 chars)
  → then geo path if needed
  → POST punch-in { repeat_punch_reason, geo_reason? }
```

### 6.4 Client 10h auto punch-out

```text
Dashboard sees session_auto_close_at due
  → POST punch-out { auto_system_punch_out: true }
  → if 409 cap_not_due → remember refused ISO; wait
  → if 200 → refresh; mark auto closed
```

Server scheduler may close the same session without GPS.

---

## 7. Frontend map

| File / area | Role |
|-------------|------|
| `Dashboard.jsx` | Punch buttons, GPS prepare, geo/repeat/extended/NHQ modals, auto-cap |
| `hooks/usePunchGps` (or similar in Dashboard) | Multi-attempt GPS acquisition |
| `services/geoClientConfig.js` | Loads `/employee/geo/client-config` |
| Attendance page | Historical view (separate from punch actions) |

**Modals in Dashboard:**

1. Outside office reason (`geoReasonModalOpen`) — ≥10 chars → `submitGeoReasonPunch`  
2. Repeat punch reason — ≥3 chars  
3. Extended hours (manual out &gt; 10h) — ≥3 chars  
4. NHQ web punch notice — only when `shouldWarnNhqWebPunch` (skipped after geo-reason confirm)

---

## 8. Jobs / schedulers

| Job | Role |
|-----|------|
| Auto punch-out scheduler (`scheduler.py` → punch auto-close) | Close overdue open sessions every ~2 minutes |
| Homepage load | May close overdue session for current user before rendering |

See module **17** for scheduler registration details.

---

## 9. Config / `.env`

| Area | Keys / location |
|------|-----------------|
| Engine mode | `GEO_ENGINE_MODE` (`LEGACY` \| `SHADOW` \| `V2`), `GEO_FENCE_V2`, `GEO_V2_FALLBACK_ON_ERROR` |
| Reason length | `GEO_REASON_MIN_CHARS` (via `geo_fence_config` / `reason_min_chars()`) |
| Confidence / accuracy | `ACC_GOOD`, `INSIDE_CONFIDENCE`, `OUTSIDE_CONFIDENCE`, … in `geo_fence_config.DEFAULTS` |
| Client GPS | `CLIENT_PUNCH_*`, `CLIENT_DASH_*`, `CLIENT_TRUSTED_CACHE_*` |
| Cap | Hardcoded `SESSION_CAP_SEC` in `punch_auto_close.py` (10h) |
| Max sessions | `MAX_PUNCH_SESSIONS_PER_DAY = 8` in `auth.py` |

Office coordinates are **DB** (`location` table), managed from HR “Add Location” UIs — not `.env`.

---

## 10. How to change safely

1. **Always** go through `validate_employee_location` for punch geo.  
2. Changing outside policy → update **backend** reason checks **and** Dashboard modal / `submitGeoReasonPunch`.  
3. Do not fire `auto_system_punch_out` unless the UI deadline matches server `evaluate_auto_close` (prevents 1–2s false auto-outs).  
4. NHQ: prefer UX warnings over silent backend blocks unless product explicitly demands a hard block.  
5. After adding PunchSession columns, add `_ensure_*` in `create_app` so old MySQL DBs upgrade.  
6. Biometric + web interaction (earliest scan, NHQ finalization) → change in `biometric/` carefully; add tests under `tests/test_biometric_*`.  
7. Aggregates: after any session mutate, call `recompute_punch_aggregate(punch)`.

---

## 11. Related modules

| Module | Why |
|--------|-----|
| 02 Auth | JWT identity for punch |
| 04 Leave / WFH | Approval applications that feed `is_wfh_allowed` |
| 07 Attendance engine | Day status / regularization beyond raw punches |
| 08 Biometric | Device IN/OUT, NHQ 20:00 finalization, source=biometric |
| 17 Schedulers | Auto punch-out job wiring |
| [ATTENDANCE_SSE.md](../ATTENDANCE_SSE.md) | Realtime events (does not write Punch) |

---

## 12. Quick test checklist

- [ ] Inside office → Check In succeeds without reason modal  
- [ ] Outside → reason &lt; 10 chars blocked; ≥10 succeeds  
- [ ] Pending WFH + outside → reason still required; session not marked WFH unless approved  
- [ ] Approved WFH + outside → punch without reason; `is_wfh` true when policy applies  
- [ ] Second punch-in same day → repeat reason required  
- [ ] Open overnight session → new day punch-in blocked until out  
- [ ] At 10h → client auto-out or scheduler closes; early auto-out returns 409  
- [ ] NHQ outside + reason Confirm → punches without stuck modal  
- [ ] On leave → punch-in 403  
