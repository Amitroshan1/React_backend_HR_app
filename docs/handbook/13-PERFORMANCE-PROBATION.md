# 13 — Performance & probation

**Audience:** developers changing monthly self-reviews, manager ratings, 6-month probation confirm/extend/fail, or reminder jobs.  
**Performance blueprint:** `website/performance_api.py` → **`/api/performance`**  
**Probation blueprint:** `website/probation_api.py` → **`/api/probation`**  
**Also:** manager routes on `/api/manager/probation-*`; HR aliases on `/api/HumanResource/probation-*`  
**Utils:** `probation_utils.py`, `employment_status.py`, `commands/probation.py`  
**UI:** `/performance`, Manager performance/probation tabs, `HRProbationReviews.jsx`  
**Related:** [05 Manager](./05-MANAGER-APPROVALS.md) · [06 HR](./06-HR-CORE.md) · [09 Accounts](./09-ACCOUNTS.md) (salary revision) · [17 Schedulers](./17-SCHEDULERS.md)

> Two products share this handbook page: **monthly performance** (employee → manager) and **probation lifecycle** (scheduler → manager → HR).

---

## 1. Purpose

### Performance
Monthly employee self-assessment (achievements / challenges / goals) → manager rating + comments → locked. Optional HR report API.

### Probation
DOJ-based ~**6-month** cycle: T-15 manager reminder → manager recommendation → HR **confirmed** / **extended** / **failed** → employment status, optional salary revision, confirmation letter.

---

## 2. Roles

| Actor | Performance | Probation |
|-------|-------------|-----------|
| Employee | `POST /self`, `GET /my`; dashboard/profile status read-only | `GET /api/probation/self` (+ auth homepage/profile payload) |
| Manager (L1–L3) | Queue + review if `_is_manager_for_target` | List due/pending; `POST /api/manager/probation-review` |
| HR | Optional `GET /hr/report` (hr emp_type) | `can_access_hr_operations` → `/api/probation/hr/*` and HumanResource aliases |
| Accounts | — | Pending `SalaryRevisionRequest` after confirm (`revision_type=probation`) |

No dedicated plan feature keys; HR uses standard HR ops gate.

---

## 3. Key tables / models

| Model | Table | Role |
|-------|-------|------|
| `EmployeePerformance` | `employee_performance` | Self-review; `status` default `Pending`; unique **`employee_name` + `month`** |
| `ManagerReview` | `manager_reviews` | 1:1 rating/comments for a performance row |
| `ProbationReview` | `probation_reviews` | Unique `(admin_id, probation_end_date)` |
| `Admin` employment fields | via `employment_status` | `employment_status`, `probation_start_date`, `probation_end_date`, `probation_duration_months` |
| `SalaryRevisionRequest` | — | Created on HR confirm |
| `ManagerContact` | — | Reminder recipient + manager scope |

---

## 4. Business rules

### 4.1 Performance cycle

| Rule | Detail |
|------|--------|
| Month key | Free-form string; UI uses `YYYY-MM` |
| Submit | Employee upsert; requires `month` + `achievements` → status **`Submitted`** |
| Review | Manager sets rating + comments → creates `ManagerReview`, status **`Reviewed`** |
| Lock | If `row.review` exists → **409** `"Performance already reviewed and locked"` |
| Ratings (UI) | `Excellent` / `Good` / `Average` / `Needs Improvement` — backend accepts any non-empty string |
| Overdue (summary) | Submitted &gt; 7 days and not reviewed |
| Email | `send_performance_submitted_email`, `send_performance_reviewed_email` |

Default DB status `Pending` is uncommon once upsert runs (sets `Submitted`).

**Schema caveat:** uniqueness is on `employee_name`+`month`, while API logic keys by `admin_id`+`month` — rename collisions / duplicate names are a risk.

### 4.2 Probation timing constants (`probation_utils`)

| Constant | Value | Meaning |
|----------|-------|---------|
| Duration | ~6 months (`PROBATION_MONTHS`) | From DOJ / admin overrides |
| `REMINDER_DAYS_BEFORE` | 15 | Initial manager reminder |
| `FOLLOWUP_DAYS_BEFORE` | 7 | Follow-up reminder |
| `OVERDUE_GRACE_DAYS` | 30 | Overdue escalation window |
| `HR_DECISION_GRACE_DAYS` | 90 | HR list windows |
| `MANAGER_SUBMITTED_HISTORY_DAYS` | 180 | Submitted history retention in lists |

### 4.3 Probation review statuses (stored)

| Status | Meaning |
|--------|---------|
| `reminder_sent` | Reminder cycle open; manager can submit |
| `manager_submitted` | Awaiting HR |
| `hr_confirmed` | Terminal — confirmed on role |
| `hr_extended` | Terminal for this end date; new cycle may open |
| `hr_failed` | Terminal — failed (no auto exit in this path) |

`TERMINAL_STATUSES` = confirmed / extended / failed. Legacy rows: `infer_status_from_row`.

### 4.4 Manager recommendation → HR decision

| Manager `manager_recommendation` | HR `decision` |
|----------------------------------|---------------|
| `confirm` | `confirmed` |
| `extend` | `extended` (+ `extended_until` or `extension_months` 1–12) |
| `not_recommend` | `failed` |

Manager submit only after a reminder row exists; cannot re-submit if already submitted/closed.

### 4.5 HR decision side effects

| Decision | Effects |
|----------|---------|
| `confirmed` | `transition_to_on_role`; pending salary revision; emails; confirmation letter PDF available |
| `extended` | `apply_probation_extension`; `extended_until`; **new** `ProbationReview` for new end date |
| `failed` | Sets `hr_failed` only — does **not** auto mark-exit |

Employee-facing labels (`build_employee_probation_status`): `on_probation`, `review_pending`, `awaiting_hr`, `confirmed`, `extended`, `failed`. Confirmation dashboard banner: same-day only when configured.

Eligible for manager queue: probation employment + window T-15 … end+30d (`is_probation_review_eligible`).

### 4.6 Known code footgun

`apply_hr_probation_decision` sets `row.status = STATUS_HR_FAILED` on fail, but **`STATUS_HR_FAILED` is not imported** in `probation_api.py` (only confirmed/extended/reminder/manager_submitted). **Failed decisions may raise `NameError` until the import is fixed.** Prefer importing from `probation_utils` alongside the others.

---

## 5. API catalog

### 5.1 `/api/performance`

| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| POST | `/self` | `upsert_self_performance` | Employee upsert |
| GET | `/my` | `my_performance_list` | Own history |
| GET | `/manager/queue` | `manager_queue` | `?status=` |
| POST | `/manager/review/<id>` | `manager_review` | Lock after review |
| GET | `/manager/summary` | `manager_summary` | Counts / overdue |
| GET | `/hr/report` | `hr_report` | HR emp_type; little/no SPA consumer |

### 5.2 `/api/probation`

| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/self` | `employee_probation_status` | Employee card |
| GET | `/hr/reviews` | `hr_probation_reviews` | Filters: `all`, `awaiting_hr`, `pending_manager`, `overdue`, `closed` |
| POST | `/hr/decision` | `hr_probation_decision` | Body: `probation_review_id`, `decision`, notes, extension fields |

### 5.3 `/api/manager` (probation + related)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/probation-reviews` | `pending` / `submitted` / `all` |
| GET | `/probation-reviews-due` | Due soon |
| POST | `/probation-review` | Manager submit |
| GET | `/sprint-performance` | Leave/WFH/claim **tally** — **not** monthly performance |

Manager SPA “sprint” widget often calls **`/api/performance/manager/summary`** instead — do not confuse the two.

### 5.4 `/api/HumanResource` (aliases)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/probation-reviews` | Same list as probation HR |
| POST | `/probation-decision` | Same decision logic |
| GET | `/employees/<id>/confirmation-letter/pdf` | After confirm |

DOJ / employment updates call `sync_probation_for_admin`. HR inbox may queue type `probation`. Auth homepage/profile attach `probation` via `build_employee_probation_status`.

---

## 6. Main flows

### 6.1 Monthly performance

```text
Employee POST /api/performance/self  → Submitted + email managers
  → Manager GET /manager/queue
  → POST /manager/review/<id>        → Reviewed + ManagerReview + email
  → (optional) HR GET /hr/report
```

### 6.2 Probation

```text
Daily job / CLI run_probation_reminder
  → ensure ProbationReview + T-15 reminder_sent (+ T-7 / overdue emails)
  → Manager POST /api/manager/probation-review  → manager_submitted
  → HR POST …/probation-decision               → confirmed|extended|failed
  → employment / salary revision / letter side effects
```

---

## 7. Frontend map

| UI | Route / entry | APIs |
|----|---------------|------|
| Employee performance | `/performance` → `EmployeePerformance.jsx` | `/api/performance/self`, `/my` |
| Manager performance | `/manager/performance-reviews` + Manager tab | `/manager/queue`, `/manager/review/:id` |
| Manager probation | Manager tab `probation` → `ManagerProbationReviews.jsx` | `/api/manager/probation-reviews*`, `probation-review` |
| Sprint widget | `SprintPerformance.jsx` | Often `/api/performance/manager/summary` |
| HR probation | HR view → `HRProbationReviews.jsx` | HumanResource probation-* + confirmation PDF |
| Confirmation snippet | `ConfirmationRequest.jsx` | `awaiting_hr` filter |
| Dashboard / Profile | Probation card | auth `probation` payload |

No top-level `/probation` App route — embedded in Manager/HR panels.

---

## 8. Jobs / CLI

| Job | When | Function |
|-----|------|----------|
| `daily_hr_jobs` | cron **06:01** IST | includes `run_probation_reminder(today)` |

Flask CLI (`commands/probation.py`):

| Command | Purpose |
|---------|---------|
| `flask probation-reminder [--run-date] [--dry-run]` | Run reminder pipeline |
| `flask probation-sync` | Same `run_probation_reminder` |
| `flask probation-dedupe` | `dedupe_probation_review_rows` |

Internals: `_process_backfill`, `_process_initial_reminders`, `_process_followup_reminders`, `_process_overdue_escalations`, `_ensure_probation_review_cycle`.

No performance scheduler — request-driven.

---

## 9. Config

| Source | Role |
|--------|------|
| `PROBATION_MONTHS` / leave accrual helpers | Default end date from DOJ |
| Admin probation date columns | Overrides |
| `EMAIL_HR` | Manager→HR notify on submit |
| Employment statuses | `STATUS_PROBATION`, `STATUS_ON_ROLE`, … |
| Scheduler TZ | Asia/Kolkata |

---

## 10. How to change safely

1. Fix **`STATUS_HR_FAILED` import** before relying on fail decisions in production.  
2. Do not change status string literals without updating `infer_status_from_row`, filters, and FE labels together.  
3. Performance unique key (`employee_name`+`month`) is fragile — prefer migrating to `admin_id`+`month` carefully.  
4. Ratings: if you need a closed set, validate in `manager_review`, not only in React.  
5. Extension creates a **new** review row — use `sync_probation_for_admin` after DOJ/employment edits; avoid dual writers.  
6. Distinguish `/api/manager/sprint-performance` (tally) vs `/api/performance/manager/summary`.  
7. Failed HR decision does not mark exit — wire to offboarding (**06**) explicitly if product requires it.  
8. Confirmation letter and salary revision are side effects of confirm — keep Accounts/HR flows in sync.
9. Performance queries go through `_tenant_performance_query()` (entries of the caller's company): HR report, manager queue / summary / review (another company's entry → 404). Covered by `tests/test_shared_db_multitenancy_security_audit.py`.

---

## 11. Related modules

| # | Boundary |
|---|----------|
| 05 | Manager queue routes + tabs |
| 06 | HR decision UI, DOJ sync, confirmation letter, inbox |
| 09 | Pending salary revision after confirm |
| 17 | Daily HR jobs / probation CLI |
| 04 | Leave accrual may treat probation months differently |

```text
performance_api.py
models/Performance.py
probation_api.py
models/probation.py
probation_utils.py
employment_status.py
commands/probation.py
manager.py              # probation-review*
Human_resource.py       # aliases + letter PDF
```

---

## 12. Quick test checklist

- [ ] Employee submit month → `Submitted`; re-edit before review works  
- [ ] Manager review → `Reviewed` + lock; second review → **409**  
- [ ] Non-manager cannot review another team’s performance → **403**  
- [ ] Probation reminder creates `reminder_sent` at T-15  
- [ ] Manager submit → `manager_submitted`; HR list `awaiting_hr`  
- [ ] HR confirm → on-role + salary revision pending + letter PDF  
- [ ] HR extend → new end date + new review row  
- [ ] HR fail → `hr_failed` (verify import fix); employee not auto-exited  
- [ ] Second HR decision on terminal row → **400**  
- [ ] Employee dashboard probation labels match status  
- [ ] `flask probation-reminder --dry-run` runs without error  
