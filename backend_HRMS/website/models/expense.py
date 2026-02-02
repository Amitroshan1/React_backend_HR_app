from .. import db
from flask_login import UserMixin


class ExpenseClaimHeader(db.Model):
    __tablename__ = 'expense_claim_header'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    employee_name = db.Column(db.String(100), nullable=False)
    designation = db.Column(db.String(50), nullable=False)
    email = db.Column(db.String(120), nullable=False)
    emp_id = db.Column(db.String(20), nullable=False)
    project_name = db.Column(db.String(100), nullable=False)
    country_state = db.Column(db.String(100), nullable=False)
    travel_from_date = db.Column(db.Date, nullable=False)
    travel_to_date = db.Column(db.Date, nullable=False)
    expenses = db.relationship('ExpenseLineItem', backref='claim', cascade="all, delete", lazy=True)

    admin = db.relationship('Admin', back_populates='expense_claim_header')




class ExpenseLineItem(db.Model):
    __tablename__ = 'expense_line_item'
    id = db.Column(db.Integer, primary_key=True)
    claim_id = db.Column(db.Integer, db.ForeignKey('expense_claim_header.id'), nullable=False)
    sr_no = db.Column(db.Integer, nullable=False)
    date = db.Column(db.Date, nullable=False)
    purpose = db.Column(db.Text, nullable=False)
    amount = db.Column(db.Float, nullable=False)
    currency = db.Column(db.String(10), nullable=False)
    Attach_file = db.Column(db.String(100), nullable=True)
    status = db.Column(db.String(20), default='Pending')  # Added status field



