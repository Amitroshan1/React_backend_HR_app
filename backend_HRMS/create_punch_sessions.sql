-- Run once on MySQL/MariaDB. Links each in→out segment to existing punch rows.
CREATE TABLE IF NOT EXISTS punch_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    punch_id INT NOT NULL,
    clock_in DATETIME NOT NULL,
    clock_out DATETIME NULL,
    repeat_reason VARCHAR(500) NULL,
    extended_hours_reason VARCHAR(500) NULL,
    is_wfh TINYINT(1) NOT NULL DEFAULT 0,
    lat DOUBLE NULL,
    lon DOUBLE NULL,
    location_status VARCHAR(30) NULL,
    CONSTRAINT fk_punch_sessions_punch FOREIGN KEY (punch_id) REFERENCES punch(id) ON DELETE CASCADE,
    INDEX ix_punch_sessions_punch_id (punch_id)
);
