from datetime import datetime
from .. import db

class Resignation(db.Model):
    __tablename__ = 'resignations'

    id = db.Column(db.Integer, primary_key=True)

    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    admin = db.relationship('Admin', back_populates='resignations')

    resignation_date = db.Column(db.Date, nullable=False)
    reason = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(20), default='Pending')  # Pending, Approved, Rejected
    applied_on = db.Column(db.DateTime, default=datetime.now())  # Use function, not datetime.now()


class Noc(db.Model):
    __tablename__ = 'noc'
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    admin = db.relationship('Admin', back_populates='noc_emp')
    noc_date = db.Column(db.Date, nullable=False)
    status = db.Column(db.String(20), default='Pending')


class Noc_Upload(db.Model):
    __tablename__ = 'noc_upload'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    file_path = db.Column(db.String(255), nullable=False)
    emp_type_uploader = db.Column(db.String(50), nullable=False)

    admin = db.relationship('Admin', back_populates='noc_upload')


class NocDepartmentRequest(db.Model):
    """Per-department NOC line item when an employee requests NOC from HR/Accounts/Manager/IT."""

    __tablename__ = 'noc_department_requests'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    resignation_id = db.Column(db.Integer, db.ForeignKey('resignations.id'), nullable=False)
    department_key = db.Column(db.String(20), nullable=False)
    noc_date = db.Column(db.Date, nullable=False)
    status = db.Column(db.String(20), default='Pending')
    requested_at = db.Column(db.DateTime, default=datetime.now)
    file_path = db.Column(db.String(255), nullable=True)
    uploaded_at = db.Column(db.DateTime, nullable=True)
    uploaded_by_admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=True)

    employee = db.relationship('Admin', foreign_keys=[admin_id])
    resignation = db.relationship('Resignation', foreign_keys=[resignation_id])
    uploaded_by = db.relationship('Admin', foreign_keys=[uploaded_by_admin_id])

