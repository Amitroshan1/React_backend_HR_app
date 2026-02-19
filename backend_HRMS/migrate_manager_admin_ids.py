"""
Migration script: Add l1_admin_id, l2_admin_id, l3_admin_id to manager_contacts.
Run: python migrate_manager_admin_ids.py
Or with Flask: flask shell < migrate_manager_admin_ids.py
"""
import os
import sys

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from website import create_app, db

def run_migration():
    app = create_app()
    with app.app_context():
        # Add columns if they don't exist (SQLite / MySQL / PostgreSQL compatible)
        try:
            db.session.execute(db.text("ALTER TABLE manager_contacts ADD COLUMN l1_admin_id INTEGER"))
            db.session.commit()
            print("Added l1_admin_id")
        except Exception as e:
            db.session.rollback()
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                print("l1_admin_id already exists")
            else:
                raise
        try:
            db.session.execute(db.text("ALTER TABLE manager_contacts ADD COLUMN l2_admin_id INTEGER"))
            db.session.commit()
            print("Added l2_admin_id")
        except Exception as e:
            db.session.rollback()
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                print("l2_admin_id already exists")
            else:
                raise
        try:
            db.session.execute(db.text("ALTER TABLE manager_contacts ADD COLUMN l3_admin_id INTEGER"))
            db.session.commit()
            print("Added l3_admin_id")
        except Exception as e:
            db.session.rollback()
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                print("l3_admin_id already exists")
            else:
                raise
        print("Migration complete.")

if __name__ == "__main__":
    run_migration()
