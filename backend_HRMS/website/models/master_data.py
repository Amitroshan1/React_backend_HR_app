from datetime import datetime
from ..datetime_utils import utc_now
from .. import db


class MasterData(db.Model):
    __tablename__ = "master_data"

    id = db.Column(db.Integer, primary_key=True)
    master_type = db.Column(db.String(20), nullable=False)  # department | circle
    name = db.Column(db.String(80), nullable=False)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    __table_args__ = (
        db.UniqueConstraint("master_type", "name", name="uq_master_type_name"),
    )
