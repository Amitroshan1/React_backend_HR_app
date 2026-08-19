# ITAM P2 — Asset History Timeline

**Flag:** `ITAM_TIMELINE_V1` (default `0`)  
**Depends on:** P0 (table + contracts). Best with P1 (`ITAM_TRANSITIONS_V1=1`) so new actions write remarks.

## What shipped

- `website/itam/timeline_service.py` — paginated query, latest-by-unit map, CSV export, assignment backfill
- APIs (409 when flag OFF):
  - `GET /api/it/units/<id>/timeline`
  - `GET /api/it/units/<id>/timeline.csv`
  - `GET /api/it/software/licenses/<id>/timeline`
  - `POST /api/it/itam/backfill-assignment-history`
- `GET /api/it/units` attaches `lastRemark` / `lastTransition` / `lastTransitionAt` when flag ON
- Frontend `AssetHistoryTimeline` (+ CSV export)
- Wired:
  - Inventory asset detail → **Details | History** tabs
  - In Repair → **History** action
  - Assigned employee panel → **History** on hardware cards

## Enable in staging/prod

```env
ITAM_TRANSITIONS_V1=1
ITAM_TIMELINE_V1=1
```

Restart backend. Frontend syncs flags via `GET /api/it/itam/meta`.

Optional one-time hydrate from assignment rows (IT admin):

```http
POST /api/it/itam/backfill-assignment-history
{ "limit": 500 }
```

## Rollback

```env
ITAM_TIMELINE_V1=0
```

History UI/APIs hide; `it_asset_transitions` rows remain (append-only).

## QA checklist

- [ ] Flag OFF: no History tab / History buttons; timeline routes return 409
- [ ] Flag ON + P1 ON: assign/repair writes appear in History with remark
- [ ] Search remarks filters timeline
- [ ] Export CSV downloads with action/remark/actor columns
- [ ] Unit list shows `lastRemark` when transitions exist
- [ ] `GET /api/it/itam/meta` shows `itam_timeline_v1: true`

## Tests

```bash
python backend_HRMS/tests/test_itam_p0_contracts.py
python backend_HRMS/tests/test_itam_p1_transitions.py
python backend_HRMS/tests/test_itam_p2_timeline.py
```

## Out of scope (later phases)

- Kill localStorage dual-write (P4)
- Employee self-service (P5)
