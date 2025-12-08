from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from .. import db

class Signup(db.Model, UserMixin):
    __tablename__ = 'signups'

    id = db.Column(db.Integer, primary_key=True)
    user_name = db.Column(db.String(120),unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(350), nullable=False)
    first_name = db.Column(db.String(150), nullable=False)
    mobile = db.Column(db.String(15), unique=True, nullable=False)
    emp_id = db.Column(db.String(10), unique=True, nullable=False)
    doj = db.Column(db.Date, nullable=False)  # Renamed `Doj` to `doj` (Python naming convention)
    emp_type = db.Column(db.String(50), nullable=False, default='employee')
    circle = db.Column(db.String(50), nullable=True)  # Changed default `None` to `nullable=True`
    confirmation_email_sent = db.Column(db.Boolean, default=False)

    # Use the `single_parent=True` flag to ensure delete-orphan works on the "many" side
    leave_balance = db.relationship('LeaveBalance', back_populates='signup', uselist=False, cascade="all, delete-orphan")
    confirmation_requests = db.relationship('ConfirmationRequest',backref='employee',lazy=True,cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Signup {self.email}>"

    # Set the password by hashing it
    def set_password(self, password):
        self.password = generate_password_hash(password)

    # Check if the entered password matches the hashed password
    def check_password(self, password):
        return check_password_hash(self.password, password)
