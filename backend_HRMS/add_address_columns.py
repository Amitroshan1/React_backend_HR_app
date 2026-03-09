#!/usr/bin/env python3
"""Add present_city, present_taluka, permanent_city, permanent_taluka to employees table."""
import os
import sys

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def run():
    from website import create_app
    from website import db
    app = create_app()
    with app.app_context():
        try:
            db.session.execute(db.text("""
                ALTER TABLE employees ADD COLUMN permanent_city VARCHAR(100);
            """))
        except Exception as e:
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                pass
            else:
                print(f"permanent_city: {e}")
        try:
            db.session.execute(db.text("""
                ALTER TABLE employees ADD COLUMN permanent_taluka VARCHAR(100);
            """))
        except Exception as e:
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                pass
            else:
                print(f"permanent_taluka: {e}")
        try:
            db.session.execute(db.text("""
                ALTER TABLE employees ADD COLUMN present_city VARCHAR(100);
            """))
        except Exception as e:
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                pass
            else:
                print(f"present_city: {e}")
        try:
            db.session.execute(db.text("""
                ALTER TABLE employees ADD COLUMN present_taluka VARCHAR(100);
            """))
        except Exception as e:
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                pass
            else:
                print(f"present_taluka: {e}")
        try:
            db.session.execute(db.text("""
                ALTER TABLE employees ADD COLUMN reporting_manager_name VARCHAR(150);
            """))
        except Exception as e:
            if "duplicate column" in str(e).lower() or "already exists" in str(e).lower():
                pass
            else:
                print(f"reporting_manager_name: {e}")
        db.session.commit()
        print("Migration completed.")

if __name__ == "__main__":
    run()
