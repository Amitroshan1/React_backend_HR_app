"""CTC breakup per employee (single row per admin)."""

from datetime import datetime

from .. import db


class CTCBreakup(db.Model):
    __tablename__ = "ctc_breakups"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)

    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Earnings
    basic_salary = db.Column(db.Float, nullable=True)
    hra = db.Column(db.Float, nullable=True)
    other_allowance = db.Column(db.Float, nullable=True)
    gross_salary = db.Column(db.Float, nullable=True)
    net_salary = db.Column(db.Float, nullable=True)

    

    # Deductions
    epf = db.Column(db.Float, nullable=True)
    # Percentage (e.g., 3.25 for 3.25%)
    esic = db.Column(db.Float, nullable=True)
    ptax = db.Column(db.Float, nullable=True)

    

    created_at = db.Column(db.DateTime, default=datetime.now, nullable=True)
    updated_at = db.Column(
        db.DateTime,
        default=datetime.now,
        onupdate=datetime.now,
        nullable=True,
    )

    admin = db.relationship("Admin", back_populates="ctc_breakup_record")

    __table_args__ = (
        db.UniqueConstraint(
            "admin_id",
            name="uq_ctc_breakup_admin_id",
        ),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "admin_id": self.admin_id,
            "basic_salary": self.basic_salary,
            "hra": self.hra,
            "other_allowance": self.other_allowance,
            "gross_salary": self.gross_salary,
            "net_salary": self.net_salary,
            "epf": self.epf,
            "esic": self.esic,
            "ptax": self.ptax,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

