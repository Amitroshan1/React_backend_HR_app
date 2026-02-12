
from .. import db
class Query(db.Model):
    __tablename__ = 'queries'

    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)

    title = db.Column(db.String(255), nullable=False)
    department = db.Column(db.String(50), nullable=False)
    query_text = db.Column(db.Text, nullable=False)

    status = db.Column(db.String(20), default='New')
    created_at = db.Column(db.DateTime, server_default=db.func.now())
    photo = db.Column(db.Text)

    # 🔥 FIX HERE (removed backref)
    admin = db.relationship(
        'Admin',
        back_populates='queries'
    )

    replies = db.relationship(
        'QueryReply',
        back_populates='parent_query',
        cascade='all, delete-orphan'
    )



class QueryReply(db.Model):
    __tablename__ = 'query_replies'

    id = db.Column(db.Integer, primary_key=True)
    query_id = db.Column(db.Integer, db.ForeignKey('queries.id'), nullable=False)
    admin_id = db.Column(db.Integer, db.ForeignKey('admins.id'), nullable=False)

    reply_text = db.Column(db.Text, nullable=False)
    user_type = db.Column(db.String(20), nullable=False)
    created_at = db.Column(db.DateTime, server_default=db.func.now())

    parent_query = db.relationship(
        'Query',
        back_populates='replies'
    )

    admin = db.relationship(
        'Admin',
        back_populates='query_replies'
    )





