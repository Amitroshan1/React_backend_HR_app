from flask import Flask
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
        "http://127.0.0.1:5000"
    )

    app.config["ZEPTO_API_KEY"] = os.getenv("ZEPTO_API_KEY")
    app.config["ZEPTO_SENDER_EMAIL"] = os.getenv("ZEPTO_SENDER_EMAIL")
    app.config["ZEPTO_SENDER_NAME"] = os.getenv("ZEPTO_SENDER_NAME")
    app.config["ZEPTO_BASE_URL"] = os.getenv("ZEPTO_BASE_URL")
    app.config["ZEPTO_CC_HR"] = os.getenv("ZEPTO_CC_HR")
    app.config["ZEPTO_CC_ACCOUNT"] = os.getenv("ZEPTO_CC_ACCOUNT")

    # ---------------------------
    # Enable CORS
    # ---------------------------
    # React dev server runs on http://localhost:5173
    # With supports_credentials=True, you must NOT use wildcard origins.
    CORS(
        app,
        # Allow common React dev ports (5173, 5174, etc.) on localhost during development.
        # Using a regex here avoids having to update this every time the port changes.
        resources={
            r"/api/*": {
                "origins": [
                    r"http://localhost:\d+",
                    r"http://127\.0\.0\.1:\d+",
                ]
            }
        },
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )

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
    from .models.attendance import LeaveBalance, LeaveApplication
    from .models.query import Query, QueryReply
    from .models.emp_detail_models import Employee
    from .models.education import Education, UploadDoc
    from .models.family_models import FamilyDetails
    from .models.prev_com import PreviousCompany

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

    app.register_blueprint(auth, url_prefix="/api/auth")
    app.register_blueprint(leave, url_prefix="/api/leave")
    app.register_blueprint(hr, url_prefix="/api/HumanResource")
    app.register_blueprint(Accounts, url_prefix="/api/accounts")
    app.register_blueprint(query, url_prefix="/api/query")

    return app
