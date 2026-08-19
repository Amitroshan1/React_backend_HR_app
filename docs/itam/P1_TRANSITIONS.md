# ITAM P1 — Remarks + Transition engine

**Flag:** `ITAM_TRANSITIONS_V1` (default `0`)  
**Depends on:** P0

## What shipped

- `website/itam/transition_service.py` — remark enforce + append-only `ITAssetTransition`
- Existing mutators record transitions when flag **ON**:
  - assign / return unit & software
  - unit status (repair / not-working / available)
  - unit delete (RETIRE)
  - return-request create / approve / reject / complete
  - inventory-stock deploy / return (UNDEPLOY)
- `POST /api/it/units/<id>/transitions` — dedicated API (409 if flag OFF)
- Frontend `TransitionRemarkModal` + provider in `AppLayout`
- Wired on Inventory status actions, InRepair restore, Assign/Unassign, Return Requests
- Data.js APIs accept `remark` / `notes` / `reason_code` / `condition_grade`

## Enable in staging/prod

```env
ITAM_TRANSITIONS_V1=1
```

Restart backend. Frontend syncs flags via `GET /api/it/itam/meta`.

## Rollback

```env
ITAM_TRANSITIONS_V1=0
```

Legacy flows work without remarks; existing transition rows remain (append-only).

## QA checklist

- [ ] Flag OFF: assign/repair/return work without modal
- [ ] Flag ON: empty remark blocked (UI + API 400)
- [ ] Flag ON: successful assign writes `it_asset_transitions` row (`CHECKOUT`)
- [ ] Flag ON: repair / not-working / restore write correct action codes
- [ ] Flag ON: return request reject uses rejection text as remark
- [ ] `GET /api/it/itam/meta` shows `itam_transitions_v1: true`

## Tests

```bash
python backend_HRMS/tests/test_itam_p0_contracts.py
python backend_HRMS/tests/test_itam_p1_transitions.py
```

## Out of scope (later phases)

- Canonical status rename (P3)
- Kill localStorage dual-write (P4)
