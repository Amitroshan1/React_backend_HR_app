
import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import ClickableImage from "../../../components/ClickableImage";
import {
  createHardwareUnitsAPI,
  createInventoryItemAPI,
  createSoftwareLicensesAPI,
  compressImage,
  getITApiErrorMessage,
  syncITDataFromAPI,
} from "../Data";
import {
  ASSET_TYPE_TABS,
  INVENTORY_CATEGORY_CONFIG,
  getHardwareFields,
  inventoryCategoryToKey,
  isValidInventoryCategory,
  isStockInventoryCategory,
  isVehicleInventoryCategory,
  keyToInventoryCategory,
} from "../inventoryCategories";
import OfficeStockForm from "./OfficeStockForm";
import TransportVehicleForm from "./TransportVehicleForm";
import InfrastructureAddForm from "./InfrastructureAddForm";
import "./AddnewAssets.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE = "/it/inventory";

// ─── Row factories ────────────────────────────────────────────────────────────

const blankHwRow = () => ({
  id: Date.now() + Math.random(),
  brand: "", make: "", model: "", serialNumber: "",
  photos: [], _errors: {},
});

const blankMobileRow = () => ({ ...blankHwRow(), imei1: "", imei2: "" });

const blankQtyRow = () => ({
  id: Date.now() + Math.random(),
  name: "", quantity: "",
  photos: [], _errors: {},
});

const blankSoftwareRow = () => ({
  id: Date.now() + Math.random(),
  name: "", subscriptionStart: "", subscriptionEnd: "", quantity: "1",
  _errors: {},
});

const blankRowForType = (rowType) => {
  if (rowType === "mobile")   return blankMobileRow();
  if (rowType === "hw")       return blankHwRow();
  if (rowType === "software") return blankSoftwareRow();
  return blankQtyRow();
};

// ─── Validation ───────────────────────────────────────────────────────────────

const validateRow = (row, rowType, { vehicleMode = false } = {}) => {
  const errors = {};

  if (rowType === "hw" || rowType === "mobile") {
    if (!row.brand.trim())        errors.brand        = "Required";
    if (!row.make.trim())         errors.make         = "Required";
    if (!row.model.trim())        errors.model        = "Required";
    if (!row.serialNumber.trim()) {
      errors.serialNumber = vehicleMode ? "Registration required" : "Required";
    } else if (vehicleMode) {
      const reg = row.serialNumber.trim();
      if (reg.length < 4) errors.serialNumber = "Min 4 characters";
      else if (!/^[A-Za-z0-9][A-Za-z0-9\s-]*$/.test(reg)) {
        errors.serialNumber = "Use letters, numbers, spaces, or hyphens";
      }
    }

    if (rowType === "mobile") {
      if (!row.imei1.trim())
        errors.imei1 = "Required";
      else if (!/^\d{15}$/.test(row.imei1.trim()))
        errors.imei1 = "Must be exactly 15 digits";

      if (row.imei2.trim() && !/^\d{15}$/.test(row.imei2.trim()))
        errors.imei2 = "Must be exactly 15 digits";
    }
  } else if (rowType === "software") {
    if (!row.name.trim())            errors.name              = "Required";
    if (!row.subscriptionStart)      errors.subscriptionStart = "Required";
    if (!row.subscriptionEnd)        errors.subscriptionEnd   = "Required";
    if (
      row.subscriptionStart &&
      row.subscriptionEnd &&
      row.subscriptionEnd <= row.subscriptionStart
    ) errors.subscriptionEnd = "Must be after start date";
    if (!row.quantity || parseInt(row.quantity) < 1) errors.quantity = "Min 1";
  } else {
    if (!row.name.trim())                               errors.name     = "Required";
    if (!row.quantity || parseInt(row.quantity) < 1)   errors.quantity = "Min 1";
  }

  return errors;
};

// ─── CellInput ────────────────────────────────────────────────────────────────

function CellInput({ value, onChange, placeholder, error, className = "", ...props }) {
  return (
    <td>
      <input
        className={`ana-cell-input ${className} ${error ? "err" : ""}`}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        {...props}
      />
      {error && <span className="ana-cell-err">{error}</span>}
    </td>
  );
}

// ─── WorkInProgress ───────────────────────────────────────────────────────────

function WorkInProgress({ label }) {
  return (
    <div className="ana-wip-wrap">
      <div className="ana-wip-card">
        <div className="ana-wip-icon">🚧</div>
        <h2 className="ana-wip-title">Work In Progress</h2>
        <p className="ana-wip-sub">
          <strong>{label}</strong> section is under development.
          <br />
          This feature will be available soon.
        </p>
      </div>
    </div>
  );
}

// ─── PhotoModal ───────────────────────────────────────────────────────────────

function PhotoModal({ photos, onClose, onRemovePhoto }) {
  return (
    <div className="ana-photo-modal-backdrop" onClick={onClose}>
      <div className="ana-photo-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ana-photo-modal-head">
          <span>{photos.length} Photo{photos.length !== 1 ? "s" : ""}</span>
          <button className="ana-photo-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="ana-photo-modal-body">
          {photos.length === 0 ? (
            <p style={{ textAlign: "center", color: "#aaa", padding: 24 }}>No photos</p>
          ) : (
            <div className="ana-photo-grid">
              {photos.map((src, i) => (
                <div key={i} className="ana-photo-item">
                  <ClickableImage src={src} alt={`photo-${i + 1}`} />
                  <button
                    type="button"
                    className="ana-photo-remove"
                    onClick={() => onRemovePhoto(i)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── InventoryAssetsForm ──────────────────────────────────────────────────────

function InventoryAssetsForm({ inventoryCategory }) {
  const navigate = useNavigate();
  const config = INVENTORY_CATEGORY_CONFIG[inventoryCategory] || INVENTORY_CATEGORY_CONFIG["IT Assets"];
  const itemCategories = config.itemCategories;
  const hwTypes = config.hwTypes;
  const mobileHwType = config.mobileHwType;
  const vehicleMode = isVehicleInventoryCategory(inventoryCategory);
  const hwFields = getHardwareFields(inventoryCategory);
  const otherHwPlaceholder = config.otherHwPlaceholder || "e.g. Docking Station, Router, UPS";
  const validateOpts = useMemo(() => ({ vehicleMode }), [vehicleMode]);

  const [category,     setCategory]     = useState("Hardware");
  const [hwType,       setHwType]       = useState(hwTypes[0] || "Other");
  const [customHwType, setCustomHwType] = useState("");
  const [rows,         setRows]         = useState([blankHwRow()]);
  const [submitted,    setSubmitted]    = useState(false);
  const [successMsg,   setSuccessMsg]   = useState("");
  const [photoPreview, setPhotoPreview] = useState(null);

  const rowType = useMemo(() => {
    if (category === "Software")  return "software";
    if (category !== "Hardware")  return "qty";
    if (mobileHwType && hwType === mobileHwType) return "mobile";
    return "hw";
  }, [category, hwType, mobileHwType]);
  const effectiveHwType = useMemo(
    () => (hwType === "Other" ? customHwType.trim() : hwType),
    [hwType, customHwType],
  );

  // ── Row management ─────────────────────────────────────────────────────────

  const resetForm = useCallback((nextRowType) => {
    setRows([blankRowForType(nextRowType)]);
    setSuccessMsg("");
    setSubmitted(false);
  }, []);

  const handleCategoryChange = useCallback((cat) => {
    setCategory(cat);
    const nextRowType =
      cat === "Software" ? "software" : cat !== "Hardware" ? "qty" : "hw";
    if (cat === "Hardware") setHwType(hwTypes[0] || "Other");
    setCustomHwType("");
    resetForm(nextRowType);
  }, [resetForm, hwTypes]);

  const handleTypeChange = useCallback((e) => {
    const type = e.target.value;
    setHwType(type);
    if (type !== "Other") setCustomHwType("");
    resetForm(mobileHwType && type === mobileHwType ? "mobile" : "hw");
  }, [resetForm, mobileHwType]);

  const addRow    = useCallback(() => setRows((prev) => [...prev, blankRowForType(rowType)]), [rowType]);
  const removeRow = useCallback((id) => setRows((prev) => prev.length > 1 ? prev.filter((r) => r.id !== id) : prev), []);

  const updateRow = useCallback((id, field, value) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        if (submitted) updated._errors = validateRow(updated, rowType, validateOpts);
        return updated;
      }),
    );
  }, [submitted, rowType, validateOpts]);

  // ── Photos ─────────────────────────────────────────────────────────────────

  const handlePhotoUpload = useCallback(async (rowId, files) => {
    if (!files?.length) return;
    try {
      const compressed = await Promise.all(Array.from(files).map(compressImage));
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, photos: [...r.photos, ...compressed] } : r,
        ),
      );
    } catch (err) {
      console.error("Photo upload failed:", err);
    }
  }, []);

  const removePhoto = useCallback((rowId, photoIndex) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, photos: r.photos.filter((_, i) => i !== photoIndex) }
          : r,
      ),
    );
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    setSubmitted(true);
    if (category === "Hardware" && hwType === "Other" && !customHwType.trim()) {
      toast.error("Please enter a hardware name for type 'Other'.");
      return;
    }
    const validated = rows.map((r) => ({ ...r, _errors: validateRow(r, rowType, validateOpts) }));
    setRows(validated);
    if (!validated.every((r) => Object.keys(r._errors).length === 0)) return;

    try {
      if (category === "Hardware") {
        const groups = new Map();
        validated.forEach((row) => {
          const key = row.brand.trim().toLowerCase();
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(row);
        });

        let addedCount = 0;
        for (const [brandKey, groupRows] of groups.entries()) {
          if (!brandKey) continue;
          const brandName = groupRows[0].brand.trim();
          const invRes = await createInventoryItemAPI({
            name: brandName,
            category: "Hardware",
            inventoryCategory,
            hwType: effectiveHwType,
          });
          const inventoryItemId = invRes?.item?.id;
          if (!inventoryItemId) continue;

          await createHardwareUnitsAPI({
            inventoryItemId,
            assetName: brandName,
            category: "Hardware",
            hwType: effectiveHwType,
            rows: groupRows,
          });
          addedCount += groupRows.length;
        }

        await syncITDataFromAPI();
        const unitLabel = vehicleMode ? "vehicle" : effectiveHwType;
        setSuccessMsg(
          `✅ ${addedCount} ${unitLabel}${addedCount !== 1 ? "s" : ""} added to ${inventoryCategory}.`,
        );
      } else if (category === "Software") {
        let totalLicenses = 0;
        for (const row of validated) {
          const qty = parseInt(row.quantity, 10) || 1;
          const invRes = await createInventoryItemAPI({
            name: row.name.trim(),
            category: "Software",
            inventoryCategory,
          });
          const inventoryItemId = invRes?.item?.id;
          if (!inventoryItemId) continue;
          await createSoftwareLicensesAPI({
            inventoryItemId,
            name: row.name.trim(),
            subscriptionStart: row.subscriptionStart,
            subscriptionEnd: row.subscriptionEnd,
            quantity: qty,
          });
          totalLicenses += qty;
        }
        await syncITDataFromAPI();
        setSuccessMsg(`✅ ${totalLicenses} Software license${totalLicenses !== 1 ? "s" : ""} added.`);
      } else {
        for (const row of validated) {
          await createInventoryItemAPI({
            name: row.name.trim(),
            category,
            inventoryCategory,
            quantity: parseInt(row.quantity, 10),
            photos: row.photos || [],
          });
        }
        await syncITDataFromAPI();
        const totalQty = validated.reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0);
        setSuccessMsg(
          `✅ ${validated.length} asset${validated.length !== 1 ? "s" : ""} (qty ${totalQty}) added to ${category}.`,
        );
      }

      setRows([blankRowForType(rowType)]);
      setSubmitted(false);
    } catch (err) {
      console.error("[AddNewAssets] Failed to save via API:", err);
      const msg = getITApiErrorMessage(err, "Failed to save assets.");
      toast.error(msg);
      setSuccessMsg(`❌ ${msg}`);
    }
  }, [rows, rowType, category, hwType, customHwType, effectiveHwType, inventoryCategory, vehicleMode, validateOpts]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const allValid = useMemo(
    () => rows.every((r) => Object.keys(validateRow(r, rowType, validateOpts)).length === 0),
    [rows, rowType, validateOpts],
  );

  const previewPhotos = photoPreview
    ? (rows.find((r) => r.id === photoPreview)?.photos ?? [])
    : [];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="ana-page">
        <main className="ana-main">
          {/* ── Step 1: Category + Hardware Type (inline) ── */}
          <section className="ana-section">
            <div className="ana-section-head">
              <span className="ana-section-num">01</span>
              <h2>Select Category</h2>
            </div>

            {/* Category chips + hardware-type dropdown on same row */}
            <div className="ana-category-row">
              <div className="ana-chip-group">
                {itemCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`ana-chip ${category === cat ? "selected" : ""}`}
                    onClick={() => handleCategoryChange(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Dropdown — only visible when Hardware is selected */}
              {category === "Hardware" && (
                <div className="ana-hwtype-dropdown-wrap">
                  <div className="ana-hwtype-select-block">
                    <label className="ana-hwtype-label" htmlFor="hw-type-select">
                      {vehicleMode ? "Vehicle Type" : "Hardware Type"}
                    </label>
                    <div className="ana-hwtype-select-wrap">
                      <select
                        id="hw-type-select"
                        className="ana-hwtype-select"
                        value={hwType}
                        onChange={handleTypeChange}
                      >
                        {hwTypes.map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                      {/* Custom chevron */}
                      <span className="ana-hwtype-chevron">▾</span>
                    </div>
                  </div>
                  {hwType === "Other" && (
                    <div className="ana-hwtype-custom-block">
                      <label className="ana-hwtype-label" htmlFor="hw-type-custom">
                        Enter Hardware Name <span className="req">*</span>
                      </label>
                      <input
                        id="hw-type-custom"
                        className="ana-hwtype-custom-input"
                        placeholder={otherHwPlaceholder}
                        value={customHwType}
                        onChange={(e) => setCustomHwType(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Category + type pill */}
          <div className="ana-category-pill-row">
            <span className={`ana-cat-dot ${category.toLowerCase()}`} />
            <span className="ana-category-pill-label">
              {category}{category === "Hardware" && ` — ${effectiveHwType || "Other"}`}
            </span>
          </div>

          {/* ── Step 2: Asset Table ── */}
          <section className="ana-section ana-section-table">
            <div className="ana-section-head">
              <span className="ana-section-num">02</span>
              <h2>
                {category === "Hardware"
                  ? `Add ${effectiveHwType || "Other"} Units`
                  : category === "Software"
                  ? "Add Software Licenses"
                  : `Add ${category}`}
              </h2>
              <span className="ana-row-count">
                {rows.length} row{rows.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="ana-table-wrap">
              <table className="ana-table">
                <thead>
                  <tr>
                    <th className="ana-th-idx">#</th>
                    {(rowType === "hw" || rowType === "mobile") && (
                      <>
                        <th>{hwFields.brand.label} <span className="req">*</span></th>
                        <th>{hwFields.make.label} <span className="req">*</span></th>
                        <th>{hwFields.model.label} <span className="req">*</span></th>
                        <th>{hwFields.serialNumber.label} <span className="req">*</span></th>
                        {rowType === "mobile" && (
                          <>
                            <th>IMEI 1 <span className="req">*</span></th>
                            <th>IMEI 2</th>
                          </>
                        )}
                        <th>Photos</th>
                      </>
                    )}
                    {rowType === "qty" && (
                      <>
                        <th>Asset Name <span className="req">*</span></th>
                        <th>Quantity <span className="req">*</span></th>
                        <th>Photos</th>
                      </>
                    )}
                    {rowType === "software" && (
                      <>
                        <th>Software Name <span className="req">*</span></th>
                        <th>Start Date <span className="req">*</span></th>
                        <th>Valid Till <span className="req">*</span></th>
                        <th>Licenses <span className="req">*</span></th>
                      </>
                    )}
                    <th className="ana-th-action" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr
                      key={row.id}
                      className={Object.keys(row._errors).length ? "row-invalid" : ""}
                    >
                      <td className="ana-td-idx">{idx + 1}</td>

                      {(rowType === "hw" || rowType === "mobile") && (
                        <>
                          <CellInput value={row.brand}  error={row._errors.brand}  placeholder={hwFields.brand.placeholder}  onChange={(e) => updateRow(row.id, "brand",  e.target.value)} />
                          <CellInput value={row.make}   error={row._errors.make}   placeholder={hwFields.make.placeholder}   onChange={(e) => updateRow(row.id, "make",   e.target.value)} />
                          <CellInput value={row.model}  error={row._errors.model}  placeholder={hwFields.model.placeholder}  onChange={(e) => updateRow(row.id, "model",  e.target.value)} />
                          <CellInput
                            value={row.serialNumber}
                            error={row._errors.serialNumber}
                            placeholder={hwFields.serialNumber.placeholder}
                            className="mono"
                            onChange={(e) => updateRow(row.id, "serialNumber", e.target.value)}
                          />
                          {rowType === "mobile" && (
                            <>
                              <CellInput
                                value={row.imei1}
                                error={row._errors.imei1}
                                placeholder="15 digits"
                                maxLength={15}
                                className="mono"
                                onChange={(e) =>
                                  updateRow(row.id, "imei1", e.target.value.replace(/\D/g, "").slice(0, 15))
                                }
                              />
                              <CellInput
                                value={row.imei2}
                                error={row._errors.imei2}
                                placeholder="Optional"
                                maxLength={15}
                                className="mono"
                                onChange={(e) =>
                                  updateRow(row.id, "imei2", e.target.value.replace(/\D/g, "").slice(0, 15))
                                }
                              />
                            </>
                          )}
                        </>
                      )}

                      {rowType === "qty" && (
                        <>
                          <CellInput value={row.name}     error={row._errors.name}     placeholder="Asset name" onChange={(e) => updateRow(row.id, "name",     e.target.value)} />
                          <CellInput value={row.quantity} error={row._errors.quantity} type="number" min="1" placeholder="Qty" className="ana-qty-input" onChange={(e) => updateRow(row.id, "quantity", e.target.value)} />
                        </>
                      )}

                      {rowType === "software" && (
                        <>
                          <CellInput value={row.name}              error={row._errors.name}              placeholder="e.g. Microsoft 365" onChange={(e) => updateRow(row.id, "name",              e.target.value)} />
                          <CellInput value={row.subscriptionStart} error={row._errors.subscriptionStart} type="date"                      onChange={(e) => updateRow(row.id, "subscriptionStart", e.target.value)} />
                          <CellInput value={row.subscriptionEnd}   error={row._errors.subscriptionEnd}   type="date"                      onChange={(e) => updateRow(row.id, "subscriptionEnd",   e.target.value)} />
                          <CellInput value={row.quantity}          error={row._errors.quantity}          type="number" min="1" placeholder="1" className="ana-qty-input" onChange={(e) => updateRow(row.id, "quantity", e.target.value)} />
                        </>
                      )}

                      {rowType !== "software" && (
                        <td className="ana-td-photos">
                          <div className="ana-photo-cell">
                            <label className="ana-photo-btn">
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                style={{ display: "none" }}
                                onClick={(e) => { e.target.value = null; }}
                                onChange={(e) => handlePhotoUpload(row.id, e.target.files)}
                              />
                              Upload
                            </label>
                            {row.photos.length > 0 && (
                              <button
                                type="button"
                                className="ana-photo-count-btn"
                                onClick={() => setPhotoPreview(row.id)}
                              >
                                {row.photos.length} photo{row.photos.length > 1 ? "s" : ""}
                              </button>
                            )}
                          </div>
                        </td>
                      )}

                      <td className="ana-td-action">
                        <button
                          type="button"
                          className="ana-btn-rm-row"
                          onClick={() => removeRow(row.id)}
                          disabled={rows.length === 1}
                          title="Remove row"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button type="button" className="ana-btn-add-row" onClick={addRow}>
              + Add Row
            </button>
          </section>

          {/* Footer */}
          <div className="ana-footer">
            <div className="ana-footer-info">
              {!allValid && submitted && (
                <span className="ana-footer-warn">
                  Fix validation errors above before submitting
                </span>
              )}
              {successMsg && (
                <span className="ana-footer-success">{successMsg}</span>
              )}
            </div>
            <div className="ana-footer-actions">
              <button
                type="button"
                className="ana-btn-cancel"
                onClick={() =>
                  navigate(`${BASE}?cat=${encodeURIComponent(inventoryCategory)}`)
                }
              >
                Cancel
              </button>
              <button type="button" className="ana-btn-submit" onClick={handleSubmit}>
                Save to Inventory
              </button>
            </div>
          </div>
        </main>
      </div>

      {photoPreview && (
        <PhotoModal
          photos={previewPhotos}
          onClose={() => setPhotoPreview(null)}
          onRemovePhoto={(photoIndex) => {
            removePhoto(photoPreview, photoIndex);
            if (previewPhotos.length === 1) setPhotoPreview(null);
          }}
        />
      )}
    </>
  );
}

// ─── AddNewAssets (default export) ───────────────────────────────────────────

const FORM_ENABLED_KEYS = new Set(ASSET_TYPE_TABS.map((t) => t.key));

export default function AddNewAssets() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const invFromUrl = searchParams.get("inv");
  const initialKey = inventoryCategoryToKey(
    isValidInventoryCategory(invFromUrl) ? invFromUrl : "IT Assets",
  );
  const [activeType, setActiveType] = useState(initialKey);

  useEffect(() => {
    if (isValidInventoryCategory(invFromUrl)) {
      setActiveType(inventoryCategoryToKey(invFromUrl));
    }
  }, [invFromUrl]);

  const activeInventoryCategory = keyToInventoryCategory(activeType);
  const formEnabled = FORM_ENABLED_KEYS.has(activeType);

  const selectType = (key) => {
    setActiveType(key);
    setSearchParams({ inv: keyToInventoryCategory(key) }, { replace: true });
  };

  return (
    <div className="ana-outer">
      <div className="ana-top-bar">
        <button className="ana-back" onClick={() => navigate(`${BASE}?cat=${encodeURIComponent(activeInventoryCategory)}`)}>
          ← Back to Inventory Management
        </button>
        <h1 className="ana-top-title">Add New Assets</h1>
      </div>

      <nav className="ana-type-tabs">
        {ASSET_TYPE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`ana-type-tab ${activeType === t.key ? "active" : ""}`}
            onClick={() => selectType(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="ana-type-content">
        {formEnabled ? (
          activeInventoryCategory === "Office Assets" ? (
            <OfficeStockForm />
          ) : activeInventoryCategory === "Transport Assets" ? (
            <TransportVehicleForm />
          ) : activeInventoryCategory === "Infrastructure Assets" ? (
            <InfrastructureAddForm />
          ) : (
            <InventoryAssetsForm inventoryCategory={activeInventoryCategory} />
          )
        ) : (
          <WorkInProgress label={ASSET_TYPE_TABS.find((t) => t.key === activeType)?.label} />
        )}
      </div>
    </div>
  );
}





