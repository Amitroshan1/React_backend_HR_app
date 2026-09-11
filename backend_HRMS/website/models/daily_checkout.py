"""Day-use Assets (daily checkout) — separate from long-term IT assignment."""

from .. import db
from ..datetime_utils import utc_now


class EmployeeSignature(db.Model):
    __tablename__ = "employee_signatures"

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False, index=True)
    version = db.Column(db.Integer, nullable=False)
    file_path = db.Column(db.String(255), nullable=False)
    content_type = db.Column(db.String(40), nullable=True)
    sha256 = db.Column(db.String(64), nullable=True)
    is_current = db.Column(db.Boolean, nullable=False, default=True, server_default="1", index=True)
    uploaded_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    uploaded_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)

    __table_args__ = (db.UniqueConstraint("admin_id", "version", name="uq_employee_signature_version"),)


class DailyEmployeeOpenHold(db.Model):
    """Legacy one-open-request lock (no longer written on create; kept for cleanup)."""

    __tablename__ = "daily_employee_open_holds"

    requester_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), primary_key=True)
    request_id = db.Column(
        db.Integer,
        db.ForeignKey("daily_checkout_requests.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )


class DailyUnitHold(db.Model):
    """Physical unit lock: one day-use hold per asset_unit_id; a request may hold many units."""

    __tablename__ = "daily_unit_holds"

    asset_unit_id = db.Column(db.Integer, db.ForeignKey("it_asset_units.id"), primary_key=True)
    request_id = db.Column(
        db.Integer,
        db.ForeignKey("daily_checkout_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    held_at = db.Column(db.DateTime, nullable=False, default=utc_now)


class DailyCheckoutRequest(db.Model):
    __tablename__ = "daily_checkout_requests"

    id = db.Column(db.Integer, primary_key=True)
    request_code = db.Column(db.String(40), unique=True, nullable=False, index=True)

    requester_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False, index=True)
    requester_emp_id_snapshot = db.Column(db.String(20), nullable=True)
    requester_name_snapshot = db.Column(db.String(150), nullable=True)
    requester_email_snapshot = db.Column(db.String(120), nullable=True)
    requester_dept_snapshot = db.Column(db.String(50), nullable=True)
    requester_circle_snapshot = db.Column(db.String(50), nullable=True)
    manager_admin_ids_json = db.Column(db.JSON, nullable=True)
    manager_emails_snapshot = db.Column(db.JSON, nullable=True)

    requested_category = db.Column(db.String(40), nullable=False, default="Hardware", server_default="Hardware")
    requested_hw_type = db.Column(db.String(40), nullable=False)
    requested_notes = db.Column(db.String(500), nullable=True)
    # Multi-item payload: [{line_type, hw_type?, description?, quantity}, ...]
    items_json = db.Column(db.JSON, nullable=True)
    expected_return_at = db.Column(db.DateTime, nullable=False, index=True)

    status = db.Column(db.String(32), nullable=False, default="requested", server_default="requested", index=True)
    rejection_reason = db.Column(db.Text, nullable=True)
    cancelled_reason = db.Column(db.String(500), nullable=True)
    overdue_notified_at = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=utc_now, index=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    requester_admin = db.relationship("Admin", foreign_keys=[requester_admin_id])
    assignment = db.relationship(
        "DailyCheckoutAssignment",
        back_populates="request",
        uselist=False,
        cascade="all, delete-orphan",
    )
    return_row = db.relationship(
        "DailyCheckoutReturn",
        back_populates="request",
        uselist=False,
        cascade="all, delete-orphan",
    )
    documents = db.relationship(
        "DailyCheckoutDocument",
        back_populates="request",
        cascade="all, delete-orphan",
    )
    events = db.relationship(
        "DailyCheckoutEvent",
        back_populates="request",
        cascade="all, delete-orphan",
        order_by="DailyCheckoutEvent.id",
    )


class DailyCheckoutAssignment(db.Model):
    """Primary assignment row per request; all units live in fulfillment_json.devices."""

    __tablename__ = "daily_checkout_assignments"

    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(
        db.Integer,
        db.ForeignKey("daily_checkout_requests.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    asset_unit_id = db.Column(db.Integer, db.ForeignKey("it_asset_units.id"), nullable=False, index=True)
    unit_code_snapshot = db.Column(db.String(60), nullable=True)
    serial_snapshot = db.Column(db.String(120), nullable=True)
    brand_snapshot = db.Column(db.String(100), nullable=True)
    model_snapshot = db.Column(db.String(100), nullable=True)
    asset_name_snapshot = db.Column(db.String(150), nullable=True)
    assigned_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    assigned_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    expected_return_at = db.Column(db.DateTime, nullable=True)
    condition_out = db.Column(db.String(20), nullable=True)
    # IT fulfillment: {devices: [...], accessories: [{description, comment, quantity}, ...]}
    fulfillment_json = db.Column(db.JSON, nullable=True)

    request = db.relationship("DailyCheckoutRequest", back_populates="assignment")
    asset_unit = db.relationship("ITAssetUnit")
    assigned_by_admin = db.relationship("Admin", foreign_keys=[assigned_by_admin_id])


class DailyCheckoutReturn(db.Model):
    __tablename__ = "daily_checkout_returns"

    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(
        db.Integer,
        db.ForeignKey("daily_checkout_requests.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    initiated_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    initiated_at = db.Column(db.DateTime, nullable=True)
    received_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    received_at = db.Column(db.DateTime, nullable=True)
    condition_in = db.Column(db.String(20), nullable=True)
    remarks = db.Column(db.Text, nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    walk_up = db.Column(db.Boolean, nullable=False, default=False, server_default="0")

    request = db.relationship("DailyCheckoutRequest", back_populates="return_row")


class DailyCheckoutDocument(db.Model):
    __tablename__ = "daily_checkout_documents"

    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(
        db.Integer,
        db.ForeignKey("daily_checkout_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    doc_type = db.Column(db.String(20), nullable=False)
    file_path = db.Column(db.String(255), nullable=False)
    sha256 = db.Column(db.String(64), nullable=True)
    signature_id = db.Column(db.Integer, db.ForeignKey("employee_signatures.id"), nullable=True)
    generated_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    generated_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)

    request = db.relationship("DailyCheckoutRequest", back_populates="documents")
    signature = db.relationship("EmployeeSignature")

    __table_args__ = (db.UniqueConstraint("request_id", "doc_type", name="uq_daily_checkout_doc_type"),)


class DailyCheckoutEvent(db.Model):
    __tablename__ = "daily_checkout_events"

    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(
        db.Integer,
        db.ForeignKey("daily_checkout_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_code = db.Column(db.String(40), nullable=False, index=True)
    actor_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)
    actor_role = db.Column(db.String(30), nullable=True)
    from_status = db.Column(db.String(32), nullable=True)
    to_status = db.Column(db.String(32), nullable=True)
    payload_json = db.Column(db.JSON, nullable=True)
    occurred_at = db.Column(db.DateTime, nullable=False, default=utc_now, index=True)

    request = db.relationship("DailyCheckoutRequest", back_populates="events")
    actor_admin = db.relationship("Admin", foreign_keys=[actor_admin_id])


class DailyCheckoutOutbox(db.Model):
    __tablename__ = "daily_checkout_outbox"

    id = db.Column(db.Integer, primary_key=True)
    request_id = db.Column(
        db.Integer,
        db.ForeignKey("daily_checkout_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_code = db.Column(db.String(40), nullable=False)
    channel = db.Column(db.String(20), nullable=False, default="email", server_default="email")
    dedupe_key = db.Column(db.String(120), unique=True, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="pending", server_default="pending", index=True)
    attempts = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    last_error = db.Column(db.Text, nullable=True)
    payload_json = db.Column(db.JSON, nullable=True)
    sent_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
