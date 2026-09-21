
import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast as rtToast } from "react-toastify";
import { useRefreshOnNavigate } from "../../../../hooks/useRefreshOnNavigate";
import {
  createParcelExportAPI,
  toastITApiFailure,
  syncITDataFromAPI,
  syncParcelsFromAPI,
  getAssetUnitsFromStorage,
  saveAssetUnitsToStorage,
  getInventoryFromStorage,
  saveInventoryToStorage,
} from "../../Data";
import ClickableImage from "../../../../components/ClickableImage";
import { openFirstImageInNewTab } from "../../../../utils/openImageInNewTab";
import {
  formatParcelBrandModel,
  getParcelAssetDisplayName,
  isTransportInventoryCategory,
  isMobileTabletHwType,
  getAssetCodeField,
} from "../../inventoryCategories";
import "./ExportedAssets.css";
import { formatDate } from "../../../../utils/dateFormat";

// ─── Constants ────────────────────────────────────────────────────────────────
const ASSET_CATEGORIES = [
  "IT Assets",
  "Office Assets",
  "Transport Assets",
  "Infrastructure Assets",
];

const BACK_PATH = "/it/inventory/parcels";

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Laptop / device code lives on unit.model; fall back to unit / asset id. */
function resolveLaptopCode(unit) {
  const fromModel = String(unit?.model || "").trim();
  if (fromModel && fromModel !== "—") return fromModel;
  const fromCode = String(unit?.unitCode || unit?.unit_code || unit?.assetId || "").trim();
  return fromCode && fromCode !== "—" ? fromCode : "";
}

function resolveImei(unit) {
  const imei1 = String(unit?.imei1 || "").trim();
  if (imei1) return imei1;
  const imei2 = String(unit?.imei2 || "").trim();
  return imei2 || "";
}

/**
 * Brand · model for the export table.
 * For IT Hardware, `model` is usually the device code (Laptop Code) — show make instead.
 */
function formatExportBrandModel(asset, inventoryCategory) {
  if (isTransportInventoryCategory(inventoryCategory)) {
    return formatParcelBrandModel(asset, inventoryCategory);
  }
  const brand = String(asset?.brand || "").trim();
  const make = String(asset?.make || "").trim();
  const model = String(asset?.model || "").trim();
  const hw = String(asset?.hwType || "").trim().toLowerCase();
  const itemCat = String(asset?.itemCategory || "").trim().toLowerCase();

  // Laptop/Desktop: brand · make (code is a separate column)
  if (itemCat === "hardware" && (hw === "laptop" || hw === "desktop")) {
    if (brand && make) return `${brand} · ${make}`;
    return brand || make || "—";
  }
  // Mobile/Tablet: brand · make (make stores phone model)
  if (isMobileTabletHwType(asset?.hwType)) {
    if (brand && make) return `${brand} · ${make}`;
    if (brand && model) return `${brand} · ${model}`;
    return brand || make || model || "—";
  }
  if (brand && make) return `${brand} · ${make}`;
  if (brand && model) return `${brand} · ${model}`;
  return brand || make || model || "—";
}

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

/** Build the flat list of available assets from in-memory / storage cache. */
function getAvailableAssetsFromStorage() {
  try {
    const units     = getAssetUnitsFromStorage() || [];
    const inventory = getInventoryFromStorage() || [];

    const inventoryIdsWithUnits = new Set(
      units.map((u) => String(u.inventoryId)).filter(Boolean)
    );

    const invById = {};
    inventory.forEach((inv) => {
      invById[String(inv.id)] = inv;
    });

    const fromUnits = units
      .filter((u) => String(u.status || "").toLowerCase() === "available")
      .map((u) => {
        const inv = invById[String(u.inventoryId)] || null;
        const inventoryCategory =
          inv?.inventoryCategory || u.inventoryCategory || "IT Assets";
        const itemCategory = u.category || inv?.category || "Hardware";
        const hwType = u.hwType || inv?.hwType || "";
        return {
          _source: "unit",
          id: u.id,
          asset_unit_id: u.id,
          inventoryId: u.inventoryId || null,
          assetName: u.assetName || u.name || inv?.name || "Unknown",
          category: inventoryCategory,
          itemCategory,
          serialNo: u.serialNumber || u.serialNo || "—",
          emoji: getEmoji({ hwType, assetName: u.assetName || u.name }),
          hwType,
          brand: u.brand || "",
          make: u.make || "",
          model: u.model || "",
          laptopCode: resolveLaptopCode(u),
          imei: resolveImei(u),
          imei1: u.imei1 || "",
          imei2: u.imei2 || "",
          unitCode: u.assetId || u.unitCode || "",
          projectCode: u.projectCode || "",
          purchaseDate: u.purchaseDate || inv?.purchaseDate || null,
          photos: u.photos || [],
          availableQty: 1,
          exportQty: 1,
          _bulk: false,
        };
      });

    // Qty-managed stock with no units — one bulk row (not one row per piece)
    const fromInventory = inventory
      .filter(
        (inv) =>
          inv.category !== "Software" &&
          !inventoryIdsWithUnits.has(String(inv.id)) &&
          (Number(inv.availableQuantity) || 0) > 0
      )
      .map((inv) => {
        const qty = Number(inv.availableQuantity) || 0;
        const inventoryCategory = inv.inventoryCategory || "IT Assets";
        return {
          _source: "inventory",
          _bulk: true,
          id: `inv-bulk-${inv.id}`,
          inventoryId: inv.id,
          assetName: inv.name || "Unknown",
          category: inventoryCategory,
          itemCategory: inv.category || "Stock",
          serialNo: "—",
          emoji: getEmoji({ hwType: inv.hwType, assetName: inv.name }),
          hwType: inv.hwType || "",
          brand: inv.brand || "",
          make: inv.make || "",
          model: inv.model || "",
          laptopCode: "",
          imei: "",
          imei1: "",
          imei2: "",
          unitCode: "",
          projectCode: "",
          purchaseDate: inv.purchaseDate || null,
          photos: inv.photos || [],
          availableQty: qty,
          exportQty: qty,
        };
      });

    return [...fromUnits, ...fromInventory];
  } catch {
    return [];
  }
}

/** Expand selected rows into API payload lines (bulk stock → N inventory lines). */
function expandAssetsForExport(selectedAssets) {
  const lines = [];
  selectedAssets.forEach((a) => {
    if (a._source === "unit") {
      lines.push(a);
      return;
    }
    const qty = Math.max(1, Math.min(
      Number(a.exportQty) || Number(a.availableQty) || 1,
      Number(a.availableQty) || 1,
    ));
    for (let i = 0; i < qty; i += 1) {
      lines.push({
        ...a,
        id: `inv-slot-${a.inventoryId}-${i}`,
        _bulk: false,
        exportQty: 1,
      });
    }
  });
  return lines;
}

/** Update assetUnits + inventory cache after an export. */
function commitExport(selectedAssets, destination) {
  try {
    const unitAssets = selectedAssets.filter((a) => a._source === "unit");

    if (unitAssets.length > 0) {
      const exportedUnitIds = new Set(unitAssets.map((a) => a.id));
      const units = getAssetUnitsFromStorage() || [];
      saveAssetUnitsToStorage(
        units.map((u) =>
          exportedUnitIds.has(u.id)
            ? { ...u, status: "exported", exportedTo: destination, exportedAt: new Date().toISOString() }
            : u
        )
      );
    }

    const countByInvId = {};
    selectedAssets.forEach((a) => {
      if (!a.inventoryId) return;
      const key = String(a.inventoryId);
      if (a._source === "unit") {
        countByInvId[key] = (countByInvId[key] || 0) + 1;
        return;
      }
      const qty = Math.max(1, Math.min(
        Number(a.exportQty) || Number(a.availableQty) || 1,
        Number(a.availableQty) || 1,
      ));
      countByInvId[key] = (countByInvId[key] || 0) + qty;
    });

    const unitInvIds = new Set(
      unitAssets.map((a) => String(a.inventoryId)).filter(Boolean)
    );

    const inventory = getInventoryFromStorage() || [];
    saveInventoryToStorage(
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
    );

    window.dispatchEvent(new Event("inventory-updated"));
  } catch (e) {
    console.error("[commitExport]:", e);
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ParcelPhotoStrip({ photos, onRemove }) {
  if (!photos.length) return null;
  return (
    <>
      <button
        type="button"
        className="re-parcel-preview-btn"
        onClick={() => openFirstImageInNewTab(photos)}
        title="Open photo in new tab"
      >
        📷 {photos.length} photo{photos.length !== 1 ? "s" : ""} added
      </button>
      <div className="re-parcel-thumbs">
        {photos.slice(0, 4).map((src, i) => (
          <div key={i} className="re-parcel-thumb-wrap">
            <ClickableImage src={src} alt={`parcel-${i}`} className="re-parcel-thumb" />
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

function ModalAssetRow({ asset, individualPhoto }) {
  const qty = asset._bulk
    ? Math.max(1, Number(asset.exportQty) || Number(asset.availableQty) || 1)
    : 1;
  return (
    <div className="re-modal-asset-row">
      <div className="re-modal-asset-thumb">
        {individualPhoto
          ? (
            <ClickableImage
              src={individualPhoto}
              alt={asset.serialNo}
              className="re-modal-thumb-img"
            />
          )
          : <span className="re-modal-thumb-emoji">{asset.emoji}</span>
        }
      </div>
      <div className="re-modal-asset-info">
        <span className="re-modal-asset-name">
          {getParcelAssetDisplayName(asset, asset.category)}
          {qty > 1 ? ` × ${qty}` : ""}
        </span>
        <span className="re-modal-asset-sn">
          {asset._bulk ? `Bulk stock · ${qty} pcs` : asset.serialNo}
        </span>
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
  const pieceCount = selectedAssets.reduce((sum, a) => {
    if (a._bulk) {
      return sum + Math.max(1, Math.min(
        Number(a.exportQty) || Number(a.availableQty) || 1,
        Number(a.availableQty) || 1,
      ));
    }
    return sum + 1;
  }, 0);
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
              {pieceCount} piece{pieceCount !== 1 ? "s" : ""} ready to ship
              {selectedAssets.length !== pieceCount
                ? ` (${selectedAssets.length} line${selectedAssets.length !== 1 ? "s" : ""})`
                : ""}
            </p>
          </div>
          <button
            type="button"
            className="re-modal-close"
            onClick={onCancel}
            aria-label="Close export modal"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="re-modal-body">
          {/* Asset summary list */}
          <div className="re-modal-assets-block">
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
        <ClickableImage src={photo} alt="asset" className="re-indiv-thumb" />
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

  const setExportQty = useCallback((assetId, nextQty, maxQty) => {
    const capped = Math.max(1, Math.min(Number(nextQty) || 1, Number(maxQty) || 1));
    setAllAssets((prev) =>
      prev.map((a) => (a.id === assetId ? { ...a, exportQty: capped } : a)),
    );
  }, []);

  const bootstrapExportAssets = useCallback(async () => {
    try {
      await syncITDataFromAPI();
    } catch (err) {
      console.error("[ReadyForExport] sync IT data failed:", err);
      toastITApiFailure(
          err,
          "Could not refresh inventory from the server. Showing cached assets if any.",
        );
    }
    loadAssets();
  }, [loadAssets]);

  useRefreshOnNavigate(bootstrapExportAssets);

  useEffect(() => {
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
    return inCategory.filter((a) =>
      [
        a.assetName,
        a.serialNo,
        a.brand,
        a.make,
        a.model,
        a.laptopCode,
        a.imei,
        a.imei1,
        a.imei2,
        a.hwType,
        a.unitCode,
        a.projectCode,
      ]
        .map((v) => String(v || "").toLowerCase())
        .some((v) => v.includes(query)),
    );
  }, [allAssets, activeCat, search]);

  const showLaptopCodeCol = useMemo(
    () =>
      activeCat === "IT Assets" &&
      filteredAssets.some(
        (a) =>
          String(a.itemCategory || "").toLowerCase() === "hardware" &&
          String(a.hwType || "").toLowerCase() === "laptop",
      ),
    [filteredAssets, activeCat],
  );

  const showImeiCol = useMemo(
    () =>
      activeCat === "IT Assets" &&
      filteredAssets.some((a) => isMobileTabletHwType(a.hwType)),
    [filteredAssets, activeCat],
  );

  const codeColumnLabel = useMemo(() => {
    const laptop = filteredAssets.find(
      (a) => String(a.hwType || "").toLowerCase() === "laptop",
    );
    return getAssetCodeField(laptop?.hwType || "Laptop").label;
  }, [filteredAssets]);

  const serialColumnLabel = isTransportInventoryCategory(activeCat)
    ? "Registration No."
    : "Serial No";

  const selectedAssets = useMemo(
    () => allAssets.filter((a) => selectedIds.has(a.id)),
    [allAssets, selectedIds]
  );

  const selectedPieceCount = useMemo(
    () =>
      selectedAssets.reduce((sum, a) => {
        if (a._bulk) {
          return sum + Math.max(1, Math.min(
            Number(a.exportQty) || Number(a.availableQty) || 1,
            Number(a.availableQty) || 1,
          ));
        }
        return sum + 1;
      }, 0),
    [selectedAssets],
  );

  const allVisibleSelected =
    filteredAssets.length > 0 && filteredAssets.every((a) => selectedIds.has(a.id));
  const hasSelection = selectedIds.size > 0;

  const tableColCount =
    8 + (showLaptopCodeCol ? 1 : 0) + (showImeiCol ? 1 : 0) + (hasSelection ? 1 : 0);

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
    async (destination, parcelPhotos, idNo, exportedBy) => {
      try {
        const exportLines = expandAssetsForExport(selectedAssets);
        await createParcelExportAPI({
          destination,
          idNo,
          exportedBy,
          inventoryCategory: activeCat,
          photos: parcelPhotos,
          assets: exportLines.map((a) => ({
            ...a,
            individualPhoto: individualPhotos[a.id] || individualPhotos[
              a._source === "inventory" ? `inv-bulk-${a.inventoryId}` : a.id
            ] || null,
          })),
        });
        await syncParcelsFromAPI();
        commitExport(selectedAssets, destination);

        setShowModal(false);
        setSelectedIds(new Set());
        setIndividualPhotos({});
        loadAssets();

        showToast(
          `✅ ${exportLines.length} asset${exportLines.length !== 1 ? "s" : ""} exported to "${destination}"`
        );
      } catch (e) {
        console.error("[ReadyForExport] Export failed:", e);
        const msg = toastITApiFailure(e, "Export failed. Please try again.");
        showToast(`⚠️ ${msg}`);
      }
    },
    [selectedAssets, individualPhotos, activeCat, loadAssets, showToast]
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
            placeholder="Search by name, serial, brand, model, laptop code or IMEI..."
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
            <span className="re-selected-count">
              {selectedIds.size} selected
              {selectedPieceCount !== selectedIds.size
                ? ` · ${selectedPieceCount} pcs`
                : ""}
            </span>
          )}
          {hasSelection && (
            <button type="button" className="re-btn-export-all" onClick={() => setShowModal(true)}>
              {selectedPieceCount === 1
                ? "✈ Export"
                : `✈ Export (${selectedPieceCount})`}
            </button>
          )}
        </div>
      </div>

      <div className="re-card">
        <div className="re-card-head">
          <span className="re-card-title">{activeCat} — Available for export</span>
          <span className="re-row-count">
            {filteredAssets.length} line{filteredAssets.length !== 1 ? "s" : ""}
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
                <th className="re-th-sticky">
                  {isTransportInventoryCategory(activeCat) ? "Owner Name" : "Assets Name"}
                </th>
                <th className="re-th-sticky">Type</th>
                <th className="re-th-sticky">Brand / Model</th>
                {showLaptopCodeCol && (
                  <th className="re-th-sticky">{codeColumnLabel}</th>
                )}
                {showImeiCol && <th className="re-th-sticky">IMEI</th>}
                <th className="re-th-sticky">Qty</th>
                <th className="re-th-sticky">{serialColumnLabel}</th>
                <th className="re-th-sticky">Purchase Date</th>
                <th className="re-th-sticky">Photo</th>
                {hasSelection && <th className="re-th-sticky">Action</th>}
              </tr>
            </thead>
            <tbody>
              {filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={tableColCount} className="re-empty">
                    {allAssets.length === 0
                      ? "No assets found. Add assets via the inventory to see them here."
                      : "No available assets in this category."}
                  </td>
                </tr>
              ) : (
                filteredAssets.map((asset, i) => {
                  const isSelected = selectedIds.has(asset.id);
                  const isLaptopHw =
                    String(asset.itemCategory || "").toLowerCase() === "hardware" &&
                    String(asset.hwType || "").toLowerCase() === "laptop";
                  const isMobileHw = isMobileTabletHwType(asset.hwType);
                  const isBulk = Boolean(asset._bulk);
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
                          aria-label={`Select ${getParcelAssetDisplayName(asset, activeCat)}`}
                        />
                      </td>
                      <td className="re-td-name">
                        <span className="re-asset-emoji" aria-hidden>{asset.emoji}</span>
                        <span className="re-asset-name-text">
                          {getParcelAssetDisplayName(asset, activeCat)}
                        </span>
                        {isBulk ? (
                          <span className="re-bulk-chip">Bulk</span>
                        ) : null}
                      </td>
                      <td className="re-td-type">
                        {asset.hwType ? (
                          <span className="re-type-chip">{asset.hwType}</span>
                        ) : (
                          <span className="re-muted">—</span>
                        )}
                      </td>
                      <td className="re-td-brand">
                        {formatExportBrandModel(asset, activeCat)}
                      </td>
                      {showLaptopCodeCol && (
                        <td className="re-td-code" data-label={codeColumnLabel}>
                          {isLaptopHw && asset.laptopCode ? (
                            <span className="re-code-chip">{asset.laptopCode}</span>
                          ) : (
                            <span className="re-muted">—</span>
                          )}
                        </td>
                      )}
                      {showImeiCol && (
                        <td className="re-td-imei" data-label="IMEI">
                          {isMobileHw && asset.imei ? (
                            <span className="re-code-chip">{asset.imei}</span>
                          ) : (
                            <span className="re-muted">—</span>
                          )}
                        </td>
                      )}
                      <td
                        className="re-td-qty"
                        data-label="Qty"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isBulk ? (
                          <input
                            type="number"
                            className="re-qty-input"
                            min={1}
                            max={asset.availableQty || 1}
                            value={asset.exportQty ?? asset.availableQty ?? 1}
                            onChange={(e) =>
                              setExportQty(asset.id, e.target.value, asset.availableQty)
                            }
                            aria-label={`Export quantity for ${asset.assetName}`}
                          />
                        ) : (
                          <span className="re-qty-chip">1</span>
                        )}
                        {isBulk ? (
                          <span className="re-qty-avail">/ {asset.availableQty}</span>
                        ) : null}
                      </td>
                      <td>
                        <span className="re-serial-chip">
                          {isBulk ? "—" : (asset.serialNo || "—")}
                        </span>
                      </td>
                      <td className="re-td-date">
                        {asset.purchaseDate ? formatDate(asset.purchaseDate) : "—"}
                      </td>
                      <td className="re-td-photo" onClick={(e) => e.stopPropagation()}>
                        <AssetPhotoCell
                          asset={asset}
                          photo={individualPhotos[asset.id] || asset.photos?.[0] || null}
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

