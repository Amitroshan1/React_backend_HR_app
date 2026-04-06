
import { useState, useMemo, useCallback, useEffect } from "react";
import {
  getAssetUnitsFromStorage,
  logDeletedAsset,
  deleteAssetUnit,
  syncInventoryCount,
} from "../Data";
import "./InventoryDashboard.css";
import "./InRepair.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATS          = ["All", "Hardware", "Accessories", "Consumables"];
const REPAIR_STATUS = "repair";
const SEARCH_FIELDS = ["brand", "assetName", "serialNumber"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
      })
    : "—";

const getDaysElapsed = (iso) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0;

const getRepairDaysClass = (days) => {
  if (days > 30) return "overdue";
  if (days > 14) return "warning";
  return "ok";
};

function readAssetUnits() {
  try { return JSON.parse(localStorage.getItem("assetUnits") || "[]"); }
  catch { return []; }
}

function writeAssetUnits(units) {
  try { localStorage.setItem("assetUnits", JSON.stringify(units)); }
  catch (err) { console.error("[InRepair] writeAssetUnits failed:", err); }
}

function readDeletedAssets() {
  try { return JSON.parse(localStorage.getItem("deletedAssets") || "[]"); }
  catch { return []; }
}

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
        <h3 className="repair-modal-title">Remove Asset Permanently?</h3>
        <p className="repair-modal-sub">{displayName}</p>

        <div className="repair-modal-field">
          <label>Removed By *</label>
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
            placeholder="Reason for removal..."
            className={errors.reason ? "err" : ""}
          />
          {errors.reason && <span className="repair-err">{errors.reason}</span>}
        </div>

        <div className="repair-modal-actions">
          <button className="repair-btn-danger" onClick={handleSubmit}>Remove Permanently</button>
          <button className="repair-btn-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── RepairRow ────────────────────────────────────────────────────────────────

function RepairRow({ unit, index, onReturn, onRemove }) {
  const days = getDaysElapsed(unit.repairDate);
  return (
    <tr className={index % 2 === 0 ? "tr-even" : "tr-odd"}>
      <td>
        <span className="repair-brand">{unit.brand || unit.assetName}</span>
        {unit.model && <span className="repair-model"> {unit.model}</span>}
      </td>
      <td><span className="inv-category-badge">{unit.category}</span></td>
      <td>
        {unit.serialNumber
          ? <span className="repair-serial">{unit.serialNumber}</span>
          : "—"}
      </td>
      <td>{formatDate(unit.repairDate)}</td>
      <td>
        <span className={`repair-days ${getRepairDaysClass(days)}`}>{days}d</span>
      </td>
      <td className="repair-actions">
        <button className="repair-btn-return" onClick={() => onReturn(unit)}>Mark Returned</button>
        <button className="repair-btn-remove" onClick={() => onRemove(unit)}>Remove</button>
      </td>
    </tr>
  );
}

// ─── InRepair ─────────────────────────────────────────────────────────────────

export default function InRepair() {
  const [units,        setUnits]        = useState([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery,  setSearchQuery]  = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);
  const [toast,        setToast]        = useState("");

  const reload = useCallback(() => {
    setUnits(getAssetUnitsFromStorage() ?? []);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2_500);
  }, []);

  // ── Derived rows ────────────────────────────────────────────────────────────
  const repairUnits = useMemo(
    () => units.filter((u) => u.status === REPAIR_STATUS),
    [units],
  );

  const filteredRows = useMemo(() => {
    let rows = repairUnits;
    if (activeCategory !== "All") rows = rows.filter((u) => u.category === activeCategory);
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      rows = rows.filter((u) =>
        SEARCH_FIELDS.some((field) => (u[field] ?? "").toLowerCase().includes(query)),
      );
    }
    return rows;
  }, [repairUnits, activeCategory, searchQuery]);

  const getCategoryCount = useCallback(
    (cat) => repairUnits.filter((u) => u.category === cat).length,
    [repairUnits],
  );

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleReturn = useCallback((unit) => {
    const updated = readAssetUnits().map((u) =>
      u.id === unit.id ? { ...u, status: "available", repairDate: null } : u,
    );
    writeAssetUnits(updated);
    syncInventoryCount(unit, "fromRepairToAvailable");
    dispatchInventoryUpdate();
    reload();
    showToast(`${unit.brand || unit.assetName} returned to available ✓`);
  }, [reload, showToast]);

  const handleRemoveConfirm = useCallback((deletedBy, reason) => {
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

    // Write deletion log
    try {
      localStorage.setItem("deletedAssets", JSON.stringify([...readDeletedAssets(), entry]));
    } catch {
      try { logDeletedAsset(removeTarget, deletedBy, reason); } catch { /* no-op */ }
    }

    // Remove unit from active list
    writeAssetUnits(readAssetUnits().filter((u) => u.id !== removeTarget.id));
    try { deleteAssetUnit(removeTarget.id); } catch { /* no-op */ }

    syncInventoryCount(removeTarget, "fromRepairDelete");
    dispatchInventoryUpdate();
    reload();
    setRemoveTarget(null);
    showToast("Asset permanently removed ✓");
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
            {filteredRows.length} asset{filteredRows.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Category Tabs */}
        <div className="repair-tabs">
          {CATS.map((cat) => (
            <button
              key={cat}
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
                <th>Serial No</th>
                <th>Repair Since</th>
                <th>Days in Repair</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={6} className="repair-empty">No assets in repair</td></tr>
              ) : (
                filteredRows.map((unit, i) => (
                  <RepairRow
                    key={unit.id}
                    unit={unit}
                    index={i}
                    onReturn={handleReturn}
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
