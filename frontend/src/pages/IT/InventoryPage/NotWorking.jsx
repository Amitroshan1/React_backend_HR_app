
import { useState, useMemo, useCallback, useEffect } from "react";
import { toast as rtToast } from "react-toastify";
import {
  createDeletedLogAPI,
  createRemovedAssetAPI,
  getAssetUnitsFromStorage,
  getInventoryFromStorage,
  getITApiErrorMessage,
  deleteHwUnit,
  saveAssetUnitsToStorage,
  setUnitStatusAPI,
  syncDeletedLogsFromAPI,
  syncITDataFromAPI,
  syncInventoryCount,
  syncRemovedITFromAPI,
  updateInventoryItemAPI,
} from "../Data";
import "./InventoryDashboard.css";
import "./NotWorking.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATS               = ["All", "Hardware", "Accessories", "Consumables"];
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
  const [deletedBy, setDeletedBy] = useState("");
  const [reason,    setReason]    = useState("");
  const [errors,    setErrors]    = useState({});

  const displayName = asset?.brand
    ? `${asset.brand} ${asset.model || ""}`.trim()
    : asset?.assetName;

  const handleSubmit = () => {
    const nextErrors = {};
    if (!deletedBy.trim()) nextErrors.deletedBy = "Required";
    if (!reason.trim())    nextErrors.reason    = "Required";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    onConfirm(deletedBy.trim(), reason.trim());
  };

  return (
    <div className="nw-modal-backdrop" onClick={onCancel}>
      <div className="nw-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="nw-modal-title">Remove Asset Permanently?</h3>
        <p className="nw-modal-sub">{displayName}</p>

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

function NotWorkingRow({ unit, index, onSendToRepair, onRemove }) {
  const isQtyRow = Boolean(unit?.isQuantityRow);
  return (
    <tr className={index % 2 === 0 ? "tr-even" : "tr-odd"}>
      <td>
        <span className="nw-brand">{unit.brand || unit.assetName || unit.name}</span>
        {unit.model && <span className="nw-model"> {unit.model}</span>}
      </td>
      <td><span className="inv-category-badge">{unit.category}</span></td>
      <td>
        {isQtyRow
          ? <span className="nw-serial">Qty: {unit.notWorkingQuantity || 0}</span>
          : unit.serialNumber
            ? <span className="nw-serial">{unit.serialNumber}</span>
            : "—"}
      </td>
      <td className="nw-actions">
        <button className="nw-btn-repair" onClick={() => onSendToRepair(unit)}>Send to Repair</button>
        <button className="nw-btn-remove" onClick={() => onRemove(unit)}>Remove</button>
      </td>
    </tr>
  );
}

// ─── NotWorking ───────────────────────────────────────────────────────────────

export default function NotWorking() {
  const [units,          setUnits]          = useState([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery,    setSearchQuery]    = useState("");
  const [removeTarget,   setRemoveTarget]   = useState(null);
  const [toast,          setToast]          = useState("");

  const reload = useCallback(() => {
    setUnits(getAssetUnitsFromStorage() ?? []);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        await syncITDataFromAPI();
        await syncDeletedLogsFromAPI();
      } catch (err) {
        console.error("[NotWorking] API sync failed, using cached data:", err);
        rtToast.error(
          getITApiErrorMessage(
            err,
            "Could not sync not-working assets from the server. Showing cached units.",
          ),
        );
      }
      reload();
    };
    load();
  }, [reload]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2_500);
  }, []);

  // ── Derived rows ────────────────────────────────────────────────────────────
  const notWorkingUnits = useMemo(
    () => units.filter((u) => isNotWorkingStatus(u.status)),
    [units],
  );
  const qtyNotWorkingRows = useMemo(
    () =>
      (getInventoryFromStorage() || [])
        .filter((i) => ["accessories", "consumables"].includes(String(i.category || "").toLowerCase()))
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
    [units],
  );

  const filteredRows = useMemo(() => {
    let rows = [...notWorkingUnits, ...qtyNotWorkingRows];
    if (activeCategory !== "All") {
      rows = rows.filter((u) => normCategory(u.category) === activeCategory);
    }
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      rows = rows.filter((u) =>
        SEARCH_FIELDS.some((field) => (u[field] ?? "").toLowerCase().includes(query)),
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
        });
        await syncITDataFromAPI();
      } catch (err) {
        console.error("[NotWorking] qty move to repair failed:", err);
        rtToast.error(getITApiErrorMessage(err, "Could not update quantity on the server."));
        return;
      }
      dispatchInventoryUpdate();
      reload();
      showToast(`${qty} item(s) sent to repair ✓`);
      return;
    }

    try {
      await setUnitStatusAPI({ unitId: unit.id, status: "repair" });
      await syncITDataFromAPI();
    } catch (err) {
      console.error("[NotWorking] set repair via API failed:", err);
      rtToast.error(
        getITApiErrorMessage(err, "Could not move this unit to repair on the server."),
      );
    }
    const updated = readAssetUnits().map((u) =>
      u.id === unit.id
        ? { ...u, status: "repair", repairDate: u.repairDate ?? new Date().toISOString() }
        : u,
    );
    writeAssetUnits(updated);
    syncInventoryCount(unit, "fromNotWorkingToRepair");
    dispatchInventoryUpdate();
    reload();
    showToast(`${unit.brand || unit.assetName} sent to repair ✓`);
  }, [reload, showToast]);

  const handleRemoveConfirm = useCallback(async (deletedBy, reason) => {
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
        await createRemovedAssetAPI({
          inventory_item_id: Number(removeTarget.inventoryId) || null,
          name: removeTarget.assetName || removeTarget.brand || "",
          category: removeTarget.category || "Accessories",
          reason: `Dead quantity marked: ${qty}. ${reason || ""}`.trim(),
        });
        await syncRemovedITFromAPI();
        await syncITDataFromAPI();
      } catch (err) {
        console.error("[NotWorking] qty remove failed:", err);
        rtToast.error(getITApiErrorMessage(err, "Could not remove quantity on the server."));
        return;
      }
      dispatchInventoryUpdate();
      reload();
      setRemoveTarget(null);
      showToast(`${qty} item(s) removed ✓`);
      return;
    }

    const entry = {
      deletedId:    `del-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      assetName:    removeTarget.assetName || removeTarget.brand || "",
      brand:        removeTarget.brand     || removeTarget.assetName || "",
      model:        removeTarget.model     || "",
      category:     removeTarget.category  || "Hardware",
      serialNumber: removeTarget.serialNumber || "",
      deletedBy,
      deleteReason: reason,
      deletedAt:    new Date().toISOString(),
    };

    try {
      await createDeletedLogAPI({
        delete_code: entry.deletedId,
        asset_unit_id: removeTarget.id || null,
        deleted_by_name: deletedBy,
        asset_name: entry.assetName,
        category: entry.category,
        serial_number: entry.serialNumber,
        reason: entry.deleteReason,
      });
      await createRemovedAssetAPI({
        asset_unit_id: removeTarget.id || null,
        name: entry.assetName,
        category: entry.category,
        reason: entry.deleteReason,
      });
      await syncDeletedLogsFromAPI();
    } catch (err) {
      console.error("[NotWorking] delete log API failed:", err);
      rtToast.error(
        getITApiErrorMessage(
          err,
          "Could not complete permanent removal on the server. Local changes were applied.",
        ),
      );
    }

    writeAssetUnits(readAssetUnits().filter((u) => u.id !== removeTarget.id));
    try { deleteHwUnit(removeTarget.id); } catch { /* no-op */ }

    syncInventoryCount(removeTarget, "fromNotWorkingDelete");
    dispatchInventoryUpdate();
    reload();
    setRemoveTarget(null);
    showToast("Asset permanently removed ✓");
  }, [removeTarget, reload, showToast]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="nw-page">
      {toast && <div className="nw-toast">{toast}</div>}

      <div className="nw-card">
        <div className="nw-header">
          <div>
            <h1 className="nw-title">Not Working</h1>
            <p className="nw-subtitle">Assets currently marked as not working</p>
          </div>
          <span className="nw-count-badge">
            {filteredRows.length} asset{filteredRows.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Category Tabs */}
        <div className="nw-tabs">
          {CATS.map((cat) => (
            <button
              key={cat}
              className={`nw-tab ${activeCategory === cat ? "active" : ""}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
              {cat !== "All" && (
                <span className="nw-tab-count">{getCategoryCount(cat)}</span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="nw-search-row">
          <div className="nw-search-wrap">
            <span className="nw-search-icon">⌕</span>
            <input
              className="nw-search-input"
              placeholder="Search by brand, name or serial..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="nw-search-clear" onClick={() => setSearchQuery("")}>×</button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="nw-table-wrap">
          <table className="nw-table">
            <thead>
              <tr>
                <th>Brand / Name</th>
                <th>Category</th>
                <th>Serial No</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={4} className="nw-empty">No not-working assets found</td></tr>
              ) : (
                filteredRows.map((unit, i) => (
                  <NotWorkingRow
                    key={unit.id}
                    unit={unit}
                    index={i}
                    onSendToRepair={handleSendToRepair}
                    onRemove={setRemoveTarget}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {removeTarget && (
        <DeleteModal
          asset={removeTarget}
          onConfirm={handleRemoveConfirm}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}

