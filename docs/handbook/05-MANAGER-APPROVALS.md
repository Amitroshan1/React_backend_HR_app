# 05 — Manager approvals

**Audience:** developers changing the Manager panel, approval workflows, team scope, or leave balance debit on approve.  
**Blueprint:** `website/manager.py` → **`/api/manager`**  
**Helpers:** `manager_utils.py`, `leave_proxy_service.py` (on-behalf), `noc_department_service.py`  
**UI:** `frontend/src/pages/Manager/` (`Manager.jsx`, `api.js`, tab comps)  
**Related:** [04 Leave/WFH](./04-LEAVE-WFH-COMPOFF.md) · Claims deep dive → **11** · Performance/probation → **13** · Offboarding → **06**

---

## 1. Purpose

Manager (L1/L2/L3) inbox for **direct reports**:

1. Approve / reject **leave**, **WFH**, **claims**, **resignation**  
2. Department **NOC** upload/download  
3. Team exit / offboarding visibility  
4. Probation reviews, increment proposals, compensation band hints  
5. Optional **team attendance** (NHQ Engineering only)  
6. Optional **apply leave on behalf** of a report (policy-gated)

Access is **assignment-based** via `ManagerContact`, not merely `emp_type == Manager`.

---

## 2. Roles & authorization

### 2.1 Who can open Manager APIs

`_ensure_manager_user()`:

1. Resolve JWT → `Admin`  
2. `user_has_manager_access(admin)` — true if this admin appears as **L1, L2, or L3** on any `ManagerContact` row  

Else **403** `Manager access required`.

Frontend: `/manager` behind `RequirePanel panel="manager"`.

### 2.2 Who can act on a specific employee

`_is_manager_for_target(approver, target)`:

| Case | Result |
|------|--------|
| Target is in another company (tenant) | Never allowed; by-id records return **404** |
| Approver is L1/L2/L3 on target’s resolved `ManagerContact` | Allowed |
| Approver == target | Allowed only if self-approval role (see below) |
| Otherwise | **403** Not allowed for this employee |

List endpoints load the manager's company's candidates, then **filter** with this check (or team id set for counts).

### 2.3 Self-approval

Env / config: `MANAGER_SELF_APPROVAL_ROLES` (default in `create_app`: `manager,hr,human resource,admin`).

If role matches, manager may approve **their own** pending items; an `AuditLog` row is written (`_append_self_approval_audit_if_needed`).

### 2.4 ManagerContact model (concept)

Per company (`tenant_id`) + circle + user_type (and optional employee email), with admin ids for L1–L3. Resolution: `resolve_manager_contact_for_employee` + `is_manager_in_contact` in `manager_utils.py`. Circle/emp_type matching uses canonical aliases (HR / Accounts wording).

Multi-tenancy: contacts are always looked up in the employee's company (`tenant_manager_contacts()` / `manager_contacts_for(admin)` / `find_manager_contact(admin)`). A manager matches by admin id only, and only when the contact is in the manager's company. L1–L3 ids from another company are ignored when resolving names/emails and rejected by the setup upsert. Existing rows get `tenant_id` at startup from the linked managers (`ensure_manager_contact_tenant_id`).

---

## 3. Key tables

| Model | Use in this module |
|-------|--------------------|
| `ManagerContact` | Who manages whom |
| `LeaveApplication` | Leave inbox + approve debit |
| `WorkFromHomeApplication` | WFH inbox |
| `ExpenseClaimHeader` / `ExpenseLineItem` | Claim inbox (line-level Pending → Approved/Rejected) |
| `Resignation` | Resignation inbox |
| `LeaveBalance` / `CompOffGain` | Mutated on leave **approve** |
| `ProbationReview` | Probation tabs |
| `AuditLog` | Self-approval audit |
| NOC dept requests | Via `noc_department_service` |

---

## 4. Business rules

### 4.1 Common action payload

```json
{ "action": "approve" }
```
or `"reject"`. Anything else → **400**.

Only **Pending** leave / WFH / resignation can be updated → else **409**.

### 4.2 Leave approve → balance (critical)

On **approve** only (reject does **not** touch balances):

| Leave type | Balance effect |
|------------|----------------|
| Privilege Leave | Subtract `deducted_days` from PL; bump `used_privilege_leave` |
| Casual Leave | Subtract `requested_deducted_days` from CL; sandwich PL via `sandwich_pl_days` |
| Compensatory Leave | `deduct_comp_leave(admin_id, requested_deducted)`; fail **400** if insufficient/expired; bump `used_comp_leave` |
| Half Day Leave | If not pure LOP (`extra_days < 0.5`): take 0.5 from CL else PL |
| Optional Leave | No balance change |
| Sandwich (non-PL types) | Additionally subtract `sandwich_pl_days` from PL |

Then email: `send_leave_decision_email` (failures logged, API still 200).

### 4.3 WFH approve

Sets status Approved/Rejected; **no leave balance**. Email: `send_wfh_decision_email`. Approved WFH unlocks punch geo bypass (module **03**).

### 4.4 Claims approve

All **Pending** line items on the claim → Approved or Rejected together. If none pending → **409**. Header-level status inferred from lines in list serializers.

### 4.5 Resignation

Pending → Approved/Rejected (manager stage). Further HR exit processing is module **06**.

### 4.6 Team attendance gate

`GET /team-attendance` only if manager’s own `circle` ≈ NHQ **and** `emp_type` ≈ Engineering (`manager_can_view_nhq_engineering_team_attendance`). Frontend mirrors this in `managerTeamAttendanceEligibility.js`.

### 4.7 Leave on behalf

`POST /leave-requests/on-behalf`:

- Requires `leave_settings.manager_on_behalf_allowed` (default **false**)  
- Future/today dates only (IST); no backdate  
- Must be manager of `admin_id`  
- Creates Pending leave via `create_proxy_leave_application`  
- Reason ≥ 10 chars (stricter than employee’s 20 on self-apply? employee is 20 — manager proxy uses 10)

### 4.8 Pending counts

`GET /pending-counts` — badge numbers for leave, wfh, claim, resignation, noc for team (+ self if self-approval). Avoids loading five full lists.

---

## 5. API catalog (`/api/manager`)

All: **JWT** + manager access unless noted.

### 5.1 Identity / shell

| Method | Path | Notes |
|--------|------|-------|
| GET | `/scope` | `{ circle, emp_type, email }` |
| GET | `/profile` | Card: name, photo, assigned scopes from ManagerContact |
| GET | `/pending-counts` | Badge counts |
| GET | `/team-members` | Direct reports list |
| GET | `/team-offboarding` | Team exit visibility |

---

### 5.2 Leave

| Method | Path | Notes |
|--------|------|-------|
| GET | `/leave-requests?status=Pending\|Approved\|…\|all` | Filtered to managed employees; CompOff rows may include FIFO preview fields |
| POST | `/leave-requests/<id>/action` | Body `{ action }`; balance on approve |
| POST | `/leave-requests/on-behalf` | Proxy apply (policy flag) |

---

### 5.3 WFH

| Method | Path |
|--------|------|
| GET | `/wfh-requests?status=…` |
| POST | `/wfh-requests/<id>/action` |

---

### 5.4 Claims

| Method | Path | Notes |
|--------|------|-------|
| GET | `/claim-requests` | Managed employees’ claims |
| GET | `/claim-requests/<id>` | Detail + line items |
| GET | `/claim-requests/<id>/files/<line_item_id>` | Attachment (watermark PDF path) |
| POST | `/claim-requests/<id>/action` | Approve/reject all pending lines |

UI detail route: `/manager/claims/:claimId`.

---

### 5.5 Resignation & NOC

| Method | Path |
|--------|------|
| GET | `/resignation-requests` |
| POST | `/resignation-requests/<id>/action` |
| GET | `/noc-requests` |
| POST | `/noc-requests/<id>/upload` |
| GET | `/noc-requests/<id>/download` |

---

### 5.6 Team attendance

| Method | Path | Notes |
|--------|------|-------|
| GET | `/team-attendance?year=&month=` | NHQ Engineering only; punches + WFH flags + sessions |

---

### 5.7 Probation / compensation / performance-adjacent

| Method | Path | Notes |
|--------|------|-------|
| GET | `/probation-reviews` | |
| GET | `/probation-reviews-due` | |
| POST | `/probation-review` | Submit review |
| POST | `/increment-proposals` | |
| GET | `/compensation-band-hint?admin_id=` | Band hint for a report |
| GET | `/sprint-performance` | Sprint tallies (if used) |

Deeper product rules → module **13**.

---

## 6. Main flows

### 6.1 Approve leave

```text
Manager tab Leave
  → GET /leave-requests?status=Pending
  → POST /leave-requests/:id/action { "action": "approve" }
  → status Approved + LeaveBalance / CompOffGain updated
  → email employee
```

### 6.2 Approve WFH → punch

```text
POST /wfh-requests/:id/action { approve }
  → employee punches outside → location-check wfh_approved true
```

### 6.3 Claims

```text
ClaimRequests / ManagerClaimDetails
  → GET claim + files
  → POST …/action { approve|reject }
```

---

## 7. Frontend map

| File | Role |
|------|------|
| `Manager.jsx` | Tabs, counts, default tab to first pending |
| `api.js` | All `/api/manager` fetch helpers |
| `LeaveRequests.jsx` / `WFHRequests.jsx` / `ClaimRequests.jsx` / `ResignationRequests.jsx` / `NocRequests.jsx` | Inboxes |
| `ManagerClaimDetails.jsx` | Claim detail + files |
| `TeamOffboarding.jsx` | Exit visibility |
| `ManagerTeamAttendance.jsx` | NHQ Eng attendance |
| `ManagerProbationReviews.jsx` / `ManagerIncrementProposals.jsx` / `ManagerPerformanceReviews.jsx` | Talent tabs |
| `managerTeamAttendanceEligibility.js` | Client gate matching backend |

---

## 8. Jobs

No manager-specific scheduler. Probation due lists may be fed by commands (`commands/probation`) — see **13** / **17**.

---

## 9. Config

| Key | Effect |
|-----|--------|
| `MANAGER_SELF_APPROVAL_ROLES` | Comma list of emp_types allowed to self-approve |
| `leave_settings.json` → `manager_on_behalf_allowed` | Enable on-behalf leave |

ManagerContact rows are data (HR Admin setup), not env.

---

## 10. How to change safely

1. Never approve without `_is_manager_for_target` (IDOR risk).  
2. Keep leave debit logic aligned with apply-time `deducted_days` / `requested_deducted_days` / `sandwich_pl_days` (module **04**).  
3. CompOff approve must use `deduct_comp_leave` and rollback on failure.  
4. Self-approval: keep audit log; don’t widen roles casually.  
5. List endpoints that scan all rows then filter can get slow — prefer team_ids pattern used by `pending-counts` when optimizing.  
6. Team attendance: change gate in **both** `manager_utils` and `managerTeamAttendanceEligibility.js`.  
7. Claim line status vs Accounts final settlement — manager approve ≠ paid; Accounts module owns payout.

---

## 11. Related modules

| # | Why |
|---|-----|
| 04 | Leave/WFH apply creates Pending items |
| 06 | HR exit after resignation; ManagerContact maintenance |
| 11 | Claim create / Accounts review after manager |
| 13 | Performance & probation product detail |
| 03 | Approved WFH affects punch |

---

## 12. Quick test checklist

- [ ] Non-L1/L2/L3 user → 403 on `/api/manager/*`  
- [ ] Manager sees only reports’ pending leave/WFH  
- [ ] Approve PL reduces PL balance; reject does not  
- [ ] Approve CompOff with expired gains → 400  
- [ ] Approve WFH → employee punch shows `wfh_approved`  
- [ ] Claim approve flips all pending lines  
- [ ] NHQ Engineering sees Attendance tab; others 403 on API  
- [ ] On-behalf disabled by default; when enabled, past dates rejected  
