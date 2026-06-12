from datetime import datetime

from .. import db
from ..datetime_utils import utc_now


class AssessmentInvite(db.Model):
    __tablename__ = "assessment_invites"

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(150), nullable=False)
    department = db.Column(db.String(120), nullable=False)
    candidate_email = db.Column(db.String(150), nullable=False, index=True)
    token_hash = db.Column(db.String(128), nullable=False, unique=True, index=True)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)
    duration_minutes = db.Column(db.Integer, nullable=False, default=180)
    attempt_no = db.Column(db.Integer, nullable=False, default=1)
    status = db.Column(db.String(30), nullable=False, default="invited", index=True)

    started_at = db.Column(db.DateTime, nullable=True)
    submitted_at = db.Column(db.DateTime, nullable=True)
    camera_granted = db.Column(db.Boolean, nullable=False, default=False)
    mic_granted = db.Column(db.Boolean, nullable=False, default=False)
    selfie_path = db.Column(db.String(300), nullable=True)
    recording_path = db.Column(db.String(300), nullable=True)
    # First time HR opened the session recording; file is removed this many days after (see Human_resource).
    recording_first_viewed_at = db.Column(db.DateTime, nullable=True)

    answers_json = db.Column(db.Text, nullable=True)  # JSON serialized answers by question number
    auto_score = db.Column(db.Float, nullable=True)
    manual_score = db.Column(db.Float, nullable=True)
    total_score = db.Column(db.Float, nullable=True)
    avg_score = db.Column(db.Float, nullable=True)
    evaluated_at = db.Column(db.DateTime, nullable=True)
    evaluated_by = db.Column(db.String(150), nullable=True)
    manual_marks_json = db.Column(db.Text, nullable=True)  # JSON serialized marks for Q26-62

    hr_notified_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(
        db.DateTime, nullable=False, default=utc_now, onupdate=utc_now
    )

