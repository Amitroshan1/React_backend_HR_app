"""
Tenant scoping for IT / ITAM / Day-use tables.

- Inventory items, parcel imports/exports, removed/deleted logs and transitions carry
  their own ``tenant_id``.
- Units, licenses, quantity assignments and location deployments belong to their
  inventory item's tenant.
- Tickets, return requests, assignment history and Day-use requests belong to the
  employee's tenant.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select

from ..models.it_models import (
    ITAssetAssignment,
    ITAssetReturnRequest,
    ITAssetTransition,
    ITAssetUnit,
    ITDeletedAssetLog,
    ITInventoryItem,
    ITInventoryQuantityAssignment,
    ITOfficeStockDeployment,
    ITParcelExport,
    ITParcelExportItem,
    ITParcelImport,
    ITRepairBill,
    ITRemovedAsset,
    ITSoftwareLicense,
    ITSupportTicket,
)
from ..tenant_context import get_current_tenant_id, tenant_admin_ids, tenant_column_clause

_OWN_TENANT_COLUMN = (
    ITInventoryItem,
    ITParcelExport,
    ITParcelImport,
    ITRepairBill,
    ITRemovedAsset,
    ITDeletedAssetLog,
    ITAssetTransition,
)
_VIA_INVENTORY_ITEM = (
    ITAssetUnit,
    ITSoftwareLicense,
    ITInventoryQuantityAssignment,
    ITOfficeStockDeployment,
)


def _tid(tenant_id: Optional[int]) -> int:
    return int(tenant_id) if tenant_id is not None else get_current_tenant_id()


def tenant_inventory_ids(tenant_id: Optional[int] = None):
    """SELECT of inventory item ids in one tenant (default: the caller's JWT tenant)."""
    return select(ITInventoryItem.id).where(tenant_column_clause(ITInventoryItem.tenant_id, _tid(tenant_id)))


def it_tenant_clause(model, tenant_id: Optional[int] = None):
    """SQL condition limiting ``model`` rows to one tenant."""
    from ..models.daily_checkout import DailyCheckoutRequest

    tid = _tid(tenant_id)
    if model in _OWN_TENANT_COLUMN:
        return tenant_column_clause(model.tenant_id, tid)
    if model in _VIA_INVENTORY_ITEM:
        return model.inventory_item_id.in_(tenant_inventory_ids(tid))
    if model in (ITSupportTicket, ITAssetReturnRequest, DailyCheckoutRequest):
        return model.requester_admin_id.in_(tenant_admin_ids(tid))
    if model is ITAssetAssignment:
        return model.assigned_to_admin_id.in_(tenant_admin_ids(tid))
    if model is ITParcelExportItem:
        exports = select(ITParcelExport.id).where(tenant_column_clause(ITParcelExport.tenant_id, tid))
        return model.parcel_export_id.in_(exports)
    raise ValueError(f"No tenant rule for {model.__name__}")


def it_query(model, tenant_id: Optional[int] = None):
    """``model.query`` limited to one tenant."""
    return model.query.filter(it_tenant_clause(model, tenant_id))


def it_get(model, pk, tenant_id: Optional[int] = None):
    """Row by primary key, or None when missing or in another tenant."""
    try:
        pk = int(pk)
    except (TypeError, ValueError):
        return None
    return it_query(model, tenant_id).filter(model.id == pk).first()
