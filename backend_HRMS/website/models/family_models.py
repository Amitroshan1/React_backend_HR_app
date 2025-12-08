from .. import db
from flask_login import UserMixin


class FamilyDetails(db.Model, UserMixin):
    __tablename__ = 'family_details'
    
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    
    photo_filename = db.Column(db.String(100), nullable=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), nullable=True)
    dob = db.Column(db.Date, nullable=False)
    age = db.Column(db.Integer, nullable=False)
    relation = db.Column(db.String(100), nullable=False)
    occupation = db.Column(db.String(100), nullable=False)
    income = db.Column(db.String(100), nullable=True)
    address = db.Column(db.String(255), nullable=False)
    remarks = db.Column(db.String(255), nullable=True)
    
    
    admin = db.relationship('Admin', back_populates='family_details')
    
    
    
    
    def __repr__(self):
        return f'<FamilyDetails {self.name}>'