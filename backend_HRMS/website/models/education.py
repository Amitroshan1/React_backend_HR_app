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


    def to_dict(self):
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}

    def __repr__(self):
        return f'<Education {self.qualification} - {self.institution}>'





class UploadDoc(db.Model, UserMixin):
    __tablename__ = 'upload_docs'
    
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)

    # Identity numbers (entered before document upload)
    aadhaar_number = db.Column(db.String(12), nullable=True)
    pan_number = db.Column(db.String(10), nullable=True)
    bank_account_number = db.Column(db.String(30), nullable=True)
    aadhaar_number_enc = db.Column(db.LargeBinary, nullable=True)
    pan_number_enc = db.Column(db.LargeBinary, nullable=True)
    bank_account_number_enc = db.Column(db.LargeBinary, nullable=True)
    bank_account_last4 = db.Column(db.String(4), nullable=True)
    pan_last4 = db.Column(db.String(4), nullable=True)
    bank_name = db.Column(db.String(120), nullable=True)
    bank_branch_code = db.Column(db.String(20), nullable=True)
    ifsc_code = db.Column(db.String(11), nullable=True)

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



    def to_dict(self):
        from ..pii_crypto import pii_get

        skip = {
            "aadhaar_number_enc",
            "pan_number_enc",
            "bank_account_number_enc",
        }
        data = {
            c.name: getattr(self, c.name)
            for c in self.__table__.columns
            if c.name not in skip
        }
        data["aadhaar_number"] = pii_get(self, "aadhaar_number")
        data["pan_number"] = pii_get(self, "pan_number")
        data["bank_account_number"] = pii_get(self, "bank_account_number")
        return data
    
    def __repr__(self):
        return f'<UploadDoc admin_id={self.admin_id}>'

