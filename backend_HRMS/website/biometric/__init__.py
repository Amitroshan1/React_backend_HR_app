"""
Biometric integration (eSSL AiFace ERIS / ADMS).

Phase 3C: /iclock/cdata → biometric_logs → attendance_bridge → PunchSession
via punch_aggregate / punch_auto_close. Does not replace web punch routes.
"""

from flask import Blueprint

biometric_bp = Blueprint("biometric", __name__)

from . import routes  # noqa: E402,F401
from . import models  # noqa: E402,F401
