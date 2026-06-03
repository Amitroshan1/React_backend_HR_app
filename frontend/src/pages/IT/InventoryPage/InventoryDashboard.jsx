// InventoryDashboard.jsx
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Routes, Route, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import ClickableImage from "../../../components/ClickableImage";
import "./InventoryDashboard.css";

import {
  getInventoryFromStorage,
  saveInventoryToStorage,
  getAssetUnitsFromStorage,
  saveAssetUnitsToStorage,
  notifyInventoryChange,
  logDeletedAsset,
  getInventoryCounts,
  getITApiErrorMessage,
  syncITDataFromAPI,
  syncDeletedLogsFromAPI,
  setUnitStatusAPI,
  createDeletedLogAPI,
  deleteAssetUnitAPI,
  updateInventoryItemAPI,
  getDeletedAssetsFromStorage,
} from "../Data";

import AddNewAssets    from "./AddnewAssets";
import NotWorking      from "./NotWorking";
import InRepair        from "./InRepair";
import RemovedAssets   from "./RemovedAssets";
import RemovedITAssets from "./RemovedITAssets";
import Parcel          from "./Parcel/ParcelDashboard";
import AddImported     from "./Parcel/AddImportedAssets";
import ReadyExport     from "./Parcel/ExportedAssets";
import {
  INV_CATEGORIES,
  deletedLogBelongsToInventoryCategory,
  filterInventoryByCategory,
  getAssignedColumnLabel,
  resolveInventoryCategory,
  getHardwareFields,
  getUnitBrandModelDisplay,
  hideAssignedColumnForCategory,
  isStockInventoryCategory,
  isValidInventoryCategory,
  isVehicleInventoryCategory,
  showInventoryDeploy,
  getDeployModalConfig,
  rowSupportsInventoryDeploy,
  isUnitDeployRow,
} from "../inventoryCategories";
import { OfficeIssueModal, OfficeReturnModal } from "./OfficeStockModals";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE           = "/it/inventory";
const REMOVED_IT_KEY = "removedITAssets";

const SUMMARY_CARDS = [
  { label: "Total Assets",    segment: "total",          color: "#3b82f6" },
  { label: "Not Working",     segment: "not-working",    color: "#ef4444" },
  { label: "In Repair",       segment: "in-repair",      color: "#f59e0b" },
  { label: "Removed From IT", segment: "removed-it",     color: "#06b6d4" },
  { label: "Dead Assets",     segment: "removed-assets", color: "#64748b" },
];

const FILTER_OPTIONS = ["All", "Available", "Assigned"];

const EDIT_OPTIONS = [
  { key: "repair",     label: "Repair",     icon: "🔧", color: "#d97706", hoverBg: "#fef3c7", bg: "#fffbeb", borderColor: "#d97706" },
  { key: "notWorking", label: "Not Working", icon: "⚠️",  color: "#ef4444", hoverBg: "#fee2e2", bg: "#fef2f2", borderColor: "#ef4444" },
  { key: "removed",   label: "Remove",     icon: "🗑️",  color: "#64748b", hoverBg: "#f1f5f9", bg: "#f8fafc", borderColor: "#94a3b8" },
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const isSoftware = (item) =>
  (item?.category ?? "").trim().toLowerCase() === "software";

const isQtyManagedCategory = (category) =>
  ["accessories", "consumables", "accessory", "consumable", "stock"].includes(
    String(category || "").trim().toLowerCase(),
  );

const isStockLineItem = (item) =>
  String(item?.category || "").trim().toLowerCase() === "stock";

const readInventory  = () => getInventoryFromStorage() ?? [];
const writeInventory = (data) => saveInventoryToStorage(data);
const readUnits      = () => getAssetUnitsFromStorage() ?? [];
const writeUnits     = (data) => saveAssetUnitsToStorage(data);

function dispatchInventoryUpdate() {
  try { window.dispatchEvent(new Event("inventory-updated")); } catch { /* no-op */ }
}

function readRemovedITCount() {
  try { return (JSON.parse(localStorage.getItem(REMOVED_IT_KEY) ?? "[]")).length; }
  catch { return 0; }
}

function countRemovedAssetsForCategory(inventoryCategory) {
  const deleted = getDeletedAssetsFromStorage() || [];
  if (!inventoryCategory) return deleted.length;
  const inventory = readInventory();
  const units = readUnits();
  return deleted.filter((d) =>
    deletedLogBelongsToInventoryCategory(d, inventoryCategory, {
      inventory,
      units,
    }),
  ).length;
}

function readLiveCounts(inventoryCategory = null) {
  const inventory = filterInventoryByCategory(readInventory(), inventoryCategory);
  const counts = getInventoryCounts();

  const total = inventory.reduce(
    (sum, i) => sum + (Number(i.totalQuantity) || 0),
    0,
  );
  const notWorking = inventory
    .filter((i) => !isSoftware(i))
    .reduce((sum, i) => sum + (Number(i.notWorkingQuantity) || 0), 0);
  const inRepair = inventory
    .filter((i) => !isSoftware(i))
    .reduce((sum, i) => sum + (Number(i.repairQuantity) || 0), 0);

  return {
    total:            Math.max(0, total),
    "not-working":    Math.max(0, notWorking || (inventoryCategory ? 0 : counts.notWorking) || 0),
    "in-repair":      Math.max(0, inRepair || (inventoryCategory ? 0 : counts.inRepair) || 0),
    "removed-assets": inventoryCategory
      ? countRemovedAssetsForCategory(inventoryCategory)
      : (counts.removedAssets || 0),
    "removed-it":     inventoryCategory === "IT Assets" || !inventoryCategory
      ? readRemovedITCount()
      : 0,
  };
}

function mapInventoryItem(item) {
  const inventoryCategory = resolveInventoryCategory(item);
  return {
    id:                item.id,
    name:              item.name,
    hwType:            item.hwType             ?? null,
    total:             Number(item.totalQuantity)     || 0,
    available:         Number(item.availableQuantity) || 0,
    inventoryCategory,
    assigned:          Number(item.assignedQuantity)  || 0,
    notWorking:        Number(item.notWorkingQuantity) || 0,
    inRepair:          Number(item.repairQuantity)     || 0,
    brand:             item.brand        || "—",
    make:              item.make         || "—",
    model:             item.model        || "—",
    serialNumber:      item.serialNumber || "—",
    category:          item.category     || "—",
    vendor:            item.vendor       || "—",
    purchaseDate:      item.purchaseDate || null,
    location:          item.location     || "—",
    notes:             item.notes        || "",
    receipts:          item.receipts     || [],
    photos:            item.photos       || [],
    isStock:           isStockLineItem(item),
    isSoftware:        isSoftware(item),
  };
}

function getMappedInventory(inventoryCategory = null) {
  const items = readInventory().map(mapInventoryItem);
  return inventoryCategory
    ? filterInventoryByCategory(items, inventoryCategory)
    : items;
}

function getUnitsForAsset(inventoryId, assetName, hwType) {
  const all = readUnits();

  // 1️⃣ Best match: by inventoryId (unique per brand+hwType combo)
  const byId = all.filter((u) => String(u.inventoryId) === String(inventoryId));
  if (byId.length > 0) return byId;

  // 2️⃣ Fallback for legacy data: match by name AND hwType so Apple Mobile ≠ Apple Laptop
  if (hwType) {
    const byNameAndType = all.filter(
      (u) =>
        (u.assetName === assetName || u.name === assetName) &&
        (u.hwType ?? "").toLowerCase() === hwType.toLowerCase(),
    );
    if (byNameAndType.length > 0) return byNameAndType;
  }

  // 3️⃣ Last resort: name only (old data with no hwType stored on unit)
  return all.filter((u) => u.assetName === assetName || u.name === assetName);
}

function safeLogDeletedAsset(asset, deletedBy, reason) {
  try { logDeletedAsset(asset, deletedBy, reason); }
  catch (err) { console.error("[InventoryDashboard] logDeletedAsset failed:", err); }
}

function applyInventoryCountMutation(item, actionKey) {
  if (actionKey === "repair") {
    item.repairQuantity    = (Number(item.repairQuantity)    || 0) + 1;
    item.availableQuantity = Math.max(0, (Number(item.availableQuantity) || 0) - 1);
  } else if (actionKey === "notWorking") {
    item.notWorkingQuantity = (Number(item.notWorkingQuantity) || 0) + 1;
    item.availableQuantity  = Math.max(0, (Number(item.availableQuantity) || 0) - 1);
  } else if (actionKey === "removed") {
    item.totalQuantity      = Math.max(0, (Number(item.totalQuantity)     || 0) - 1);
    item.availableQuantity  = Math.max(0, (Number(item.availableQuantity) || 0) - 1);
  }
}

function updateInventoryCounts(row, actionKey) {
  const inventory = readInventory();
  const index     = inventory.findIndex((i) => String(i.id) === String(row.id));
  if (index < 0) { notifyInventoryChange(); return; }

  const item = { ...inventory[index] };
  applyInventoryCountMutation(item, actionKey);

  if (actionKey === "removed" && Number(item.totalQuantity) <= 0) {
    writeInventory(inventory.filter((_, i) => i !== index));
  } else {
    inventory[index] = item;
    writeInventory(inventory);
  }
  notifyInventoryChange();
}

function buildSyntheticUnit(row, status) {
  const clean = (val) => (val && val !== "—" ? val : "");
  return {
    id:           `synth-unit-${row.id}`,
    inventoryId:  String(row.id),
    assetName:    row.name,
    brand:        clean(row.brand)        || row.name,
    model:        clean(row.model),
    category:     clean(row.category)     || "Hardware",
    serialNumber: clean(row.serialNumber),
    location:     clean(row.location),
    purchaseDate: row.purchaseDate ?? null,
    status,
    repairDate:   status === "repair" ? new Date().toISOString() : null,
  };
}

function findUnitIndex(all, row) {
  const byId = all.findIndex(
    (u) =>
      String(u.inventoryId) === String(row.id) ||
      u.id === `synth-unit-${row.id}`,
  );
  if (byId >= 0) return byId;
  return all.findIndex((u) => u.assetName === row.name || u.name === row.name);
}

// ─── RemoveAssetModal ─────────────────────────────────────────────────────────

function RemoveAssetModal({ asset, onConfirm, onCancel }) {
  const [removedBy, setRemovedBy] = useState("");
  const [reason,    setReason]    = useState("");
  const [errors,    setErrors]    = useState({});

  const handleSubmit = () => {
    const nextErrors = {};
    if (!removedBy.trim()) nextErrors.removedBy = "Required";
    if (!reason.trim())    nextErrors.reason    = "Required";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    onConfirm(removedBy.trim(), reason.trim());
  };

  return (
    <div className="inv-modal-backdrop" onClick={onCancel}>
      <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="inv-modal-hero">
          <p className="inv-modal-hero-label">Asset Action</p>
          <h2 className="inv-modal-hero-title">Remove Asset</h2>
          <p className="inv-modal-hero-sub">{asset?.name}</p>
        </div>
        <div className="inv-modal-body">
          <p className="inv-modal-hint">
            This asset will be moved to <strong>Removed Assets</strong>. Please fill in the details below.
          </p>

          <div className="inv-modal-field">
            <label className="inv-modal-label">Removed By <span className="req">*</span></label>
            <input
              className={`inv-modal-input${errors.removedBy ? " err" : ""}`}
              value={removedBy}
              onChange={(e) => setRemovedBy(e.target.value)}
              placeholder="Enter your name"
            />
            {errors.removedBy && <span className="inv-modal-err">{errors.removedBy}</span>}
          </div>

          <div className="inv-modal-field">
            <label className="inv-modal-label">Reason for Removal <span className="req">*</span></label>
            <textarea
              className={`inv-modal-textarea${errors.reason ? " err" : ""}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this asset is being removed..."
              rows={3}
            />
            {errors.reason && <span className="inv-modal-err">{errors.reason}</span>}
          </div>

          <div className="inv-modal-actions">
            <button className="inv-modal-btn-confirm" onClick={handleSubmit}>Confirm Remove</button>
            <button className="inv-modal-btn-cancel"  onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuantityActionModal({ actionTarget, onConfirm, onCancel }) {
  const row = actionTarget?.row || null;
  const actionKey = actionTarget?.actionKey || "";
  const actionLabel = actionKey === "notWorking"
    ? "Not Working"
    : actionKey === "removed"
      ? "Dead Device"
      : "Repair";

  const maxQty = Math.max(0, Number(row?.available ?? 0));
  const [quantity, setQuantity] = useState(maxQty > 0 ? "1" : "0");
  const [error, setError] = useState("");

  const submit = () => {
    const qty = Number.parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      setError("Enter a valid quantity (minimum 1).");
      return;
    }
    if (qty > maxQty) {
      setError(`Quantity cannot exceed available count (${maxQty}).`);
      return;
    }
    onConfirm(qty);
  };

  return (
    <div className="inv-modal-backdrop" onClick={onCancel}>
      <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="inv-modal-hero">
          <p className="inv-modal-hero-label">Quantity Action</p>
          <h2 className="inv-modal-hero-title">{actionLabel}</h2>
          <p className="inv-modal-hero-sub">{row?.name || "Asset"}</p>
        </div>
        <div className="inv-modal-body">
          <p className="inv-modal-hint">
            How many items do you want to mark for <strong>{actionLabel}</strong>?
          </p>
          <div className="inv-modal-field">
            <label className="inv-modal-label">
              Quantity <span className="req">*</span>
            </label>
            <input
              className={`inv-modal-input${error ? " err" : ""}`}
              type="number"
              min={1}
              max={maxQty}
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setError("");
              }}
              placeholder={`1 to ${maxQty}`}
            />
            <span className="inv-modal-hint-sub">Available: {maxQty}</span>
            {error && <span className="inv-modal-err">{error}</span>}
          </div>

          <div className="inv-modal-actions">
            <button className="inv-modal-btn-confirm" onClick={submit}>
              Confirm
            </button>
            <button className="inv-modal-btn-cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── UnitPickerModal ──────────────────────────────────────────────────────────
// Opens when user clicks Edit — lists each available unit (brand + serial no)
// so the user picks exactly which device to act on before choosing an action.

function UnitPickerModal({ row, onAction, onCancel }) {
  const [selectedUnitId, setSelectedUnitId] = useState(null);

  const allUnits = getUnitsForAsset(row.id, row.name, row.hwType);
  // Only show units that are still available (not yet assigned / in repair / etc.)
  const availableUnits = allUnits.filter(
    (u) => !u.status || u.status === "available" || u.status === "Available",
  );

  const selectedUnit = availableUnits.find(
    (u) => (u.assetId ?? u.id) === selectedUnitId,
  ) ?? null;
  const useQuantityFallback = availableUnits.length === 0;

  return (
    <div className="inv-modal-backdrop" onClick={onCancel}>
      <div className="inv-upicker-box" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="inv-upicker-header">
          <div>
            <p className="inv-upicker-label">Edit Asset</p>
            <h2 className="inv-upicker-title">{row.name}</h2>
            {row.hwType && <p className="inv-upicker-sub">{row.hwType}</p>}
          </div>
          <button className="inv-detail-close-btn" onClick={onCancel}>×</button>
        </div>

        {/* Unit list */}
        <div className="inv-upicker-body">
          <p className="inv-upicker-hint">Select the unit you want to act on:</p>

          {availableUnits.length === 0 ? (
            <div className="inv-upicker-empty">
              <span>📦</span>
              <p>No available units found for this asset.</p>
              <p className="inv-upicker-empty-sub">
                You can still use actions below to update quantity-level status.
              </p>
            </div>
          ) : (
            <div className="inv-upicker-list">
              {availableUnits.map((u) => {
                const uid      = u.assetId ?? u.id;
                const brand    = u.brand || row.name;
                const serial   = u.serialNumber || "—";
                const serialPrefix = isVehicleInventoryCategory(row.inventoryCategory)
                  ? "Reg"
                  : "S/N";
                const isSelected = selectedUnitId === uid;
                return (
                  <button
                    key={uid}
                    className={`inv-upicker-unit${isSelected ? " inv-upicker-unit--selected" : ""}`}
                    onClick={() => setSelectedUnitId(isSelected ? null : uid)}
                  >
                    <span className="inv-upicker-unit-check">{isSelected ? "✔" : ""}</span>
                    <div className="inv-upicker-unit-info">
                      <span className="inv-upicker-unit-brand">{brand}</span>
                      <span className="inv-upicker-unit-serial">{serialPrefix}: {serial}</span>
                    </div>
                    {u.assetId && (
                      <span className="inv-upicker-unit-id">#{u.assetId}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Action buttons — use selected unit when present, else quantity-level fallback */}
        <div className="inv-upicker-actions">
          {EDIT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className="inv-upicker-action-btn"
              style={{ color: opt.color, borderColor: opt.borderColor, background: opt.bg }}
              disabled={!selectedUnit && !useQuantityFallback}
              title={!selectedUnit && !useQuantityFallback ? "Select a unit first" : opt.label}
              onClick={() => onAction(row, opt.key, selectedUnit || null)}
              onMouseEnter={(e) => { if (selectedUnit || useQuantityFallback) e.currentTarget.style.background = opt.hoverBg; }}
              onMouseLeave={(e) => (e.currentTarget.style.background = opt.bg)}
            >
              <span>{opt.icon}</span> {opt.label}
            </button>
          ))}
          <button className="inv-upicker-cancel-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── ViewActionGroup ──────────────────────────────────────────────────────────

function ViewActionGroup({
  row,
  onViewAsset,
  inventoryCategory,
  inventoryDeploy = false,
  onOfficeIssue,
  onOfficeReturn,
}) {
  const deployLabels = getDeployModalConfig(inventoryCategory);
  const deployable = inventoryDeploy && rowSupportsInventoryDeploy(row, inventoryCategory);
  const canDeploy = deployable && Number(row.available) > 0;
  const canReturn = deployable && Number(row.assigned) > 0;

  return (
    <div className="inv-action-group">
      <button type="button" className="inv-action-btn" onClick={() => onViewAsset(row)}>
        View
      </button>
      {deployable && (
        <>
          <button
            type="button"
            className="inv-action-btn inv-action-btn--issue"
            disabled={!canDeploy}
            title={canDeploy ? deployLabels.deployTitle : deployLabels.deployDisabledTitle}
            onClick={() => onOfficeIssue?.(row)}
          >
            {deployLabels.deployLabel}
          </button>
          <button
            type="button"
            className="inv-action-btn inv-action-btn--return"
            disabled={!canReturn}
            title={canReturn ? deployLabels.returnTitle : deployLabels.returnDisabledTitle}
            onClick={() => onOfficeReturn?.(row)}
          >
            {deployLabels.returnLabel}
          </button>
        </>
      )}
    </div>
  );
}

// ─── AssetDetailModal ─────────────────────────────────────────────────────────

function AssetDetailModal({
  asset,
  onClose,
  onStatusChange,
  inventoryCategory,
  inventoryDeploy = false,
  onOfficeIssue,
  onOfficeReturn,
}) {
  const [selectedUnitIndex, setSelectedUnitIndex] = useState(0);

  const units  = getUnitsForAsset(asset.id, asset.name, asset.hwType);
  const unit   = units[selectedUnitIndex] ?? null;
  const photos = unit?.photos ?? unit?.assignmentPhotos ?? [];
  const inventoryPhotos = asset?.photos ?? [];
  const inventoryReceipts = asset?.receipts ?? [];
  const stockMode = asset?.isStock || isStockLineItem(asset);
  const deployLabels = getDeployModalConfig(inventoryCategory || asset?.inventoryCategory);
  const hwFields = getHardwareFields(asset.inventoryCategory, asset.category);
  const showItemMeta =
    !stockMode &&
    (isVehicleInventoryCategory(asset.inventoryCategory) ||
      String(asset.category || "").toLowerCase() === "equipment");

  const invCat = inventoryCategory || asset?.inventoryCategory;
  const isInfraEquipment =
    invCat === "Infrastructure Assets" &&
    String(asset.category || "").toLowerCase() === "equipment";
  const brandModel = unit ? getUnitBrandModelDisplay(unit, invCat) : { primary: "—", secondary: "" };

  const detailFields = isInfraEquipment
    ? [
        {
          label: hwFields.serialNumber.label,
          value: unit?.serialNumber ?? "—",
          mono: true,
          highlight: true,
        },
        { label: "Make", value: brandModel.primary, mono: false, highlight: false },
        { label: hwFields.model.label, value: brandModel.secondary || "—", mono: false, highlight: false },
      ]
    : [
        { label: "Asset ID", value: unit?.assetId ?? unit?.id ?? "—", mono: true, highlight: true },
        { label: hwFields.brand.label, value: brandModel.primary, mono: false, highlight: false },
        { label: hwFields.make.label, value: unit?.make ?? "—", mono: false, highlight: false },
        {
          label: hwFields.model.label,
          value: brandModel.secondary || unit?.model || "—",
          mono: false,
          highlight: false,
        },
        {
          label: hwFields.serialNumber.label,
          value: unit?.serialNumber ?? "—",
          mono: true,
          highlight: false,
        },
      ];

  return (
    <>
      <div className="inv-detail-backdrop" onClick={onClose}>
        <div className="inv-detail-box" onClick={(e) => e.stopPropagation()}>

          <div className="inv-detail-hero">
            <div>
              <p className="inv-detail-hero-label">Asset Details</p>
              <h2 className="inv-detail-hero-title">{asset.name}</h2>
              <div className="inv-detail-hero-badges">
                <span className="inv-detail-badge inv-detail-badge--cat">{asset.inventoryCategory}</span>
                {!stockMode && (
                  <span className="inv-detail-badge inv-detail-badge--units">
                    {units.length} unit{units.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            <button className="inv-detail-close-btn" onClick={onClose}>×</button>
          </div>

          {units.length > 1 && (
            <div className="inv-unit-tabs">
              <span className="inv-unit-label">Unit:</span>
              {units.map((u, i) => (
                <button
                  key={u.assetId ?? i}
                  className={`inv-unit-tab${selectedUnitIndex === i ? " inv-unit-tab--active" : ""}`}
                  onClick={() => setSelectedUnitIndex(i)}
                >
                  #{u.assetTag ?? u.assetId ?? i + 1}
                </button>
              ))}
            </div>
          )}

          <div className="inv-detail-body">
            {units.length === 0 ? (
              <div className="inv-detail-empty">
                <div className="inv-empty-qty-layout">
                  <div className="inv-empty-photo-card">
                    <p className="inv-empty-photo-title">
                      Photos {inventoryPhotos.length > 0 ? `(${inventoryPhotos.length})` : ""}
                    </p>
                    {inventoryPhotos.length === 0 ? (
                      <div className="inv-photos-empty">
                        <div className="inv-photos-empty-icon">📷</div>
                        <p className="inv-photos-empty-text">No photos available</p>
                      </div>
                    ) : (
                      <>
                        <div className="inv-photo-main">
                          <ClickableImage src={inventoryPhotos[0]} alt="asset" />
                          {inventoryPhotos.length > 1 && (
                            <span className="inv-photo-more-badge">+{inventoryPhotos.length - 1} more</span>
                          )}
                        </div>
                        {inventoryPhotos.length > 1 && (
                          <div className="inv-photo-strip">
                            {inventoryPhotos.map((src, i) => (
                              <ClickableImage
                                key={i}
                                src={src}
                                alt=""
                                className="inv-photo-thumb"
                              />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {inventoryReceipts.length > 0 && (
                    <div className="inv-empty-photo-card">
                      <p className="inv-empty-photo-title">
                        Receipts ({inventoryReceipts.length})
                      </p>
                      <div className="inv-photo-strip">
                        {inventoryReceipts.map((src, i) => (
                          <ClickableImage
                            key={i}
                            src={src}
                            alt=""
                            className="inv-photo-thumb"
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="inv-empty-stats-card">
                    <p className="inv-empty-stats-title">Asset Summary</p>
                    <div className="inv-empty-stats-grid">
                      {[
                        ["Total Quantity", asset?.total ?? 0],
                        ["Available", asset?.available ?? 0],
                        ...(!stockMode || inventoryDeploy
                          ? [[inventoryDeploy ? "In use" : "Assigned", asset?.assigned ?? 0]]
                          : []),
                        ["Not Working", asset?.notWorking ?? 0],
                        ["In Repair", asset?.inRepair ?? 0],
                        ...(stockMode && asset?.vendor && asset.vendor !== "—"
                          ? [["Supplier", asset.vendor]]
                          : []),
                        ...(stockMode && asset?.purchaseDate
                          ? [["Purchase date", asset.purchaseDate]]
                          : []),
                        ...(stockMode && asset?.location && asset.location !== "—"
                          ? [["Location", asset.location]]
                          : []),
                      ].map(([label, value]) => (
                        <div key={label} className="inv-empty-stat">
                          <span>{label}</span>
                          <strong>{value}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {showItemMeta && (
                  <div className="inv-detail-meta-strip">
                    {asset.vendor && asset.vendor !== "—" && (
                      <span><strong>Vendor:</strong> {asset.vendor}</span>
                    )}
                    {asset.purchaseDate && (
                      <span><strong>Purchase:</strong> {asset.purchaseDate}</span>
                    )}
                    {asset.location && asset.location !== "—" && (
                      <span><strong>Location:</strong> {asset.location}</span>
                    )}
                  </div>
                )}
                <div className="inv-detail-fields">
                  {detailFields.map(({ label, value, mono, highlight }, idx) => (
                    <div
                      key={label}
                      className={[
                        "inv-detail-field-row",
                        highlight ? "inv-detail-field-row--highlight"
                          : idx % 2 !== 0 ? "inv-detail-field-row--alt"
                          : "",
                      ].filter(Boolean).join(" ")}
                    >
                      <span className="inv-detail-field-label">{label}</span>
                      <span
                        className={[
                          "inv-detail-field-value",
                          highlight ? "inv-detail-field-value--highlight" : "",
                          mono      ? "inv-detail-field-value--mono"      : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {value}
                      </span>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="inv-photos-label">
                    Photos {photos.length > 0 ? `(${photos.length})` : ""}
                  </p>
                  {photos.length === 0 ? (
                    <div className="inv-photos-empty">
                      <div className="inv-photos-empty-icon">📷</div>
                      <p className="inv-photos-empty-text">No photos available</p>
                    </div>
                  ) : (
                    <>
                      <div className="inv-photo-main">
                        <ClickableImage src={photos[0]} alt="asset" />
                        {photos.length > 1 && (
                          <span className="inv-photo-more-badge">+{photos.length - 1} more</span>
                        )}
                      </div>
                      {photos.length > 1 && (
                        <div className="inv-photo-strip">
                          {photos.map((src, i) => (
                            <ClickableImage
                              key={i}
                              src={src}
                              alt=""
                              className="inv-photo-thumb"
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="inv-detail-footer">
            <div className="inv-detail-footer-actions">
              {inventoryDeploy && stockMode && (
                <>
                  <button
                    type="button"
                    className="inv-inline-action-btn"
                    style={{
                      color: "#1d4ed8",
                      background: "#eff6ff",
                      borderColor: "#3b82f6",
                    }}
                    disabled={Number(asset?.available) < 1}
                    onClick={() => {
                      onOfficeIssue?.(asset);
                      onClose();
                    }}
                  >
                    {deployLabels.deployLabel}
                  </button>
                  <button
                    type="button"
                    className="inv-inline-action-btn"
                    style={{
                      color: "#047857",
                      background: "#ecfdf5",
                      borderColor: "#10b981",
                    }}
                    disabled={Number(asset?.assigned) < 1}
                    onClick={() => {
                      onOfficeReturn?.(asset);
                      onClose();
                    }}
                  >
                    {deployLabels.returnLabel}
                  </button>
                </>
              )}
              {EDIT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className="inv-inline-action-btn"
                  style={{
                    color: opt.color,
                    background: opt.bg,
                    borderColor: opt.borderColor,
                  }}
                  onClick={() => {
                    onStatusChange?.(asset, opt.key, null);
                    onClose();
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = opt.hoverBg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = opt.bg; }}
                >
                  <span>{opt.icon}</span> {opt.label}
                </button>
              ))}
            </div>
            <button className="inv-detail-footer-btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

    </>
  );
}

// ─── useAssetActions hook ─────────────────────────────────────────────────────

function useAssetActions(onRefresh) {
  const [removeTarget, setRemoveTarget] = useState(null);
  const [quantityTarget, setQuantityTarget] = useState(null);
  const [toast,        setToast]        = useState("");

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2_800);
  }, []);

  const handleStatusChange = useCallback(async (row, actionKey, unit) => {
    if (!unit && isQtyManagedCategory(row?.category)) {
      setQuantityTarget({ row, actionKey });
      return;
    }
    if (actionKey === "removed") { setRemoveTarget({ ...row, _selectedUnit: unit }); return; }

    const targetStatus = actionKey === "repair" ? "repair" : "notWorking";
    const all          = readUnits();

    const resolveUnit = () => {
      if (unit) {
        const uid = unit.assetId ?? unit.id;
        const idx = all.findIndex((u) => (u.assetId ?? u.id) === uid);
        return idx >= 0 ? all[idx] : unit;
      }
      const matchIdx = findUnitIndex(all, row);
      return matchIdx >= 0 ? all[matchIdx] : null;
    };

    const rowUnit = resolveUnit();
    const serverUnitId = rowUnit != null ? Number(rowUnit.id) : NaN;
    const canSyncServer = Number.isFinite(serverUnitId) && serverUnitId > 0;

    if (canSyncServer) {
      try {
        await setUnitStatusAPI({ unitId: serverUnitId, status: targetStatus });
        await syncITDataFromAPI();
      } catch (err) {
        console.error("[InventoryDashboard] set unit status via API failed:", err);
        toast.error(
          getITApiErrorMessage(err, "Could not update this unit on the server."),
        );
        return;
      }
    } else {
      if (rowUnit) {
        const uid = rowUnit.assetId ?? rowUnit.id;
        const idx = all.findIndex((u) => (u.assetId ?? u.id) === uid);
        if (idx >= 0) {
          all[idx] = {
            ...all[idx],
            status:     targetStatus,
            repairDate: targetStatus === "repair"
              ? all[idx].repairDate ?? new Date().toISOString()
              : all[idx].repairDate,
          };
          writeUnits(all);
        }
      } else {
        writeUnits([...all, buildSyntheticUnit(row, targetStatus)]);
      }
      updateInventoryCounts(row, actionKey);
    }

    showToast(
      actionKey === "repair"
        ? `✅ "${row.name}" sent to Repair`
        : `⚠️ "${row.name}" marked as Not Working`,
    );
    dispatchInventoryUpdate();
    onRefresh();
  }, [onRefresh, showToast]);

  const handleQuantityConfirm = useCallback(async (qty) => {
    if (!quantityTarget) return;
    const { row, actionKey } = quantityTarget;

    const inventory = readInventory();
    const index = inventory.findIndex((i) => String(i.id) === String(row.id));
    if (index < 0) {
      setQuantityTarget(null);
      return;
    }
    const item = { ...inventory[index] };

    const available = Number(item.availableQuantity || 0);
    const total = Number(item.totalQuantity || 0);
    const safeQty = Math.max(1, Math.min(Number(qty || 0), available));
    if (safeQty < 1) {
      toast.error("No available quantity left for this action.");
      return;
    }

    if (actionKey === "repair") {
      item.repairQuantity = Number(item.repairQuantity || 0) + safeQty;
      item.availableQuantity = Math.max(0, available - safeQty);
    } else if (actionKey === "notWorking") {
      item.notWorkingQuantity = Number(item.notWorkingQuantity || 0) + safeQty;
      item.availableQuantity = Math.max(0, available - safeQty);
    } else if (actionKey === "removed") {
      item.totalQuantity = Math.max(0, total - safeQty);
      item.availableQuantity = Math.max(0, available - safeQty);
    }

    try {
      await updateInventoryItemAPI(row.id, {
        total_quantity: item.totalQuantity,
        available_quantity: item.availableQuantity,
        assigned_quantity: item.assignedQuantity,
        not_working_quantity: item.notWorkingQuantity,
        repair_quantity: item.repairQuantity,
      });
      if (actionKey === "removed") {
        await createDeletedLogAPI({
          delete_code: `del-qty-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          inventory_item_id: Number(row.id) || null,
          deleted_by_name: "Inventory",
          asset_name: row.name,
          category: row.category || "Accessories",
          serial_number: "",
          reason: `Dead quantity marked: ${safeQty}`,
        });
        await syncDeletedLogsFromAPI();
      }
      await syncITDataFromAPI();
    } catch (err) {
      console.error("[InventoryDashboard] quantity action via API failed:", err);
      toast.error(
        getITApiErrorMessage(err, "Could not update quantity status on the server."),
      );
      return;
    }

    setQuantityTarget(null);
    showToast(
      actionKey === "repair"
        ? `✅ ${safeQty} item(s) moved to Repair`
        : actionKey === "notWorking"
          ? `⚠️ ${safeQty} item(s) marked Not Working`
          : `🗑️ ${safeQty} item(s) moved to Dead Assets`,
    );
    dispatchInventoryUpdate();
    onRefresh();
  }, [quantityTarget, onRefresh, showToast]);

  const handleRemoveConfirm = useCallback(async (removedBy, reason) => {
    if (!removeTarget) return;

    const all          = readUnits();
    const selectedUnit = removeTarget._selectedUnit ?? null;

    let unit = null;
    if (selectedUnit) {
      const uid = selectedUnit.assetId ?? selectedUnit.id;
      const idx = all.findIndex((u) => (u.assetId ?? u.id) === uid);
      unit = idx >= 0 ? all[idx] : selectedUnit;
    } else {
      const matchIdx = findUnitIndex(all, removeTarget);
      unit = matchIdx >= 0 ? all[matchIdx] : null;
    }

    const unitIdNum = unit != null ? Number(unit.id) : NaN;
    const canUseApi = Number.isFinite(unitIdNum) && unitIdNum > 0;

    const entry = {
      deletedId:    `del-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      assetName:    unit?.assetName || removeTarget.name,
      brand:        unit?.brand     || removeTarget.name,
      model:        unit?.model     || "",
      category:     unit?.category  || removeTarget.inventoryCategory || "Hardware",
      serialNumber: unit?.serialNumber || "",
    };

    if (canUseApi) {
      try {
        await createDeletedLogAPI({
          delete_code: entry.deletedId,
          asset_unit_id: unitIdNum,
          inventory_item_id: Number(unit.inventoryId) || Number(removeTarget.id) || null,
          deleted_by_name: removedBy,
          asset_name: entry.assetName,
          category: entry.category,
          serial_number: entry.serialNumber,
          reason,
        });
        await deleteAssetUnitAPI(unitIdNum);
        await syncITDataFromAPI();
        await syncDeletedLogsFromAPI();
      } catch (err) {
        console.error("[InventoryDashboard] remove via API failed:", err);
        toast.error(
          getITApiErrorMessage(err, "Could not remove this asset on the server."),
        );
        return;
      }
    } else if (unit) {
      const uid = unit.assetId ?? unit.id;
      const idx = all.findIndex((u) => (u.assetId ?? u.id) === uid);
      if (idx >= 0) {
        safeLogDeletedAsset(
          {
            ...unit,
            assetName: unit.assetName || removeTarget.name,
            brand:     unit.brand     || removeTarget.name,
            category:  unit.category  || removeTarget.inventoryCategory || "Hardware",
          },
          removedBy,
          reason,
        );
        writeUnits(all.filter((_, i) => i !== idx));
      }
      updateInventoryCounts(removeTarget, "removed");
    } else {
      safeLogDeletedAsset(
        {
          assetName: removeTarget.name,
          brand: removeTarget.name,
          model: "",
          category: removeTarget.inventoryCategory || "Hardware",
          serialNumber: "",
          id: removeTarget.id,
        },
        removedBy,
        reason,
      );
      updateInventoryCounts(removeTarget, "removed");
    }

    showToast(`🗑️ "${removeTarget.name}" moved to Dead Assets`);
    setRemoveTarget(null);
    dispatchInventoryUpdate();
    onRefresh();
  }, [removeTarget, onRefresh, showToast]);

  return {
    removeTarget,
    setRemoveTarget,
    quantityTarget,
    setQuantityTarget,
    toast,
    handleStatusChange,
    handleRemoveConfirm,
    handleQuantityConfirm,
  };
}

// ─── InventoryShell ───────────────────────────────────────────────────────────

export function InventoryShell({ children, category, setCategory, activeSegment }) {
  const navigate  = useNavigate();
  const headerRef = useRef(null);
  const navRef    = useRef(null);

  const [stickyTop, setStickyTop] = useState(0);
  const [counts,    setCounts]    = useState(() => readLiveCounts(category));

  useEffect(() => {
    const measure = () => {
      const headerH = headerRef.current?.offsetHeight ?? 0;
      const navH    = navRef.current?.offsetHeight    ?? 0;
      setStickyTop(headerH + navH);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const update = () => setCounts(readLiveCounts(category));
    syncITDataFromAPI().then(update).catch((err) => {
      console.error("[InventoryDashboard] API sync failed, using cached data:", err);
      toast.error(
        getITApiErrorMessage(
          err,
          "Could not sync IT data from the server. Showing cached inventory.",
        ),
      );
      update();
    });
    window.addEventListener("inventory-updated", update);
    window.addEventListener("storage",           update);
    return () => {
      window.removeEventListener("inventory-updated", update);
      window.removeEventListener("storage",           update);
    };
  }, [category]);

  const visibleCards = useMemo(
    () => SUMMARY_CARDS.filter(
      (c) => !(c.segment === "removed-it" && category !== "IT Assets"),
    ),
    [category],
  );

  return (
    <div className="inv-root">
      <nav className="inv-tab-bar" ref={navRef}>
        {INV_CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={category === cat ? "inv-tab--active" : "inv-tab"}
            onClick={() => {
              setCategory(cat);
              navigate(`${BASE}?cat=${encodeURIComponent(cat)}`);
            }}
          >
            {cat}
          </button>
        ))}
      </nav>

      <header className="inv-header" ref={headerRef}>
        <div className="inv-header-left">
          <button className="inv-back-btn" onClick={() => navigate("/it/")}>← Back</button>
          <div className="inv-logo-group">
            <div className="inv-logo">
              <span className="inv-logo-dot" />
              <span className="inv-logo-text">INVENTORY</span>
            </div>
            <span className="inv-header-sub">Asset Management System</span>
          </div>
        </div>
        <div className="inv-header-right">
          <button className="inv-btn-outline" onClick={() => navigate(`${BASE}/parcels`)}>📦 Parcels</button>
          <button
            className="inv-btn-primary"
            onClick={() => navigate(`${BASE}/add-assets?inv=${encodeURIComponent(category)}`)}
          >
            + Add Assets
          </button>
        </div>
      </header>

      <section className="inv-cards-grid inv-cards-grid--sticky" style={{ top: stickyTop }}>
        {visibleCards.map((card) => {
          const isActive = activeSegment === card.segment;
          const count    = counts[card.segment] ?? 0;
          return (
            <button
              key={card.segment}
              className="inv-card"
              style={{
                borderColor: isActive ? card.color : "#e2e8f0",
                boxShadow:   isActive ? `0 4px 14px ${card.color}33` : "none",
              }}
              onClick={() =>
                navigate(
                  `${BASE}/${card.segment}?cat=${encodeURIComponent(category)}`,
                )
              }
            >
              <span className="inv-card-label">{card.label}</span>
              <span
                className="inv-card-count"
                style={{ color: count === 0 ? "#94a3b8" : isActive ? card.color : "#0f172a" }}
              >
                {count}
              </span>
              <div className="inv-card-bar" style={{ background: card.color }} />
            </button>
          );
        })}
      </section>

      {children}
    </div>
  );
}

// ─── Shared AssetTable ────────────────────────────────────────────────────────

function formatCategoryLabel(category) {
  const c = String(category || "").trim();
  if (!c || c === "—") return "—";
  const lower = c.toLowerCase();
  if (lower === "consumables") return "Consumable";
  if (lower === "accessories") return "Accessories";
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function categoryPillVariant(category) {
  const key = String(category || "").trim().toLowerCase();
  const map = {
    hardware: "hardware",
    accessories: "accessories",
    accessory: "accessories",
    consumables: "consumables",
    consumable: "consumables",
    software: "software",
    stock: "stock",
    vehicle: "vehicle",
    equipment: "equipment",
  };
  return map[key] || "default";
}

function CategoryPill({ category }) {
  const label = formatCategoryLabel(category);
  if (label === "—") return <span className="inv-cat-pill inv-cat-pill--muted">—</span>;
  const variant = categoryPillVariant(category);
  return <span className={`inv-cat-pill inv-cat-pill--${variant}`}>{label}</span>;
}

function AssetTable({
  assets,
  filter,
  onViewAsset,
  hideAssigned = false,
  assignedColumnLabel = "Assigned",
  inventoryCategory,
  inventoryDeploy = false,
  onOfficeIssue,
  onOfficeReturn,
}) {
  const showAvailable = filter !== "Assigned" && filter !== "In use";
  const showAssigned  = !hideAssigned && filter !== "Available";
  const emptyColSpan  = 4 + (showAvailable ? 1 : 0) + (showAssigned ? 1 : 0);

  return (
    <div className="inv-table-scroll">
      <table className="inv-table">
        <thead>
          <tr>
            <th>Assets Name</th>
            <th>Category</th>
            <th>Total Qty</th>
            {showAvailable && <th>Available</th>}
            {showAssigned  && <th>{assignedColumnLabel}</th>}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {assets.length === 0 ? (
            <tr>
              <td colSpan={emptyColSpan} className="inv-empty-row">No assets found.</td>
            </tr>
          ) : (
            assets.map((row, i) => (
              <tr key={row.id} className={i % 2 === 0 ? "tr-even" : "tr-odd"}>
                <td className="td-name">
                  {row.hwType && !row.isStock && !row.isSoftware ? (
                    <div className="td-name-wrap">
                      <span className="td-name-brand">{row.name}</span>
                      <span className="td-name-sub">{row.hwType}</span>
                    </div>
                  ) : (
                    <div className="td-name-wrap">
                      <span className="td-name-brand">{row.name}</span>
                      {row.isStock && row.vendor && row.vendor !== "—" && (
                        <span className="td-name-sub">{row.vendor}</span>
                      )}
                    </div>
                  )}
                </td>
                <td className="td-category">
                  <CategoryPill category={row.category} />
                </td>
                <td>{row.total}</td>
                {showAvailable && <td className="td-available">{row.available}</td>}
                {showAssigned  && <td className="td-assigned">{row.assigned}</td>}
                <td>
                  <ViewActionGroup
                    row={row}
                    onViewAsset={onViewAsset}
                    inventoryCategory={inventoryCategory}
                    inventoryDeploy={inventoryDeploy}
                    onOfficeIssue={onOfficeIssue}
                    onOfficeReturn={onOfficeReturn}
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── TotalAssetsPage ──────────────────────────────────────────────────────────

function TotalAssetsPage({ category }) {
  const showTypeFilter = category === "IT Assets";
  const [filter,        setFilter]        = useState("All");
  const [hwTypeFilter,  setHwTypeFilter]  = useState("All");
  const [searchQuery,   setSearchQuery]   = useState("");
  const [detailAsset,   setDetailAsset]   = useState(null);
  const [officeIssueTarget, setOfficeIssueTarget] = useState(null);
  const [officeReturnTarget, setOfficeReturnTarget] = useState(null);
  const [refreshKey,    setRefreshKey]    = useState(0);

  const inventoryDeploy = showInventoryDeploy(category);
  const filterOptions = inventoryDeploy
    ? ["All", "Available", "In use"]
    : FILTER_OPTIONS;
  const assignedLabel = getAssignedColumnLabel(category);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const {
    removeTarget,
    setRemoveTarget,
    quantityTarget,
    setQuantityTarget,
    toast,
    handleStatusChange,
    handleRemoveConfirm,
    handleQuantityConfirm,
  } = useAssetActions(refresh);

  const filteredAssets = useMemo(() => {
    void refreshKey;
    const q = searchQuery.trim().toLowerCase();
    return getMappedInventory(category)
      .filter((a) => Number(a.total) > 0)
      .filter((a) => {
        if (filter === "Available") return a.available > 0;
        if (filter === "Assigned" || filter === "In use") return a.assigned > 0;
        return true;
      })
      .filter((a) => {
        if (!showTypeFilter || hwTypeFilter === "All") return true;
        return (a.category ?? "").toLowerCase() === hwTypeFilter.toLowerCase();
      })
      .filter((a) => {
        if (!q) return true;
        return (
          a.name.toLowerCase().includes(q) ||
          (a.hwType  ?? "").toLowerCase().includes(q) ||
          (a.category ?? "").toLowerCase().includes(q)
        );
      });
  }, [category, filter, hwTypeFilter, searchQuery, refreshKey, showTypeFilter]);

  return (
    <>
      {toast && <div className="inv-toast">{toast}</div>}

      <div className="inv-filter-row">
        <span className="inv-filter-label">Filter:</span>
        {filterOptions.map((f) => (
          <button
            key={f}
            className={filter === f ? "inv-filter-pill--active" : "inv-filter-pill"}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}

        {showTypeFilter && (
          <>
            <span className="inv-filter-divider" />
            <span className="inv-filter-label">Type:</span>
            <select
              className="inv-hwtype-dropdown"
              value={hwTypeFilter}
              onChange={(e) => setHwTypeFilter(e.target.value)}
            >
              {["All", "Hardware", "Software", "Consumables", "Accessories"].map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </>
        )}

        <div className="inv-search-wrap">
          <span className="inv-search-icon">🔍</span>
          <input
            className="inv-search-input"
            type="text"
            placeholder="Search by brand..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="inv-search-clear" onClick={() => setSearchQuery("")}>×</button>
          )}
        </div>
      </div>

      <section className="inv-table-wrap">
        <div className="inv-table-header">
          <span className="inv-table-title">{category} — TOTAL ASSETS</span>
          <span className="inv-table-count">{filteredAssets.length} records</span>
        </div>
        <AssetTable
          assets={filteredAssets}
          filter={filter}
          onViewAsset={setDetailAsset}
          hideAssigned={hideAssignedColumnForCategory(category)}
          assignedColumnLabel={assignedLabel}
          inventoryCategory={category}
          inventoryDeploy={inventoryDeploy}
          onOfficeIssue={setOfficeIssueTarget}
          onOfficeReturn={setOfficeReturnTarget}
        />
      </section>

      {detailAsset  && (
        <AssetDetailModal
          asset={detailAsset}
          onClose={() => setDetailAsset(null)}
          onStatusChange={handleStatusChange}
          inventoryCategory={category}
          inventoryDeploy={inventoryDeploy}
          onOfficeIssue={setOfficeIssueTarget}
          onOfficeReturn={setOfficeReturnTarget}
        />
      )}
      {officeIssueTarget && (
        <OfficeIssueModal
          asset={officeIssueTarget}
          inventoryCategory={category}
          onClose={() => setOfficeIssueTarget(null)}
          onSuccess={refresh}
        />
      )}
      {officeReturnTarget && (
        <OfficeReturnModal
          asset={officeReturnTarget}
          inventoryCategory={category}
          onClose={() => setOfficeReturnTarget(null)}
          onSuccess={refresh}
        />
      )}
      {removeTarget && <RemoveAssetModal asset={removeTarget} onConfirm={handleRemoveConfirm} onCancel={() => setRemoveTarget(null)} />}
      {quantityTarget && (
        <QuantityActionModal
          actionTarget={quantityTarget}
          onConfirm={handleQuantityConfirm}
          onCancel={() => setQuantityTarget(null)}
        />
      )}
    </>
  );
}

// ─── OverviewPage ─────────────────────────────────────────────────────────────

function OverviewPage({ category }) {
  const [detailAsset, setDetailAsset] = useState(null);
  const [officeIssueTarget, setOfficeIssueTarget] = useState(null);
  const [officeReturnTarget, setOfficeReturnTarget] = useState(null);
  const [refreshKey,  setRefreshKey]  = useState(0);

  const inventoryDeploy = showInventoryDeploy(category);
  const assignedLabel = getAssignedColumnLabel(category);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const {
    removeTarget,
    setRemoveTarget,
    quantityTarget,
    setQuantityTarget,
    toast,
    handleStatusChange,
    handleRemoveConfirm,
    handleQuantityConfirm,
  } = useAssetActions(refresh);

  const assets = useMemo(() => {
    void refreshKey;
    return getMappedInventory(category)
      .filter((a) => Number(a.total) > 0);
  }, [category, refreshKey]);

  return (
    <>
      {toast && <div className="inv-toast">{toast}</div>}

      <section className="inv-table-wrap">
        <div className="inv-table-header">
          <span className="inv-table-title">{category} — OVERVIEW</span>
          <span className="inv-table-count">{assets.length} records</span>
        </div>
        <AssetTable
          assets={assets}
          filter="All"
          onViewAsset={setDetailAsset}
          hideAssigned={hideAssignedColumnForCategory(category)}
          assignedColumnLabel={assignedLabel}
          inventoryCategory={category}
          inventoryDeploy={inventoryDeploy}
          onOfficeIssue={setOfficeIssueTarget}
          onOfficeReturn={setOfficeReturnTarget}
        />
      </section>

      {detailAsset  && (
        <AssetDetailModal
          asset={detailAsset}
          onClose={() => setDetailAsset(null)}
          onStatusChange={handleStatusChange}
          inventoryCategory={category}
          inventoryDeploy={inventoryDeploy}
          onOfficeIssue={setOfficeIssueTarget}
          onOfficeReturn={setOfficeReturnTarget}
        />
      )}
      {officeIssueTarget && (
        <OfficeIssueModal
          asset={officeIssueTarget}
          inventoryCategory={category}
          onClose={() => setOfficeIssueTarget(null)}
          onSuccess={refresh}
        />
      )}
      {officeReturnTarget && (
        <OfficeReturnModal
          asset={officeReturnTarget}
          inventoryCategory={category}
          onClose={() => setOfficeReturnTarget(null)}
          onSuccess={refresh}
        />
      )}
      {removeTarget && <RemoveAssetModal asset={removeTarget} onConfirm={handleRemoveConfirm} onCancel={() => setRemoveTarget(null)} />}
      {quantityTarget && (
        <QuantityActionModal
          actionTarget={quantityTarget}
          onConfirm={handleQuantityConfirm}
          onCancel={() => setQuantityTarget(null)}
        />
      )}
    </>
  );
}

// ─── InventoryRoot + default export ──────────────────────────────────────────

function InventoryRoot() {
  const [searchParams, setSearchParams] = useSearchParams();
  const catParam = searchParams.get("cat");
  const [category, setCategoryState] = useState(
    isValidInventoryCategory(catParam) ? catParam : "IT Assets",
  );
  const location  = useLocation();
  const segment   = location.pathname.replace(BASE, "").replace(/^\//, "");

  useEffect(() => {
    if (isValidInventoryCategory(catParam)) setCategoryState(catParam);
  }, [catParam]);

  const setCategory = useCallback((cat) => {
    setCategoryState(cat);
    setSearchParams({ cat }, { replace: true });
  }, [setSearchParams]);

  return (
    <InventoryShell category={category} setCategory={setCategory} activeSegment={segment}>
      <Routes>
        <Route path="/"              element={<OverviewPage    category={category} />} />
        <Route path="total"          element={<TotalAssetsPage category={category} />} />
        <Route path="not-working"    element={<NotWorking inventoryCategory={category} />} />
        <Route path="in-repair"      element={<InRepair inventoryCategory={category} />} />
        <Route path="removed-it"     element={<RemovedITAssets />} />
        <Route path="removed-assets" element={<RemovedAssets inventoryCategory={category} />} />
      </Routes>
    </InventoryShell>
  );
}

const InventoryDashboard = () => (
  <Routes>
    <Route path="add-assets"   element={<AddNewAssets />} />
    <Route path="parcels"      element={<Parcel />} />
    <Route path="add-import"   element={<AddImported />} />
    <Route path="ready-export" element={<ReadyExport />} />
    <Route path="/*"           element={<InventoryRoot />} />
  </Routes>
);

export default InventoryDashboard;
// // InventoryDashboard.jsx
// import { useState, useRef, useEffect, useCallback, useMemo } from "react";
// import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
// import "./InventoryDashboard.css";

// import {
//   getInventoryFromStorage,
//   saveInventoryToStorage,
//   getAssetUnitsFromStorage,
//   saveAssetUnitsToStorage,
//   notifyInventoryChange,
//   logDeletedAsset,
//   getInventoryCounts,
// } from "../Data";

// import AddNewAssets    from "./AddnewAssets";
// import NotWorking      from "./NotWorking";
// import InRepair        from "./InRepair";
// import RemovedAssets   from "./RemovedAssets";
// import RemovedITAssets from "./RemovedITAssets";
// import Parcel          from "./Parcel/ParcelDashboard";
// import AddImported     from "./Parcel/AddImportedAssets";
// import ReadyExport     from "./Parcel/ExportedAssets";

// // ─── Constants ────────────────────────────────────────────────────────────────

// const BASE           = "/it/inventory";
// const REMOVED_IT_KEY = "removedITAssets";

// const INV_CATEGORIES = [
//   "IT Assets",
//   "Office Assets",
//   "Transport Assets",
//   "Infrastructure Assets",
// ];

// const SUMMARY_CARDS = [
//   { label: "Total Assets",    segment: "total",          color: "#3b82f6" },
//   { label: "Not Working",     segment: "not-working",    color: "#ef4444" },
//   { label: "In Repair",       segment: "in-repair",      color: "#f59e0b" },
//   { label: "Removed From IT", segment: "removed-it",     color: "#06b6d4" },
//   { label: "Removed Assets",  segment: "removed-assets", color: "#64748b" },
// ];

// const FILTER_OPTIONS = ["All", "Available", "Assigned"];

// const EDIT_OPTIONS = [
//   { key: "repair",     label: "Repair",     icon: "🔧", color: "#d97706", hoverBg: "#fef3c7", bg: "#fffbeb", borderColor: "#d97706" },
//   { key: "notWorking", label: "Not Working", icon: "⚠️",  color: "#ef4444", hoverBg: "#fee2e2", bg: "#fef2f2", borderColor: "#ef4444" },
//   { key: "removed",   label: "Remove",     icon: "🗑️",  color: "#64748b", hoverBg: "#f1f5f9", bg: "#f8fafc", borderColor: "#94a3b8" },
// ];

// // ─── Pure helpers ─────────────────────────────────────────────────────────────

// const formatDate = (iso) => {
//   if (!iso) return "—";
//   const d = new Date(iso);
//   return isNaN(d) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
// };

// const isSoftware = (item) =>
//   (item?.category ?? "").trim().toLowerCase() === "software";

// const readInventory  = () => getInventoryFromStorage() ?? [];
// const writeInventory = (data) => saveInventoryToStorage(data);
// const readUnits      = () => getAssetUnitsFromStorage() ?? [];
// const writeUnits     = (data) => saveAssetUnitsToStorage(data);

// function dispatchInventoryUpdate() {
//   try { window.dispatchEvent(new Event("inventory-updated")); } catch { /* no-op */ }
// }

// function readRemovedITCount() {
//   try { return (JSON.parse(localStorage.getItem(REMOVED_IT_KEY) ?? "[]")).length; }
//   catch { return 0; }
// }

// function readLiveCounts() {
//   const counts = getInventoryCounts();

//   // Total = available + assigned + notWorking + inRepair (excludes removed assets)
//   const hardwareItems = readInventory().filter((i) => !isSoftware(i));
//   const totalActive = hardwareItems.reduce((sum, i) => {
//     return (
//       sum +
//       (Number(i.availableQuantity)  || 0) +
//       (Number(i.assignedQuantity)   || 0) +
//       (Number(i.notWorkingQuantity) || 0) +
//       (Number(i.repairQuantity)     || 0)
//     );
//   }, 0);

//   return {
//     total:            Math.max(0, totalActive),
//     "not-working":    counts.notWorking    || 0,
//     "in-repair":      counts.inRepair      || 0,
//     "removed-assets": counts.removedAssets || 0,
//     "removed-it":     readRemovedITCount(),
//   };
// }

// function mapInventoryItem(item) {
//   return {
//     id:                item.id,
//     name:              item.name,
//     hwType:            item.hwType             ?? null,
//     total:             Number(item.totalQuantity)     || 0,
//     available:         Number(item.availableQuantity) || 0,
//     inventoryCategory: item.inventoryCategory         || "IT Assets",
//     assigned:          Number(item.assignedQuantity)  || 0,
//     notWorking:        Number(item.notWorkingQuantity) || 0,
//     inRepair:          Number(item.repairQuantity)     || 0,
//     brand:             item.brand        || "—",
//     make:              item.make         || "—",
//     model:             item.model        || "—",
//     serialNumber:      item.serialNumber || "—",
//     category:          item.category     || "—",
//     purchaseDate:      item.purchaseDate || null,
//     location:          item.location     || "—",
//   };
// }

// function getMappedInventory() {
//   return readInventory().filter((i) => !isSoftware(i)).map(mapInventoryItem);
// }

// function getUnitsForAsset(inventoryId, assetName, hwType) {
//   const all = readUnits();

//   // 1️⃣ Best match: by inventoryId (unique per brand+hwType combo)
//   const byId = all.filter((u) => String(u.inventoryId) === String(inventoryId));
//   if (byId.length > 0) return byId;

//   // 2️⃣ Fallback for legacy data: match by name AND hwType so Apple Mobile ≠ Apple Laptop
//   if (hwType) {
//     const byNameAndType = all.filter(
//       (u) =>
//         (u.assetName === assetName || u.name === assetName) &&
//         (u.hwType ?? "").toLowerCase() === hwType.toLowerCase(),
//     );
//     if (byNameAndType.length > 0) return byNameAndType;
//   }

//   // 3️⃣ Last resort: name only (old data with no hwType stored on unit)
//   return all.filter((u) => u.assetName === assetName || u.name === assetName);
// }

// function safeLogDeletedAsset(asset, deletedBy, reason) {
//   try { logDeletedAsset(asset, deletedBy, reason); }
//   catch (err) { console.error("[InventoryDashboard] logDeletedAsset failed:", err); }
// }

// function applyInventoryCountMutation(item, actionKey) {
//   if (actionKey === "repair") {
//     item.repairQuantity    = (Number(item.repairQuantity)    || 0) + 1;
//     item.availableQuantity = Math.max(0, (Number(item.availableQuantity) || 0) - 1);
//   } else if (actionKey === "notWorking") {
//     item.notWorkingQuantity = (Number(item.notWorkingQuantity) || 0) + 1;
//     item.availableQuantity  = Math.max(0, (Number(item.availableQuantity) || 0) - 1);
//   } else if (actionKey === "removed") {
//     item.totalQuantity      = Math.max(0, (Number(item.totalQuantity)     || 0) - 1);
//     item.availableQuantity  = Math.max(0, (Number(item.availableQuantity) || 0) - 1);
//   }
// }

// function updateInventoryCounts(row, actionKey) {
//   const inventory = readInventory();
//   const index     = inventory.findIndex((i) => String(i.id) === String(row.id));
//   if (index < 0) { notifyInventoryChange(); return; }

//   const item = { ...inventory[index] };
//   applyInventoryCountMutation(item, actionKey);

//   if (actionKey === "removed" && Number(item.totalQuantity) <= 0) {
//     writeInventory(inventory.filter((_, i) => i !== index));
//   } else {
//     inventory[index] = item;
//     writeInventory(inventory);
//   }
//   notifyInventoryChange();
// }

// function buildSyntheticUnit(row, status) {
//   const clean = (val) => (val && val !== "—" ? val : "");
//   return {
//     id:           `synth-unit-${row.id}`,
//     inventoryId:  String(row.id),
//     assetName:    row.name,
//     brand:        clean(row.brand)        || row.name,
//     model:        clean(row.model),
//     category:     clean(row.category)     || "Hardware",
//     serialNumber: clean(row.serialNumber),
//     location:     clean(row.location),
//     purchaseDate: row.purchaseDate ?? null,
//     status,
//     repairDate:   status === "repair" ? new Date().toISOString() : null,
//   };
// }

// function findUnitIndex(all, row) {
//   const byId = all.findIndex(
//     (u) =>
//       String(u.inventoryId) === String(row.id) ||
//       u.id === `synth-unit-${row.id}`,
//   );
//   if (byId >= 0) return byId;
//   return all.findIndex((u) => u.assetName === row.name || u.name === row.name);
// }

// // ─── RemoveAssetModal ─────────────────────────────────────────────────────────

// function RemoveAssetModal({ asset, onConfirm, onCancel }) {
//   const [removedBy, setRemovedBy] = useState("");
//   const [reason,    setReason]    = useState("");
//   const [errors,    setErrors]    = useState({});

//   const handleSubmit = () => {
//     const nextErrors = {};
//     if (!removedBy.trim()) nextErrors.removedBy = "Required";
//     if (!reason.trim())    nextErrors.reason    = "Required";
//     if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
//     onConfirm(removedBy.trim(), reason.trim());
//   };

//   return (
//     <div className="inv-modal-backdrop" onClick={onCancel}>
//       <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
//         <div className="inv-modal-hero">
//           <p className="inv-modal-hero-label">Asset Action</p>
//           <h2 className="inv-modal-hero-title">Remove Asset</h2>
//           <p className="inv-modal-hero-sub">{asset?.name}</p>
//         </div>
//         <div className="inv-modal-body">
//           <p className="inv-modal-hint">
//             This asset will be moved to <strong>Removed Assets</strong>. Please fill in the details below.
//           </p>

//           <div className="inv-modal-field">
//             <label className="inv-modal-label">Removed By <span className="req">*</span></label>
//             <input
//               className={`inv-modal-input${errors.removedBy ? " err" : ""}`}
//               value={removedBy}
//               onChange={(e) => setRemovedBy(e.target.value)}
//               placeholder="Enter your name"
//             />
//             {errors.removedBy && <span className="inv-modal-err">{errors.removedBy}</span>}
//           </div>

//           <div className="inv-modal-field">
//             <label className="inv-modal-label">Reason for Removal <span className="req">*</span></label>
//             <textarea
//               className={`inv-modal-textarea${errors.reason ? " err" : ""}`}
//               value={reason}
//               onChange={(e) => setReason(e.target.value)}
//               placeholder="Explain why this asset is being removed..."
//               rows={3}
//             />
//             {errors.reason && <span className="inv-modal-err">{errors.reason}</span>}
//           </div>

//           <div className="inv-modal-actions">
//             <button className="inv-modal-btn-confirm" onClick={handleSubmit}>Confirm Remove</button>
//             <button className="inv-modal-btn-cancel"  onClick={onCancel}>Cancel</button>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }

// // ─── EditDropdown ─────────────────────────────────────────────────────────────

// function EditDropdown({ row, onStatusChange }) {
//   const [isOpen, setIsOpen] = useState(false);
//   const wrapRef             = useRef(null);
//   const isDisabled          = (row.available || 0) === 0;

//   useEffect(() => {
//     if (!isOpen) return;
//     const handleOutsideClick = (e) => {
//       if (wrapRef.current && !wrapRef.current.contains(e.target)) setIsOpen(false);
//     };
//     document.addEventListener("mousedown", handleOutsideClick);
//     return () => document.removeEventListener("mousedown", handleOutsideClick);
//   }, [isOpen]);

//   if (isDisabled) {
//     return (
//       <span className="inv-edit-dropdown-wrap">
//         <button
//           className="inv-action-btn-edit"
//           disabled
//           title="All units are assigned — make a unit available before changing status"
//         >
//           Edit ▾
//         </button>
//       </span>
//     );
//   }

//   if (isOpen) {
//     return (
//       <span ref={wrapRef} className="inv-inline-actions">
//         {EDIT_OPTIONS.map((opt, i) => (
//           <button
//             key={opt.key}
//             className="inv-inline-action-btn"
//             style={{
//               color:       opt.color,
//               borderColor: opt.borderColor,
//               background:  opt.bg,
//               borderLeft:  i === 0 ? `1px solid ${opt.borderColor}` : "none",
//               borderRadius:
//                 i === 0 ? "6px 0 0 6px"
//                 : i === EDIT_OPTIONS.length - 1 ? "0 6px 6px 0"
//                 : "0",
//             }}
//             onClick={() => { setIsOpen(false); onStatusChange(row, opt.key); }}
//             onMouseEnter={(e) => (e.currentTarget.style.background = opt.hoverBg)}
//             onMouseLeave={(e) => (e.currentTarget.style.background = opt.bg)}
//           >
//             <span style={{ fontSize: 13 }}>{opt.icon}</span>
//             {opt.label}
//           </button>
//         ))}
//         <button className="inv-inline-cancel-btn" onClick={() => setIsOpen(false)} title="Cancel">
//           ✕
//         </button>
//       </span>
//     );
//   }

//   return (
//     <span ref={wrapRef} className="inv-edit-dropdown-wrap">
//       <button className="inv-action-btn-edit" onClick={() => setIsOpen(true)}>Edit ▾</button>
//     </span>
//   );
// }

// // ─── PhotoLightbox ────────────────────────────────────────────────────────────

// function PhotoLightbox({ photos, startIndex, onClose }) {
//   const [currentIndex, setCurrentIndex] = useState(startIndex);

//   const goToPrev = (e) => {
//     e.stopPropagation();
//     setCurrentIndex((i) => (i - 1 + photos.length) % photos.length);
//   };
//   const goToNext = (e) => {
//     e.stopPropagation();
//     setCurrentIndex((i) => (i + 1) % photos.length);
//   };

//   return (
//     <div className="inv-lightbox" onClick={onClose}>
//       <button className="inv-lightbox-close" onClick={onClose}>×</button>
//       {photos.length > 1 && (
//         <button className="inv-lightbox-prev" onClick={goToPrev}>‹</button>
//       )}
//       <div className="inv-lightbox-img-wrap" onClick={(e) => e.stopPropagation()}>
//         <img src={photos[currentIndex]} alt="" />
//         {photos.length > 1 && (
//           <div className="inv-lightbox-counter">
//             {currentIndex + 1} / {photos.length}
//           </div>
//         )}
//       </div>
//       {photos.length > 1 && (
//         <button className="inv-lightbox-next" onClick={goToNext}>›</button>
//       )}
//     </div>
//   );
// }

// // ─── AssetDetailModal ─────────────────────────────────────────────────────────

// function AssetDetailModal({ asset, onClose }) {
//   const [selectedUnitIndex, setSelectedUnitIndex] = useState(0);
//   const [lightboxStartIdx,  setLightboxStartIdx]  = useState(null);

//   const units  = getUnitsForAsset(asset.id, asset.name, asset.hwType);
//   const unit   = units[selectedUnitIndex] ?? null;
//   const photos = unit?.photos ?? unit?.assignmentPhotos ?? [];

//   const detailFields = [
//     { label: "Asset ID",   value: unit?.assetId ?? unit?.id ?? "—", mono: true,  highlight: true  },
//     { label: "Brand",      value: unit?.brand              ?? "—",  mono: false, highlight: false },
//     { label: "Make",       value: unit?.make               ?? "—",  mono: false, highlight: false },
//     { label: "Serial No.", value: unit?.serialNumber       ?? "—",  mono: true,  highlight: false },
//   ];

//   return (
//     <>
//       <div className="inv-detail-backdrop" onClick={onClose}>
//         <div className="inv-detail-box" onClick={(e) => e.stopPropagation()}>

//           <div className="inv-detail-hero">
//             <div>
//               <p className="inv-detail-hero-label">Asset Details</p>
//               <h2 className="inv-detail-hero-title">{asset.name}</h2>
//               <div className="inv-detail-hero-badges">
//                 <span className="inv-detail-badge inv-detail-badge--cat">{asset.inventoryCategory}</span>
//                 <span className="inv-detail-badge inv-detail-badge--units">
//                   {units.length} unit{units.length !== 1 ? "s" : ""}
//                 </span>
//               </div>
//             </div>
//             <button className="inv-detail-close-btn" onClick={onClose}>×</button>
//           </div>

//           {units.length > 1 && (
//             <div className="inv-unit-tabs">
//               <span className="inv-unit-label">Unit:</span>
//               {units.map((u, i) => (
//                 <button
//                   key={u.assetId ?? i}
//                   className={`inv-unit-tab${selectedUnitIndex === i ? " inv-unit-tab--active" : ""}`}
//                   onClick={() => setSelectedUnitIndex(i)}
//                 >
//                   #{u.assetTag ?? u.assetId ?? i + 1}
//                 </button>
//               ))}
//             </div>
//           )}

//           <div className="inv-detail-body">
//             {units.length === 0 ? (
//               <div className="inv-detail-empty">
//                 <div className="inv-detail-empty-icon">📦</div>
//                 <p className="inv-detail-empty-title">No unit records found</p>
//                 <p className="inv-detail-empty-sub">Individual units added via Add Assets will appear here</p>
//               </div>
//             ) : (
//               <>
//                 <div className="inv-detail-fields">
//                   {detailFields.map(({ label, value, mono, highlight }, idx) => (
//                     <div
//                       key={label}
//                       className={[
//                         "inv-detail-field-row",
//                         highlight ? "inv-detail-field-row--highlight"
//                           : idx % 2 !== 0 ? "inv-detail-field-row--alt"
//                           : "",
//                       ].filter(Boolean).join(" ")}
//                     >
//                       <span className="inv-detail-field-label">{label}</span>
//                       <span
//                         className={[
//                           "inv-detail-field-value",
//                           highlight ? "inv-detail-field-value--highlight" : "",
//                           mono      ? "inv-detail-field-value--mono"      : "",
//                         ].filter(Boolean).join(" ")}
//                       >
//                         {value}
//                       </span>
//                     </div>
//                   ))}
//                 </div>

//                 <div>
//                   <p className="inv-photos-label">
//                     Photos {photos.length > 0 ? `(${photos.length})` : ""}
//                   </p>
//                   {photos.length === 0 ? (
//                     <div className="inv-photos-empty">
//                       <div className="inv-photos-empty-icon">📷</div>
//                       <p className="inv-photos-empty-text">No photos available</p>
//                     </div>
//                   ) : (
//                     <>
//                       <div className="inv-photo-main" onClick={() => setLightboxStartIdx(0)}>
//                         <img src={photos[0]} alt="asset" />
//                         {photos.length > 1 && (
//                           <span className="inv-photo-more-badge">+{photos.length - 1} more</span>
//                         )}
//                       </div>
//                       {photos.length > 1 && (
//                         <div className="inv-photo-strip">
//                           {photos.map((src, i) => (
//                             <img
//                               key={i}
//                               src={src}
//                               alt=""
//                               className="inv-photo-thumb"
//                               onClick={() => setLightboxStartIdx(i)}
//                             />
//                           ))}
//                         </div>
//                       )}
//                     </>
//                   )}
//                 </div>
//               </>
//             )}
//           </div>

//           <div className="inv-detail-footer">
//             <button className="inv-detail-footer-btn" onClick={onClose}>Close</button>
//           </div>
//         </div>
//       </div>

//       {lightboxStartIdx !== null && (
//         <PhotoLightbox
//           photos={photos}
//           startIndex={lightboxStartIdx}
//           onClose={() => setLightboxStartIdx(null)}
//         />
//       )}
//     </>
//   );
// }

// // ─── useAssetActions hook ─────────────────────────────────────────────────────

// function useAssetActions(onRefresh) {
//   const [removeTarget, setRemoveTarget] = useState(null);
//   const [toast,        setToast]        = useState("");

//   const showToast = useCallback((msg) => {
//     setToast(msg);
//     setTimeout(() => setToast(""), 2_800);
//   }, []);

//   const handleStatusChange = useCallback((row, actionKey) => {
//     if (actionKey === "removed") { setRemoveTarget(row); return; }

//     const targetStatus = actionKey === "repair" ? "repair" : "notWorking";
//     const all          = readUnits();
//     const matchIdx     = findUnitIndex(all, row);

//     if (matchIdx >= 0) {
//       all[matchIdx] = {
//         ...all[matchIdx],
//         status:     targetStatus,
//         repairDate:
//           targetStatus === "repair"
//             ? all[matchIdx].repairDate ?? new Date().toISOString()
//             : all[matchIdx].repairDate,
//       };
//       writeUnits(all);
//     } else {
//       console.debug("[InventoryDashboard] No unit found, building synthetic:", row.id);
//       writeUnits([...all, buildSyntheticUnit(row, targetStatus)]);
//     }

//     updateInventoryCounts(row, actionKey);
//     showToast(
//       actionKey === "repair"
//         ? `✅ "${row.name}" sent to Repair`
//         : `⚠️ "${row.name}" marked as Not Working`,
//     );
//     dispatchInventoryUpdate();
//     onRefresh();
//   }, [onRefresh, showToast]);

//   const handleRemoveConfirm = useCallback((removedBy, reason) => {
//     if (!removeTarget) return;

//     const all      = readUnits();
//     const matchIdx = findUnitIndex(all, removeTarget);

//     if (matchIdx >= 0) {
//       const unit = all[matchIdx];
//       safeLogDeletedAsset(
//         {
//           ...unit,
//           assetName: unit.assetName || removeTarget.name,
//           brand:     unit.brand     || removeTarget.name,
//           category:  unit.category  || removeTarget.inventoryCategory || "Hardware",
//         },
//         removedBy,
//         reason,
//       );
//       writeUnits(all.filter((_, i) => i !== matchIdx));
//     } else {
//       safeLogDeletedAsset(
//         {
//           assetName: removeTarget.name, brand: removeTarget.name,
//           model: "", category: removeTarget.inventoryCategory || "Hardware",
//           serialNumber: "", id: removeTarget.id,
//         },
//         removedBy,
//         reason,
//       );
//     }

//     updateInventoryCounts(removeTarget, "removed");
//     showToast(`🗑️ "${removeTarget.name}" moved to Removed Assets`);
//     setRemoveTarget(null);
//     dispatchInventoryUpdate();
//     onRefresh();
//   }, [removeTarget, onRefresh, showToast]);

//   return { removeTarget, setRemoveTarget, toast, handleStatusChange, handleRemoveConfirm };
// }

// // ─── InventoryShell ───────────────────────────────────────────────────────────

// export function InventoryShell({ children, category, setCategory, activeSegment }) {
//   const navigate  = useNavigate();
//   const headerRef = useRef(null);
//   const navRef    = useRef(null);

//   const [stickyTop, setStickyTop] = useState(0);
//   const [counts,    setCounts]    = useState(readLiveCounts);

//   useEffect(() => {
//     const measure = () => {
//       const headerH = headerRef.current?.offsetHeight ?? 0;
//       const navH    = navRef.current?.offsetHeight    ?? 0;
//       setStickyTop(headerH + navH);
//     };
//     measure();
//     window.addEventListener("resize", measure);
//     return () => window.removeEventListener("resize", measure);
//   }, []);

//   useEffect(() => {
//     const update = () => setCounts(readLiveCounts());
//     window.addEventListener("inventory-updated", update);
//     window.addEventListener("storage",           update);
//     return () => {
//       window.removeEventListener("inventory-updated", update);
//       window.removeEventListener("storage",           update);
//     };
//   }, []);

//   const visibleCards = useMemo(
//     () => SUMMARY_CARDS.filter(
//       (c) => !(c.segment === "removed-it" && category !== "IT Assets"),
//     ),
//     [category],
//   );

//   return (
//     <div className="inv-root">
//       <header className="inv-header" ref={headerRef}>
//         <div className="inv-header-left">
//           <button className="inv-back-btn" onClick={() => navigate("/it/")}>← Back</button>
//           <div className="inv-logo-group">
//             <div className="inv-logo">
//               <span className="inv-logo-dot" />
//               <span className="inv-logo-text">INVENTORY</span>
//             </div>
//             <span className="inv-header-sub">Asset Management System</span>
//           </div>
//         </div>
//         <div className="inv-header-right">
//           <button className="inv-btn-outline" onClick={() => navigate(`${BASE}/parcels`)}>📦 Parcels</button>
//           <button className="inv-btn-primary" onClick={() => navigate(`${BASE}/add-assets`)}>+ Add Assets</button>
//         </div>
//       </header>

//       <nav className="inv-tab-bar" ref={navRef}>
//         {INV_CATEGORIES.map((cat) => (
//           <button
//             key={cat}
//             className={category === cat ? "inv-tab--active" : "inv-tab"}
//             onClick={() => { setCategory(cat); navigate(BASE); }}
//           >
//             {cat}
//           </button>
//         ))}
//       </nav>

//       <section className="inv-cards-grid inv-cards-grid--sticky" style={{ top: stickyTop }}>
//         {visibleCards.map((card) => {
//           const isActive = activeSegment === card.segment;
//           const count    = counts[card.segment] ?? 0;
//           return (
//             <button
//               key={card.segment}
//               className="inv-card"
//               style={{
//                 borderColor: isActive ? card.color : "#e2e8f0",
//                 boxShadow:   isActive ? `0 4px 14px ${card.color}33` : "none",
//               }}
//               onClick={() => navigate(`${BASE}/${card.segment}`)}
//             >
//               <span className="inv-card-label">{card.label}</span>
//               <span
//                 className="inv-card-count"
//                 style={{ color: count === 0 ? "#94a3b8" : isActive ? card.color : "#0f172a" }}
//               >
//                 {count}
//               </span>
//               <div className="inv-card-bar" style={{ background: card.color }} />
//             </button>
//           );
//         })}
//       </section>

//       {children}
//     </div>
//   );
// }

// // ─── Shared AssetTable ────────────────────────────────────────────────────────

// function AssetTable({ assets, filter, onViewAsset, onStatusChange }) {
//   const showAvailable = filter !== "Assigned";
//   const showAssigned  = filter !== "Available";
//   const emptyColSpan  = 4 + (showAvailable ? 1 : 0) + (showAssigned ? 1 : 0);

//   return (
//     <div className="inv-table-scroll">
//       <table className="inv-table">
//         <thead>
//           <tr>
//             <th>Assets Name</th>
//             <th>Total Qty</th>
//             {showAvailable && <th>Available</th>}
//             <th>Category</th>
//             {showAssigned  && <th>Assigned</th>}
//             <th>Action</th>
//           </tr>
//         </thead>
//         <tbody>
//           {assets.length === 0 ? (
//             <tr>
//               <td colSpan={emptyColSpan} className="inv-empty-row">No assets found.</td>
//             </tr>
//           ) : (
//             assets.map((row, i) => (
//               <tr key={row.id} className={i % 2 === 0 ? "tr-even" : "tr-odd"}>
//                 <td className="td-name">
//                   {row.hwType ? (
//                     <div className="td-name-wrap">
//                       <span className="td-name-brand">{row.name}</span>
//                       <span className="td-name-sub">{row.hwType}</span>
//                     </div>
//                   ) : (
//                     <span className="td-name-brand">{row.name}</span>
//                   )}
//                 </td>
//                 <td>{row.total}</td>
//                 {showAvailable && <td className="td-available">{row.available}</td>}
//                 <td><span className="inv-category-badge">{row.inventoryCategory}</span></td>
//                 {showAssigned  && <td className="td-assigned">{row.assigned}</td>}
//                 <td>
//                   <button className="inv-action-btn" onClick={() => onViewAsset(row)}>View</button>
//                   <EditDropdown row={row} onStatusChange={onStatusChange} />
//                 </td>
//               </tr>
//             ))
//           )}
//         </tbody>
//       </table>
//     </div>
//   );
// }

// // ─── TotalAssetsPage ──────────────────────────────────────────────────────────

// function TotalAssetsPage({ category }) {
//   const [filter,        setFilter]        = useState("All");
//   const [hwTypeFilter,  setHwTypeFilter]  = useState("All");
//   const [searchQuery,   setSearchQuery]   = useState("");
//   const [detailAsset,   setDetailAsset]   = useState(null);
//   const [refreshKey,    setRefreshKey]    = useState(0);

//   const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
//   const { removeTarget, setRemoveTarget, toast, handleStatusChange, handleRemoveConfirm } =
//     useAssetActions(refresh);

//   // Base list for this category (unfiltered by status) — used for per-pill counts
//   const baseAssets = useMemo(() => {
//     void refreshKey;
//     return getMappedInventory().filter((a) => a.inventoryCategory === category);
//   }, [category, refreshKey]);

//   // Per-filter counts shown on the pills
//   const filterCounts = useMemo(() => ({
//     All:       baseAssets.length,
//     Available: baseAssets.filter((a) => a.available > 0).length,
//     Assigned:  baseAssets.filter((a) => a.assigned  > 0).length,
//   }), [baseAssets]);

//   const filteredAssets = useMemo(() => {
//     void refreshKey;
//     const q = searchQuery.trim().toLowerCase();
//     return baseAssets
//       .filter((a) => {
//         if (filter === "Available") return a.available > 0;
//         if (filter === "Assigned")  return a.assigned  > 0;
//         return true; // "All" — every asset regardless of status
//       })
//       .filter((a) => {
//         if (hwTypeFilter === "All") return true;
//         return (a.category ?? "").toLowerCase() === hwTypeFilter.toLowerCase();
//       })
//       .filter((a) => {
//         if (!q) return true;
//         return (
//           a.name.toLowerCase().includes(q) ||
//           (a.hwType  ?? "").toLowerCase().includes(q) ||
//           (a.category ?? "").toLowerCase().includes(q)
//         );
//       });
//   }, [baseAssets, filter, hwTypeFilter, searchQuery, refreshKey]);

//   return (
//     <>
//       {toast && <div className="inv-toast">{toast}</div>}

//       <div className="inv-filter-row">
//         <span className="inv-filter-label">Filter:</span>
//         {FILTER_OPTIONS.map((f) => (
//           <button
//             key={f}
//             className={filter === f ? "inv-filter-pill--active" : "inv-filter-pill"}
//             onClick={() => setFilter(f)}
//           >
//             {f}
//             <span className="inv-filter-pill-count">{filterCounts[f] ?? 0}</span>
//           </button>
//         ))}

//         <span className="inv-filter-divider" />

//         <span className="inv-filter-label">Type:</span>
//         <select
//           className="inv-hwtype-dropdown"
//           value={hwTypeFilter}
//           onChange={(e) => setHwTypeFilter(e.target.value)}
//         >
//           {["All", "Hardware", "Consumables", "Accessories"].map((opt) => (
//             <option key={opt} value={opt}>{opt}</option>
//           ))}
//         </select>

//         <div className="inv-search-wrap">
//           <span className="inv-search-icon">🔍</span>
//           <input
//             className="inv-search-input"
//             type="text"
//             placeholder="Search by brand..."
//             value={searchQuery}
//             onChange={(e) => setSearchQuery(e.target.value)}
//           />
//           {searchQuery && (
//             <button className="inv-search-clear" onClick={() => setSearchQuery("")}>×</button>
//           )}
//         </div>
//       </div>

//       <section className="inv-table-wrap">
//         <div className="inv-table-header">
//           <span className="inv-table-title">{category} — TOTAL ASSETS</span>
//           <span className="inv-table-count">{filteredAssets.length} assets</span>
//         </div>
//         <AssetTable
//           assets={filteredAssets}
//           filter={filter}
//           onViewAsset={setDetailAsset}
//           onStatusChange={handleStatusChange}
//         />
//       </section>

//       {detailAsset  && <AssetDetailModal asset={detailAsset}  onClose={() => setDetailAsset(null)} />}
//       {removeTarget && <RemoveAssetModal asset={removeTarget} onConfirm={handleRemoveConfirm} onCancel={() => setRemoveTarget(null)} />}
//     </>
//   );
// }

// // ─── OverviewPage ─────────────────────────────────────────────────────────────

// function OverviewPage({ category }) {
//   const [detailAsset, setDetailAsset] = useState(null);
//   const [refreshKey,  setRefreshKey]  = useState(0);

//   const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
//   const { removeTarget, setRemoveTarget, toast, handleStatusChange, handleRemoveConfirm } =
//     useAssetActions(refresh);

//   const assets = useMemo(() => {
//     void refreshKey;
//     return getMappedInventory().filter((a) => a.inventoryCategory === category);
//   }, [category, refreshKey]);

//   return (
//     <>
//       {toast && <div className="inv-toast">{toast}</div>}

//       <section className="inv-table-wrap">
//         <div className="inv-table-header">
//           <span className="inv-table-title">{category} — OVERVIEW</span>
//           <span className="inv-table-count">{assets.length} records</span>
//         </div>
//         <AssetTable
//           assets={assets}
//           filter="All"
//           onViewAsset={setDetailAsset}
//           onStatusChange={handleStatusChange}
//         />
//       </section>

//       {detailAsset  && <AssetDetailModal asset={detailAsset}  onClose={() => setDetailAsset(null)} />}
//       {removeTarget && <RemoveAssetModal asset={removeTarget} onConfirm={handleRemoveConfirm} onCancel={() => setRemoveTarget(null)} />}
//     </>
//   );
// }

// // ─── InventoryRoot + default export ──────────────────────────────────────────

// function InventoryRoot() {
//   const [category, setCategory] = useState("IT Assets");
//   const location  = useLocation();
//   const segment   = location.pathname.replace(BASE, "").replace(/^\//, "");

//   return (
//     <InventoryShell category={category} setCategory={setCategory} activeSegment={segment}>
//       <Routes>
//         <Route path="/"              element={<OverviewPage    category={category} />} />
//         <Route path="total"          element={<TotalAssetsPage category={category} />} />
//         <Route path="not-working"    element={<NotWorking />} />
//         <Route path="in-repair"      element={<InRepair />} />
//         <Route path="removed-it"     element={<RemovedITAssets />} />
//         <Route path="removed-assets" element={<RemovedAssets />} />
//       </Routes>
//     </InventoryShell>
//   );
// }

// const InventoryDashboard = () => (
//   <Routes>
//     <Route path="add-assets"   element={<AddNewAssets />} />
//     <Route path="parcels"      element={<Parcel />} />
//     <Route path="add-import"   element={<AddImported />} />
//     <Route path="ready-export" element={<ReadyExport />} />
//     <Route path="/*"           element={<InventoryRoot />} />
//   </Routes>
// );

// export default InventoryDashboard;



