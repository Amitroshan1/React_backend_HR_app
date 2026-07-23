from datetime import datetime, timedelta

from .. import db
from ..datetime_utils import utc_now


class OTP(db.Model):
    """One-time password for login (email now; SMS channel reserved for later)."""

    __tablename__ = "otps"

    id = db.Column(db.Integer, primary_key=True)
    identifier = db.Column(db.String(120), nullable=False, index=True)
    channel = db.Column(db.String(20), nullable=False, default="email")  # email | sms
    otp_hash = db.Column(db.String(128), nullable=False)
    admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    expires_at = db.Column(db.DateTime, nullable=False)
    is_used = db.Column(db.Boolean, nullable=False, default=False)
    attempts = db.Column(db.Integer, nullable=False, default=0)

    # Legacy columns kept optional so old rows (if any) do not break
    email = db.Column(db.String(120), nullable=True)
    otp_code = db.Column(db.String(6), nullable=True)

    @staticmethod
    def expiry_from_now(minutes=5):
        return utc_now() + timedelta(minutes=minutes)

    def is_expired(self):
        if not self.expires_at:
            return True
        return utc_now() > self.expires_at
