
import { useState, useMemo, useCallback, useEffect } from "react";
import { toast as rtToast } from "react-toastify";
import { useRefreshOnNavigate } from "../../../hooks/useRefreshOnNavigate";
import {
  buildDeletedLogApiPayload,
  buildLocalDeletedEntry,
  createDeletedLogAPI,
  deleteAssetUnitAPI,
  getAssetUnitsFromStorage,
  getInventoryFromStorage,
  toastITApiFailure,
  deleteHwUnit,
  logDeletedAsset,
  saveAssetUnitsToStorage,
  setUnitStatusAPI,
  syncDeletedLogsFromAPI,
  syncITDataFromAPI,
  syncInventoryCount,
  updateInventoryItemAPI
} from "../Data";
import {
  getHardwareFields,
  getInventoryStatusCategoryTabs,
  getUnitBrandModelDisplay,
  showInventoryStatusCategoryTabs,
  unitBelongsToInventoryCategory,
  resolveInventoryCategory,
} from "../inventoryCategories";
import { useTransitionRemark } from "../itam/TransitionRemarkModal";
import { remarkPayload } from "../itam/transitionUi";
import "./InventoryDashboard.css";
import "./NotWorking.css";
import {
  InventoryPanel,
  InventoryFiltersInner,
  InventoryFilterSearch,
  InventoryCategoryTabs,
} from "./InventoryPanel";

// ─── Constants ────────────────────────────────────────────────────────────────
const NOT_WORKING_STATUS = "notWorking";
const SEARCH_FIELDS      = ["brand", "assetName", "serialNumber"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const readAssetUnits = () => getAssetUnitsFromStorage() || [];
const writeAssetUnits = (units) => saveAssetUnitsToStorage(units);

const normStatus = (status) => String(status || "").trim().toLowerCase();
const isNotWorkingStatus = (status) => {
  const s = normStatus(status);
  return s === "notworking" || s === "not-working";
};
const normCategory = (category) => {
  const raw = String(category || "").trim();
  if (!raw) return "Hardware";
  return raw.toLowerCase().startsWith("consumable") ? "Consumables" : raw;
};

function dispatchInventoryUpdate() {
  try { window.dispatchEvent(new Event("inventory-updated")); } catch { /* no-op */ }
}

// ─── DeleteModal ──────────────────────────────────────────────────────────────

function DeleteModal({ asset, onConfirm, onCancel }) {
  const prefilledReason = String(asset?._remarkText || "").trim();
  const [deletedBy, setDeletedBy] = useState("");
  const [reason,    setReason]    = useState(prefilledReason);
  const [errors,    setErrors]    = useState({});

  const displayName = asset?.brand
    ? `${asset.brand} ${asset.model || ""}`.trim()
    : asset?.assetName;

  const handleSubmit = () => {
    const nextErrors = {};
    if (!deletedBy.trim()) nextErrors.deletedBy = "Required";
    if (!reason.trim())    nextErrors.reason    = "Required";
    else if (reason.trim().length < 20) nextErrors.reason = "Min 20 characters";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    onConfirm(deletedBy.trim(), reason.trim());
  };

  return (
    <div className="nw-modal-backdrop" onClick={onCancel}>
      <div className="nw-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="nw-modal-title">Remove Asset Permanently?</h3>
        <p className="nw-modal-sub">{displayName}</p>
        {prefilledReason ? (
          <p className="nw-modal-sub">Remarks already captured — confirm removed-by.</p>
        ) : null}

        <div className="nw-modal-field">
          <label>Removed By *</label>
          <input
            value={deletedBy}
            onChange={(e) => setDeletedBy(e.target.value)}
            placeholder="Your name"
            className={errors.deletedBy ? "err" : ""}
          />
          {errors.deletedBy && <span className="nw-err">{errors.deletedBy}</span>}
        </div>

        <div className="nw-modal-field">
          <label>Reason *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Reason for removal..."
            className={errors.reason ? "err" : ""}
          />
          {errors.reason && <span className="nw-err">{errors.reason}</span>}
        </div>

        <div className="nw-modal-actions">
          <button className="nw-btn-danger" onClick={handleSubmit}>Remove Permanently</button>
          <button className="nw-btn-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── NotWorkingRow ────────────────────────────────────────────────────────────

function NotWorkingRow({ unit, index, inventoryCategory, onSendToRepair, onRemove, serialColLabel }) {
  const isQtyRow = Boolean(unit?.isQuantityRow);
  const { primary, secondary } = getUnitBrandModelDisplay(unit, inventoryCategory);
  return (
    <tr className={index % 2 === 0 ? "tr-even" : "tr-odd"}>
      <td data-label="Brand / Name">
        <span className="nw-brand">{primary}</span>
        {secondary ? <span className="nw-model"> {secondary}</span> : null}
      </td>
      <td data-label="Category"><span className="inv-category-badge">{unit.category}</span></td>
      <td data-label={serialColLabel}>
        {isQtyRow
          ? <span className="nw-serial">Qty: {unit.notWorkingQuantity || 0}</span>
          : unit.serialNumber
            ? <span className="nw-serial">{unit.serialNumber}</span>
            : "—"}
      </td>
      <td className="nw-actions" data-label="Actions">
        <button className="nw-btn-repair" onClick={() => onSendToRepair(unit)}>Send to Repair</button>
        <button className="nw-btn-remove" onClick={() => onRemove(unit)}>Remove</button>
      </td>
    </tr>
  );
}

// ─── NotWorking ───────────────────────────────────────────────────────────────

export default function NotWorking({ inventoryCategory = "IT Assets" }) {
  const categoryTabs = getInventoryStatusCategoryTabs(inventoryCategory);
  const showCategoryTabs = showInventoryStatusCategoryTabs(inventoryCategory);
  const serialColLabel =
    inventoryCategory === "Infrastructure Assets"
      ? "Asset tag / Serial"
      : getHardwareFields(inventoryCategory).serialNumber.label;
  const [units,          setUnits]          = useState([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery,    setSearchQuery]    = useState("");
  const [removeTarget,   setRemoveTarget]   = useState(null);
  const [toast,          setToast]          = useState("");
  const { requestRemark } = useTransitionRemark();

  useEffect(() => {
    setActiveCategory("All");
  }, [inventoryCategory]);

  const reload = useCallback(() => {
    setUnits(getAssetUnitsFromStorage() ?? []);
  }, []);

  useRefreshOnNavigate(() => {
    const load = async () => {
      try {
        await syncITDataFromAPI();
        await syncDeletedLogsFromAPI();
      } catch (err) {
        console.error("[NotWorking] API sync failed, using cached data:", err);
        toastITApiFailure(
            err,
            "Could not sync not-working assets from the server. Showing cached units.",
          );
      }
      reload();
    };
    load();
  }, [inventoryCategory, reload]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2_500);
  }, []);

  // ── Derived rows ────────────────────────────────────────────────────────────
  const inventoryRows = useMemo(() => getInventoryFromStorage() || [], [units]);

  const notWorkingUnits = useMemo(
    () =>
      units.filter(
        (u) =>
          isNotWorkingStatus(u.status) &&
          unitBelongsToInventoryCategory(u, inventoryCategory, inventoryRows),
      ),
    [units, inventoryCategory, inventoryRows],
  );
  const qtyNotWorkingRows = useMemo(
    () =>
      inventoryRows
        .filter((i) =>
          ["accessories", "consumables", "stock"].includes(String(i.category || "").toLowerCase()),
        )
        .filter((i) => resolveInventoryCategory(i) === inventoryCategory)
        .filter((i) => Number(i.notWorkingQuantity || 0) > 0)
        .map((i) => ({
          id: `qty-${i.id}`,
          inventoryId: i.id,
          assetName: i.name,
          brand: i.name,
          category: normCategory(i.category),
          serialNumber: "",
          notWorkingQuantity: Number(i.notWorkingQuantity || 0),
          availableQuantity: Number(i.availableQuantity || 0),
          totalQuantity: Number(i.totalQuantity || 0),
          assignedQuantity: Number(i.assignedQuantity || 0),
          repairQuantity: Number(i.repairQuantity || 0),
          isQuantityRow: true,
        })),
    [inventoryRows, inventoryCategory],
  );

  const filteredRows = useMemo(() => {
    let rows = [...notWorkingUnits, ...qtyNotWorkingRows];
    if (activeCategory !== "All") {
      rows = rows.filter((u) => normCategory(u.category) === activeCategory);
    }
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      rows = rows.filter((u) =>
        SEARCH_FIELDS.some((field) =>
          String(u[field] ?? "").toLowerCase().includes(query),
        ),
      );
    }
    return rows;
  }, [notWorkingUnits, qtyNotWorkingRows, activeCategory, searchQuery]);

  const getCategoryCount = useCallback(
    (cat) =>
      [...notWorkingUnits, ...qtyNotWorkingRows]
        .filter((u) => normCategory(u.category) === cat).length,
    [notWorkingUnits, qtyNotWorkingRows],
  );

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleSendToRepair = useCallback(async (unit) => {
    const remarkResult = await requestRemark("SEND_REPAIR", {
      force: true,
      assetLabel: unit?.assetName || unit?.serialNumber || unit?.brand || "Asset",
      subtitle: "Move from Not Working → Repair",
    });
    if (remarkResult === null) return;
    const fields = remarkPayload(remarkResult);
    const remarkText = String(fields.remark || "").trim();

    if (unit?.isQuantityRow) {
      const maxQty = Number(unit.notWorkingQuantity || 0);
      const input = window.prompt(`Enter quantity to move to Repair (1-${maxQty})`, "1");
      if (input == null) return;
      const qty = Number.parseInt(input, 10);
      if (!Number.isFinite(qty) || qty < 1 || qty > maxQty) {
        rtToast.error(`Please enter a valid quantity between 1 and ${maxQty}.`);
        return;
      }
      try {
        await updateInventoryItemAPI(unit.inventoryId, {
          not_working_quantity: Math.max(0, Number(unit.notWorkingQuantity || 0) - qty),
          repair_quantity: Number(unit.repairQuantity || 0) + qty,
          available_quantity: Number(unit.availableQuantity || 0),
          assigned_quantity: Number(unit.assignedQuantity || 0),
          total_quantity: Number(unit.totalQuantity || 0),
          ...(remarkText
            ? {
                notes: [
                  String(unit.notes || "").trim(),
                  `[Repair x${qty}] ${remarkText}`,
                ]
                  .filter(Boolean)
                  .join("\n")
                  .slice(0, 500),
              }
            : {}),
        });
        await syncITDataFromAPI();
      } catch (err) {
        console.error("[NotWorking] qty move to repair failed:", err);
        toastITApiFailure(err, "Could not update quantity on the server.");
        return;
      }
      dispatchInventoryUpdate();
      reload();
      showToast(`${qty} item(s) sent to repair ✓`);
      return;
    }

    try {
      await setUnitStatusAPI({ unitId: unit.id, status: "repair", ...fields });
      await syncITDataFromAPI();
    } catch (err) {
      console.error("[NotWorking] set repair via API failed:", err);
      toastITApiFailure(err, "Could not move this unit to repair on the server.");
      return;
    }
    const updated = readAssetUnits().map((u) =>
      u.id === unit.id
        ? {
            ...u,
            status: "repair",
            repairDate: u.repairDate ?? new Date().toISOString(),
            lastRemark: fields.remark || u.lastRemark,
          }
        : u,
    );
    writeAssetUnits(updated);
    syncInventoryCount(unit, "fromNotWorkingToRepair");
    dispatchInventoryUpdate();
    reload();
    const { primary } = getUnitBrandModelDisplay(unit, inventoryCategory);
    showToast(`${primary} sent to repair ✓`);
  }, [reload, showToast, inventoryCategory, requestRemark]);

  const handleRemovePrompt = useCallback(async (unit) => {
    const remarkResult = await requestRemark("RETIRE", {
      force: true,
      assetLabel: unit?.assetName || unit?.serialNumber || unit?.brand || "Asset",
      subtitle: "Remove / retire from inventory",
      defaultReasonCode: "PERMANENT_DELETE",
      defaultConditionGrade: "Fail",
    });
    if (remarkResult === null) return;
    setRemoveTarget({
      ...unit,
      _remarkFields: remarkPayload(remarkResult),
      _remarkText: String(remarkResult.remark || "").trim(),
    });
  }, [requestRemark]);

  const handleRemoveConfirm = useCallback(async (deletedBy, reason) => {
    const retireFields = {
      ...(removeTarget?._remarkFields || {}),
      remark: reason || removeTarget?._remarkText || "",
      notes: reason || removeTarget?._remarkText || "",
    };
    if (removeTarget?.isQuantityRow) {
      const maxQty = Number(removeTarget.notWorkingQuantity || 0);
      const input = window.prompt(`Enter quantity to remove as dead device (1-${maxQty})`, "1");
      if (input == null) return;
      const qty = Number.parseInt(input, 10);
      if (!Number.isFinite(qty) || qty < 1 || qty > maxQty) {
        rtToast.error(`Please enter a valid quantity between 1 and ${maxQty}.`);
        return;
      }
      try {
        await updateInventoryItemAPI(removeTarget.inventoryId, {
          not_working_quantity: Math.max(0, Number(removeTarget.notWorkingQuantity || 0) - qty),
          total_quantity: Math.max(0, Number(removeTarget.totalQuantity || 0) - qty),
          available_quantity: Number(removeTarget.availableQuantity || 0),
          assigned_quantity: Number(removeTarget.assignedQuantity || 0),
          repair_quantity: Number(removeTarget.repairQuantity || 0),
        });
        await createDeletedLogAPI({
          delete_code: `del-qty-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          inventory_item_id: Number(removeTarget.inventoryId) || null,
          deleted_by_name: deletedBy,
          asset_name: removeTarget.assetName || removeTarget.brand || "",
          category: removeTarget.category || "Accessories",
          serial_number: "",
          reason: `Dead quantity marked: ${qty}. ${reason || ""}`.trim(),
        });
        await syncDeletedLogsFromAPI();
        await syncITDataFromAPI();
      } catch (err) {
        console.error("[NotWorking] qty remove failed:", err);
        toastITApiFailure(err, "Could not remove quantity on the server.");
        return;
      }
      dispatchInventoryUpdate();
      reload();
      setRemoveTarget(null);
      showToast(`${qty} item(s) removed ✓`);
      return;
    }

    const deletedId = `del-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const entry = buildLocalDeletedEntry(removeTarget, deletedBy, reason, deletedId);

    try {
      await createDeletedLogAPI(
        buildDeletedLogApiPayload(removeTarget, deletedBy, reason, deletedId),
      );
      await deleteAssetUnitAPI(removeTarget.id, retireFields);
      await syncITDataFromAPI();
      await syncDeletedLogsFromAPI();
    } catch (err) {
      console.error("[NotWorking] dead device failed:", err);
      toastITApiFailure(
          err,
          "Could not complete dead device removal on the server.",
        );
      try {
        logDeletedAsset(removeTarget, deletedBy, reason);
      } catch {
        /* no-op */
      }
      writeAssetUnits(readAssetUnits().filter((u) => u.id !== removeTarget.id));
      try {
        deleteHwUnit(removeTarget.id);
      } catch {
        /* no-op */
      }
      syncInventoryCount(removeTarget, "fromNotWorkingDelete");
      dispatchInventoryUpdate();
      reload();
      setRemoveTarget(null);
      return;
    }

    writeAssetUnits(readAssetUnits().filter((u) => u.id !== removeTarget.id));
    try {
      deleteHwUnit(removeTarget.id);
    } catch {
      /* no-op */
    }

    syncInventoryCount(removeTarget, "fromNotWorkingDelete");
    dispatchInventoryUpdate();
    reload();
    setRemoveTarget(null);
    rtToast.success(`${entry.assetName || entry.brand} moved to Dead Assets.`);
    showToast("Asset moved to Dead Assets ✓");
  }, [removeTarget, reload, showToast]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {toast && <div className="inv-toast">{toast}</div>}

      <InventoryPanel
        eyebrow={inventoryCategory}
        title="Not Working"
        subtitle="Assets currently marked as not working"
        recordCount={filteredRows.length}
        variant="alert"
        filterBadge={
          activeCategory !== "All" ? (
            <span className="inv-table-filter-badge">{activeCategory}</span>
          ) : null
        }
        filters={
          <InventoryFiltersInner>
            <InventoryFilterSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search by brand, name or serial…"
            />
            {showCategoryTabs && (
              <InventoryCategoryTabs
                tabs={categoryTabs}
                active={activeCategory}
                onChange={setActiveCategory}
                getCount={getCategoryCount}
              />
            )}
          </InventoryFiltersInner>
        }
      >
        <div className="inv-table-scroll inv-table-scroll--responsive">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Brand / Name</th>
                <th>Category</th>
                <th>{serialColLabel}</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={4} className="inv-empty-row">No not-working assets found</td></tr>
              ) : (
                filteredRows.map((unit, i) => (
                  <NotWorkingRow
                    key={unit.id}
                    unit={unit}
                    index={i}
                    inventoryCategory={inventoryCategory}
                    serialColLabel={serialColLabel}
                    onSendToRepair={handleSendToRepair}
                    onRemove={handleRemovePrompt}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </InventoryPanel>

      {removeTarget && (
        <DeleteModal
          asset={removeTarget}
          onConfirm={handleRemoveConfirm}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </>
  );
}

