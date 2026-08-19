# ITAM P0 / P1+ rollout checklist

Use this checklist for every ITAM phase promotion to production.

## Per-phase production gate

- [ ] Phase scope only (no N+1 leakage)
- [ ] Migration expandable / non-destructive
- [ ] Feature flag defaults **OFF** before deploy
- [ ] Deploy with flag OFF → smoke existing IT flows
- [ ] Enable flag in staging → QA checklist
- [ ] Enable flag in prod (one customer / canary if possible)
- [ ] Monitoring / error toasts verified
- [ ] Rollback: set flag `0` + restart; document any data left behind (append-only OK)

## P0 deploy checklist

- [ ] Pull code containing `website/itam/` + `ITAssetTransition`
- [ ] Confirm env flags unset or `0`
- [ ] Restart backend; confirm startup log or table `it_asset_transitions` created (empty)
- [ ] As IT user: `GET /api/it/itam/meta` → `success: true`, all flags `false`
- [ ] Confirm assign / repair / return still work **without** remark modal
- [ ] Run unit tests: `pytest backend_HRMS/tests/test_itam_p0_contracts.py -q`

## P1 enable (future)

```env
ITAM_TRANSITIONS_V1=1
```

- [ ] Remark required on assign, repair, restore, deploy, return complete, dispose
- [ ] Empty remark → 400 / UI blocked
- [ ] Rows appear in `it_asset_transitions`
- [ ] Rollback: `ITAM_TRANSITIONS_V1=0` (old endpoints remain)
- [ ] See `docs/itam/P1_TRANSITIONS.md`

## P2 enable

```env
ITAM_TIMELINE_V1=1
```

Prefer also:

```env
ITAM_TRANSITIONS_V1=1
```

- [ ] Asset History tab / History buttons show P1 transitions + remarks
- [ ] CSV export works
- [ ] Unit list `lastRemark` populated when history exists
- [ ] Rollback: flag OFF hides UI; data retained
- [ ] See `docs/itam/P2_TIMELINE.md`

## P3 enable

```env
ITAM_LIFECYCLE_V1=1
```

- [ ] Employee assign → CheckedOut + EMPLOYEE custody
- [ ] Location deploy → Deployed + LOCATION (not employee-assigned semantics)
- [ ] Dual-write keeps legacy `status` for old filters
- [ ] Optional `POST /itam/backfill-lifecycle`
- [ ] Rollback: flag OFF; columns retained
- [ ] See `docs/itam/P3_LIFECYCLE.md`

## Contacts / ownership

- Backend: `website/itam/`, `it.py`
- Frontend: `utils/itamFlags.js`, `pages/IT/itam/`
- Docs: `docs/itam/`
