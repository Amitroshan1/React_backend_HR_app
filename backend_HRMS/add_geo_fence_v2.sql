-- Geo-fencing V2 — additive schema (MySQL / MariaDB).
-- Safe to run multiple times if you guard with information_schema checks;
-- app also auto-migrates via _ensure_* on startup.

-- Office-specific grace (meters). NULL → DEFAULT_OFFICE_GRACE_M from geo_fence_config.
ALTER TABLE location
  ADD COLUMN grace FLOAT NULL DEFAULT 25;

-- Punch attempt audit / analytics
CREATE TABLE IF NOT EXISTS geo_punch_attempts (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  attempt_id VARCHAR(64) NOT NULL,
  admin_id INT NULL,
  punch_session_id INT NULL,
  direction VARCHAR(10) NOT NULL,
  latitude DOUBLE NULL,
  longitude DOUBLE NULL,
  accuracy_m DOUBLE NULL,
  distance_m DOUBLE NULL,
  office_id INT NULL,
  office_name VARCHAR(120) NULL,
  radius_m DOUBLE NULL,
  grace_m DOUBLE NULL,
  confidence_score DOUBLE NULL,
  geo_decision VARCHAR(30) NULL,
  spatial_class VARCHAR(20) NULL,
  policy_action VARCHAR(30) NULL,
  network_match TINYINT(1) NOT NULL DEFAULT 0,
  device_type VARCHAR(20) NULL,
  browser VARCHAR(80) NULL,
  operating_system VARCHAR(80) NULL,
  user_agent VARCHAR(512) NULL,
  sample_count INT NULL,
  spread_m DOUBLE NULL,
  retry_count INT NULL,
  acquisition_ms INT NULL,
  client_ip VARCHAR(64) NULL,
  flag_reason VARCHAR(80) NULL,
  error_code VARCHAR(60) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_geo_attempt_id (attempt_id),
  KEY ix_geo_attempts_admin (admin_id),
  KEY ix_geo_attempts_created (created_at),
  KEY ix_geo_attempts_session (punch_session_id),
  KEY ix_geo_attempts_office (office_id)
);
