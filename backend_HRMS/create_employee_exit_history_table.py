#!/usr/bin/env python3
"""
Create employee_exit_history table (Option B - audit/history for exits).

Run on the server inside the app venv:
  python create_employee_exit_history_table.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def run():
    from website import create_app, db

    app = create_app()
    with app.app_context():
        db.session.execute(
            db.text(
                """
                CREATE TABLE IF NOT EXISTS employee_exit_history (
                    id INT NOT NULL AUTO_INCREMENT,
                    admin_id INT NOT NULL,
                    exit_date DATE NOT NULL,
                    exit_type VARCHAR(30) NULL,
                    exit_reason TEXT NULL,
                    created_by VARCHAR(120) NULL,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    KEY ix_employee_exit_history_admin_id (admin_id),
                    CONSTRAINT fk_employee_exit_history_admin_id
                        FOREIGN KEY (admin_id) REFERENCES admins(id)
                        ON DELETE CASCADE
                ) ENGINE=InnoDB;
                """
            )
        )
        db.session.commit()
        print("employee_exit_history table is ready.")


if __name__ == "__main__":
    run()

