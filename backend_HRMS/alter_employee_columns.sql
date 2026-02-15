-- Run this once to fix "Data too long" errors for gender, marital_status, mobile, emergency_mobile.
--
-- IN MYSQL WORKBENCH: Select your database first (double-click it under SCHEMAS), then run this file.
-- OR replace YOUR_DATABASE_NAME below with your actual DB name (e.g. hrms, backend_hrms) and run.

USE YOUR_DATABASE_NAME;

ALTER TABLE employees MODIFY COLUMN gender VARCHAR(50) NOT NULL;
ALTER TABLE employees MODIFY COLUMN marital_status VARCHAR(50) NOT NULL;
ALTER TABLE employees MODIFY COLUMN mobile VARCHAR(20) NOT NULL;
ALTER TABLE employees MODIFY COLUMN emergency_mobile VARCHAR(50) NOT NULL;

-- If audit_logs is missing the meta column (error: Unknown column 'metadata' or 'meta'):
-- ALTER TABLE audit_logs ADD COLUMN meta JSON NULL;

-- If punch table is missing location_status (error: Unknown column 'punch.location_status'):
ALTER TABLE punch ADD COLUMN location_status VARCHAR(30) NULL;
