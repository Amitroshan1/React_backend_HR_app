
import { useState, useMemo, useCallback, useEffect } from "react";
import {
  getAssetUnitsFromStorage,
  logDeletedAsset,
  deleteHwUnit,
  syncInventoryCount,
} from "../Data";
import "./InventoryDashboard.css";
import "./NotWorking.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATS               = ["All", "Hardware", "Accessories", "Consumables"];
const NOT_WORKING_STATUS = "notWorking";
const SEARCH_FIELDS      = ["brand", "assetName", "serialNumber"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readAssetUnits() {
  try { return JSON.parse(localStorage.getItem("assetUnits") || "[]"); }
  catch { return []; }
}

function writeAssetUnits(units) {
  try { localStorage.setItem("assetUnits", JSON.stringify(units)); }
  catch (err) { console.error("[NotWorking] writeAssetUnits failed:", err); }
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
  return (
    <tr className={index % 2 === 0 ? "tr-even" : "tr-odd"}>
      <td>
        <span className="nw-brand">{unit.brand || unit.assetName}</span>
        {unit.model && <span className="nw-model"> {unit.model}</span>}
      </td>
      <td><span className="inv-category-badge">{unit.category}</span></td>
      <td>
        {unit.serialNumber
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

  useEffect(() => { reload(); }, [reload]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2_500);
  }, []);

  // ── Derived rows ────────────────────────────────────────────────────────────
  const notWorkingUnits = useMemo(
    () => units.filter((u) => u.status === NOT_WORKING_STATUS),
    [units],
  );

  const filteredRows = useMemo(() => {
    let rows = notWorkingUnits;
    if (activeCategory !== "All") rows = rows.filter((u) => u.category === activeCategory);
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      rows = rows.filter((u) =>
        SEARCH_FIELDS.some((field) => (u[field] ?? "").toLowerCase().includes(query)),
      );
    }
    return rows;
  }, [notWorkingUnits, activeCategory, searchQuery]);

  const getCategoryCount = useCallback(
    (cat) => notWorkingUnits.filter((u) => u.category === cat).length,
    [notWorkingUnits],
  );

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleSendToRepair = useCallback((unit) => {
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

    try {
      localStorage.setItem("deletedAssets", JSON.stringify([...readDeletedAssets(), entry]));
    } catch {
      try { logDeletedAsset(removeTarget, deletedBy, reason); } catch { /* no-op */ }
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

