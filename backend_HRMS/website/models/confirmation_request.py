from .. import db
from datetime import datetime




class ConfirmationRequest(db.Model):
    __tablename__ = 'confirmation_requests'

    id = db.Column(db.Integer, primary_key=True)

    # Foreign key linking to employee (Signup table)
    employee_id = db.Column(db.Integer, db.ForeignKey('signups.id'), nullable=False)

    # L1, L2, L3 manager emails stored from ManagerContact
    l1_email = db.Column(db.String(120))
    l2_email = db.Column(db.String(120))
    l3_email = db.Column(db.String(120))
    status = db.Column(db.String(50), default='Pending')
    # 🆕 Review/comment field
    review_comment = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Optional: readable representation (for debugging/logs)
    def __repr__(self):
        return f"<ConfirmationRequest employee_id={self.employee_id} status={self.status}>"


class HRConfirmationRequest(db.Model):
    __tablename__ = 'hr_confirmation_requests'

    id = db.Column(db.Integer, primary_key=True)
    confirmation_id = db.Column(db.Integer, db.ForeignKey('confirmation_requests.id'), nullable=False)
    employee_id = db.Column(db.Integer, db.ForeignKey('signups.id'), nullable=False)
    hr_email = db.Column(db.String(120))
    manager_email = db.Column(db.String(120))
    manager_decision = db.Column(db.String(50))  # Approved / Rejected
    manager_review = db.Column(db.Text)
    status = db.Column(db.String(50), default='Pending')  # HR's action
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    employee = db.relationship("Signup", backref="hr_confirmation_requests", lazy=True)
    confirmation = db.relationship("ConfirmationRequest", backref="hr_requests", lazy=True)