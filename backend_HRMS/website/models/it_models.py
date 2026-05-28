from datetime import datetime

from .. import db


class ITInventoryItem(db.Model):
    __tablename__ = "it_inventory_items"

    id = db.Column(db.Integer, primary_key=True)
    inventory_code = db.Column(db.String(30), unique=True, nullable=False, index=True)

    name = db.Column(db.String(150), nullable=False, index=True)
    category = db.Column(db.String(40), nullable=False, index=True)  # Hardware/Software/Accessories/Consumables
    inventory_category = db.Column(db.String(60), nullable=False, default="IT Assets", server_default="IT Assets")
    hw_type = db.Column(db.String(40), nullable=True, index=True)

    total_quantity = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    available_quantity = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    assigned_quantity = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    not_working_quantity = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    repair_quantity = db.Column(db.Integer, nullable=False, default=0, server_default="0")

    created_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    created_by_admin = db.relationship("Admin", backref=db.backref("it_inventory_items_created", lazy="dynamic"))
    asset_units = db.relationship("ITAssetUnit", back_populates="inventory_item", cascade="all, delete-orphan")
    software_licenses = db.relationship("ITSoftwareLicense", back_populates="inventory_item", cascade="all, delete-orphan")


class ITAssetUnit(db.Model):
    __tablename__ = "it_asset_units"

    id = db.Column(db.Integer, primary_key=True)
    unit_code = db.Column(db.String(60), unique=True, nullable=False, index=True)  # maps old assetId / serial identity

    inventory_item_id = db.Column(db.Integer, db.ForeignKey("it_inventory_items.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_name = db.Column(db.String(150), nullable=False)
    category = db.Column(db.String(40), nullable=False, default="Hardware", server_default="Hardware")
    hw_type = db.Column(db.String(40), nullable=True)

    brand = db.Column(db.String(100), nullable=True)
    make = db.Column(db.String(100), nullable=True)
    model = db.Column(db.String(100), nullable=True)
    serial_number = db.Column(db.String(120), nullable=True, index=True)
    imei1 = db.Column(db.String(25), nullable=True)
    imei2 = db.Column(db.String(25), nullable=True)

    status = db.Column(db.String(30), nullable=False, default="available", server_default="available", index=True)
    assigned_to_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)
    assigned_at = db.Column(db.DateTime, nullable=True)
    asset_tag = db.Column(db.String(80), nullable=True, unique=True)

    exported_to = db.Column(db.String(150), nullable=True)
    exported_at = db.Column(db.DateTime, nullable=True)
    repair_date = db.Column(db.DateTime, nullable=True)

    photos_json = db.Column(db.JSON, nullable=True)
    assignment_photos_json = db.Column(db.JSON, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    inventory_item = db.relationship("ITInventoryItem", back_populates="asset_units")
    assigned_to_admin = db.relationship("Admin", backref=db.backref("it_asset_units_assigned", lazy="dynamic"))
    assignments = db.relationship("ITAssetAssignment", back_populates="asset_unit", cascade="all, delete-orphan")
    parcel_export_items = db.relationship("ITParcelExportItem", back_populates="asset_unit")


class ITSoftwareLicense(db.Model):
    __tablename__ = "it_software_licenses"

    id = db.Column(db.Integer, primary_key=True)
    license_code = db.Column(db.String(80), unique=True, nullable=False, index=True)

    inventory_item_id = db.Column(db.Integer, db.ForeignKey("it_inventory_items.id", ondelete="CASCADE"), nullable=False, index=True)
    name = db.Column(db.String(150), nullable=False, index=True)

    subscription_start = db.Column(db.Date, nullable=True)
    subscription_end = db.Column(db.Date, nullable=True)

    status = db.Column(db.String(30), nullable=False, default="available", server_default="available", index=True)
    assigned_to_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)
    assigned_at = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    inventory_item = db.relationship("ITInventoryItem", back_populates="software_licenses")
    assigned_to_admin = db.relationship("Admin", backref=db.backref("it_software_licenses_assigned", lazy="dynamic"))
    assignments = db.relationship("ITAssetAssignment", back_populates="software_license", cascade="all, delete-orphan")


class ITInventoryQuantityAssignment(db.Model):
    __tablename__ = "it_inventory_quantity_assignments"

    id = db.Column(db.Integer, primary_key=True)
    inventory_item_id = db.Column(
        db.Integer,
        db.ForeignKey("it_inventory_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assigned_to_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False, index=True)
    quantity = db.Column(db.Integer, nullable=False, default=0, server_default="0")
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    inventory_item = db.relationship("ITInventoryItem", backref=db.backref("quantity_assignments", lazy="dynamic"))
    assigned_to_admin = db.relationship(
        "Admin",
        foreign_keys=[assigned_to_admin_id],
        backref=db.backref("it_inventory_quantity_assignments", lazy="dynamic"),
    )


class ITAssetAssignment(db.Model):
    __tablename__ = "it_asset_assignments"

    id = db.Column(db.Integer, primary_key=True)

    assignment_type = db.Column(db.String(20), nullable=False, default="assign", server_default="assign")  # assign/unassign/return
    assigned_to_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False, index=True)
    assigned_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)

    asset_unit_id = db.Column(db.Integer, db.ForeignKey("it_asset_units.id"), nullable=True, index=True)
    software_license_id = db.Column(db.Integer, db.ForeignKey("it_software_licenses.id"), nullable=True, index=True)

    notes = db.Column(db.Text, nullable=True)
    assigned_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    unassigned_at = db.Column(db.DateTime, nullable=True)

    assigned_to_admin = db.relationship("Admin", foreign_keys=[assigned_to_admin_id], backref=db.backref("it_assignments_received", lazy="dynamic"))
    assigned_by_admin = db.relationship("Admin", foreign_keys=[assigned_by_admin_id], backref=db.backref("it_assignments_created", lazy="dynamic"))
    asset_unit = db.relationship("ITAssetUnit", back_populates="assignments")
    software_license = db.relationship("ITSoftwareLicense", back_populates="assignments")


class ITSupportTicket(db.Model):
    __tablename__ = "it_support_tickets"

    id = db.Column(db.Integer, primary_key=True)
    ticket_code = db.Column(db.String(40), unique=True, nullable=False, index=True)

    requester_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False, index=True)
    assignee_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)

    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=False)
    priority = db.Column(db.String(20), nullable=True, default="medium", server_default="medium")
    status = db.Column(db.String(20), nullable=False, default="pending", server_default="pending", index=True)
    resolved_at = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    requester_admin = db.relationship("Admin", foreign_keys=[requester_admin_id], backref=db.backref("it_tickets_requested", lazy="dynamic"))
    assignee_admin = db.relationship("Admin", foreign_keys=[assignee_admin_id], backref=db.backref("it_tickets_assigned", lazy="dynamic"))


class ITRemovedAsset(db.Model):
    __tablename__ = "it_removed_assets"

    id = db.Column(db.Integer, primary_key=True)
    removed_code = db.Column(db.String(60), unique=True, nullable=False, index=True)

    asset_unit_id = db.Column(db.Integer, db.ForeignKey("it_asset_units.id"), nullable=True, index=True)
    inventory_item_id = db.Column(db.Integer, db.ForeignKey("it_inventory_items.id"), nullable=True, index=True)

    owner_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)
    removed_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)

    name = db.Column(db.String(150), nullable=False)
    category = db.Column(db.String(40), nullable=True)
    reason = db.Column(db.Text, nullable=True)
    photos_json = db.Column(db.JSON, nullable=True)

    removed_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    asset_unit = db.relationship("ITAssetUnit", backref=db.backref("removed_records", lazy="dynamic"))
    inventory_item = db.relationship("ITInventoryItem", backref=db.backref("removed_records", lazy="dynamic"))
    owner_admin = db.relationship("Admin", foreign_keys=[owner_admin_id], backref=db.backref("it_assets_removed_from_owner", lazy="dynamic"))
    removed_by_admin = db.relationship("Admin", foreign_keys=[removed_by_admin_id], backref=db.backref("it_assets_removed_by_admin", lazy="dynamic"))


class ITDeletedAssetLog(db.Model):
    __tablename__ = "it_deleted_asset_logs"

    id = db.Column(db.Integer, primary_key=True)
    delete_code = db.Column(db.String(60), unique=True, nullable=False, index=True)

    asset_unit_id = db.Column(db.Integer, db.ForeignKey("it_asset_units.id"), nullable=True, index=True)
    inventory_item_id = db.Column(db.Integer, db.ForeignKey("it_inventory_items.id"), nullable=True, index=True)
    deleted_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)

    asset_name = db.Column(db.String(150), nullable=True)
    category = db.Column(db.String(40), nullable=True)
    serial_number = db.Column(db.String(120), nullable=True)
    reason = db.Column(db.Text, nullable=True)

    deleted_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    asset_unit = db.relationship("ITAssetUnit", backref=db.backref("delete_logs", lazy="dynamic"))
    inventory_item = db.relationship("ITInventoryItem", backref=db.backref("delete_logs", lazy="dynamic"))
    deleted_by_admin = db.relationship("Admin", backref=db.backref("it_deleted_asset_logs", lazy="dynamic"))


class ITParcelExport(db.Model):
    __tablename__ = "it_parcel_exports"

    id = db.Column(db.Integer, primary_key=True)
    export_code = db.Column(db.String(60), unique=True, nullable=False, index=True)

    destination = db.Column(db.String(180), nullable=False)
    id_no = db.Column(db.String(80), nullable=True, index=True)
    exported_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)
    # Free-text who processed the export (no admin link required for parcel tracking)
    exported_by_name = db.Column(db.String(120), nullable=True)

    exported_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    parcel_photos_json = db.Column(db.JSON, nullable=True)

    exported_by_admin = db.relationship("Admin", backref=db.backref("it_parcel_exports_created", lazy="dynamic"))
    items = db.relationship("ITParcelExportItem", back_populates="parcel_export", cascade="all, delete-orphan")


class ITParcelExportItem(db.Model):
    __tablename__ = "it_parcel_export_items"

    id = db.Column(db.Integer, primary_key=True)
    parcel_export_id = db.Column(db.Integer, db.ForeignKey("it_parcel_exports.id", ondelete="CASCADE"), nullable=False, index=True)

    asset_unit_id = db.Column(db.Integer, db.ForeignKey("it_asset_units.id"), nullable=True, index=True)
    asset_name = db.Column(db.String(150), nullable=False)
    serial_number = db.Column(db.String(120), nullable=True, index=True)
    brand = db.Column(db.String(100), nullable=True)
    model = db.Column(db.String(100), nullable=True)
    individual_photo_json = db.Column(db.JSON, nullable=True)

    parcel_export = db.relationship("ITParcelExport", back_populates="items")
    asset_unit = db.relationship("ITAssetUnit", back_populates="parcel_export_items")


class ITParcelImport(db.Model):
    __tablename__ = "it_parcel_imports"

    id = db.Column(db.Integer, primary_key=True)
    import_code = db.Column(db.String(60), unique=True, nullable=False, index=True)

    source = db.Column(db.String(180), nullable=False)
    asset_name = db.Column(db.String(150), nullable=False)
    count = db.Column(db.Integer, nullable=False, default=1, server_default="1")
    id_no = db.Column(db.String(80), nullable=True, index=True)

    received_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)
    # Free-text who received the shipment (no admin link required for parcel tracking)
    received_by_name = db.Column(db.String(120), nullable=True)
    received_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    photos_json = db.Column(db.JSON, nullable=True)

    received_by_admin = db.relationship("Admin", backref=db.backref("it_parcel_imports_received", lazy="dynamic"))


class ITAssetReturnRequest(db.Model):
    __tablename__ = "it_asset_return_requests"

    id = db.Column(db.Integer, primary_key=True)
    request_code = db.Column(db.String(60), unique=True, nullable=False, index=True)

    requester_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=False, index=True)
    requester_emp_id = db.Column(db.String(30), nullable=True, index=True)

    asset_unit_id = db.Column(db.Integer, db.ForeignKey("it_asset_units.id"), nullable=True, index=True)
    software_license_id = db.Column(db.Integer, db.ForeignKey("it_software_licenses.id"), nullable=True, index=True)
    inventory_item_id = db.Column(db.Integer, db.ForeignKey("it_inventory_items.id"), nullable=True, index=True)
    quantity = db.Column(db.Integer, nullable=False, default=1, server_default="1")

    asset_name = db.Column(db.String(150), nullable=True)
    category = db.Column(db.String(40), nullable=True)
    reason = db.Column(db.Text, nullable=False)

    status = db.Column(db.String(20), nullable=False, default="pending", server_default="pending", index=True)
    approved_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)
    approved_at = db.Column(db.DateTime, nullable=True)
    receipt_confirmed_by_admin_id = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True, index=True)
    receipt_confirmed_at = db.Column(db.DateTime, nullable=True)
    rejection_reason = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    requester_admin = db.relationship("Admin", foreign_keys=[requester_admin_id], backref=db.backref("it_return_requests_created", lazy="dynamic"))
    approved_by_admin = db.relationship("Admin", foreign_keys=[approved_by_admin_id], backref=db.backref("it_return_requests_approved", lazy="dynamic"))
    receipt_confirmed_by_admin = db.relationship("Admin", foreign_keys=[receipt_confirmed_by_admin_id], backref=db.backref("it_return_requests_completed", lazy="dynamic"))

    asset_unit = db.relationship("ITAssetUnit", backref=db.backref("return_requests", lazy="dynamic"))
    software_license = db.relationship("ITSoftwareLicense", backref=db.backref("return_requests", lazy="dynamic"))
    inventory_item = db.relationship("ITInventoryItem", backref=db.backref("return_requests", lazy="dynamic"))

