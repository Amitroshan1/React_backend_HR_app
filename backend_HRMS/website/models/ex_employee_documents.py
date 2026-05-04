"""Ex-employee document sharing: time-limited download links (no login)."""
from .. import db
from datetime import datetime


class ExEmployeeDocShare(db.Model):
    __tablename__ = "ex_employee_doc_shares"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    token_hash = db.Column(db.String(64), unique=True, nullable=False, index=True)
    recipient_email = db.Column(db.String(255), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    created_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    files = db.relationship(
        "ExEmployeeDocFile",
        backref="share",
        lazy=True,
        cascade="all, delete-orphan",
    )


class ExEmployeeDocFile(db.Model):
    __tablename__ = "ex_employee_doc_files"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    share_id = db.Column(db.Integer, db.ForeignKey("ex_employee_doc_shares.id"), nullable=False)
    display_name = db.Column(db.String(255), nullable=False)
    stored_rel_path = db.Column(db.String(512), nullable=False)
