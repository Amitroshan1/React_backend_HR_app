from .. import db
from flask_login import UserMixin
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

    # --- Identity / Auth ---
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(350), nullable=False)

    # --- Basic Profile ---
    first_name = db.Column(db.String(150), nullable=False)
    user_name = db.Column(db.String(120), unique=True, nullable=False)
    mobile = db.Column(db.String(15), unique=True, nullable=False)

    # --- Employee Info ---
    emp_id = db.Column(db.String(10), unique=True, nullable=False)
    doj = db.Column(db.Date, nullable=False)
    emp_type = db.Column(db.String(50), nullable=False, default='employee')
    circle = db.Column(db.String(50), nullable=True)

    # --- System Flags ---
    
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.now)

   

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
    noc_emp = db.relationship('Noc',back_populates='admin', cascade='all, delete-orphan')
    noc_upload = db.relationship('Noc_Upload',back_populates='admin', cascade='all, delete-orphan')
    performances = db.relationship(
        'EmployeePerformance',
        back_populates='admin',
        cascade='all, delete-orphan'
    )   
    leave_balance = db.relationship(
    'LeaveBalance',
    back_populates='admin',
    uselist=False,
    cascade="all, delete-orphan"
)

     # Password helpers
    def set_password(self, password):
        self.password = generate_password_hash(password)

    def check_password(self, password):
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
