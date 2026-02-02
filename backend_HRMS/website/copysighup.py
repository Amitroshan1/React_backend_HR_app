from website import create_app, db
from .models.signup import Signup
from website.models.Admin_models import Admin
from datetime import datetime

def migrate_signup_to_admin():
    app = create_app()

    with app.app_context():
        signups = Signup.query.all()
        print(f"🔍 Found {len(signups)} Signup records")

        migrated = 0
        created = 0
        skipped = 0

        for s in signups:
            if not s.email:
                skipped += 1
                continue

            admin = Admin.query.filter_by(email=s.email).first()

            # ------------------------------------------------
            # CASE 1: Admin already exists → update missing
            # ------------------------------------------------
            if admin:
                updated = False

                if not admin.first_name and hasattr(s, "first_name"):
                    admin.first_name = s.first_name
                    updated = True

                if not admin.emp_id and hasattr(s, "emp_id"):
                    admin.emp_id = s.emp_id
                    updated = True

                if not admin.mobile and hasattr(s, "mobile"):
                    admin.mobile = s.mobile
                    updated = True

                if not admin.doj and hasattr(s, "doj"):
                    admin.doj = s.doj
                    updated = True

                if not admin.emp_type and hasattr(s, "emp_type"):
                    admin.emp_type = s.emp_type
                    updated = True

                if not admin.circle and hasattr(s, "circle"):
                    admin.circle = s.circle
                    updated = True

                if admin.is_active is None:
                    admin.is_active = True
                    updated = True

                if updated:
                    migrated += 1

            # ------------------------------------------------
            # CASE 2: Admin does NOT exist → create new
            # ------------------------------------------------
            else:
                admin = Admin(
                    email=s.email,
                    first_name=getattr(s, "first_name", None),
                    emp_id=getattr(s, "emp_id", None),
                    mobile=getattr(s, "mobile", None),
                    doj=getattr(s, "doj", None),
                    emp_type=getattr(s, "emp_type", None),
                    circle=getattr(s, "circle", None),
                    is_active=True,
                    created_at=datetime.utcnow()
                )
                db.session.add(admin)
                created += 1

        db.session.commit()

        print("✅ MIGRATION COMPLETED")
        print(f"🟢 Updated existing admins: {migrated}")
        print(f"🆕 Created new admins: {created}")
        print(f"⚠️ Skipped records: {skipped}")

if __name__ == "__main__":
    migrate_signup_to_admin()

'''README - Migrate Signup to Admin

Step 1: Activate venv
source venv/bin/activate

Step 2: Run script
python scripts/migrate_signup_to_admin.py


📌 Run only once '''