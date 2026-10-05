# 17 — Schedulers & background jobs

**Audience:** developers adding, changing, or debugging Flask-APScheduler jobs, daily HR batch work, or related Flask CLI commands.  
**Registration:** `website/__init__.py` → `SCHEDULER_JOBS` + `APScheduler`  
**Job bodies:** `website/scheduler.py`  
**CLI:** `website/commands/*` (same functions, manual / backfill)  
**Related:** [01 Architecture](./01-ARCHITECTURE.md) · [03 Punch](./03-DASHBOARD-PUNCH-GEO.md) · [04 Leave/CompOff](./04-LEAVE-WFH-COMPOFF.md) · [08 Biometric](./08-BIOMETRIC.md) · [13 Probation](./13-PERFORMANCE-PROBATION.md) · [14 Day-use](./14-IT-ITAM.md) · [06 HR assessments](./06-HR-CORE.md)

> All scheduled work runs **inside the Flask process** (Flask-APScheduler). There is no separate worker queue. Multi-worker gunicorn can run the same job **N times** unless the job is idempotent / claim-guarded.

---

## 1. Purpose

1. **Register** cron/interval jobs at app boot (`create_app`)  
2. **Daily HR batch** — probation, CompOff, leave accrual, leave-pending email, assessment recording purge, LWD deactivation, offboarding reminders  
3. **Near-real-time attendance** — 10h auto punch-out; NHQ biometric last-scan sync (18–21 IST + catch-up)  
4. **IT day-use** — overdue holds, PDF retry, email outbox flush  
5. **CLI parity** — same pipelines runnable with `--run-date` / `--dry-run` for ops

Domain rules live in the modules above; this page is the **ops map** (when, what, how to rerun safely).

---

## 2. Roles

| Actor | Access |
|-------|--------|
| Server process | Runs all jobs automatically after `scheduler.start()` |
| Ops / engineer | Flask CLI from `backend_HRMS` with app context |
| End users | No direct scheduler UI or HTTP API |

`SCHEDULER_API_ENABLED = False` — no APScheduler HTTP management endpoints.

---

## 3. Key tables / models (job side-effects)

| Model / concern | Touched by |
|-----------------|------------|
| `probation_reviews` + emails | `run_probation_reminder` |
| `comp_off_gains`, `leave_balance.compensatory_*` | `run_compoff_process` |
| `leave_balance`, `leave_accrual_log` | `_run_leave_accrual_for_date` |
| `leave_applications.pending_reminder_sent_at` | `run_leave_pending_reminder` |
| `assessment_invites` recording fields + files | `purge_expired_assessment_recordings` |
| `admins.is_active` / `exit_login_until`, `audit_log` | `run_lwd_deactivation_job` |
| `offboarding_reminder_log` + emails | `run_offboarding_reminders` |
| `punch_sessions` (open → closed) | `process_auto_punch_outs` |
| Biometric logs / NHQ `Punch`/`PunchSession` | last-scan sync / catch-up / mapping reprocess |
| Day-use requests, docs, outbox | `mark_overdue_and_notify`, `retry_pending_pdfs`, `flush_outbox` |

No dedicated “job runs” table. Idempotency uses **event keys**, **claim timestamps**, **dedupe keys**, or **reminder_log** rows.

---

## 4. Business rules & edge cases

### 4.1 Boot & timezone

| Rule | Detail |
|------|--------|
| Set app | `scheduler.set_app(app)` before jobs run |
| TZ | `SCHEDULER_TIMEZONE = Asia/Kolkata`; daily HR uses `datetime.now(IST).date()` |
| HTTP API | Disabled |
| Failure isolation | `run_daily_hr_jobs` runs the bundle once per company (§4.7); each step is try/except so one failure does not abort siblings; commit **per company** (rollback + log on failure, other companies unaffected) |

### 4.2 Multi-worker / duplicate runs

APScheduler starts **per process**. With multiple gunicorn workers, interval/cron jobs may fire in parallel.

| Job family | Guard |
|------------|-------|
| CompOff Sunday gains | `dedupe_key` + `IntegrityError` nested; daily dedupe of triples |
| Leave pending reminder | Atomic claim on `pending_reminder_sent_at` before send; release on send fail |
| Offboarding reminders | `OffboardingReminderLog.reminder_key` claim (`_claim_reminder`) |
| Leave accrual | `leave_accrual_log` unique `(admin_id, event_key)` |
| Probation | Dedupes review rows; “already sent” skips |
| Biometric / auto punch-out | Designed for frequent re-entry; prefer same close outcome |

**Footgun:** email-sending jobs without a claim can spam if workers race. Prefer the leave-pending / offboarding pattern for new reminder jobs.

### 4.3 Daily HR bundle (`daily_hr_jobs` @ 06:01 IST)

Order inside `run_daily_hr_jobs_for_tenant` (called once per active company, inside its `tenant_scope`):

1. **Probation** — backfill, T-15, T-7 follow-up, overdue escalation (module **13**)  
2. **CompOff** — Sunday gains (max 2/month, 62-day lookback), balance sync, expiry reminder at **T-7**  
3. **Leave accrual** — Jan 1 year reset (PL carry cap **45**); **20th** PL/CL credit per schedule; skips ineligible / on probation  
4. **Leave pending** — status `Pending`, age ≥ **6** days, one reminder to managers (+ HR CC)  
5. **LWD deactivation** — `is_exited` + `exit_login_until < today` → `is_active=False`  
6. **Offboarding reminders** — LWD at **7/3/1** days; NOC SLA overdue (**5** days)  
7. Commit (this company)

After all companies: **Assessment recordings** — purge files **15** days after HR first view (one global run: it only deletes files by age and sends no email), then commit.

Accrual on non-20th / non-Jan-1 days still scans admins (ensure balance rows) but credits/resets no-op.

### 4.4 Auto punch-out (every 2 min)

| Rule | Detail |
|------|--------|
| Cap | **10h** per open segment (`SESSION_CAP_SEC`); prior closed segments do not reduce remaining |
| Clock-out time | Cap deadline even if job runs late |
| GPS | Scheduler close uses `AUTO_PUNCH_NO_LIVE_GPS` — no fake geofence copy |
| NHQ same-day bio open | **Skipped** by 10h path; last-scan / catch-up owns OUT (module **08**) |
| Also | Homepage / punch load may close overdue sessions for that user |

### 4.5 Biometric last-scan

| Job | Behavior |
|-----|----------|
| Sync every **5s** | Active **18:00–21:00 IST** only; no-ops outside; does **not** close single-scan days |
| Catch-up **21:05** + **06:10** | `force=True`, `allow_single_scan_out=True` |
| Mapping reprocess **06:20** | Retry mapping failures; exhaust ghost PINs → `unmapped_permanent` (no invented punch) |

Former 20:00 finalize + 22:00 late-scan crons are **removed** (CLI `biometric-finalize-day` remains for manual/legacy).

### 4.6 Day-use (every 15 min)

`mark_overdue_and_notify` → `retry_pending_pdfs` → `flush_outbox`. See module **14**.

### 4.7 Tenancy

| Rule | Detail |
|------|--------|
| Which companies | `tenant_jobs.job_tenant_ids()` = tenant 1 + every tenant not `suspended` / `cancelled` (suspended companies get no reminders, accruals or deactivations until re-activated) |
| Company scope | `run_for_each_tenant` wraps each company in `tenant_context.tenant_scope(tid)`: `get_current_tenant_id()`, tenant helpers, `get_plan()` and `company_mailbox()` resolve to that company although there is no JWT |
| Job functions | `run_probation_reminder`, `run_compoff_process`, `_run_leave_accrual_for_date`, `run_leave_pending_reminder`, `run_lwd_deactivation_job`, `run_offboarding_reminders`, `dedupe_*` take `tenant_id=None`; None = all companies. Scans filter with `admin_scope(tid)` / `admin_id_scope(column, tid)` |
| Mailboxes | Emails read HR / Accounts / IT / Admin addresses via `company_mailbox(key)`: `tenants.mailbox_*` → `.env` (tenant 1 only) → none. Company 2 never CCs the platform HR inbox |
| CLI | Email-sending commands loop per company in scope (`run_in_each_tenant_scope`) and print summed counts; `--dry-run` still rolls back everything |
| Global on purpose | Auto punch-out, biometric sync / catch-up / reprocess (no emails; per `admin_id` / device), Day-use job (routes by the request's company), assessment purge |

---

## 5. API catalog

**No HTTP APIs** for the scheduler itself.

Ops surface = **Flask CLI** (section 8) + logs (`scheduler: …` on `app.logger`).

---

## 6. Main flows

### 6.1 App boot

```text
create_app()
  → register CLI commands
  → set_app(app)
  → APScheduler(config SCHEDULER_JOBS)
  → init_app + start()
```

### 6.2 Daily HR (06:01)

```text
cron daily_hr_jobs
  → run_daily_hr_jobs()
      → for each active company (tenant_scope):
          probation → compoff → leave accrual → leave-pending
          → LWD deactivate → offboarding reminders → commit
      → purge recordings (global) → commit
```

### 6.3 NHQ evening OUT

```text
18:00–21:00  every 5s sync (latest scan → OUT; skip single-scan)
21:05        force catch-up + single-scan OUT
06:10        morning catch-up if evening missed
```

### 6.4 10h cap

```text
every 2 min  process_auto_punch_outs()
  → for each open PunchSession: close if past deadline
  → skip NHQ same-day biometric opens
```

---

## 7. Frontend

None. UI reflects job outcomes (closed punches, CompOff ledger, probation inbox, day-use overdue) via normal APIs.

---

## 8. Jobs / schedulers (canonical table)

Registered in `__init__.py` → `SCHEDULER_JOBS`:

| Job id | Trigger | Function | What it does |
|--------|---------|----------|--------------|
| `daily_hr_jobs` | cron **06:01** IST | `run_daily_hr_jobs` | Bundle §4.3 |
| `auto_punch_out_scan` | interval **2 min** | `run_auto_punch_out_job` | 10h auto OUT |
| `biometric_last_scan_sync` | interval **5 s** | `run_biometric_last_scan_sync_job` | NHQ last-scan window |
| `biometric_last_scan_catchup_evening` | cron **21:05** | `run_biometric_last_scan_catchup_job` | Force + single-scan |
| `biometric_last_scan_catchup_morning` | cron **06:10** | same catch-up | Morning safety net |
| `biometric_mapping_reprocess` | cron **06:20** | `run_biometric_mapping_reprocess_job` | Map-failure retry |
| `daily_checkout_jobs` | interval **15 min** | `run_daily_checkout_job` | Day-use overdue/PDF/outbox |

### Flask CLI (manual / backfill)

Run from `backend_HRMS` with env loaded (same as app).

| Command | Mirrors |
|---------|---------|
| `flask probation-reminder [--run-date] [--dry-run]` | Probation pipeline |
| `flask probation-sync` | Same `run_probation_reminder` |
| `flask probation-dedupe` | Merge duplicate review rows |
| `flask compoff-process [--run-date] [--dry-run]` | Sunday gains + reminders |
| `flask compoff-dedupe` | Duplicate Sunday gain cleanup |
| `flask leave-accrual-run [--run-date] [--dry-run]` | Accrual for a date |
| `flask leave-pending-reminder [--run-date] [--dry-run]` | 6+ day pending leaves |
| `flask offboarding-daily` | LWD deactivation |
| `flask offboarding-reminders [--run-date] [--dry-run]` | LWD / NOC SLA emails |
| `flask biometric-finalize-day […]` | Legacy day finalize (not on scheduler) |
| `flask biometric-rebuild-attendance-days` | Rebuild attendance-day rows |
| `flask biometric-reprocess-mapping` | Mapping reprocess |
| `flask biometric-mapping-audit` | Map / emp_id audit |
| `flask uploads-relocate [--apply] [--kind] [--tenant]` | One-off: move legacy uploads into `tenants/{id}/` (dry run by default; see chapter 15) |
| `flask uploads-relocate-cleanup MANIFEST [--apply]` / `uploads-relocate-rollback MANIFEST [--apply]` | Delete the old files / undo a relocation run |
| `flask itam-extract-photos [--apply]` | One-off: turn IT `data:` photos into `tenants/{id}/itam/` files (dry run by default) |

Assessment recording purge has **no** dedicated CLI — only the daily HR bundle (or call `purge_expired_assessment_recordings` in a shell).

---

## 9. Config / `.env`

| Key / setting | Role |
|---------------|------|
| `SCHEDULER_TIMEZONE` | Hardcoded `Asia/Kolkata` in `__init__.py` |
| `SCHEDULER_API_ENABLED` | `False` |
| `BIOMETRIC_NHQ_SERIALS` | Which devices get last-scan policy (module **08**) |
| Email / Zepto | All reminder sends |
| `leave_settings.json` | Accrual eligibility adjacent (employment / contract flags) |
| Gunicorn worker count | Multiplies in-process schedulers — prefer **1** worker for jobs **or** rely on claim/idempotency |

No `ENABLE_SCHEDULER` kill switch today — jobs start whenever `create_app` completes. Disabling = comment/remove job entry or run a process without starting the app that registers them (not recommended ad hoc).

---

## 10. How to change safely

1. **Add a job** in three places: implement `run_*` in `scheduler.py` (app context + try/except + rollback), register in `SCHEDULER_JOBS`, add Flask CLI in `commands/` when ops backfill matters.  
2. Prefer **idempotent** writes and **claim-before-email** for reminders.  
3. Keep **IST** consistent for “today” date math; don’t mix naive UTC date with cron IST.  
4. Changing NHQ window / single-scan: update `biometric/finalization.py` **and** job ids/triggers together; tests: `test_biometric_day_finalization.py`.  
5. Changing 10h cap: `punch_auto_close.py` + module **03**; keep NHQ skip intact.  
6. Leave accrual day (**20**) / carry cap (**45**): `leave_accrual_schedule.py` / `leave_accrual.py` — don’t credit outside `_run_leave_accrual_for_date` without event keys.  
7. Do **not** invent biometric punches from reprocess exhaust path.  
8. After changing daily bundle order, ensure commit still once per company at the end (or document per-step commits like leave-pending claims).  
9. Multi-tenant: a new per-employee job takes `tenant_id=None`, filters its scans with `admin_scope` / `admin_id_scope`, and is called from `run_daily_hr_jobs_for_tenant` (never a global scan inside the per-company loop). Emails use `company_mailbox(key)`, never `current_app.config.get("EMAIL_HR")` etc. Tests: `test_shared_db_multitenancy_schedulers.py`.

---

## 11. Related modules

| # | Topic |
|---|--------|
| 03 | Client + server 10h punch-out |
| 04 | CompOff gains / leave pending fields |
| 06 | Assessment recording retention |
| 08 | NHQ sync / reprocess / bridge |
| 13 | Probation reminder pipeline |
| 14 | Day-use overdue / outbox |
| 16 | Future tenant-aware jobs |
| 18 | Plans/env (planned) — deploy/process layout |

---

## Checklist

- [ ] New reminder job: claim/idempotency before email  
- [ ] New cron: listed in `SCHEDULER_JOBS` + `scheduler.py` + INDEX/this doc  
- [ ] CLI `--dry-run` rolls back where mutations exist  
- [ ] Biometric schedule change covered by finalization tests  
- [ ] Multi-worker: verified no duplicate emails / double gains  
- [ ] Logs searchable: `scheduler:` prefix  
- [ ] Per-employee job: `tenant_id` param + `admin_scope` filter, run per company via `run_daily_hr_jobs_for_tenant`; mailboxes via `company_mailbox`  
