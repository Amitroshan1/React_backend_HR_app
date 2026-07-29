-- Geo Analytics Step 5 — optional ops indexes / config tables
-- Safe to run multiple times (MySQL 8+ / MariaDB may need IF NOT EXISTS adaptations).

CREATE TABLE IF NOT EXISTS geo_config_overrides (
  id INT AUTO_INCREMENT PRIMARY KEY,
  config_key VARCHAR(80) NOT NULL,
  config_value TEXT NOT NULL,
  updated_at DATETIME NOT NULL,
  updated_by_admin_id INT NULL,
  UNIQUE KEY uq_geo_config_key (config_key),
  KEY ix_geo_config_key (config_key)
);

CREATE TABLE IF NOT EXISTS geo_config_changes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  version INT NOT NULL,
  config_key VARCHAR(80) NOT NULL,
  old_value TEXT NULL,
  new_value TEXT NOT NULL,
  reason VARCHAR(500) NOT NULL,
  changed_by_admin_id INT NULL,
  changed_by_email VARCHAR(120) NULL,
  created_at DATETIME NOT NULL,
  KEY ix_geo_cfg_ver (version),
  KEY ix_geo_cfg_key (config_key),
  KEY ix_geo_cfg_by (changed_by_admin_id),
  KEY ix_geo_cfg_at (created_at)
);

-- Analytics query helpers (ignore errors if already present)
CREATE INDEX ix_geo_attempts_created_decision ON geo_punch_attempts (created_at, geo_decision);
CREATE INDEX ix_geo_attempts_created_office ON geo_punch_attempts (created_at, office_id);
CREATE INDEX ix_geo_attempts_created_policy ON geo_punch_attempts (created_at, policy_action);
CREATE INDEX ix_geo_attempts_created_browser ON geo_punch_attempts (created_at, browser);
CREATE INDEX ix_geo_attempts_decision_created ON geo_punch_attempts (geo_decision, created_at);
