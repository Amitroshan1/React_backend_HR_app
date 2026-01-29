

#https://solviotec.com/api/account



from flask import Blueprint, request, current_app, jsonify,json
from flask_jwt_extended import jwt_required, get_jwt
from .email import send_email_via_zeptomail,send_welcome_email
from .models.Admin_models import Admin
from datetime import datetime,date,timedelta
from zoneinfo import ZoneInfo
import calendar
from .email import asset_email,update_asset_email
from .utility import generate_attendance_excel,send_excel_file,calculate_month_summary
from .models.emp_detail_models import Employee,Asset
from .models.family_models import FamilyDetails
from .models.prev_com import PreviousCompany
from .models.education import UploadDoc, Education
from .models.attendance import Punch, LeaveApplication,LeaveBalance
from .models.news_feed import NewsFeed
from werkzeug.security import generate_password_hash
import os
from . import db
from werkzeug.utils import secure_filename




Accounts = Blueprint('Accounts', __name__)






