from datetime import datetime, timedelta
from flask import current_app,url_for
from .. import db


class NewsFeed(db.Model):
    __tablename__ = 'news_feeds'

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    content = db.Column(db.Text, nullable=False)
    file_path = db.Column(db.String(255), nullable=True)
    circle = db.Column(db.String(50), nullable=False)  
    emp_type = db.Column(db.String(50), nullable=False) 
    created_at = db.Column(db.DateTime, default=datetime.now)

    def is_new(self): 
        return datetime.now() - self.created_at <= timedelta(weeks=1)

    def file_url(self):
        if self.file_path:
            return url_for('static', filename=f'uploads/{self.file_path}', _external=True)
        return None
    


class PaySlip(db.Model):
    __tablename__ = 'payslips'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    month = db.Column(db.String(20), nullable=False)
    year = db.Column(db.String(4), nullable=False)
    file_path = db.Column(db.String(255), nullable=False)

    admin = db.relationship('Admin', back_populates='payslips')
