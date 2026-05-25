-- Run once on MySQL/MariaDB after deploying server-side auto punch-out.
ALTER TABLE punch_sessions
    ADD COLUMN auto_punched_out TINYINT(1) NOT NULL DEFAULT 0;
