from website import db


class ManagerContact(db.Model):
    __tablename__ = 'manager_contacts'

    id = db.Column(db.Integer, primary_key=True)
    circle_name = db.Column(db.String(50), nullable=False)
    user_type = db.Column(db.String(50), nullable=False)
    user_email = db.Column(db.String(100), default=None, nullable=True)
    l1_admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=True)
    l2_admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=True)
    l3_admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=True)
