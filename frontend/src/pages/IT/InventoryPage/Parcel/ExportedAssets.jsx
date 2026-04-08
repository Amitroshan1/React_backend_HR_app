
import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./ExportedAssets.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const ASSET_CATEGORIES = [
  "IT Assets",
  "Office Assets",
  "Transport Assets",
  "Infrastructure Assets",
];

const BACK_PATH = "/it/inventory/parcels";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const todayStr = () =>
  new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/** Derive a representative emoji from hwType or assetName. */
function getEmoji(unit) {
  const t = (unit.hwType || unit.assetName || "").toLowerCase();
  if (t.includes("laptop"))                                        return "💻";
  if (t.includes("mobile") || t.includes("phone") || t.includes("iphone")) return "📱";
  if (t.includes("tablet") || t.includes("ipad"))                 return "📱";
  if (t.includes("desktop") || t.includes("monitor"))             return "🖥";
  if (t.includes("mouse"))                                         return "🖱";
  if (t.includes("keyboard"))                                      return "⌨";
  if (t.includes("router") || t.includes("access point"))         return "📡";
  if (t.includes("printer") || t.includes("toner") || t.includes("ink")) return "🖨";
  if (t.includes("toyota") || t.includes("hiace") || t.includes("vehicle")) return "🚐";
  if (t.includes("switch") || t.includes("dock") || t.includes("cable")) return "🔌";
  if (t.includes("bag"))                                           return "🎒";
  return "📦";
}

/** Read a single File as a base64 data URL. */
const readAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`Failed to read: ${file.name}`));
    reader.readAsDataURL(file);
  });

/** Read multiple Files as base64 data URLs in parallel. */
const readFilesAsDataURLs = (files) =>
  Promise.all(Array.from(files).map(readAsDataURL));

/** Build the flat list of available assets from localStorage. */
function getAvailableAssetsFromStorage() {
  try {
    const units     = JSON.parse(localStorage.getItem("assetUnits") || "[]");
    const inventory = JSON.parse(localStorage.getItem("inventory")  || "[]");

    const inventoryIdsWithUnits = new Set(
      units.map((u) => String(u.inventoryId)).filter(Boolean)
    );

    const categoryByInvId = {};
    inventory.forEach((inv) => {
      categoryByInvId[String(inv.id)] = inv.inventoryCategory || "IT Assets";
    });

    const fromUnits = units
      .filter((u) => u.status === "available")
      .map((u) => ({
        _source:      "unit",
        id:           u.id,
        inventoryId:  u.inventoryId || null,
        assetName:    u.assetName || u.name || "Unknown",
        category:     categoryByInvId[String(u.inventoryId)] || u.inventoryCategory || "IT Assets",
        serialNo:     u.serialNumber || u.serialNo || "—",
        emoji:        getEmoji(u),
        hwType:       u.hwType       || "",
        brand:        u.brand        || "",
        model:        u.model        || "",
        purchaseDate: u.purchaseDate || null,
      }));

    const fromInventory = inventory
      .filter(
        (inv) =>
          inv.category !== "Software" &&
          !inventoryIdsWithUnits.has(String(inv.id)) &&
          (Number(inv.availableQuantity) || 0) > 0
      )
      .flatMap((inv) => {
        const qty = Number(inv.availableQuantity) || 0;
        return Array.from({ length: qty }, (_, i) => ({
          _source:      "inventory",
          id:           `inv-slot-${inv.id}-${i}`,
          inventoryId:  inv.id,
          assetName:    inv.name || "Unknown",
          category:     inv.inventoryCategory || "IT Assets",
          serialNo:     "—",
          emoji:        getEmoji({ hwType: inv.hwType, assetName: inv.name }),
          hwType:       inv.hwType  || "",
          brand:        inv.brand   || "",
          model:        inv.model   || "",
          purchaseDate: inv.purchaseDate || null,
        }));
      });

    return [...fromUnits, ...fromInventory];
  } catch {
    return [];
  }
}

/** Update assetUnits + inventory in localStorage after an export. */
function commitExport(selectedAssets, destination) {
  try {
    const unitAssets = selectedAssets.filter((a) => a._source === "unit");

    if (unitAssets.length > 0) {
      const exportedUnitIds = new Set(unitAssets.map((a) => a.id));
      const units = JSON.parse(localStorage.getItem("assetUnits") || "[]");
      localStorage.setItem(
        "assetUnits",
        JSON.stringify(
          units.map((u) =>
            exportedUnitIds.has(u.id)
              ? { ...u, status: "exported", exportedTo: destination, exportedAt: new Date().toISOString() }
              : u
          )
        )
      );
    }

    const countByInvId = {};
    selectedAssets.forEach((a) => {
      if (!a.inventoryId) return;
      const key = String(a.inventoryId);
      countByInvId[key] = (countByInvId[key] || 0) + 1;
    });

    const unitInvIds = new Set(
      unitAssets.map((a) => String(a.inventoryId)).filter(Boolean)
    );

    const inventory = JSON.parse(localStorage.getItem("inventory") || "[]");
    localStorage.setItem(
      "inventory",
      JSON.stringify(
        inventory.map((inv) => {
          const delta = countByInvId[String(inv.id)] || 0;
          if (!delta) return inv;
          const isUnitTracked = unitInvIds.has(String(inv.id));
          return {
            ...inv,
            availableQuantity: Math.max(0, (Number(inv.availableQuantity) || 0) - delta),
            totalQuantity: isUnitTracked
              ? Number(inv.totalQuantity) || 0
              : Math.max(0, (Number(inv.totalQuantity) || 0) - delta),
          };
        })
      )
    );

    window.dispatchEvent(new Event("inventory-updated"));
  } catch (e) {
    console.error("[commitExport]:", e);
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ParcelPhotoStrip({ photos, onRemove, onPreviewOpen }) {
  if (!photos.length) return null;
  return (
    <>
      <button type="button" className="re-parcel-preview-btn" onClick={onPreviewOpen}>
        📷 {photos.length} photo{photos.length !== 1 ? "s" : ""} added
      </button>
      <div className="re-parcel-thumbs">
        {photos.slice(0, 4).map((src, i) => (
          <div key={i} className="re-parcel-thumb-wrap">
            <img src={src} alt={`parcel-${i}`} className="re-parcel-thumb" />
            <button
              type="button"
              className="re-parcel-thumb-remove"
              onClick={() => onRemove(i)}
              aria-label="Remove photo"
            >
              ×
            </button>
          </div>
        ))}
        {photos.length > 4 && (
          <div className="re-parcel-thumb-more">+{photos.length - 4}</div>
        )}
      </div>
    </>
  );
}

function PhotoPreviewModal({ photos, onRemove, onClose }) {
  return (
    <div className="re-photo-preview-backdrop" onClick={onClose}>
      <div className="re-photo-preview-box" onClick={(e) => e.stopPropagation()}>
        <div className="re-photo-preview-head">
          <span>Parcel Photos ({photos.length})</span>
          <button type="button" onClick={onClose} aria-label="Close preview">✕</button>
        </div>
        <div className="re-photo-preview-grid">
          {photos.map((src, i) => (
            <div key={i} className="re-photo-preview-item">
              <img src={src} alt={`preview-${i}`} />
              <button
                type="button"
                onClick={() => {
                  onRemove(i);
                  if (photos.length === 1) onClose();
                }}
                aria-label="Remove photo"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModalAssetRow({ asset, individualPhoto }) {
  return (
    <div className="re-modal-asset-row">
      <div className="re-modal-asset-thumb">
        {individualPhoto
          ? <img src={individualPhoto} alt={asset.serialNo} className="re-modal-thumb-img" />
          : <span className="re-modal-thumb-emoji">{asset.emoji}</span>
        }
      </div>
      <div className="re-modal-asset-info">
        <span className="re-modal-asset-name">{asset.assetName}</span>
        <span className="re-modal-asset-sn">{asset.serialNo}</span>
      </div>
      {individualPhoto && <span className="re-modal-indiv-badge">📷 Photo</span>}
    </div>
  );
}

/** Export confirmation modal — includes Exported By field. */
function ExportModal({ selectedAssets, individualPhotos, onSend, onCancel }) {
  const [destination,      setDestination]      = useState("");
  const [destinationError, setDestinationError] = useState("");
  const [exportedBy,       setExportedBy]       = useState("");
  const [exportedByError,  setExportedByError]  = useState("");
  const [idNo,             setIdNo]             = useState("");
  const [parcelPhotos,     setParcelPhotos]     = useState([]);
  const [isPreviewOpen,    setIsPreviewOpen]    = useState(false);

  const handlePhotoUpload = useCallback(async (files) => {
    if (!files?.length) return;
    try {
      const results = await readFilesAsDataURLs(files);
      setParcelPhotos((prev) => [...prev, ...results]);
    } catch (e) {
      console.error("[ExportModal] Photo upload failed:", e);
    }
  }, []);

  const removeParcelPhoto = (index) =>
    setParcelPhotos((prev) => prev.filter((_, i) => i !== index));

  const handleSend = () => {
    let valid = true;
    if (!destination.trim()) { setDestinationError("Destination is required"); valid = false; }
    if (!exportedBy.trim())  { setExportedByError("Exported By is required");  valid = false; }
    if (!valid) return;
    onSend(destination.trim(), parcelPhotos, idNo.trim(), exportedBy.trim());
  };

  return (
    <div className="re-modal-backdrop" onClick={onCancel}>
      <div className="re-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="re-modal-head">
          <div>
            <h3 className="re-modal-title">Export Assets</h3>
            <p className="re-modal-sub">
              {selectedAssets.length} asset{selectedAssets.length !== 1 ? "s" : ""} ready to ship
            </p>
          </div>
          <button type="button" className="re-modal-close" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="re-modal-body">
          {/* Asset summary list */}
          <div className="re-modal-section-label">Assets in this parcel</div>
          <div className="re-modal-assets-list">
            {selectedAssets.map((a) => (
              <ModalAssetRow
                key={a.id}
                asset={a}
                individualPhoto={individualPhotos[a.id]}
              />
            ))}
          </div>

          {/* Destination */}
          <div className="re-modal-field">
            <label className="re-modal-label">
              Send To <span className="req">*</span>
            </label>
            <input
              className={`re-modal-input${destinationError ? " err" : ""}`}
              placeholder="e.g. Branch Office — Pune / Client Name / Site"
              value={destination}
              autoFocus
              onChange={(e) => { setDestination(e.target.value); setDestinationError(""); }}
            />
            {destinationError && <span className="re-modal-err">{destinationError}</span>}
          </div>

          {/* Exported By */}
          <div className="re-modal-field">
            <label className="re-modal-label">
              Exported By <span className="req">*</span>
            </label>
            <input
              className={`re-modal-input${exportedByError ? " err" : ""}`}
              placeholder="Name of person exporting"
              value={exportedBy}
              onChange={(e) => { setExportedBy(e.target.value); setExportedByError(""); }}
            />
            {exportedByError && <span className="re-modal-err">{exportedByError}</span>}
          </div>

          {/* ID No */}
          <div className="re-modal-field">
            <label className="re-modal-label">ID No</label>
            <textarea
              className="re-modal-textarea"
              placeholder="e.g. EXP-2024-001 / AWB No / Reference ID"
              value={idNo}
              rows={2}
              onChange={(e) => setIdNo(e.target.value)}
            />
          </div>

          {/* Parcel Photos */}
          <div className="re-modal-field">
            <label className="re-modal-label">
              📦 Parcel Photos
              <span className="re-modal-label-hint"> (bulk shipment photos)</span>
            </label>
            <div className="re-parcel-photo-area">
              <label className="re-parcel-upload-btn">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => { handlePhotoUpload(e.target.files); e.target.value = null; }}
                />
                + Upload Parcel Photos
              </label>
              <ParcelPhotoStrip
                photos={parcelPhotos}
                onRemove={removeParcelPhoto}
                onPreviewOpen={() => setIsPreviewOpen(true)}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="re-modal-footer">
          <button type="button" className="re-modal-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="re-modal-btn-send" onClick={handleSend}>
            ✈ Send Export
          </button>
        </div>
      </div>

      {isPreviewOpen && (
        <PhotoPreviewModal
          photos={parcelPhotos}
          onRemove={removeParcelPhoto}
          onClose={() => setIsPreviewOpen(false)}
        />
      )}
    </div>
  );
}

/** Per-asset individual photo cell in the main table. */
function AssetPhotoCell({ asset, photo, onUpload }) {
  const handleChange = (e) => {
    onUpload(asset.id, e.target.files);
    e.target.value = null;
  };

  if (photo) {
    return (
      <div className="re-indiv-photo-wrap">
        <img src={photo} alt="asset" className="re-indiv-thumb" />
        <label className="re-indiv-change-btn" title="Change photo">
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleChange} />
          ✎
        </label>
      </div>
    );
  }

  return (
    <label className="re-indiv-upload-btn" title="Upload individual photo">
      <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleChange} />
      <span className="re-indiv-emoji">{asset.emoji}</span>
      <span className="re-indiv-upload-hint">+ Photo</span>
    </label>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ReadyForExport() {
  const navigate = useNavigate();

  const [allAssets,        setAllAssets]        = useState([]);
  const [activeCat,        setActiveCat]        = useState(ASSET_CATEGORIES[0]);
  const [search,           setSearch]           = useState("");
  const [selectedIds,      setSelectedIds]      = useState(new Set());
  const [individualPhotos, setIndividualPhotos] = useState({});
  const [showModal,        setShowModal]        = useState(false);
  const [toast,            setToast]            = useState("");

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }, []);

  const loadAssets = useCallback(() => {
    setAllAssets(getAvailableAssetsFromStorage());
  }, []);

  useEffect(() => {
    loadAssets();
    window.addEventListener("inventory-updated", loadAssets);
    window.addEventListener("storage", loadAssets);
    return () => {
      window.removeEventListener("inventory-updated", loadAssets);
      window.removeEventListener("storage", loadAssets);
    };
  }, [loadAssets]);

  const countByCategory = useMemo(() => {
    const counts = Object.fromEntries(ASSET_CATEGORIES.map((c) => [c, 0]));
    allAssets.forEach((a) => {
      if (counts[a.category] !== undefined) counts[a.category]++;
    });
    return counts;
  }, [allAssets]);

  const filteredAssets = useMemo(() => {
    const inCategory = allAssets.filter((a) => a.category === activeCat);
    if (!search.trim()) return inCategory;
    const query = search.toLowerCase();
    return inCategory.filter(
      (a) =>
        a.assetName.toLowerCase().includes(query) ||
        a.serialNo.toLowerCase().includes(query)  ||
        (a.brand || "").toLowerCase().includes(query) ||
        (a.model || "").toLowerCase().includes(query)
    );
  }, [allAssets, activeCat, search]);

  const selectedAssets = useMemo(
    () => allAssets.filter((a) => selectedIds.has(a.id)),
    [allAssets, selectedIds]
  );

  const allVisibleSelected =
    filteredAssets.length > 0 && filteredAssets.every((a) => selectedIds.has(a.id));
  const hasSelection = selectedIds.size > 0;

  const toggleRow = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    const ids = filteredAssets.map((a) => a.id);
    const allSelected = ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }, [filteredAssets, selectedIds]);

  const handleCategoryChange = useCallback((cat) => {
    setActiveCat(cat);
    setSearch("");
    setSelectedIds(new Set());
  }, []);

  const handleIndividualPhoto = useCallback(async (assetId, files) => {
    if (!files?.length) return;
    try {
      const dataURL = await readAsDataURL(files[0]);
      setIndividualPhotos((prev) => ({ ...prev, [assetId]: dataURL }));
    } catch (e) {
      console.error("[ReadyForExport] Individual photo upload failed:", e);
    }
  }, []);

  // ── Export send — receives exportedBy as 4th argument ─────────────────────
  const handleSend = useCallback(
    (destination, parcelPhotos, idNo, exportedBy) => {
      try {
        const existing = JSON.parse(localStorage.getItem("pcl_exported") || "[]");

        const newEntry = {
          id:            `EXP-${Date.now()}`,
          assetName:     [...new Set(selectedAssets.map((a) => a.assetName))].join(", "),
          count:         selectedAssets.length,
          to:            destination,
          date:          new Date().toISOString().split("T")[0],
          idNo:          idNo || "",
          exportedBy:    exportedBy || "",
          serialNumbers: selectedAssets.map((a) => a.serialNo),
          assets:        selectedAssets.map((a) => ({
            id:              a.id,
            assetName:       a.assetName,
            serialNo:        a.serialNo,
            brand:           a.brand,
            model:           a.model,
            emoji:           a.emoji,
            individualPhoto: individualPhotos[a.id] || null,
          })),
          photos: parcelPhotos,
        };

        localStorage.setItem("pcl_exported", JSON.stringify([newEntry, ...existing]));
        commitExport(selectedAssets, destination);

        setShowModal(false);
        setSelectedIds(new Set());
        setIndividualPhotos({});
        loadAssets();

        showToast(
          `✅ ${selectedAssets.length} asset${selectedAssets.length !== 1 ? "s" : ""} exported to "${destination}"`
        );
      } catch (e) {
        console.error("[ReadyForExport] Export failed:", e);
        showToast("❌ Export failed. Please try again.");
      }
    },
    [selectedAssets, individualPhotos, loadAssets, showToast]
  );

  return (
    <div className="re-page">
      {toast && <div className="re-toast" role="status">{toast}</div>}

      <div className="re-topbar">
        <button type="button" className="re-back-btn" onClick={() => navigate(BACK_PATH)}>
          ← Back to Parcels
        </button>
        <div>
          <h1 className="re-title">Ready for Export</h1>
        </div>
      </div>

      <nav className="re-cat-tabs" aria-label="Asset categories">
        {ASSET_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`re-cat-tab${activeCat === cat ? " active" : ""}`}
            onClick={() => handleCategoryChange(cat)}
          >
            {cat}
            <span className="re-cat-count">{countByCategory[cat] ?? 0}</span>
          </button>
        ))}
      </nav>

      <div className="re-filter-bar">
        <div className="re-search-wrap">
          <span className="re-search-icon" aria-hidden>⌕</span>
          <input
            className="re-search-input"
            placeholder="Search by name, serial number, brand or model..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search assets"
          />
          {search && (
            <button type="button" className="re-search-clear" onClick={() => setSearch("")} aria-label="Clear search">
              ×
            </button>
          )}
        </div>
        <div className="re-action-area">
          {hasSelection && (
            <span className="re-selected-count">{selectedIds.size} selected</span>
          )}
          {hasSelection && (
            <button type="button" className="re-btn-export-all" onClick={() => setShowModal(true)}>
              {selectedIds.size === 1 ? "✈ Export" : `✈ Export All (${selectedIds.size})`}
            </button>
          )}
        </div>
      </div>

      <div className="re-card">
        <div className="re-card-head">
          <span className="re-card-title">{activeCat} — Available Assets</span>
          <span className="re-row-count">
            {filteredAssets.length} asset{filteredAssets.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="re-table-wrap re-table-wrap--scroll">
          <table className="re-table">
            <thead className="re-thead-sticky">
              <tr>
                <th className="re-th-check re-th-sticky">
                  <input
                    type="checkbox"
                    className="re-checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label="Select all visible assets"
                  />
                </th>
                <th className="re-th-sticky">Assets Name</th>
                <th className="re-th-sticky">Brand / Model</th>
                <th className="re-th-sticky">Current Date</th>
                <th className="re-th-sticky">Serial No</th>
                <th className="re-th-sticky">Photo</th>
                {hasSelection && <th className="re-th-sticky">Action</th>}
              </tr>
            </thead>
            <tbody>
              {filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={hasSelection ? 7 : 6} className="re-empty">
                    {allAssets.length === 0
                      ? "No assets found. Add assets via the inventory to see them here."
                      : "No available assets in this category."}
                  </td>
                </tr>
              ) : (
                filteredAssets.map((asset, i) => {
                  const isSelected = selectedIds.has(asset.id);
                  return (
                    <tr
                      key={asset.id}
                      className={`${i % 2 === 0 ? "re-tr-even" : "re-tr-odd"} ${isSelected ? "re-tr-selected" : ""} re-tr-clickable`}
                      onClick={() => toggleRow(asset.id)}
                    >
                      <td className="re-td-check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="re-checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(asset.id)}
                          aria-label={`Select ${asset.assetName}`}
                        />
                      </td>
                      <td className="re-td-name">
                        <span className="re-asset-emoji" aria-hidden>{asset.emoji}</span>
                        {asset.assetName}
                      </td>
                      <td className="re-td-brand">
                        {asset.brand && asset.brand !== "—"
                          ? `${asset.brand}${asset.model ? ` · ${asset.model}` : ""}`
                          : "—"}
                      </td>
                      <td className="re-td-date">{todayStr()}</td>
                      <td><span className="re-serial-chip">{asset.serialNo}</span></td>
                      <td className="re-td-photo" onClick={(e) => e.stopPropagation()}>
                        <AssetPhotoCell
                          asset={asset}
                          photo={individualPhotos[asset.id]}
                          onUpload={handleIndividualPhoto}
                        />
                      </td>
                      {hasSelection && (
                        <td onClick={(e) => e.stopPropagation()}>
                          {isSelected && (
                            <button
                              type="button"
                              className="re-btn-export-single"
                              onClick={() => {
                                setSelectedIds(new Set([asset.id]));
                                setShowModal(true);
                              }}
                            >
                              ✈ Export
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <ExportModal
          selectedAssets={selectedAssets}
          individualPhotos={individualPhotos}
          onSend={handleSend}
          onCancel={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

