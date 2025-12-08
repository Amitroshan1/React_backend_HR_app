from .. import db
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime


class Admin(db.Model, UserMixin):
    __tablename__ = 'admins'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    first_name = db.Column(db.String(150), nullable=False)
    

    # OAuth2-specific fields
    oauth_provider = db.Column(db.String(50), nullable=False, default='microsoft')
    oauth_id = db.Column(db.String(255), unique=True, nullable=False)  # Stores the unique Microsoft ID
    oauth_token = db.Column(db.Text, nullable=True)  # Access token
    oauth_refresh_token = db.Column(db.Text, nullable=True)  # Refresh token
    oauth_token_expiry = db.Column(db.DateTime, nullable=True)  # Token expiration time

   



   

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
    performance = db.relationship('EmployeePerformance',back_populates='admin', cascade='all, delete-orphan')
    # sessions = db.relationship('Session', back_populates='admin', cascade="all, delete-orphan")


    
     # Check if the OAuth2 token is valid
    def is_oauth_token_valid(self):
        return self.oauth_token_expiry and self.oauth_token_expiry > datetime.now()
    







# class Session(db.Model):
#     __tablename__ = 'session'

#     session_id = db.Column(db.String(255), primary_key=True)
#     admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)  # Link to Admins
#     data = db.Column(db.Text, nullable=False)
#     expiry = db.Column(db.DateTime, nullable=False)

#     admin = db.relationship('Admin', back_populates='sessions')

#     def __repr__(self):
#         return f"<Session(session_id={self.session_id}, admin_id={self.admin_id}, expiry={self.expiry})>"
