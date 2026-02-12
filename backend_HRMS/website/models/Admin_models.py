from .. import db
from flask_login import UserMixin, login_manager
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
from website.models.family_models import FamilyDetails
from website.models.emp_detail_models import Employee,Asset
from website.models.prev_com import PreviousCompany
from website.models.education import Education, UploadDoc
from website.models.attendance import LeaveApplication, Punch,WorkFromHomeApplication,Punch,LeaveBalance,Location
from website.models.news_feed import PaySlip
from website.models.query import Query, QueryReply  
from website.models.seperation import Resignation,Noc,Noc_Upload
from website.models.expense import ExpenseClaimHeader   
from website.models.Performance import EmployeePerformance



class Admin(db.Model, UserMixin):
    __tablename__ = 'admins'

    id = db.Column(db.Integer, primary_key=True)

    # Identity
    email = db.Column(db.String(120), unique=True, nullable=True)
    password = db.Column(db.String(350), nullable=True)
    password_reset_token = db.Column(db.String(255), nullable=True)
    password_reset_expiry = db.Column(db.DateTime, nullable=True)


    # Profile
    first_name = db.Column(db.String(150), nullable=True)
    user_name = db.Column(db.String(120), unique=True, nullable=True)
    mobile = db.Column(db.String(15), unique=True, nullable=True)

    # Employment
    emp_id = db.Column(db.String(10), unique=True, nullable=True)
    doj = db.Column(db.Date, nullable=True)
    emp_type = db.Column(db.String(50), nullable=True)
    circle = db.Column(db.String(50), nullable=True)

    # OAuth (old users)
    oauth_provider = db.Column(db.String(50), nullable=True)
    oauth_id = db.Column(db.String(255), unique=True, nullable=True)
    oauth_token = db.Column(db.Text, nullable=True)
    oauth_refresh_token = db.Column(db.Text, nullable=True)
    oauth_token_expiry = db.Column(db.DateTime, nullable=True)

    # System flags
    is_active = db.Column(db.Boolean, default=True)
    is_exited = db.Column(db.Boolean, default=False)

    exit_date = db.Column(db.Date, nullable=True)
    exit_reason = db.Column(db.Text, nullable=True)
    exit_type = db.Column(db.String(30), nullable=True)

    created_at = db.Column(db.DateTime, nullable=True, default=datetime.now)

    # --- Relationships (UNCHANGED) ---
    employee_details = db.relationship('Employee', back_populates='admin', uselist=False, cascade="all, delete-orphan")
    family_details = db.relationship('FamilyDetails', back_populates='admin', cascade="all, delete-orphan")
    previous_companies = db.relationship('PreviousCompany', back_populates='admin', lazy=True, cascade="all, delete-orphan")
    education_details = db.relationship('Education', back_populates='admin', lazy='dynamic', cascade="all, delete-orphan")
    document_details = db.relationship('UploadDoc', back_populates='admin', lazy='dynamic', cascade="all, delete-orphan")
    leave_applications = db.relationship('LeaveApplication', back_populates='admin', lazy='dynamic', cascade="all, delete-orphan")
    punch_records = db.relationship('Punch', back_populates='admin', lazy='dynamic', cascade="all, delete-orphan")
    assets = db.relationship('Asset', back_populates='admin', cascade="all, delete-orphan")
    payslips = db.relationship('PaySlip', back_populates='admin', cascade="all, delete-orphan")
    queries = db.relationship('Query', back_populates='admin', cascade="all, delete-orphan")
    query_replies = db.relationship('QueryReply', back_populates='admin', cascade="all, delete-orphan")
    work_from_home_applications = db.relationship('WorkFromHomeApplication', back_populates='admin', cascade='all, delete-orphan')
    resignations = db.relationship('Resignation', back_populates='admin', lazy='dynamic', cascade="all, delete-orphan")
    expense_claim_header = db.relationship('ExpenseClaimHeader', back_populates='admin', cascade='all, delete-orphan')
    noc_emp = db.relationship('Noc', back_populates='admin', cascade='all, delete-orphan')
    noc_upload = db.relationship('Noc_Upload', back_populates='admin', cascade='all, delete-orphan')
    performances = db.relationship('EmployeePerformance', back_populates='admin', cascade='all, delete-orphan')

    leave_balance = db.relationship(
        'LeaveBalance',
        back_populates='admin',
        uselist=False,
        cascade="all, delete-orphan"
    )

    # --- Password helpers ---
    def set_password(self, password):
        self.password = generate_password_hash(password)

    def check_password(self, password):
        # werkzeug.security.check_password_hash expects (pwhash, password)
        return check_password_hash(self.password, password)





class EmployeeArchive(db.Model):
    __tablename__ = "employee_archive"

    id = db.Column(db.Integer, primary_key=True)

    # Original admin reference (optional)
    admin_id = db.Column(db.Integer, nullable=True)

    # Basic identity
    full_name = db.Column(db.String(150), nullable=False)
    emp_id = db.Column(db.String(20), nullable=True)

    # Contact (personal, not official)
    personal_email = db.Column(db.String(120), nullable=True)
    mobile = db.Column(db.String(15), nullable=True)

    # Employment details
    circle = db.Column(db.String(50))
    emp_type = db.Column(db.String(50))
    doj = db.Column(db.Date)
    dol = db.Column(db.Date)  # Date of leaving

    # Exit info
    exit_reason = db.Column(db.Text)
    exit_type = db.Column(db.String(30))  # Resigned / Terminated / Absconded
    exit_initiated_by = db.Column(db.String(50))  # HR / System

    # Metadata
    archived_at = db.Column(db.DateTime, default=db.func.now())



class AuditLog(db.Model):
    __tablename__ = "audit_logs"

    id = db.Column(db.Integer, primary_key=True)
    action = db.Column(db.String(100))
    performed_by = db.Column(db.String(120))   # HR email
    target_email = db.Column(db.String(120))   # Employee email
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
