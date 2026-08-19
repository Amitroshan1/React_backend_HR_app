"""Real-time attendance notifications (Phase 3D — SSE only).

Attendance persistence is independent: publish failures never roll back punches.
Import ``publisher`` alone without loading HTTP routes (keeps biometric tests light).
"""

from flask import Blueprint

attendance_realtime_bp = Blueprint("attendance_realtime", __name__)

from . import models  # noqa: E402,F401
from . import hooks  # noqa: E402,F401 — register SQLAlchemy after_commit
