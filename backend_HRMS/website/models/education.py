from .. import db
from flask_login import UserMixin



class Education(db.Model, UserMixin):
    __tablename__ = 'education'
    
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    qualification = db.Column(db.String(100), nullable=False)
    institution = db.Column(db.String(100), nullable=False)
    board = db.Column(db.String(100), nullable=False)
    start = db.Column(db.Date, nullable=False)
    end = db.Column(db.Date, nullable=False)
    marks = db.Column(db.String(50), nullable=False)
    doc_file = db.Column(db.String(200), nullable=True)

    admin = db.relationship('Admin', back_populates='education_details')

    def __repr__(self):
        return f'<Education {self.qualification} - {self.institution}>'





class UploadDoc(db.Model, UserMixin):
    __tablename__ = 'upload_docs'
    
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)

    # Aadhaar
    aadhaar_front = db.Column(db.String(200), nullable=True)
    aadhaar_back = db.Column(db.String(200), nullable=True)

    # PAN
    pan_front = db.Column(db.String(200), nullable=True)
    pan_back = db.Column(db.String(200), nullable=True)

    # Appointment Letter
    appointment_letter = db.Column(db.String(200), nullable=True)

    # Passbook
    passbook_front = db.Column(db.String(200), nullable=True)
    

    # Relationship
    admin = db.relationship('Admin', back_populates='document_details')

    def __repr__(self):
        return f'<UploadDoc admin_id={self.admin_id}>'

