from flask import Flask
from sqlalchemy import text

from website import db
from website.schema_align import align_schema


def test_align_adds_missing_table_and_nullable_column_without_touching_rows():
    app = Flask("schema_align_test")
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite:///:memory:",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        TESTING=True,
    )
    db.init_app(app)

    class AlignProbe(db.Model):
        __tablename__ = "schema_align_probe"
        id = db.Column(db.Integer, primary_key=True)
        name = db.Column(db.String(40), nullable=True)
        extra = db.Column(db.String(40), nullable=True)

    with app.app_context():
        db.session.execute(
            text("CREATE TABLE schema_align_probe (id INTEGER PRIMARY KEY, name VARCHAR(40))")
        )
        db.session.execute(text("INSERT INTO schema_align_probe (id, name) VALUES (1, 'kept')"))
        db.session.commit()

        result = align_schema(db, load_modules=False)
        assert "schema_align_probe.extra" in result["added_columns"]

        row = db.session.execute(
            text("SELECT id, name, extra FROM schema_align_probe WHERE id = 1")
        ).fetchone()
        assert row[0] == 1
        assert row[1] == "kept"
        assert row[2] is None

        again = align_schema(db, load_modules=False)
        assert again["added_columns"] == []
        assert again["created_tables"] == []
