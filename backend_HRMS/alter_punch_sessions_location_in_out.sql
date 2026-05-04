-- Punch in vs punch out geofence (run once on MySQL/MariaDB).
-- App sets location_status_in at punch-in and location_status_out at punch-out.

ALTER TABLE punch_sessions ADD COLUMN location_status_in VARCHAR(30) NULL;
ALTER TABLE punch_sessions ADD COLUMN location_status_out VARCHAR(30) NULL;

-- Best-effort backfill: legacy location_status was overwritten at punch-out when closed.
UPDATE punch_sessions
SET location_status_out = location_status
WHERE clock_out IS NOT NULL AND location_status IS NOT NULL AND location_status_out IS NULL;

UPDATE punch_sessions
SET location_status_in = location_status
WHERE clock_out IS NULL AND location_status IS NOT NULL AND location_status_in IS NULL;
