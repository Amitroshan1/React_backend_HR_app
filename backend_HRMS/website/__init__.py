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
    app.config["EMAIL_HR"] = os.getenv("EMAIL_HR")
    app.config["EMAIL_ACCOUNTS"] = os.getenv("EMAIL_ACCOUNTS")
    app.config["EMAIL_IT"] = os.getenv("EMAIL_IT")
    app.config["EMAIL_ADMIN"] = os.getenv("EMAIL_ADMIN")

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
                "http://localhost:5173",
                "http://localhost:3000",
                "http://127.0.0.1:5173",
                "http://127.0.0.1:3000",
            ]
        ),
    )
    _cors_origins = [o.strip() for o in raw_cors_origins.split(",") if o.strip()]
    if not _cors_origins:
        _cors_origins = ["https://solviotec.com"]

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
    from .models.attendance import LeaveBalance, LeaveApplication, CompOffGain, Punch
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

    # ---------------------------
    # Flask-Login user loader
    # ---------------------------
    @login_manager.user_loader
    def load_user(user_id):
        user = Admin.query.get(int(user_id))
        if not user:
            return None
        if user.is_active is False or user.is_exited is True:
            return None
        return user


    # ---------------------------
    # Create tables (DEV ONLY)
    # ---------------------------
    if os.getenv("RUN_DB_CREATE_ALL", "0").strip() == "1":
        with app.app_context():
            db.create_all()

    # ---------------------------
    # Register Blueprints
    # ---------------------------
    from .auth import auth
    from .leave_attendence import leave
    from .Human_resource import hr
    from .query import query
    from .Accounts import Accounts
    # from .Manager import manager
    from .Manager import manager
    from .Admin import admin_bp

    from .notifications import notifications
    from .performance_api import performance_api

    app.register_blueprint(auth, url_prefix="/api/auth")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(leave, url_prefix="/api/leave")
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(Accounts, url_prefix="/api/accounts")
    app.register_blueprint(query, url_prefix="/api/query")
    app.register_blueprint(manager, url_prefix="/api/manager")
    app.register_blueprint(notifications, url_prefix="/api/notifications")
    app.register_blueprint(performance_api, url_prefix="/api/performance")

    from .commands.leave_accrual import register_leave_accrual_command
    register_leave_accrual_command(app)
    from .commands.compoff import register_compoff_command
    register_compoff_command(app)
    from .commands.probation import register_probation_command
    register_probation_command(app)
    from .commands.leave_pending_reminder import register_leave_pending_reminder_command
    register_leave_pending_reminder_command(app)

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
            "minute": 0,
        }
    ]
    scheduler.init_app(app)
    scheduler.start()

    return app
