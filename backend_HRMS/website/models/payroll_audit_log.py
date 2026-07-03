"""Audit trail for monthly payroll changes and status transitions."""

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class PayrollAuditLog(db.Model):
    __tablename__ = "payroll_audit_logs"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    payroll_id = db.Column(
        db.Integer,
        db.ForeignKey("monthly_payrolls.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action = db.Column(db.String(40), nullable=False)
    from_status = db.Column(db.String(20), nullable=True)
    to_status = db.Column(db.String(20), nullable=True)
    actor_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    field_changes = db.Column(db.JSON, nullable=True)
    comment = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    payroll = db.relationship("MonthlyPayroll", backref=db.backref("audit_logs", lazy="dynamic"))
    actor = db.relationship("Admin", foreign_keys=[actor_admin_id])

    def to_dict(self):
        return {
            "id": self.id,
            "payroll_id": self.payroll_id,
            "action": self.action,
            "from_status": self.from_status,
            "to_status": self.to_status,
            "actor_admin_id": self.actor_admin_id,
            "field_changes": self.field_changes,
            "comment": self.comment,
            "created_at": isoformat_api(self.created_at),
        }
