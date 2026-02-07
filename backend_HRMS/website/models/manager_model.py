from website import db

from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash


class ManagerContact(db.Model):
    __tablename__ = 'manager_contacts'

    id = db.Column(db.Integer, primary_key=True)
    circle_name = db.Column(db.String(50), nullable=False)
    user_type = db.Column(db.String(50), nullable=False)
    user_email = db.Column(db.String(100), default=None,nullable=True)
    l1_name = db.Column(db.String(100), nullable=True)
    l1_mobile = db.Column(db.String(15), nullable=True)
    l1_email = db.Column(db.String(100), nullable=True)
    l2_name = db.Column(db.String(100), nullable=True)
    l2_mobile = db.Column(db.String(15), nullable=True)
    l2_email = db.Column(db.String(100), nullable=True)
    # Note: Some existing databases may not yet have l3_* columns.
    # To avoid runtime errors when the DB schema is older, make these optional.
    l3_name = db.Column(db.String(100), nullable=True)
    l3_mobile = db.Column(db.String(15), nullable=True)
    l3_email = db.Column(db.String(100), nullable=True)







 