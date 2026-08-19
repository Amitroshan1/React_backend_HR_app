# ITAM P3 — Canonical lifecycle + custody

**Flag:** `ITAM_LIFECYCLE_V1` (default `0`)  
**Depends on:** P0–P2 (transitions/timeline recommended)

## What shipped

- Dual-write columns on `it_asset_units`: `lifecycle_status`, `custody_type`, `custody_json`
- Open/closed custody table: `it_asset_custodies` (≤1 open row per unit)
- `website/itam/lifecycle_service.py` — resolve / apply / backfill
- Mutations write lifecycle when flag **ON**:
  - Employee assign → **CheckedOut** + **EMPLOYEE**
  - Location deploy → **Deployed** + **LOCATION** (no longer looks like employee assign)
  - Return / undeploy / repair / quarantine / retire mapped accordingly
- Unit serializers expose `lifecycleStatus`, `statusLabel`, `custodyType`, `custodyLabel`, `isCheckedOut`, `isDeployed`
- `POST /api/it/itam/backfill-lifecycle`
- Frontend `lifecycleUi.js` badges on inventory detail + assigned asset cards

## Dual-write rules

| Canonical | Legacy `status` (kept for old filters/counts) |
|-----------|-----------------------------------------------|
| InStock | `available` |
| CheckedOut | `assigned` |
| Deployed | `assigned` |
| InRepair | `repair` |
| Quarantine | `not-working` |
| Retired | `dead` |

`Deployed` vs `CheckedOut` is distinguished by `lifecycle_status` + custody — not by legacy status alone.

## Enable

```env
ITAM_LIFECYCLE_V1=1
```

Recommended with:

```env
ITAM_TRANSITIONS_V1=1
ITAM_TIMELINE_V1=1
```

Restart backend. Optional hydrate:

```http
POST /api/it/itam/backfill-lifecycle
{ "limit": 500 }
```

## Rollback

```env
ITAM_LIFECYCLE_V1=0
```

API stops attaching / writing lifecycle fields; legacy `status` continues to work. Columns + custody rows retained.

## QA checklist

- [ ] Flag OFF: assign/deploy unchanged; no lifecycle fields on unit JSON
- [ ] Flag ON: employee assign → `lifecycleStatus=CheckedOut`, `custodyType=EMPLOYEE`
- [ ] Flag ON: vehicle/equipment deploy → `lifecycleStatus=Deployed`, `custodyType=LOCATION`, no `assignedTo`
- [ ] Flag ON: undeploy → `InStock` / `NONE`; open custody closed
- [ ] At most one open custody per unit after mutations
- [ ] UI shows canonical status / custody labels
- [ ] `GET /api/it/itam/meta` → `itam_lifecycle_v1: true`

## Tests

```bash
python backend_HRMS/tests/test_itam_p0_contracts.py
python backend_HRMS/tests/test_itam_p1_transitions.py
python backend_HRMS/tests/test_itam_p2_timeline.py
python backend_HRMS/tests/test_itam_p3_lifecycle.py
```

## Out of scope (later)

- Kill localStorage dual-write (P4)
- Employee self-service (P5)
- Offboarding / NOC gate (P6)
