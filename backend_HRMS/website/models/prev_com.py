from .. import db

class PreviousCompany(db.Model):
    __tablename__ = 'previous_companies'

    id = db.Column(db.Integer, primary_key=True)
    com_name = db.Column(db.String(150), nullable=False)
    designation = db.Column(db.String(150), nullable=False)
    doj = db.Column(db.Date, nullable=False)
    dol = db.Column(db.Date, nullable=False)
    reason = db.Column(db.String(150), nullable=False)
    salary = db.Column(db.String(150), nullable=False)
    uan = db.Column(db.String(150), nullable=True)
    pan = db.Column(db.String(150), nullable=False)
    contact = db.Column(db.String(15), nullable=False)
    name_contact = db.Column(db.String(150), nullable=False)
    pf_num = db.Column(db.String(150), nullable=False)
    address = db.Column(db.String(150), nullable=False)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)

    
    admin = db.relationship('Admin', back_populates='previous_companies')

    def __repr__(self):
        return f'<PreviousCompany {self.com_name}>'
