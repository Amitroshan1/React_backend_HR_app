# ITAM P0 — Contracts & feature flags

**Phase:** P0  
**Contract version:** `itam-p0-2026-08-13`  
**Behavior change:** None. Flags default **OFF**. No UI remarks/timeline yet.

## Goals (exit criteria)

- [x] TransitionRecord field contract frozen
- [x] Action codes + remark policies frozen
- [x] Legacy → canonical status mapping draft
- [x] Feature flags exist (env + Flask config + frontend mirror), default OFF
- [x] Read-only `GET /api/it/itam/meta`
- [x] Empty `it_asset_transitions` table creatable (no writers)
- [x] Rollout checklist documented

## Feature flags

| Flag | Env var | Phase | Default |
|------|---------|-------|---------|
| `itam_transitions_v1` | `ITAM_TRANSITIONS_V1` | P1 | `0` |
| `itam_timeline_v1` | `ITAM_TIMELINE_V1` | P2 | `0` |
| `itam_lifecycle_v1` | `ITAM_LIFECYCLE_V1` | P3 | `0` |
| `itam_api_first_v1` | `ITAM_API_FIRST_V1` | P4 | `0` |
| `itam_self_service_v1` | `ITAM_SELF_SERVICE_V1` | P5 | `0` |
| `itam_offboard_gate_v1` | `ITAM_OFFBOARD_GATE_V1` | P6 | `0` |

Frontend optional mirrors: `VITE_ITAM_TRANSITIONS_V1`, etc. (also default off). Prefer server meta cache after sync.

### `.env` example (keep OFF in prod until phase ships)

```env
ITAM_TRANSITIONS_V1=0
ITAM_TIMELINE_V1=0
ITAM_LIFECYCLE_V1=0
ITAM_API_FIRST_V1=0
ITAM_SELF_SERVICE_V1=0
ITAM_OFFBOARD_GATE_V1=0
```

## API contracts (planned)

### P0 (live)

`GET /api/it/itam/meta` — JWT + IT panel. Returns contract version, flags, actions, remark policies, lifecycle map, planned endpoints.

### P1 (not registered yet)

`POST /api/it/units/<unit_id>/transitions`

```json
{
  "action_code": "CHECKOUT",
  "remark": "Issued laptop for project Alpha onboarding",
  "reason_code": null,
  "condition_grade": null,
  "custody": { "type": "EMPLOYEE", "admin_id": 123 },
  "related": {},
  "attachments": []
}
```

Errors: `400` policy/remark; `404` unit; `409` illegal transition.

Also planned: software license + inventory item transition variants.

### P2 (not registered yet)

`GET /api/it/units/<unit_id>/timeline?action=&from=&to=&q=&page=&limit=`

## Code locations

| Area | Path |
|------|------|
| Backend package | `backend_HRMS/website/itam/` |
| ORM (unused writers) | `ITAssetTransition` in `models/it_models.py` |
| Meta route | `GET /api/it/itam/meta` in `it.py` |
| Frontend flags | `frontend/src/utils/itamFlags.js` |
| Frontend contracts | `frontend/src/pages/IT/itam/contracts.js` |

## What P0 does **not** do

- Does not require remarks on assign/repair/etc.
- Does not change existing `/assignments` or `/units/<id>/status` behavior
- Does not rename live status values in DB
- Does not show History UI

Next: **P1** — `transition_service` + remark modal behind `itam_transitions_v1`.
