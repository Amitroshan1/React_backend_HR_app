# ITAM status mapping (live behind `ITAM_LIFECYCLE_V1` — Phase P3)

When the flag is **OFF**, writers still use legacy `status` strings only.

When the flag is **ON**, dual-write populates `lifecycle_status` + `custody_type` while keeping legacy `status` for existing filters/counts.

## Canonical statuses

| Status | Meaning |
|--------|---------|
| Ordered | PO raised |
| InTransit | Shipment inbound |
| Received | GRN done, awaiting tag |
| InStock | Available in store |
| Reserved | Hold for approved request |
| CheckedOut | Employee custody |
| Deployed | Location / site custody |
| PendingReturn | Return request open |
| InRepair | Vendor / internal repair |
| Quarantine | Not-working / forensics |
| Exported | Left org stock |
| Retired | EOL / dead / wiped |
| Lost | Missing |

## Legacy → canonical

| Legacy (`ITAssetUnit.status` / UI) | Canonical | Notes |
|------------------------------------|-----------|-------|
| `available` | InStock | |
| `assigned` | CheckedOut | Default employee path |
| `assigned` + Office/Transport/Infra (no employee) | Deployed | P3 must disambiguate |
| `not-working` / `notWorking` | Quarantine | |
| `repair` / `in-repair` / `inRepair` | InRepair | |
| `exported` | Exported | |
| `removed_from_it` / `removed` | Quarantine | Holding bay; refine in P3 if needed |
| `dead` / `deleted` | Retired | |

## Custody types (P3)

| Type | Use |
|------|-----|
| EMPLOYEE | CheckedOut |
| LOCATION | Deployed |
| VENDOR | InRepair at vendor |
| NONE | InStock / terminal |

## Source of truth in code

`backend_HRMS/website/itam/lifecycle.py` — `LEGACY_STATUS_MAP`, `canonical_status()`.
