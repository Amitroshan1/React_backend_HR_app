-- Run once on MySQL/MariaDB after deploying extended-hours punch-out reason.
ALTER TABLE punch_sessions
    ADD COLUMN extended_hours_reason VARCHAR(500) NULL
    AFTER repeat_reason;
