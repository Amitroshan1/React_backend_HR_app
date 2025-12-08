from .. import db
from flask_login import UserMixin
from datetime import datetime




class Punch(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    punch_date = db.Column(db.Date, nullable=False)
    
    punch_in = db.Column(db.Time, nullable=True)
    punch_out = db.Column(db.Time, nullable=True)
    today_work = db.Column(db.Time, nullable=True)
    
    is_holiday = db.Column(db.Boolean, default=False)
    is_wfh = db.Column(db.Boolean, default=False)  # ✅ New field to track WFH status
    
    lat = db.Column(db.Float, nullable=True)  # ✅ Optional: Latitude of punch location
    lon = db.Column(db.Float, nullable=True)  # ✅ Optional: Longitude of punch location

    admin = db.relationship('Admin', back_populates='punch_records')


class Location(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    radius = db.Column(db.Float, default=100)




class LeaveBalance(db.Model):
    __tablename__ = 'leave_balances'

    id = db.Column(db.Integer, primary_key=True)
    
    # Foreign keys for Signup and Admin
    signup_id = db.Column(db.Integer, db.ForeignKey('signups.id', ondelete="CASCADE"), unique=True, nullable=False)
    
    privilege_leave_balance = db.Column(db.Float, default=0.0, nullable=False)
    casual_leave_balance = db.Column(db.Float, default=0.0, nullable=False)
    compensatory_leave_balance = db.Column(db.Float, default=0.0, nullable=False)
    last_updated = db.Column(db.Date, nullable=True)
    # Relationships
    signup = db.relationship('Signup', back_populates='leave_balance')



    def restore_leave(self, leave_type, days):
        if leave_type == 'Privilege Leave':
            self.privilege_leave_balance += days
        elif leave_type == 'Casual Leave':
            self.casual_leave_balance += days
        elif leave_type == 'Half Day Leave':
            self.casual_leave_balance += 0.5
    
    def __init__(self, signup_id, admin_id=None, privilege_leave_balance=0.0, casual_leave_balance=0.0, **kwargs):
        super().__init__(**kwargs)
        self.signup_id = signup_id
        self.admin_id = admin_id
        self.privilege_leave_balance = privilege_leave_balance
        self.casual_leave_balance = casual_leave_balance



    

class LeaveApplication(db.Model):
    __tablename__ = 'leave_applications'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    leave_type = db.Column(db.String(50), nullable=False)
    reason = db.Column(db.String(255), nullable=False)  
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)  
    status = db.Column(db.String(20), nullable=False, default='Pending')
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)
    deducted_days = db.Column(db.Float, default=0.0)
    extra_days=db.Column(db.Float, default=0.0)

    admin = db.relationship('Admin', back_populates='leave_applications')




class WorkFromHomeApplication(db.Model):
    __tablename__ = 'work_from_home_applications'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)

    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    reason = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='Pending')

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.now)

    admin = db.relationship('Admin', back_populates='work_from_home_applications')
   