"""Per-employee annual tax investment declaration (header + line items + documents)."""
from .. import db
from ..datetime_utils import isoformat_api, utc_now


class EmployeeTaxDeclaration(db.Model):
    __tablename__ = "employee_tax_declarations"
    __table_args__ = (
        db.UniqueConstraint(
            "admin_id",
            "financial_year",
            name="uq_employee_tax_decl_admin_fy",
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    financial_year = db.Column(db.String(9), nullable=False, index=True)
    tax_regime = db.Column(db.String(80), nullable=True)

    # Legacy rollup fields (synced from items for TDS projection)
    rent_paid_annual = db.Column(db.Float, nullable=True, default=0)
    is_metro = db.Column(db.Boolean, nullable=False, default=False)
    section_80c_extra = db.Column(db.Float, nullable=True, default=0)
    section_80d = db.Column(db.Float, nullable=True, default=0)
    previous_employer_tds = db.Column(db.Float, nullable=True, default=0)
    previous_employer_taxable = db.Column(db.Float, nullable=True, default=0)

    regime_declaration_accepted = db.Column(db.Boolean, nullable=False, default=False)
    new_regime_acknowledged = db.Column(db.Boolean, nullable=False, default=False)
    final_declaration_accepted = db.Column(db.Boolean, nullable=False, default=False)
    declaration_place = db.Column(db.String(120), nullable=True)
    declaration_signed_at = db.Column(db.Date, nullable=True)

    status = db.Column(db.String(30), nullable=False, default="draft", index=True)
    submitted_at = db.Column(db.DateTime, nullable=True)
    reviewed_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)
    rejection_reason = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    admin = db.relationship("Admin", foreign_keys=[admin_id], backref=db.backref("tax_declarations", lazy="dynamic"))
    reviewed_by = db.relationship("Admin", foreign_keys=[reviewed_by_admin_id])
    items = db.relationship(
        "TaxDeclarationItem",
        back_populates="declaration",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )
    documents = db.relationship(
        "TaxDeclarationDocument",
        back_populates="declaration",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )
    approval_history = db.relationship(
        "TaxDeclarationApprovalHistory",
        back_populates="declaration",
        cascade="all, delete-orphan",
        lazy="dynamic",
        order_by="TaxDeclarationApprovalHistory.created_at",
    )

    def is_locked(self):
        return self.status in ("submitted", "approved")

    def to_dict(self, include_items=False, include_documents=False):
        payload = {
            "id": self.id,
            "admin_id": self.admin_id,
            "financial_year": self.financial_year,
            "tax_regime": self.tax_regime,
            "rent_paid_annual": float(self.rent_paid_annual or 0),
            "is_metro": bool(self.is_metro),
            "section_80c_extra": float(self.section_80c_extra or 0),
            "section_80d": float(self.section_80d or 0),
            "previous_employer_tds": float(self.previous_employer_tds or 0),
            "previous_employer_taxable": float(self.previous_employer_taxable or 0),
            "regime_declaration_accepted": bool(self.regime_declaration_accepted),
            "new_regime_acknowledged": bool(self.new_regime_acknowledged),
            "final_declaration_accepted": bool(self.final_declaration_accepted),
            "declaration_place": self.declaration_place,
            "declaration_signed_at": self.declaration_signed_at.isoformat() if self.declaration_signed_at else None,
            "status": self.status,
            "submitted_at": isoformat_api(self.submitted_at),
            "reviewed_by_admin_id": self.reviewed_by_admin_id,
            "reviewed_at": isoformat_api(self.reviewed_at),
            "rejection_reason": self.rejection_reason,
            "created_at": isoformat_api(self.created_at),
            "updated_at": isoformat_api(self.updated_at),
        }
        if include_items:
            payload["items"] = [i.to_dict() for i in self.items.order_by(TaxDeclarationItem.id)]
        if include_documents:
            payload["documents"] = [d.to_dict() for d in self.documents.order_by(TaxDeclarationDocument.id)]
        return payload


class TaxDeclarationItem(db.Model):
    __tablename__ = "tax_declaration_items"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    declaration_id = db.Column(
        db.Integer,
        db.ForeignKey("employee_tax_declarations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    section_code = db.Column(db.String(40), nullable=False, index=True)
    item_code = db.Column(db.String(60), nullable=False)
    amount = db.Column(db.Float, nullable=True)
    text_value = db.Column(db.String(500), nullable=True)
    meta_json = db.Column(db.JSON, nullable=True)

    declaration = db.relationship("EmployeeTaxDeclaration", back_populates="items")

    def to_dict(self):
        return {
            "id": self.id,
            "section_code": self.section_code,
            "item_code": self.item_code,
            "amount": float(self.amount) if self.amount is not None else None,
            "text_value": self.text_value,
            "meta_json": self.meta_json,
        }


class TaxDeclarationDocument(db.Model):
    __tablename__ = "tax_declaration_documents"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    declaration_id = db.Column(
        db.Integer,
        db.ForeignKey("employee_tax_declarations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    doc_type = db.Column(db.String(60), nullable=False)
    section_code = db.Column(db.String(40), nullable=True, index=True)
    item_code = db.Column(db.String(60), nullable=True, index=True)
    file_path = db.Column(db.String(300), nullable=False)
    original_name = db.Column(db.String(255), nullable=True)
    mime_type = db.Column(db.String(120), nullable=True)
    size_bytes = db.Column(db.Integer, nullable=True)
    uploaded_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    declaration = db.relationship("EmployeeTaxDeclaration", back_populates="documents")

    def to_dict(self):
        return {
            "id": self.id,
            "doc_type": self.doc_type,
            "section_code": self.section_code,
            "item_code": self.item_code,
            "file_path": self.file_path,
            "original_name": self.original_name,
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "uploaded_at": isoformat_api(self.uploaded_at),
            "url": f"/static/uploads/{self.file_path}" if self.file_path else None,
        }


class TaxDeclarationApprovalHistory(db.Model):
    __tablename__ = "tax_approval_history"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    declaration_id = db.Column(
        db.Integer,
        db.ForeignKey("employee_tax_declarations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action = db.Column(db.String(40), nullable=False)
    from_status = db.Column(db.String(30), nullable=True)
    to_status = db.Column(db.String(30), nullable=False)
    actor_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    comment = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utc_now)

    declaration = db.relationship("EmployeeTaxDeclaration", back_populates="approval_history")
    actor = db.relationship("Admin", foreign_keys=[actor_admin_id])

    def to_dict(self):
        return {
            "id": self.id,
            "action": self.action,
            "from_status": self.from_status,
            "to_status": self.to_status,
            "actor_admin_id": self.actor_admin_id,
            "comment": self.comment,
            "created_at": isoformat_api(self.created_at),
        }
