from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager
from flask_bcrypt import Bcrypt
from flask_migrate import Migrate
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
import os

# Load .env
base_dir = os.path.abspath(os.path.dirname(__file__))
dotenv_path = os.path.join(base_dir, '..', '.env')
load_dotenv(dotenv_path)

# ---------------------------
# Initialize extensions
# ---------------------------
db = SQLAlchemy()
bcrypt = Bcrypt()
migrate = Migrate()
jwt = JWTManager()
login_manager = LoginManager()   # ✅ ADD THIS


def create_app():
    app = Flask(__name__)

    # ---------------------------
    # Config
    # ---------------------------
    app.config['SECRET_KEY'] = os.getenv("SECRET_KEY")
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv("DATABASE_URI")
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    # JWT configuration
    app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "super-secret-key")
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = 86400  # 1 day

    app.config["BASE_URL"] = os.getenv(
        "BASE_URL",
        "https://solviotec.com"
    )

    app.config["ZEPTO_API_KEY"] = os.getenv("ZEPTO_API_KEY")
    app.config["ZEPTO_SENDER_EMAIL"] = os.getenv("ZEPTO_SENDER_EMAIL")
    app.config["ZEPTO_SENDER_NAME"] = os.getenv("ZEPTO_SENDER_NAME")
    app.config["ZEPTO_BASE_URL"] = os.getenv("ZEPTO_BASE_URL")
    app.config["ZEPTO_CC_HR"] = os.getenv("ZEPTO_CC_HR")
    app.config["ZEPTO_CC_ACCOUNT"] = os.getenv("ZEPTO_CC_ACCOUNT")
    app.config["ZEPTO_CC_IT"] = os.getenv("ZEPTO_CC_IT")
    app.config["EMAIL_HR"] = os.getenv("EMAIL_HR")
    app.config["EMAIL_ACCOUNTS"] = os.getenv("EMAIL_ACCOUNTS")
    app.config["EMAIL_IT"] = os.getenv("EMAIL_IT")
    app.config["EMAIL_ADMIN"] = os.getenv("EMAIL_ADMIN")
    app.config["MANAGER_SELF_APPROVAL_ROLES"] = os.getenv(
        "MANAGER_SELF_APPROVAL_ROLES",
        "manager,hr,human resource,admin",
    )

    # Uploads root for payslips/form16 etc. Set UPLOADS_ROOT in production to absolute path if files live elsewhere.
    app.config["UPLOADS_ROOT"] = os.getenv("UPLOADS_ROOT")
    _max_upload_mb = int(os.getenv("MAX_CONTENT_LENGTH_MB", "800"))
    app.config["MAX_CONTENT_LENGTH"] = _max_upload_mb * 1024 * 1024

    # Vendor master instance: show "New customer deployment" in Admin panel (0 on per-customer servers)
    app.config["SHOW_DEPLOYMENT_GUIDE"] = os.getenv("SHOW_DEPLOYMENT_GUIDE", "0").strip() in (
        "1", "true", "yes", "on",
    )

    _raw_plan = os.getenv("CUSTOMER_PLAN", "essential").strip().lower()
    app.config["CUSTOMER_PLAN"] = (
        _raw_plan if _raw_plan in ("basic", "essential", "enterprise") else "essential"
    )

    # ---------------------------
    # Enable CORS
    # ---------------------------
    # Use CORS_ORIGINS in env as comma-separated list for production.
    raw_cors_origins = os.getenv(
        "CORS_ORIGINS",
        ",".join(
            [
                "https://solviotec.com",
                "https://www.solviotec.com",
                "https://test.solviotec.com",
                "http://localhost:5173",
                "http://localhost:3000",
                "http://127.0.0.1:5173",
                "http://127.0.0.1:3000",
            ]
        ),
    )
    _cors_origins = [o.strip() for o in raw_cors_origins.split(",") if o.strip()]
    if not _cors_origins:
        _cors_origins = [
            "https://solviotec.com",
            "https://test.solviotec.com",
        ]

    CORS(
        app,
        resources={r"/api/*": {"origins": _cors_origins}},
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        expose_headers=["Content-Type"],
    )

    def _add_cors_headers(response):
        origin = None
        if request:
            origin = request.headers.get("Origin")
            if not origin and request.referrer and request.referrer.startswith("http"):
                idx = request.referrer.find("/", 8)
                origin = request.referrer[:idx] if idx != -1 else request.referrer
        if not origin or origin not in _cors_origins:
            origin = _cors_origins[0]  # fallback so 500 responses still get CORS
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        return response

    @app.after_request
    def after_request_cors(response):
        return _add_cors_headers(response)

    @app.errorhandler(500)
    def handle_500(e):
        response = jsonify(success=False, message="Internal server error")
        response.status_code = 500
        return _add_cors_headers(response)

    # ---------------------------
    # Initialize extensions
    # ---------------------------
    db.init_app(app)
    bcrypt.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    login_manager.init_app(app)          # ✅ INIT LOGIN MANAGER
    login_manager.login_view = "auth.login"

    # ---------------------------
    # Import Models
    # ---------------------------
    from .models.Admin_models import Admin
    from .models.attendance import LeaveBalance, LeaveApplication, CompOffGain, Punch, PunchSession
    from .models.query import Query, QueryReply
    from .models.emp_detail_models import Employee
    from .models.education import Education, UploadDoc
    from .models.family_models import FamilyDetails
    from .models.prev_com import PreviousCompany
    from .models.notification import Notification
    from .models.master_data import MasterData
    from .models.leave_accrual_log import LeaveAccrualLog
    from .models.holiday_calendar import HolidayCalendar
    from .models.probation import ProbationReview
    from .models.employee_accounts import EmployeeAccounts
    from .models.employee_tax_declaration import (
        EmployeeTaxDeclaration,
        TaxDeclarationItem,
        TaxDeclarationDocument,
        TaxDeclarationApprovalHistory,
    )
    from .models.ctc_breakup import CTCBreakup
    from .models.ctc_breakup_revision import CTCBreakupRevision
    from .models.employee_salary_loan import EmployeeSalaryLoan
    from .models.fnf_settlement import FnfSettlement
    from .models.monthly_payroll import MonthlyPayroll
    from .models.assessment import AssessmentInvite
    from .models.employee_circle_history import EmployeeCircleHistory
    from .models.it_models import (
        ITInventoryItem,
        ITInventoryQuantityAssignment,
        ITOfficeStockDeployment,
        ITAssetUnit,
        ITSoftwareLicense,
        ITAssetAssignment,
        ITAssetReturnRequest,
        ITSupportTicket,
        ITRemovedAsset,
        ITDeletedAssetLog,
        ITParcelExport,
        ITParcelExportItem,
        ITParcelImport,
    )

    # ---------------------------
    # Flask-Login user loader
    # ---------------------------
    @login_manager.user_loader
    def load_user(user_id):
        from .offboarding_service import admin_login_allowed

        user = Admin.query.get(int(user_id))
        if not user:
            return None
        if not admin_login_allowed(user):
            return None
        return user


    # ---------------------------
    # Create tables (DEV ONLY — set RUN_DB_CREATE_ALL=0 on production/test servers)
    # ---------------------------
    if os.getenv("RUN_DB_CREATE_ALL", "0").strip() == "1":
        with app.app_context():
            try:
                db.create_all()
            except Exception as e:
                # e.g. MySQL 1050 table already exists (redeploy / multi-worker gunicorn boot)
                err = str(e).lower()
                if "already exists" in err or "1050" in err:
                    app.logger.warning(
                        "db.create_all skipped existing tables: %s", e
                    )
                else:
                    app.logger.error("db.create_all failed: %s", e, exc_info=True)
                    raise

    # ---------------------------
    # Register Blueprints
    # ---------------------------
    from .auth import auth
    from .leave_attendence import leave
    from .Human_resource import hr
    from .query import query
    from .Accounts import Accounts
    from .manager import manager
    from .it import it_bp

    # from .manager import manager
    from .Admin import admin_bp
    from .notifications import notifications
    from .performance_api import performance_api
    from .probation_api import probation_api

    app.register_blueprint(auth, url_prefix="/api/auth")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(leave, url_prefix="/api/leave")
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(Accounts, url_prefix="/api/accounts")
    app.register_blueprint(query, url_prefix="/api/query")
    app.register_blueprint(manager, url_prefix="/api/manager")
    app.register_blueprint(it_bp, url_prefix="/api/it")
    app.register_blueprint(notifications, url_prefix="/api/notifications")
    app.register_blueprint(performance_api, url_prefix="/api/performance")
    app.register_blueprint(probation_api, url_prefix="/api/probation")

    # Lightweight schema patch: free-text parcel tracking (no admin FK required)
    def _ensure_parcel_name_columns():
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            tables = set(insp.get_table_names())
            dialect = db.engine.dialect.name

            def addcol(table, col):
                if table not in tables:
                    return
                existing = {c["name"] for c in insp.get_columns(table)}
                if col in existing:
                    return
                if dialect == "postgresql":
                    stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} VARCHAR(120) NULL')
                else:
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} VARCHAR(120) NULL")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s for parcel free-text tracking", table, col)

            addcol("it_parcel_imports", "received_by_name")
            addcol("it_parcel_exports", "exported_by_name")
            addcol("it_parcel_exports", "inventory_category")
            addcol("it_parcel_export_items", "make")
        except Exception as e:
            app.logger.warning("Parcel name column migration skipped: %s", e)

    def _ensure_expense_line_item_rejection_reason():
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            table = "expense_line_item"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            if "rejection_reason" in existing:
                return
            dialect = db.engine.dialect.name
            if dialect == "postgresql":
                stmt = text(f'ALTER TABLE "{table}" ADD COLUMN rejection_reason TEXT NULL')
            else:
                stmt = text(f"ALTER TABLE {table} ADD COLUMN rejection_reason TEXT NULL")
            with db.engine.begin() as conn:
                conn.execute(stmt)
            app.logger.info("Added column %s.rejection_reason", table)
        except Exception as e:
            app.logger.warning("expense_line_item rejection_reason migration skipped: %s", e)

    def _ensure_punch_session_auto_punched_out():
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            table = "punch_sessions"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            if "auto_punched_out" in existing:
                return
            dialect = db.engine.dialect.name
            if dialect == "postgresql":
                stmt = text(
                    f'ALTER TABLE "{table}" ADD COLUMN auto_punched_out BOOLEAN NOT NULL DEFAULT FALSE'
                )
            else:
                stmt = text(
                    f"ALTER TABLE {table} ADD COLUMN auto_punched_out TINYINT(1) NOT NULL DEFAULT 0"
                )
            with db.engine.begin() as conn:
                conn.execute(stmt)
            app.logger.info("Added column %s.auto_punched_out", table)
        except Exception as e:
            app.logger.warning("punch_sessions auto_punched_out migration skipped: %s", e)

    def _cleanup_zero_qty_inventory_rows():
        """
        Remove legacy zero-quantity Accessories/Consumables rows that have no
        related units/licenses/logs. This keeps Inventory Overview clean.
        """
        try:
            from .models.it_models import (
                ITAssetUnit,
                ITDeletedAssetLog,
                ITInventoryItem,
                ITRemovedAsset,
                ITSoftwareLicense,
            )

            rows = ITInventoryItem.query.filter(
                db.func.lower(db.func.coalesce(ITInventoryItem.category, "")).in_(["accessories", "consumables"]),
                db.func.coalesce(ITInventoryItem.total_quantity, 0) <= 0,
                db.func.coalesce(ITInventoryItem.available_quantity, 0) <= 0,
                db.func.coalesce(ITInventoryItem.assigned_quantity, 0) <= 0,
            ).all()

            removed = 0
            for item in rows:
                has_links = any(
                    (
                        ITAssetUnit.query.filter_by(inventory_item_id=item.id).first() is not None,
                        ITSoftwareLicense.query.filter_by(inventory_item_id=item.id).first() is not None,
                        ITRemovedAsset.query.filter_by(inventory_item_id=item.id).first() is not None,
                        ITDeletedAssetLog.query.filter_by(inventory_item_id=item.id).first() is not None,
                    )
                )
                if has_links:
                    continue
                db.session.delete(item)
                removed += 1

            if removed:
                db.session.commit()
                app.logger.info("Cleaned %s legacy zero-qty inventory row(s)", removed)
            else:
                db.session.rollback()
        except Exception as e:
            db.session.rollback()
            app.logger.warning("Zero-qty inventory cleanup skipped: %s", e)

    def _ensure_it_return_request_table():
        try:
            from sqlalchemy import inspect
            from .models.it_models import ITAssetReturnRequest

            insp = inspect(db.engine)
            if "it_asset_return_requests" in set(insp.get_table_names()):
                return
            ITAssetReturnRequest.__table__.create(bind=db.engine, checkfirst=True)
            app.logger.info("Created table it_asset_return_requests")
        except Exception as e:
            app.logger.warning("IT return request table ensure skipped: %s", e)

    def _ensure_it_return_request_columns():
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            table = "it_asset_return_requests"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            with db.engine.begin() as conn:
                if "return_destination" not in existing:
                    conn.execute(
                        text(
                            "ALTER TABLE it_asset_return_requests "
                            "ADD COLUMN return_destination VARCHAR(30) NOT NULL DEFAULT 'available'"
                        )
                    )
                if "photos_json" not in existing:
                    conn.execute(
                        text(
                            "ALTER TABLE it_asset_return_requests "
                            "ADD COLUMN photos_json JSON NULL"
                        )
                    )
        except Exception as e:
            app.logger.warning("IT return request columns ensure skipped: %s", e)

    def _ensure_it_inventory_quantity_assignment_table():
        try:
            from sqlalchemy import inspect
            from .models.it_models import ITInventoryQuantityAssignment

            insp = inspect(db.engine)
            if "it_inventory_quantity_assignments" in set(insp.get_table_names()):
                return
            ITInventoryQuantityAssignment.__table__.create(bind=db.engine, checkfirst=True)
            app.logger.info("Created table it_inventory_quantity_assignments")
        except Exception as e:
            app.logger.warning("IT inventory quantity assignment table ensure skipped: %s", e)

    def _fix_it_inventory_category_mismatches():
        """Fast SQL fixes for legacy mis-tagged inventory_category (no full-table ORM load)."""
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            if "it_inventory_items" not in set(insp.get_table_names()):
                return
            existing = {c["name"] for c in insp.get_columns("it_inventory_items")}
            if "inventory_category" not in existing:
                return

            dialect = db.engine.dialect.name
            updates = [
                (
                    "Transport Assets",
                    "LOWER(TRIM(category)) = 'vehicle' AND "
                    "COALESCE(inventory_category, '') <> 'Transport Assets'",
                ),
                (
                    "Infrastructure Assets",
                    "LOWER(TRIM(category)) = 'equipment' AND "
                    "COALESCE(inventory_category, '') <> 'Infrastructure Assets'",
                ),
                (
                    "IT Assets",
                    "LOWER(TRIM(category)) IN "
                    "('hardware', 'software', 'accessories', 'consumables') AND "
                    "COALESCE(inventory_category, '') <> 'IT Assets'",
                ),
            ]
            total = 0
            with db.engine.begin() as conn:
                for new_cat, where_sql in updates:
                    if dialect == "postgresql":
                        stmt = text(
                            f'UPDATE it_inventory_items SET inventory_category = :cat '
                            f"WHERE {where_sql}"
                        )
                    else:
                        stmt = text(
                            f"UPDATE it_inventory_items SET inventory_category = :cat "
                            f"WHERE {where_sql}"
                        )
                    result = conn.execute(stmt, {"cat": new_cat})
                    total += result.rowcount or 0
            if total:
                app.logger.info(
                    "Corrected inventory_category on %s inventory row(s)", total
                )
        except Exception as e:
            app.logger.warning("IT inventory_category mismatch fix skipped: %s", e)

    def _ensure_it_office_stock_deployment_table():
        try:
            from sqlalchemy import inspect, text
            from .models.it_models import ITOfficeStockDeployment

            insp = inspect(db.engine)
            table = "it_office_stock_deployments"
            if table not in set(insp.get_table_names()):
                ITOfficeStockDeployment.__table__.create(bind=db.engine, checkfirst=True)
                app.logger.info("Created table it_office_stock_deployments")
                return

            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name
            with db.engine.begin() as conn:
                if "inventory_category" not in existing:
                    if dialect == "postgresql":
                        conn.execute(
                            text(
                                f'ALTER TABLE "{table}" ADD COLUMN inventory_category '
                                "VARCHAR(60) NOT NULL DEFAULT 'Office Assets'"
                            )
                        )
                    else:
                        conn.execute(
                            text(
                                f"ALTER TABLE {table} ADD COLUMN inventory_category "
                                "VARCHAR(60) NOT NULL DEFAULT 'Office Assets'"
                            )
                        )
                if "asset_unit_id" not in existing:
                    # Avoid FK in ALTER — some MySQL/MariaDB builds fail and abort app startup.
                    if dialect == "postgresql":
                        conn.execute(
                            text(
                                f'ALTER TABLE "{table}" ADD COLUMN asset_unit_id INTEGER NULL'
                            )
                        )
                    else:
                        conn.execute(
                            text(
                                f"ALTER TABLE {table} ADD COLUMN asset_unit_id INTEGER NULL"
                            )
                        )
        except Exception as e:
            app.logger.warning("IT office stock deployment table ensure skipped: %s", e)

    def _ensure_it_inventory_item_photos_column():
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            table = "it_inventory_items"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            if "photos_json" in existing:
                return

            dialect = db.engine.dialect.name
            if dialect == "postgresql":
                stmt = text(f'ALTER TABLE "{table}" ADD COLUMN photos_json JSONB NULL')
            elif dialect == "mysql":
                stmt = text(f"ALTER TABLE {table} ADD COLUMN photos_json JSON NULL")
            else:
                stmt = text(f"ALTER TABLE {table} ADD COLUMN photos_json TEXT NULL")

            with db.engine.begin() as conn:
                conn.execute(stmt)
            app.logger.info("Added column %s.photos_json", table)
        except Exception as e:
            app.logger.warning("it_inventory_items photos_json ensure skipped: %s", e)

    def _ensure_it_inventory_stock_columns():
        """Office stock fields: vendor, purchase_date, receipts, location, notes."""
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            table = "it_inventory_items"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name

            specs = [
                ("vendor", "VARCHAR(150) NULL"),
                ("purchase_date", "DATE NULL"),
                ("location", "VARCHAR(120) NULL"),
                ("notes", "VARCHAR(500) NULL"),
            ]
            for col, col_type in specs:
                if col in existing:
                    continue
                if dialect == "postgresql":
                    stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
                else:
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)

            if "receipts_json" not in existing:
                if dialect == "postgresql":
                    stmt = text(f'ALTER TABLE "{table}" ADD COLUMN receipts_json JSONB NULL')
                elif dialect == "mysql":
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN receipts_json JSON NULL")
                else:
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN receipts_json TEXT NULL")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.receipts_json", table)
        except Exception as e:
            app.logger.warning("it_inventory_items stock columns ensure skipped: %s", e)

    def _ensure_it_deleted_log_name_column():
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            table = "it_deleted_asset_logs"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            if "deleted_by_name" in existing:
                return
            dialect = db.engine.dialect.name
            if dialect == "postgresql":
                stmt = text(f'ALTER TABLE "{table}" ADD COLUMN deleted_by_name VARCHAR(120) NULL')
            else:
                stmt = text(f"ALTER TABLE {table} ADD COLUMN deleted_by_name VARCHAR(120) NULL")
            with db.engine.begin() as conn:
                conn.execute(stmt)
            app.logger.info("Added column %s.deleted_by_name", table)
        except Exception as e:
            app.logger.warning("it_deleted_asset_logs deleted_by_name ensure skipped: %s", e)

    def _ensure_ex_employee_doc_tables():
        try:
            from sqlalchemy import inspect
            from .models.ex_employee_documents import ExEmployeeDocShare, ExEmployeeDocFile

            insp = inspect(db.engine)
            tables = set(insp.get_table_names())
            if "ex_employee_doc_shares" not in tables:
                ExEmployeeDocShare.__table__.create(bind=db.engine, checkfirst=True)
                app.logger.info("Created table ex_employee_doc_shares")
            if "ex_employee_doc_files" not in tables:
                ExEmployeeDocFile.__table__.create(bind=db.engine, checkfirst=True)
                app.logger.info("Created table ex_employee_doc_files")
        except Exception as e:
            app.logger.warning("ex_employee_doc tables ensure skipped: %s", e)

    def _ensure_assessment_tables():
        try:
            from sqlalchemy import inspect, text
            from .models.assessment import AssessmentInvite

            insp = inspect(db.engine)
            tables = set(insp.get_table_names())
            dialect = db.engine.dialect.name
            if "assessment_invites" not in tables:
                AssessmentInvite.__table__.create(bind=db.engine, checkfirst=True)
                app.logger.info("Created table assessment_invites")
            else:
                existing = {c["name"] for c in insp.get_columns("assessment_invites")}
                if "recording_path" not in existing:
                    if dialect == "postgresql":
                        stmt = text(
                            'ALTER TABLE "assessment_invites" ADD COLUMN recording_path VARCHAR(300) NULL'
                        )
                    else:
                        stmt = text(
                            "ALTER TABLE assessment_invites ADD COLUMN recording_path VARCHAR(300) NULL"
                        )
                    with db.engine.begin() as conn:
                        conn.execute(stmt)
                    app.logger.info("Added column assessment_invites.recording_path")
                existing = {c["name"] for c in insp.get_columns("assessment_invites")}
                if "recording_first_viewed_at" not in existing:
                    if dialect == "postgresql":
                        stmt = text(
                            'ALTER TABLE "assessment_invites" ADD COLUMN recording_first_viewed_at TIMESTAMP NULL'
                        )
                    else:
                        stmt = text(
                            "ALTER TABLE assessment_invites ADD COLUMN recording_first_viewed_at DATETIME NULL"
                        )
                    with db.engine.begin() as conn:
                        conn.execute(stmt)
                    app.logger.info("Added column assessment_invites.recording_first_viewed_at")
        except Exception as e:
            app.logger.warning("assessment table ensure skipped: %s", e)

    def _ensure_employee_circle_history_table():
        try:
            from sqlalchemy import inspect
            from .models.employee_circle_history import EmployeeCircleHistory

            insp = inspect(db.engine)
            if "employee_circle_history" in set(insp.get_table_names()):
                return
            EmployeeCircleHistory.__table__.create(bind=db.engine, checkfirst=True)
            app.logger.info("Created table employee_circle_history")
        except Exception as e:
            app.logger.warning("employee_circle_history table ensure skipped: %s", e)

    def _ensure_deployed_customers_table():
        try:
            from sqlalchemy import inspect
            from .models.deployed_customer import DeployedCustomer

            insp = inspect(db.engine)
            if "deployed_customers" in set(insp.get_table_names()):
                return
            DeployedCustomer.__table__.create(bind=db.engine, checkfirst=True)
            app.logger.info("Created table deployed_customers")
        except Exception as e:
            app.logger.warning("deployed_customers table ensure skipped: %s", e)

    def _ensure_leave_balance_defaults():
        """Align leave_balances total/used columns with model (DEFAULT 0, no data change)."""
        try:
            from sqlalchemy import inspect, text
            from .models.attendance import LeaveBalance

            insp = inspect(db.engine)
            tables = set(insp.get_table_names())
            if "leave_balances" not in tables:
                LeaveBalance.__table__.create(bind=db.engine, checkfirst=True)
                app.logger.info("Created table leave_balances")
                return

            dialect = db.engine.dialect.name
            float_type = "DOUBLE" if dialect == "mysql" else "FLOAT"
            for col in (
                "total_privilege_leave",
                "total_casual_leave",
                "total_compensatory_leave",
                "used_privilege_leave",
                "used_casual_leave",
                "used_comp_leave",
            ):
                existing = {c["name"] for c in insp.get_columns("leave_balances")}
                if col not in existing:
                    if dialect == "mysql":
                        stmt = text(
                            f"ALTER TABLE leave_balances ADD COLUMN {col} "
                            f"{float_type} NOT NULL DEFAULT 0"
                        )
                    else:
                        stmt = text(
                            f'ALTER TABLE leave_balances ADD COLUMN "{col}" '
                            f"{float_type} NOT NULL DEFAULT 0"
                        )
                    with db.engine.begin() as conn:
                        conn.execute(stmt)
                    app.logger.info("Added column leave_balances.%s", col)
                else:
                    if dialect == "mysql":
                        stmt = text(
                            f"ALTER TABLE leave_balances MODIFY {col} "
                            f"{float_type} NOT NULL DEFAULT 0"
                        )
                    else:
                        stmt = text(
                            f'ALTER TABLE leave_balances ALTER COLUMN "{col}" '
                            f"SET DEFAULT 0"
                        )
                    with db.engine.begin() as conn:
                        conn.execute(stmt)
        except Exception as e:
            app.logger.warning("leave_balances defaults ensure skipped: %s", e)

    def _ensure_ctc_breakup_columns():
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            table = "ctc_breakups"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name
            additions = []
            if "annual_ctc" not in existing:
                additions.append(
                    ("annual_ctc", 'DOUBLE PRECISION NULL' if dialect == "postgresql" else "FLOAT NULL")
                )
            if "mediclaim_yearly" not in existing:
                additions.append(
                    ("mediclaim_yearly", 'DOUBLE PRECISION NULL' if dialect == "postgresql" else "FLOAT NULL")
                )
            float_cols = (
                "hra_pct",
                "annual_ctc_computed",
                "esic_employer",
                "deductions_total",
                "gratuity_yearly",
                "gratuity_monthly",
                "employer_pf_yearly",
                "employer_pf_monthly",
                "employer_esic_yearly",
                "employer_esic_monthly",
                "epf_pct",
            )
            for col in float_cols:
                if col not in existing:
                    additions.append(
                        (col, 'DOUBLE PRECISION NULL' if dialect == "postgresql" else "FLOAT NULL")
                    )
            if "epf_mode" not in existing:
                additions.append(
                    ("epf_mode", "VARCHAR(20) NULL" if dialect == "postgresql" else "VARCHAR(20) NULL")
                )
            if "ptax_month" not in existing:
                additions.append(
                    ("ptax_month", "VARCHAR(7) NULL" if dialect == "postgresql" else "VARCHAR(7) NULL")
                )
            phase1_float_cols = (
                "dearness_allowance",
                "special_allowance",
                "conveyance_allowance",
                "medical_allowance",
                "lta_allowance",
                "variable_ctc_annual",
                "pf_admin_yearly",
                "pf_admin_monthly",
                "edli_yearly",
                "edli_monthly",
                "statutory_bonus_yearly",
                "statutory_bonus_monthly",
                "lwf_employer_yearly",
                "lwf_employee_yearly",
            )
            for col in phase1_float_cols:
                if col not in existing:
                    additions.append(
                        (col, 'DOUBLE PRECISION NULL' if dialect == "postgresql" else "FLOAT NULL")
                    )
            if "include_pf_admin_in_ctc" not in existing:
                additions.append(
                    (
                        "include_pf_admin_in_ctc",
                        "BOOLEAN NULL DEFAULT TRUE"
                        if dialect == "postgresql"
                        else "TINYINT(1) NULL DEFAULT 1",
                    )
                )
            if "include_edli_in_ctc" not in existing:
                additions.append(
                    (
                        "include_edli_in_ctc",
                        "BOOLEAN NULL DEFAULT TRUE"
                        if dialect == "postgresql"
                        else "TINYINT(1) NULL DEFAULT 1",
                    )
                )
            if "ptax_state" not in existing:
                additions.append(("ptax_state", "VARCHAR(2) NULL"))
            phase3_bool_cols = (
                "include_statutory_bonus_in_ctc",
                "include_lwf_in_ctc",
            )
            for col in phase3_bool_cols:
                if col not in existing:
                    additions.append(
                        (
                            col,
                            "BOOLEAN NULL DEFAULT FALSE"
                            if dialect == "postgresql"
                            else "TINYINT(1) NULL DEFAULT 0",
                        )
                    )
            if "effective_from" not in existing:
                additions.append(("effective_from", "DATE NULL"))
            phase7_float_cols = (
                "vpf_monthly",
                "nps_employer_pct",
                "reimbursement_monthly",
            )
            for col in phase7_float_cols:
                if col not in existing:
                    additions.append(
                        (col, 'DOUBLE PRECISION NULL' if dialect == "postgresql" else "FLOAT NULL")
                    )
            phase7_bool_cols = (
                "include_nps_in_ctc",
                "is_metro_hra",
            )
            for col in phase7_bool_cols:
                if col not in existing:
                    additions.append(
                        (
                            col,
                            "BOOLEAN NULL DEFAULT FALSE"
                            if dialect == "postgresql"
                            else "TINYINT(1) NULL DEFAULT 0",
                        )
                    )
            for col, col_type in additions:
                if dialect == "postgresql":
                    stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
                else:
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
        except Exception as e:
            app.logger.warning("ctc_breakups column migration skipped: %s", e)

    def _ensure_upload_doc_identity_columns():
        """Aadhaar/PAN/bank metadata on upload_docs (numbers before file upload)."""
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            table = "upload_docs"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name
            specs = [
                ("aadhaar_number", "VARCHAR(12) NULL"),
                ("pan_number", "VARCHAR(10) NULL"),
                ("bank_account_number", "VARCHAR(30) NULL"),
                ("bank_name", "VARCHAR(120) NULL"),
                ("bank_branch_code", "VARCHAR(20) NULL"),
                ("ifsc_code", "VARCHAR(11) NULL"),
            ]
            for col, col_type in specs:
                if col in existing:
                    continue
                if dialect == "postgresql":
                    stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
                else:
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
        except Exception as e:
            app.logger.warning("upload_docs identity columns ensure skipped: %s", e)

    def _ensure_probation_review_columns():
        """Phase 1 probation workflow columns on probation_reviews."""
        try:
            from sqlalchemy import inspect, text
            from .models.probation import ProbationReview

            insp = inspect(db.engine)
            table = ProbationReview.__tablename__
            if table not in insp.get_table_names():
                ProbationReview.__table__.create(bind=db.engine, checkfirst=True)
                app.logger.info("Created table %s", table)
                return

            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name
            specs = [
                ("status", "VARCHAR(30) NULL"),
                ("followup_reminder_sent_at", "TIMESTAMP NULL" if dialect == "postgresql" else "DATETIME NULL"),
                ("overdue_escalation_sent_at", "TIMESTAMP NULL" if dialect == "postgresql" else "DATETIME NULL"),
                ("manager_recommendation", "VARCHAR(30) NULL"),
                ("hr_decision", "VARCHAR(20) NULL"),
                ("hr_decided_at", "TIMESTAMP NULL" if dialect == "postgresql" else "DATETIME NULL"),
                ("hr_decided_by_admin_id", "INTEGER NULL"),
                ("extended_until", "DATE NULL"),
                ("hr_notes", "TEXT NULL"),
            ]
            for col, col_type in specs:
                if col in existing:
                    continue
                if dialect == "postgresql":
                    stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
                else:
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
        except Exception as e:
            app.logger.warning("probation_reviews column migration skipped: %s", e)

    def _ensure_monthly_payroll_tds_columns():
        try:
            from sqlalchemy import inspect, text
            insp = inspect(db.engine)
            table = MonthlyPayroll.__tablename__
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            specs = [
                ("tds_computed", "FLOAT NULL"),
                ("tds_final", "FLOAT NULL"),
                ("lwf_computed", "FLOAT NULL"),
                ("lwf_final", "FLOAT NULL"),
                ("arrears_gross_computed", "FLOAT NULL"),
                ("arrears_gross_final", "FLOAT NULL"),
                ("leave_encashment_computed", "FLOAT NULL"),
                ("leave_encashment_final", "FLOAT NULL"),
                ("loan_recovery_computed", "FLOAT NULL"),
                ("loan_recovery_final", "FLOAT NULL"),
                ("reimbursement_computed", "FLOAT NULL"),
                ("reimbursement_final", "FLOAT NULL"),
            ]
            for col, col_type in specs:
                if col in existing:
                    continue
                stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
        except Exception as e:
            app.logger.warning("monthly_payrolls TDS columns ensure skipped: %s", e)

    def _ensure_ctc_revision_table():
        try:
            from .models.ctc_breakup_revision import CTCBreakupRevision

            CTCBreakupRevision.__table__.create(bind=db.engine, checkfirst=True)
        except Exception as e:
            app.logger.warning("ctc_breakup_revisions table ensure skipped: %s", e)

    def _ensure_payroll_lifecycle_tables():
        try:
            from .models.employee_salary_loan import EmployeeSalaryLoan
            from .models.fnf_settlement import FnfSettlement
            from .models.salary_revision_request import SalaryRevisionRequest
            from .models.hr_policy import HRPolicyDocument, PolicyAcknowledgment

            EmployeeSalaryLoan.__table__.create(bind=db.engine, checkfirst=True)
            FnfSettlement.__table__.create(bind=db.engine, checkfirst=True)
            SalaryRevisionRequest.__table__.create(bind=db.engine, checkfirst=True)
            HRPolicyDocument.__table__.create(bind=db.engine, checkfirst=True)
            PolicyAcknowledgment.__table__.create(bind=db.engine, checkfirst=True)
        except Exception as e:
            app.logger.warning("payroll lifecycle tables ensure skipped: %s", e)

    def _ensure_phase3_hr_tables():
        """Phase 3 — ATS, increment cycles, headcount budgets, salary revision columns."""
        try:
            from sqlalchemy import inspect, text
            from .models.recruitment import JobRequisition, Candidate, Offer
            from .models.increment_cycle import IncrementCycle
            from .models.headcount_budget import HeadcountBudget
            from .models.salary_revision_request import SalaryRevisionRequest

            JobRequisition.__table__.create(bind=db.engine, checkfirst=True)
            Candidate.__table__.create(bind=db.engine, checkfirst=True)
            Offer.__table__.create(bind=db.engine, checkfirst=True)
            IncrementCycle.__table__.create(bind=db.engine, checkfirst=True)
            HeadcountBudget.__table__.create(bind=db.engine, checkfirst=True)

            from .models.compensation_band import CompensationBand
            CompensationBand.__table__.create(bind=db.engine, checkfirst=True)
            from .models.merit_matrix import MeritMatrixEntry
            MeritMatrixEntry.__table__.create(bind=db.engine, checkfirst=True)

            table = SalaryRevisionRequest.__tablename__
            insp = inspect(db.engine)
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name
            new_cols = {
                "increment_cycle_id": "INTEGER NULL",
                "revision_type": "VARCHAR(20) NOT NULL DEFAULT 'probation'",
                "proposed_annual_ctc": "DOUBLE PRECISION NULL" if dialect == "postgresql" else "FLOAT NULL",
                "manager_notes": "TEXT NULL",
                "manager_proposed_at": "TIMESTAMP NULL" if dialect == "postgresql" else "DATETIME NULL",
                "manager_proposed_by_admin_id": "INTEGER NULL",
                "hr_approved_at": "TIMESTAMP NULL" if dialect == "postgresql" else "DATETIME NULL",
                "hr_approved_by_admin_id": "INTEGER NULL",
            }
            for col, col_type in new_cols.items():
                if col in existing:
                    continue
                stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
                if dialect != "postgresql":
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
        except Exception as e:
            app.logger.warning("phase3 HR tables ensure skipped: %s", e)

    def _ensure_phase6_hr_columns():
        """Phase 6 — offer acceptance columns on candidate_offers."""
        try:
            from sqlalchemy import inspect, text
            from .models.recruitment import Offer

            Offer.__table__.create(bind=db.engine, checkfirst=True)
            insp = inspect(db.engine)
            table = Offer.__tablename__
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name
            new_cols = {
                "acceptance_token_hash": "VARCHAR(64) NULL",
                "acceptance_expires_at": "TIMESTAMP NULL" if dialect == "postgresql" else "DATETIME NULL",
                "accepted_at": "TIMESTAMP NULL" if dialect == "postgresql" else "DATETIME NULL",
                "accepted_by_name": "VARCHAR(150) NULL",
            }
            for col, col_type in new_cols.items():
                if col in existing:
                    continue
                stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
                if dialect != "postgresql":
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
        except Exception as e:
            app.logger.warning("phase6 HR columns ensure skipped: %s", e)

    def _ensure_payroll_governance_columns():
        """Phase 8 — payroll status, statutory bonus, audit log."""
        try:
            from sqlalchemy import inspect, text
            from .models.monthly_payroll import MonthlyPayroll
            from .models.payroll_audit_log import PayrollAuditLog

            PayrollAuditLog.__table__.create(bind=db.engine, checkfirst=True)

            insp = inspect(db.engine)
            table = MonthlyPayroll.__tablename__
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name
            float_cols = (
                "statutory_bonus_computed",
                "statutory_bonus_final",
            )
            for col in float_cols:
                if col in existing:
                    continue
                col_type = "DOUBLE PRECISION NULL" if dialect == "postgresql" else "FLOAT NULL"
                stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
                if dialect != "postgresql":
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
            if "status" not in existing:
                col_type = (
                    "VARCHAR(20) NOT NULL DEFAULT 'draft'"
                    if dialect == "postgresql"
                    else "VARCHAR(20) NOT NULL DEFAULT 'draft'"
                )
                stmt = text(f'ALTER TABLE "{table}" ADD COLUMN status {col_type}')
                if dialect != "postgresql":
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN status {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.status", table)
            if "status_changed_at" not in existing:
                ts_type = "TIMESTAMP NULL" if dialect == "postgresql" else "DATETIME NULL"
                stmt = text(f"ALTER TABLE {table} ADD COLUMN status_changed_at {ts_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.status_changed_at", table)
            if "status_changed_by_admin_id" not in existing:
                stmt = text(f"ALTER TABLE {table} ADD COLUMN status_changed_by_admin_id INTEGER NULL")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.status_changed_by_admin_id", table)
        except Exception as e:
            app.logger.warning("payroll governance columns ensure skipped: %s", e)

    def _ensure_leave_application_columns():
        """HR on-behalf leave tracking on leave_applications."""
        try:
            from sqlalchemy import inspect, text
            from .models.attendance import LeaveApplication

            insp = inspect(db.engine)
            table = LeaveApplication.__tablename__
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name
            additions = {
                "applied_by_admin_id": "INTEGER NULL",
                "applied_on_behalf": (
                    "BOOLEAN NOT NULL DEFAULT FALSE"
                    if dialect == "postgresql"
                    else "BOOLEAN NOT NULL DEFAULT 0"
                ),
            }
            for col, col_type in additions.items():
                if col in existing:
                    continue
                stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
                if dialect != "postgresql":
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
        except Exception as e:
            app.logger.warning("leave_applications column migration skipped: %s", e)

    def _ensure_attendance_regularization_table():
        try:
            from .models.attendance import AttendanceRegularization

            AttendanceRegularization.__table__.create(bind=db.engine, checkfirst=True)
            app.logger.info("Ensured table attendance_regularizations")
        except Exception as e:
            app.logger.warning("attendance_regularizations table ensure skipped: %s", e)

    def _ensure_employee_tax_declarations_table():
        try:
            from sqlalchemy import inspect, text
            from .models.employee_tax_declaration import (
                EmployeeTaxDeclaration,
                TaxDeclarationApprovalHistory,
                TaxDeclarationDocument,
                TaxDeclarationItem,
            )

            for model in (
                EmployeeTaxDeclaration,
                TaxDeclarationItem,
                TaxDeclarationDocument,
                TaxDeclarationApprovalHistory,
            ):
                model.__table__.create(bind=db.engine, checkfirst=True)

            insp = inspect(db.engine)
            table = EmployeeTaxDeclaration.__tablename__
            if table in insp.get_table_names():
                existing = {c["name"] for c in insp.get_columns(table)}
                dialect = db.engine.dialect.name
                specs = [
                    ("regime_declaration_accepted", "TINYINT(1) NOT NULL DEFAULT 0" if dialect == "mysql" else "BOOLEAN NOT NULL DEFAULT FALSE"),
                    ("new_regime_acknowledged", "TINYINT(1) NOT NULL DEFAULT 0" if dialect == "mysql" else "BOOLEAN NOT NULL DEFAULT FALSE"),
                    ("final_declaration_accepted", "TINYINT(1) NOT NULL DEFAULT 0" if dialect == "mysql" else "BOOLEAN NOT NULL DEFAULT FALSE"),
                    ("declaration_place", "VARCHAR(120) NULL"),
                    ("declaration_signed_at", "DATE NULL"),
                    ("reviewed_by_admin_id", "INTEGER NULL"),
                    ("reviewed_at", "DATETIME NULL"),
                    ("rejection_reason", "TEXT NULL"),
                    ("declaration_phase", "VARCHAR(20) NOT NULL DEFAULT 'provisional'"),
                    ("final_proof_status", "VARCHAR(30) NULL"),
                    ("final_proof_submitted_at", "DATETIME NULL"),
                    ("final_proof_reviewed_at", "DATETIME NULL"),
                    ("final_proof_rejection_reason", "TEXT NULL"),
                ]
                for col, col_type in specs:
                    if col in existing:
                        continue
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                    with db.engine.begin() as conn:
                        conn.execute(stmt)
                    app.logger.info("Added column %s.%s", table, col)

            item_table = TaxDeclarationItem.__tablename__
            if item_table in insp.get_table_names():
                item_existing = {c["name"] for c in insp.get_columns(item_table)}
                item_specs = [
                    ("final_amount", "FLOAT NULL"),
                ]
                for col, col_type in item_specs:
                    if col in item_existing:
                        continue
                    stmt = text(f"ALTER TABLE {item_table} ADD COLUMN {col} {col_type}")
                    with db.engine.begin() as conn:
                        conn.execute(stmt)
                    app.logger.info("Added column %s.%s", item_table, col)

            doc_table = TaxDeclarationDocument.__tablename__
            if doc_table in insp.get_table_names():
                doc_existing = {c["name"] for c in insp.get_columns(doc_table)}
                doc_specs = [
                    ("section_code", "VARCHAR(40) NULL"),
                    ("item_code", "VARCHAR(60) NULL"),
                ]
                for col, col_type in doc_specs:
                    if col in doc_existing:
                        continue
                    stmt = text(f"ALTER TABLE {doc_table} ADD COLUMN {col} {col_type}")
                    with db.engine.begin() as conn:
                        conn.execute(stmt)
                    app.logger.info("Added column %s.%s", doc_table, col)
        except Exception as e:
            app.logger.warning("employee_tax_declarations table ensure skipped: %s", e)

    def _ensure_employee_accounts_regime_columns():
        try:
            from sqlalchemy import inspect, text
            from .models.employee_accounts import EmployeeAccounts

            table = EmployeeAccounts.__tablename__
            insp = inspect(db.engine)
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            specs = [
                ("tax_regime_override", "VARCHAR(80) NULL"),
                ("tax_regime_override_reason", "TEXT NULL"),
                ("tax_regime_override_at", "DATETIME NULL"),
                ("tax_regime_override_by_admin_id", "INTEGER NULL"),
            ]
            for col, col_type in specs:
                if col in existing:
                    continue
                stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
        except Exception as e:
            app.logger.warning("employee_accounts regime columns ensure skipped: %s", e)

    def _ensure_form16_parsed_columns():
        try:
            from sqlalchemy import inspect, text
            from .models.news_feed import Form16

            table = Form16.__tablename__
            insp = inspect(db.engine)
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            specs = [
                ("parsed_gross_salary", "FLOAT NULL"),
                ("parsed_tds_deducted", "FLOAT NULL"),
                ("parsed_taxable_income", "FLOAT NULL"),
                ("parsed_annual_tax", "FLOAT NULL"),
                ("data_source", "VARCHAR(30) NULL"),
                ("certificate_type", "VARCHAR(30) NULL"),
                ("part_type", "VARCHAR(20) NULL"),
            ]
            for col, col_type in specs:
                if col in existing:
                    continue
                stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
        except Exception as e:
            app.logger.warning("form16 parsed columns ensure skipped: %s", e)

    def _ensure_employee_exit_history_columns():
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            table = "employee_exit_history"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name
            specs = [
                ("last_working_day", "DATE NULL"),
                ("notice_shortfall_days", "INTEGER NULL"),
                ("resignation_date_snapshot", "DATE NULL"),
                ("force_override", "BOOLEAN NULL"),
                ("force_override_reason", "TEXT NULL"),
            ]
            for col, col_type in specs:
                if col in existing:
                    continue
                if dialect == "mysql" and col == "force_override":
                    col_type = "TINYINT(1) NULL"
                if dialect == "postgresql":
                    stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
                else:
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
        except Exception as e:
            app.logger.warning("employee_exit_history columns ensure skipped: %s", e)

    def _ensure_admin_exit_login_until_column():
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            table = "admins"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            if "exit_login_until" in existing:
                return
            dialect = db.engine.dialect.name
            col_type = "DATE NULL"
            if dialect == "postgresql":
                stmt = text(f'ALTER TABLE "{table}" ADD COLUMN exit_login_until {col_type}')
            else:
                stmt = text(f"ALTER TABLE {table} ADD COLUMN exit_login_until {col_type}")
            with db.engine.begin() as conn:
                conn.execute(stmt)
            app.logger.info("Added column %s.exit_login_until", table)
        except Exception as e:
            app.logger.warning("admins.exit_login_until ensure skipped: %s", e)

    def _ensure_offboarding_reminder_table():
        try:
            from sqlalchemy import inspect
            from .models.offboarding_reminder import OffboardingReminderLog

            insp = inspect(db.engine)
            if "offboarding_reminder_logs" not in insp.get_table_names():
                OffboardingReminderLog.__table__.create(bind=db.engine, checkfirst=True)
                app.logger.info("Created table offboarding_reminder_logs")
        except Exception as e:
            app.logger.warning("offboarding_reminder_logs ensure skipped: %s", e)

    def _ensure_employee_archive_rehire_columns():
        try:
            from sqlalchemy import inspect, text

            insp = inspect(db.engine)
            table = "employee_archive"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name
            specs = [
                ("rehire_eligible", "BOOLEAN NULL"),
                ("rehire_cooldown_until", "DATE NULL"),
                ("rehire_notes", "TEXT NULL"),
            ]
            for col, col_type in specs:
                if col in existing:
                    continue
                if dialect == "mysql" and col == "rehire_eligible":
                    col_type = "TINYINT(1) NULL"
                if dialect == "postgresql":
                    stmt = text(f'ALTER TABLE "{table}" ADD COLUMN {col} {col_type}')
                else:
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.%s", table, col)
        except Exception as e:
            app.logger.warning("employee_archive rehire columns ensure skipped: %s", e)

    def _ensure_exit_interview_table():
        try:
            from sqlalchemy import inspect
            from .models.exit_interview import ExitInterview

            insp = inspect(db.engine)
            if "exit_interviews" not in insp.get_table_names():
                ExitInterview.__table__.create(bind=db.engine, checkfirst=True)
                app.logger.info("Created table exit_interviews")
        except Exception as e:
            app.logger.warning("exit_interviews table ensure skipped: %s", e)

    def _ensure_comp_off_gain_dedupe_key():
        """Unique Sunday punch key + one-time collapse of triplicate Comp Off rows."""
        try:
            from sqlalchemy import inspect, text
            from .compoff_utils import dedupe_duplicate_sunday_compoff_gains

            insp = inspect(db.engine)
            table = "comp_off_gains"
            if table not in insp.get_table_names():
                return
            existing = {c["name"] for c in insp.get_columns(table)}
            dialect = db.engine.dialect.name
            if "dedupe_key" not in existing:
                if dialect == "postgresql":
                    stmt = text(f'ALTER TABLE "{table}" ADD COLUMN dedupe_key VARCHAR(64) NULL')
                else:
                    stmt = text(f"ALTER TABLE {table} ADD COLUMN dedupe_key VARCHAR(64) NULL")
                with db.engine.begin() as conn:
                    conn.execute(stmt)
                app.logger.info("Added column %s.dedupe_key", table)

            # Unique index (MySQL/Postgres: multiple NULLs allowed)
            index_name = "uq_comp_off_gains_dedupe_key"
            try:
                indexes = {ix["name"] for ix in insp.get_indexes(table)}
            except Exception:
                indexes = set()
            if index_name not in indexes:
                if dialect == "postgresql":
                    idx_stmt = text(
                        f'CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON "{table}" (dedupe_key)'
                    )
                else:
                    idx_stmt = text(
                        f"CREATE UNIQUE INDEX {index_name} ON {table} (dedupe_key)"
                    )
                try:
                    with db.engine.begin() as conn:
                        conn.execute(idx_stmt)
                    app.logger.info("Created unique index %s", index_name)
                except Exception as idx_err:
                    app.logger.warning("comp_off_gains unique index skipped: %s", idx_err)

            removed = dedupe_duplicate_sunday_compoff_gains()
            if removed:
                db.session.commit()
                app.logger.info(
                    "Removed %s duplicate Sunday Comp Off gain(s) on startup", removed
                )
            else:
                db.session.commit()
        except Exception as e:
            db.session.rollback()
            app.logger.warning("comp_off_gains dedupe_key ensure skipped: %s", e)

    with app.app_context():
        try:
            _ensure_upload_doc_identity_columns()
            _ensure_ctc_breakup_columns()
            _ensure_parcel_name_columns()
            _ensure_expense_line_item_rejection_reason()
            _ensure_punch_session_auto_punched_out()
            _ensure_it_return_request_table()
            _ensure_it_return_request_columns()
            _ensure_it_inventory_quantity_assignment_table()
            _ensure_it_office_stock_deployment_table()
            _fix_it_inventory_category_mismatches()
            _ensure_it_inventory_item_photos_column()
            _ensure_it_inventory_stock_columns()
            _ensure_it_deleted_log_name_column()
            _ensure_ex_employee_doc_tables()
            _ensure_assessment_tables()
            _ensure_employee_circle_history_table()
            _ensure_deployed_customers_table()
            _ensure_leave_balance_defaults()
            _ensure_probation_review_columns()
            _ensure_employee_tax_declarations_table()
            _ensure_employee_accounts_regime_columns()
            _ensure_form16_parsed_columns()
            _ensure_monthly_payroll_tds_columns()
            _ensure_ctc_revision_table()
            _ensure_payroll_lifecycle_tables()
            _ensure_phase3_hr_tables()
            _ensure_phase6_hr_columns()
            _ensure_payroll_governance_columns()
            _ensure_leave_application_columns()
            _ensure_attendance_regularization_table()
            _ensure_employee_exit_history_columns()
            _ensure_admin_exit_login_until_column()
            _ensure_offboarding_reminder_table()
            _ensure_employee_archive_rehire_columns()
            _ensure_exit_interview_table()
            _ensure_comp_off_gain_dedupe_key()
            _cleanup_zero_qty_inventory_rows()
        except Exception as e:
            app.logger.error(
                "Schema bootstrap failed (app will still start): %s", e, exc_info=True
            )

    from .commands.leave_accrual import register_leave_accrual_command
    register_leave_accrual_command(app)
    from .commands.compoff import register_compoff_command
    register_compoff_command(app)
    from .commands.probation import register_probation_command
    register_probation_command(app)
    from .commands.leave_pending_reminder import register_leave_pending_reminder_command
    register_leave_pending_reminder_command(app)
    from .commands.offboarding import register_offboarding_commands
    register_offboarding_commands(app)
    from .commands.offboarding_reminders import register_offboarding_reminders_command
    register_offboarding_reminders_command(app)

    # ---------------------------
    # APScheduler: daily HR jobs (probation, compoff, leave accrual) - no manual intervention
    # ---------------------------
    from flask_apscheduler import APScheduler
    from . import scheduler as sched_mod
    sched_mod.set_app(app)
    scheduler = APScheduler()
    app.config["SCHEDULER_API_ENABLED"] = False
    app.config["SCHEDULER_TIMEZONE"] = "Asia/Kolkata"
    app.config["SCHEDULER_JOBS"] = [
        {
            "id": "daily_hr_jobs",
            "func": "website.scheduler:run_daily_hr_jobs",
            "trigger": "cron",
            "hour": 6,
            "minute": 1,
        },
        {
            "id": "auto_punch_out_scan",
            "func": "website.scheduler:run_auto_punch_out_job",
            "trigger": "interval",
            "minutes": 2,
        },
    ]
    scheduler.init_app(app)
    scheduler.start()

    return app
