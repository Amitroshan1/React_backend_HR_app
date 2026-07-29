# Geo-fencing V2 — Configuration Reference

All thresholds are defined in `backend_HRMS/website/geo_fence_config.py` and loaded into Flask `app.config` at startup.

Override any key via **environment variable** of the same name (no code change required).

## Feature flag

| Key | Default | Description |
|-----|---------|-------------|
| `GEO_FENCE_V2` | `true` | Enables V2 decision path on punch APIs (Phase 1+). |

## Confidence weights (must sum ≈ 1.0; auto-normalized if drifted)

| Key | Default | Description |
|-----|---------|-------------|
| `GPS_ACCURACY_WEIGHT` | `0.40` | Weight for GPS accuracy component |
| `GPS_CONSISTENCY_WEIGHT` | `0.25` | Weight for multi-sample spread |
| `SAMPLE_COUNT_WEIGHT` | `0.10` | Weight for sample count |
| `FRESHNESS_WEIGHT` | `0.10` | Weight for fix freshness |
| `DEVICE_WEIGHT` | `0.08` | Weight for mobile vs desktop |
| `NETWORK_WEIGHT` | `0.07` | Weight for office-network match (**confidence booster only — never grants INSIDE alone**) |

## Accuracy gates (meters)

| Key | Default | Description |
|-----|---------|-------------|
| `ACC_GOOD` | `30` | High-quality / primary early-stop accuracy |
| `ACC_USABLE` | `50` | Secondary early-stop accuracy |
| `ACC_MAX_MOBILE` | `250` | Above → `LOW_SIGNAL` on mobile |
| `ACC_MAX_DESKTOP` | `400` | Above → `LOW_SIGNAL` on desktop |

## Confidence cutoffs (0–100)

| Key | Default | Description |
|-----|---------|-------------|
| `INSIDE_CONFIDENCE` | `70` | `CONTAINED` + score ≥ this → `INSIDE` |
| `OUTSIDE_CONFIDENCE` | `60` | `DISJOINT` + score ≥ this → `OUTSIDE` |
| `UNCERTAIN_CONFIDENCE` | `0` | Reserved |

## GPS acquisition (client contract)

| Key | Default | Description |
|-----|---------|-------------|
| `MAX_GPS_ATTEMPTS` | `5` | Max `getCurrentPosition` attempts |
| `GPS_TIMEOUT_MS` | `8000` | Per-attempt timeout |
| `GPS_TOTAL_TIMEOUT_MS` | `12000` | Wall-clock acquisition window |
| `GPS_INTER_ATTEMPT_DELAY_MS` | `1500` | Delay between attempts |
| `EARLY_STOP_ACCURACY` | `30` | Primary early-stop accuracy (defaults to `ACC_GOOD`) |
| `EARLY_STOP_SPREAD_M` | `50` | Max spread for primary early-stop |
| `EARLY_STOP_ACCURACY_LOOSE` | `50` | Loose early-stop accuracy |
| `EARLY_STOP_SPREAD_LOOSE_M` | `75` | Max spread for loose early-stop |
| `EARLY_STOP_MIN_SAMPLES` | `2` | Min samples for primary early-stop |
| `EARLY_STOP_MIN_SAMPLES_LOOSE` | `3` | Min samples for loose early-stop |
| `OUTLIER_MIN_METERS` | `100` | Outlier gate floor: `max(this, 2 × best.accuracy)` |

## Office fence fallbacks

| Key | Default | Description |
|-----|---------|-------------|
| `DEFAULT_OFFICE_RADIUS_M` | `100` | Used when `location.radius` is null |
| `DEFAULT_OFFICE_GRACE_M` | `25` | Used when `location.grace` is null |

**Per-office values** live on the `location` table: `radius`, `grace` (office-specific).

## Other

| Key | Default | Description |
|-----|---------|-------------|
| `GEO_ATTEMPT_TTL_SECONDS` | `120` | Single-use `attempt_id` TTL |
| `GEO_REASON_MIN_CHARS` | `10` | Min reason length for Outside / weak GPS |

## Architecture rule (mandatory)

Office network / public IP match **increases confidence only**.  
It must **never** independently classify an employee as `INSIDE` or bypass geo validation.
