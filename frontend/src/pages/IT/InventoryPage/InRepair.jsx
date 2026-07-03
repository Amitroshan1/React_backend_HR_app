
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
  getITApiErrorMessage,
  saveAssetUnitsToStorage,
  logDeletedAsset,
  deleteAssetUnit,
  syncDeletedLogsFromAPI,
  syncInventoryCount,
  syncITDataFromAPI,
  setUnitStatusAPI,
  updateInventoryItemAPI,
} from "../Data";
import {
  getHardwareFields,
  getInventoryStatusCategoryTabs,
  getUnitBrandModelDisplay,
  showInventoryStatusCategoryTabs,
  unitBelongsToInventoryCategory,
  resolveInventoryCategory,
} from "../inventoryCategories";
import "./InventoryDashboard.css";
import "./InRepair.css";
import { formatDate } from "../../../utils/dateFormat";

// ─── Constants ────────────────────────────────────────────────────────────────
const REPAIR_STATUS = "repair";
const SEARCH_FIELDS = ["brand", "assetName", "serialNumber"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getDaysElapsed = (iso) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0;

const getRepairDaysClass = (days) => {
  if (days > 30) return "overdue";
  if (days > 14) return "warning";
  return "ok";
};

const normCategory = (category) => {
  const raw = String(category || "").trim();
  if (!raw) return "Hardware";
  return raw.toLowerCase().startsWith("consumable") ? "Consumables" : raw;
};

/** One table row per unit in repair (qty catalog lines become N rows). */
function expandRepairRowsForDisplay(rows) {
  const expanded = [];
  for (const row of rows) {
    if (!row.isQuantityRow) {
      expanded.push(row);
      continue;
    }
    const qty = Math.max(0, Number(row.repairQuantity || 0));
    for (let n = 1; n <= qty; n += 1) {
      expanded.push({
        ...row,
        id: `${row.id}::line-${n}`,
        isQuantityLine: true,
        qtyLineIndex: n,
        qtyLineTotal: qty,
      });
    }
  }
  return expanded;
}

function isCatalogQtyRepairRow(unit) {
  return Boolean(unit?.isQuantityRow || unit?.isQuantityLine);
}

const readAssetUnits = () => getAssetUnitsFromStorage() || [];
const writeAssetUnits = (units) => saveAssetUnitsToStorage(units);

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
    <div className="repair-modal-backdrop" onClick={onCancel}>
      <div className="repair-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="repair-modal-title">Mark as Dead Device?</h3>
        <p className="repair-modal-sub">{displayName}</p>
        <p className="repair-modal-sub">
          This device will be moved to <strong>Dead Assets</strong> and removed from active inventory.
          Please confirm to continue.
        </p>

        <div className="repair-modal-field">
          <label>Marked By *</label>
          <input
            value={deletedBy}
            onChange={(e) => setDeletedBy(e.target.value)}
            placeholder="Your name"
            className={errors.deletedBy ? "err" : ""}
          />
          {errors.deletedBy && <span className="repair-err">{errors.deletedBy}</span>}
        </div>

        <div className="repair-modal-field">
          <label>Reason *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Reason for marking this device as dead..."
            className={errors.reason ? "err" : ""}
          />
          {errors.reason && <span className="repair-err">{errors.reason}</span>}
        </div>

        <div className="repair-modal-actions">
          <button className="repair-btn-danger" onClick={handleSubmit}>Confirm Dead Device</button>
          <button className="repair-btn-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── RepairRow ────────────────────────────────────────────────────────────────

function RepairRow({ unit, index, inventoryCategory, onReturn, onRemove }) {
  const isCatalogQty = isCatalogQtyRepairRow(unit);
  const days = isCatalogQty ? null : getDaysElapsed(unit.repairDate);
  const { primary, secondary } = getUnitBrandModelDisplay(unit, inventoryCategory);
  const lineLabel =
    unit?.isQuantityLine && unit.qtyLineTotal > 1
      ? `Unit ${unit.qtyLineIndex} of ${unit.qtyLineTotal}`
      : null;
  return (
    <tr className={index % 2 === 0 ? "tr-even" : "tr-odd"}>
      <td>
        <span className="repair-brand">{primary}</span>
        {secondary ? <span className="repair-model"> {secondary}</span> : null}
        {lineLabel ? (
          <span className="repair-model" style={{ display: "block", marginTop: 2 }}>
            {lineLabel}
          </span>
        ) : null}
      </td>
      <td><span className="inv-category-badge">{unit.category}</span></td>
      <td>
        {isCatalogQty
          ? <span className="repair-serial">{lineLabel || "Stock item"}</span>
          : unit.serialNumber
            ? <span className="repair-serial">{unit.serialNumber}</span>
            : "—"}
      </td>
      <td>{isCatalogQty ? "—" : formatDate(unit.repairDate)}</td>
      <td>
        {isCatalogQty ? (
          <span className="repair-days ok">—</span>
        ) : (
          <span className={`repair-days ${getRepairDaysClass(days)}`}>{days}d</span>
        )}
      </td>
      <td className="repair-actions">
        <button className="repair-btn-return" onClick={() => onReturn(unit)}>Repaired</button>
        <button className="repair-btn-remove" onClick={() => onRemove(unit)}>Dead Device</button>
      </td>
    </tr>
  );
}

// ─── InRepair ─────────────────────────────────────────────────────────────────

export default function InRepair({ inventoryCategory = "IT Assets" }) {
  const categoryTabs = getInventoryStatusCategoryTabs(inventoryCategory);
  const showCategoryTabs = showInventoryStatusCategoryTabs(inventoryCategory);
  const serialColLabel =
    inventoryCategory === "Infrastructure Assets"
      ? "Asset tag / Serial"
      : getHardwareFields(inventoryCategory).serialNumber.label;
  const [units,        setUnits]        = useState([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery,  setSearchQuery]  = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);
  const [toast,        setToast]        = useState("");

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
        console.error("[InRepair] API sync failed, using cached data:", err);
        rtToast.error(
          getITApiErrorMessage(
            err,
            "Could not sync repair list from the server. Showing cached units.",
          ),
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

  const repairUnits = useMemo(
    () =>
      units.filter(
        (u) =>
          u.status === REPAIR_STATUS &&
          unitBelongsToInventoryCategory(u, inventoryCategory, inventoryRows),
      ),
    [units, inventoryCategory, inventoryRows],
  );

  const qtyRepairRows = useMemo(() => {
    const rows = [];
    const qtyCatalogCats = new Set(["accessories", "consumables", "stock"]);

    for (const i of inventoryRows) {
      if (resolveInventoryCategory(i) !== inventoryCategory) continue;
      const repairQty = Number(i.repairQuantity || 0);
      if (repairQty <= 0) continue;

      const cat = String(i.category || "").toLowerCase();
      const unitsForItem = repairUnits.filter(
        (u) => String(u.inventoryId) === String(i.id),
      ).length;

      if (qtyCatalogCats.has(cat)) {
        rows.push({
          id: `qty-${i.id}`,
          inventoryId: i.id,
          assetName: i.name,
          brand: i.name,
          category: normCategory(i.category),
          serialNumber: "",
          repairQuantity: repairQty,
          availableQuantity: Number(i.availableQuantity || 0),
          totalQuantity: Number(i.totalQuantity || 0),
          assignedQuantity: Number(i.assignedQuantity || 0),
          notWorkingQuantity: Number(i.notWorkingQuantity || 0),
          isQuantityRow: true,
        });
        continue;
      }

      const excess = repairQty - unitsForItem;
      if (excess > 0) {
        rows.push({
          id: `qty-${i.id}`,
          inventoryId: i.id,
          assetName: i.name,
          brand: i.name,
          category: normCategory(i.category),
          serialNumber: "",
          repairQuantity: excess,
          availableQuantity: Number(i.availableQuantity || 0),
          totalQuantity: Number(i.totalQuantity || 0),
          assignedQuantity: Number(i.assignedQuantity || 0),
          notWorkingQuantity: Number(i.notWorkingQuantity || 0),
          isQuantityRow: true,
        });
      }
    }
    return rows;
  }, [inventoryRows, inventoryCategory, repairUnits]);

  const allRepairRows = useMemo(
    () => [...repairUnits, ...qtyRepairRows],
    [repairUnits, qtyRepairRows],
  );

  const filteredRows = useMemo(() => {
    let rows = allRepairRows;
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
  }, [allRepairRows, activeCategory, searchQuery]);

  const displayRows = useMemo(
    () => expandRepairRowsForDisplay(filteredRows),
    [filteredRows],
  );

  const repairTotalCount = useMemo(
    () => expandRepairRowsForDisplay(allRepairRows).length,
    [allRepairRows],
  );

  const getCategoryCount = useCallback(
    (cat) =>
      expandRepairRowsForDisplay(
        allRepairRows.filter((u) => normCategory(u.category) === cat),
      ).length,
    [allRepairRows],
  );

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleReturn = useCallback(async (unit) => {
    if (isCatalogQtyRepairRow(unit)) {
      const maxQty = unit?.isQuantityLine
        ? 1
        : Number(unit.repairQuantity || 0);
      let qty = 1;
      if (!unit?.isQuantityLine) {
        const input = window.prompt(`Enter quantity to mark as repaired (1-${maxQty})`, "1");
        if (input == null) return;
        qty = Number.parseInt(input, 10);
        if (!Number.isFinite(qty) || qty < 1 || qty > maxQty) {
          rtToast.error(`Please enter a valid quantity between 1 and ${maxQty}.`);
          return;
        }
      }
      try {
        await updateInventoryItemAPI(unit.inventoryId, {
          repair_quantity: Math.max(0, Number(unit.repairQuantity || 0) - qty),
          available_quantity: Number(unit.availableQuantity || 0) + qty,
          not_working_quantity: Number(unit.notWorkingQuantity || 0),
          assigned_quantity: Number(unit.assignedQuantity || 0),
          total_quantity: Number(unit.totalQuantity || 0),
        });
        await syncITDataFromAPI();
      } catch (err) {
        console.error("[InRepair] qty mark repaired failed:", err);
        rtToast.error(getITApiErrorMessage(err, "Could not update quantity on the server."));
        return;
      }
      dispatchInventoryUpdate();
      reload();
      showToast(`${qty} item(s) marked repaired ✓`);
      return;
    }

    const ok = window.confirm(
      "This device will be moved to Available and can be assigned again. Are you sure you want to mark it as repaired?",
    );
    if (!ok) return;

    try {
      await setUnitStatusAPI({ unitId: unit.id, status: "available" });
      await syncITDataFromAPI();
    } catch (err) {
      console.error("[InRepair] set available via API failed:", err);
      rtToast.error(
        getITApiErrorMessage(err, "Could not move this unit to available on the server."),
      );
      return;
    }

    const updated = readAssetUnits().map((u) =>
      u.id === unit.id ? { ...u, status: "available", repairDate: null } : u,
    );
    writeAssetUnits(updated);
    syncInventoryCount(unit, "fromRepairToAvailable");
    dispatchInventoryUpdate();
    reload();
    const { primary } = getUnitBrandModelDisplay(unit, inventoryCategory);
    showToast(`${primary} marked repaired and moved to available ✓`);
  }, [reload, showToast, inventoryCategory]);

  const handleRemovePrompt = useCallback((unit) => {
    const ok = window.confirm(
      "This will move the device to Dead Assets and remove it from active inventory. Continue?",
    );
    if (!ok) return;
    setRemoveTarget(unit);
  }, []);

  const handleRemoveConfirm = useCallback(async (deletedBy, reason) => {
    if (isCatalogQtyRepairRow(removeTarget)) {
      const maxQty = removeTarget?.isQuantityLine
        ? 1
        : Number(removeTarget.repairQuantity || 0);
      let qty = 1;
      if (!removeTarget?.isQuantityLine) {
        const input = window.prompt(`Enter quantity to remove as dead device (1-${maxQty})`, "1");
        if (input == null) return;
        qty = Number.parseInt(input, 10);
        if (!Number.isFinite(qty) || qty < 1 || qty > maxQty) {
          rtToast.error(`Please enter a valid quantity between 1 and ${maxQty}.`);
          return;
        }
      }
      try {
        await updateInventoryItemAPI(removeTarget.inventoryId, {
          repair_quantity: Math.max(0, Number(removeTarget.repairQuantity || 0) - qty),
          total_quantity: Math.max(0, Number(removeTarget.totalQuantity || 0) - qty),
          available_quantity: Number(removeTarget.availableQuantity || 0),
          assigned_quantity: Number(removeTarget.assignedQuantity || 0),
          not_working_quantity: Number(removeTarget.notWorkingQuantity || 0),
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
        console.error("[InRepair] qty dead device failed:", err);
        rtToast.error(getITApiErrorMessage(err, "Could not remove quantity on the server."));
        return;
      }
      dispatchInventoryUpdate();
      reload();
      setRemoveTarget(null);
      showToast(`${qty} item(s) moved to Dead Assets ✓`);
      return;
    }

    const deletedId = `del-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const entry = buildLocalDeletedEntry(removeTarget, deletedBy, reason, deletedId);

    try {
      await createDeletedLogAPI(
        buildDeletedLogApiPayload(removeTarget, deletedBy, reason, deletedId),
      );
      await deleteAssetUnitAPI(removeTarget.id);
      await syncITDataFromAPI();
      await syncDeletedLogsFromAPI();
    } catch (err) {
      console.error("[InRepair] dead device failed:", err);
      rtToast.error(
        getITApiErrorMessage(
          err,
          "Could not complete dead device removal on the server.",
        ),
      );
      try {
        logDeletedAsset(removeTarget, deletedBy, reason);
      } catch {
        /* no-op */
      }
      writeAssetUnits(readAssetUnits().filter((u) => u.id !== removeTarget.id));
      try {
        deleteAssetUnit(removeTarget.id);
      } catch {
        /* no-op */
      }
      syncInventoryCount(removeTarget, "fromRepairDelete");
      dispatchInventoryUpdate();
      reload();
      setRemoveTarget(null);
      return;
    }

    writeAssetUnits(readAssetUnits().filter((u) => u.id !== removeTarget.id));
    try {
      deleteAssetUnit(removeTarget.id);
    } catch {
      /* no-op */
    }

    syncInventoryCount(removeTarget, "fromRepairDelete");
    dispatchInventoryUpdate();
    reload();
    setRemoveTarget(null);
    rtToast.success(`${entry.assetName || entry.brand} moved to Dead Assets.`);
    showToast("Asset moved to Dead Assets ✓");
  }, [removeTarget, reload, showToast]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="repair-page">
      {toast && <div className="repair-toast">{toast}</div>}

      <div className="repair-card">
        <div className="repair-header">
          <div>
            <h1 className="repair-title">In Repair</h1>
            <p className="repair-subtitle">Assets currently under repair</p>
          </div>
          <span className="repair-count-badge">
            {displayRows.length} asset{displayRows.length !== 1 ? "s" : ""}
          </span>
        </div>

        {showCategoryTabs && (
          <div className="repair-tabs">
            {categoryTabs.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`repair-tab ${activeCategory === cat ? "active" : ""}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
                {cat !== "All" && (
                  <span className="repair-tab-count">{getCategoryCount(cat)}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="repair-search-row">
          <div className="repair-search-wrap">
            <span className="repair-search-icon">⌕</span>
            <input
              className="repair-search-input"
              placeholder="Search by brand, name or serial..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="repair-search-clear" onClick={() => setSearchQuery("")}>×</button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="repair-table-wrap">
          <table className="repair-table">
            <thead>
              <tr>
                <th>Brand / Name</th>
                <th>Category</th>
                <th>{serialColLabel}</th>
                <th>Repair Since</th>
                <th>Days in Repair</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 ? (
                <tr><td colSpan={6} className="repair-empty">No assets in repair</td></tr>
              ) : (
                displayRows.map((unit, i) => (
                  <RepairRow
                    key={unit.id}
                    unit={unit}
                    index={i}
                    inventoryCategory={inventoryCategory}
                    onReturn={handleReturn}
                    onRemove={handleRemovePrompt}
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
