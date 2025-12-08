from .. import db
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime


class EmployeePerformance(db.Model):
    __tablename__ = 'employee_performance'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=True)
    employee_name = db.Column(db.String(150), nullable=False)
    month = db.Column(db.String(50), nullable=False)
    achievements = db.Column(db.Text, nullable=False)
    challenges = db.Column(db.Text, nullable=True)
    goals_next_month = db.Column(db.Text, nullable=True)
    suggestion_improvement = db.Column(db.Text, nullable=True)
    submitted_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    status = db.Column(db.String(20), default='Pending', nullable=False)

    # ✅ Cascade delete review when performance is deleted
    admin = db.relationship('Admin', backref=db.backref('performances', lazy='dynamic'))
    review = db.relationship(
        'ManagerReview',
        back_populates='performance',
        cascade='all, delete-orphan',
        uselist=False
    )

    __table_args__ = (
        db.UniqueConstraint('employee_name', 'month', name='uq_employee_month'),
    )

class ManagerReview(db.Model):
    __tablename__ = 'manager_reviews'

    id = db.Column(db.Integer, primary_key=True)
    performance_id = db.Column(db.Integer, db.ForeignKey('employee_performance.id', ondelete='CASCADE'), nullable=False)
    manager_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)
    rating = db.Column(db.String(50), nullable=True)
    comments = db.Column(db.Text, nullable=True)
    reviewed_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    performance = db.relationship('EmployeePerformance', back_populates='review')
    manager = db.relationship('Admin', backref=db.backref('manager_reviews', lazy='dynamic'))

