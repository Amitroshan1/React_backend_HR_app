"""Per-employee payroll / statutory fields for Accounts (one row per admin when linked)."""
from datetime import datetime

from .. import db


class EmployeeAccounts(db.Model):
    __tablename__ = "employee_accounts"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    # Set when employee_number matches Admin.emp_id; nullable until first successful link
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        unique=True,
        nullable=True,
        index=True,
    )

    # Employee number as entered (must match admins.emp_id when saving / linking)
    employee_number = db.Column(db.String(50), nullable=True, index=True)

    function = db.Column(db.String(150), nullable=True)
    designation = db.Column(db.String(150), nullable=True)
    location = db.Column(db.String(200), nullable=True)
    bank_details = db.Column(db.Text, nullable=True)
    date_of_joining = db.Column(db.Date, nullable=True)
    tax_regime = db.Column(db.String(80), nullable=True)
    pan = db.Column(db.String(20), nullable=True)
    uan = db.Column(db.String(30), nullable=True)
    pf_account_number = db.Column(db.String(50), nullable=True)
    esi_number = db.Column(db.String(50), nullable=True)
    pran = db.Column(db.String(50), nullable=True)

    created_at = db.Column(db.DateTime, nullable=True, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=True, default=datetime.utcnow, onupdate=datetime.utcnow)

    admin = db.relationship("Admin", back_populates="employee_accounts_record")

    def to_dict(self):
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "employee_number": self.employee_number,
            "function": self.function,
            "designation": self.designation,
            "location": self.location,
            "bank_details": self.bank_details,
            "date_of_joining": self.date_of_joining.isoformat() if self.date_of_joining else None,
            "tax_regime": self.tax_regime,
            "pan": self.pan,
            "uan": self.uan,
            "pf_account_number": self.pf_account_number,
            "esi_number": self.esi_number,
            "pran": self.pran,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
