from .. import db
from flask_login import UserMixin
from datetime import datetime





class Employee(db.Model,UserMixin):

    __tablename__ = 'employees'

    
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), unique=True, nullable=False)
     
    photo_filename = db.Column(db.String(100), nullable=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    father_name = db.Column(db.String(100), nullable=False)
    mother_name = db.Column(db.String(100), nullable=False)
    marital_status = db.Column(db.String(50), nullable=False)
    dob = db.Column(db.Date, nullable=False)
    emp_id = db.Column(db.String(50), unique=True, nullable=False)
    mobile = db.Column(db.String(20), nullable=False)
    gender = db.Column(db.String(50), nullable=False)
    emergency_mobile = db.Column(db.String(50), nullable=False)
    nationality = db.Column(db.String(150), nullable=False)
    blood_group = db.Column(db.String(150), nullable=False)
    designation=db.Column(db.String(150), nullable=False)
    
    permanent_address_line1 = db.Column(db.String(400), nullable=False)
    permanent_pincode = db.Column(db.String(10), nullable=False)
    permanent_district = db.Column(db.String(100), nullable=True)
    permanent_state = db.Column(db.String(100), nullable=True)

    present_address_line1 = db.Column(db.String(400), nullable=False)
    present_pincode = db.Column(db.String(10), nullable=False)
    present_district = db.Column(db.String(100), nullable=True)
    present_state = db.Column(db.String(100), nullable=True)


    
    # One-to-One relationship with Admin
    admin = db.relationship('Admin', back_populates='employee_details')

    def to_dict(self):
        return {c.name: getattr(self, c.name) for c in self.__table__.columns}
    
    def __repr__(self):
        return f'<Employee {self.name}>'
    

class Asset(db.Model):
    __tablename__ = 'assets'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(255))
    image_files = db.Column(db.Text)  # Store multiple image paths as a comma-separated string
    issue_date = db.Column(db.Date, default=datetime.now)  
    return_date = db.Column(db.Date)
    remark = db.Column(db.Text)  # ✅ Add this line to store remarks
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)

    admin = db.relationship('Admin', back_populates='assets')

    def set_image_files(self, images):
        """Store list of image filenames as a comma-separated string."""
        self.image_files = ",".join(images)

    def get_image_files(self):
        """Retrieve image filenames as a list."""
        return self.image_files.split(",") if self.image_files else []
    
    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "issue_date": self.issue_date.isoformat() if self.issue_date else None,
            "return_date": self.return_date.isoformat() if self.return_date else None,
            "remark": self.remark,
            "images": self.get_image_files(),
            "admin_id": self.admin_id
        }

