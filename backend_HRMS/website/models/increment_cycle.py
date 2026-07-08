"""Annual increment cycle windows."""
from __future__ import annotations

from .. import db
from ..datetime_utils import isoformat_api, utc_now


class IncrementCycle(db.Model):
    __tablename__ = "increment_cycles"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(120), nullable=False)
    fiscal_year = db.Column(db.String(20), nullable=False, index=True)
    window_start = db.Column(db.Date, nullable=True)
    window_end = db.Column(db.Date, nullable=True)
    status = db.Column(db.String(20), nullable=False, default="open", index=True)
    created_by = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "fiscal_year": self.fiscal_year,
            "window_start": self.window_start.isoformat() if self.window_start else None,
            "window_end": self.window_end.isoformat() if self.window_end else None,
            "status": self.status,
            "created_by": self.created_by,
            "created_at": isoformat_api(self.created_at),
        }
