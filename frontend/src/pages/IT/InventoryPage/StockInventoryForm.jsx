import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  compressImage,
  createInventoryItemAPI,
  getITApiErrorMessage,
  syncITDataFromAPI,
} from "../Data";
import "./AddnewAssets.css";

const BASE = "/it/inventory";

const blankRow = () => ({
  id: Date.now() + Math.random(),
  itemName: "",
  vendor: "",
  quantity: "",
  purchaseDate: "",
  location: "",
  notes: "",
  photos: [],
  receipts: [],
  _errors: {},
});

function validateRow(row, { requireVendor = true, requirePurchaseDate = true } = {}) {
  const errors = {};
  if (!row.itemName.trim()) errors.itemName = "Required";
  if (requireVendor && !row.vendor.trim()) errors.vendor = "Required";
  if (!row.quantity || parseInt(row.quantity, 10) < 1) errors.quantity = "Min 1";
  if (requirePurchaseDate && !row.purchaseDate) errors.purchaseDate = "Required";
  return errors;
}

function CellInput({ value, onChange, placeholder, error, type = "text", className = "" }) {
  return (
    <td>
      <input
        type={type}
        className={`ana-cell-input ${className} ${error ? "err" : ""}`}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
      />
      {error && <span className="ana-cell-err">{error}</span>}
    </td>
  );
}

function PhotoModal({ photos, onClose, onRemovePhoto }) {
  return (
    <div className="ana-photo-modal-backdrop" onClick={onClose}>
      <div className="ana-photo-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ana-photo-modal-head">
          <span>{photos.length} file{photos.length !== 1 ? "s" : ""}</span>
          <button type="button" className="ana-photo-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="ana-photo-modal-body">
          <div className="ana-photo-grid">
            {photos.map((src, i) => (
              <div key={i} className="ana-photo-item">
                <img src={src} alt="" />
                <button type="button" className="ana-photo-remove" onClick={() => onRemovePhoto(i)}>×</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StockInventoryForm({
  inventoryCategory,
  sectionTitle = "Stock",
  tableTitle = "Add stock lines",
  hint = "Track items by quantity with supplier, purchase date, and receipts. No employee assignment.",
  stockCategory = "Stock",
  saveErrorMessage = "Failed to save stock.",
  compact = false,
}) {
  const navigate = useNavigate();
  const validateOpts = useMemo(() => ({ requireVendor: true, requirePurchaseDate: true }), []);
  const [rows, setRows] = useState([blankRow()]);
  const [submitted, setSubmitted] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [photoPreview, setPhotoPreview] = useState(null);
  const [previewField, setPreviewField] = useState("photos");

  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (id) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));

  const updateRow = useCallback((id, field, value) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        if (submitted) updated._errors = validateRow(updated, validateOpts);
        return updated;
      }),
    );
  }, [submitted, validateOpts]);

  const uploadFiles = useCallback(async (rowId, field, files) => {
    if (!files?.length) return;
    try {
      const compressed = await Promise.all(Array.from(files).map(compressImage));
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId ? { ...r, [field]: [...r[field], ...compressed] } : r,
        ),
      );
    } catch (err) {
      toast.error("Could not process image.");
    }
  }, []);

  const removeFile = useCallback((rowId, field, index) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId ? { ...r, [field]: r[field].filter((_, i) => i !== index) } : r,
      ),
    );
  }, []);

  const allValid = useMemo(
    () => rows.every((r) => Object.keys(validateRow(r, validateOpts)).length === 0),
    [rows, validateOpts],
  );

  const handleSubmit = useCallback(async () => {
    setSubmitted(true);
    const validated = rows.map((r) => ({ ...r, _errors: validateRow(r, validateOpts) }));
    setRows(validated);
    if (!validated.every((r) => Object.keys(r._errors).length === 0)) return;

    try {
      let totalQty = 0;
      for (const row of validated) {
        const qty = parseInt(row.quantity, 10) || 0;
        await createInventoryItemAPI({
          name: row.itemName.trim(),
          category: stockCategory,
          inventoryCategory,
          quantity: qty,
          photos: row.photos,
          vendor: row.vendor.trim(),
          purchaseDate: row.purchaseDate,
          receipts: row.receipts,
          location: row.location.trim() || null,
          notes: row.notes.trim() || null,
        });
        totalQty += qty;
      }
      await syncITDataFromAPI();
      setSuccessMsg(
        `✅ ${validated.length} line${validated.length !== 1 ? "s" : ""} added (qty ${totalQty}).`,
      );
      setRows([blankRow()]);
      setSubmitted(false);
    } catch (err) {
      toast.error(getITApiErrorMessage(err, saveErrorMessage));
    }
  }, [rows, inventoryCategory, stockCategory, saveErrorMessage, validateOpts]);

  const previewRow = photoPreview ? rows.find((r) => r.id === photoPreview) : null;
  const previewPhotos = previewRow?.[previewField] ?? [];

  const formBody = (
    <>
          <section className="ana-section ana-section-table">
            <div className="ana-section-head">
              <span className="ana-section-num">02</span>
              <h2>{tableTitle}</h2>
              <span className="ana-row-count">{rows.length} row{rows.length !== 1 ? "s" : ""}</span>
            </div>

            <div className="ana-table-wrap">
              <table className="ana-table">
                <thead>
                  <tr>
                    <th className="ana-th-idx">#</th>
                    <th>Item name <span className="req">*</span></th>
                    <th>Supplier / vendor <span className="req">*</span></th>
                    <th>Qty <span className="req">*</span></th>
                    <th>Purchase date <span className="req">*</span></th>
                    <th>Location</th>
                    <th>Photos</th>
                    <th>Receipt</th>
                    <th className="ana-th-action" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={row.id} className={Object.keys(row._errors).length ? "row-invalid" : ""}>
                      <td className="ana-td-idx">{idx + 1}</td>
                      <CellInput
                        value={row.itemName}
                        error={row._errors.itemName}
                        placeholder="e.g. CAT6 cable box"
                        onChange={(e) => updateRow(row.id, "itemName", e.target.value)}
                      />
                      <CellInput
                        value={row.vendor}
                        error={row._errors.vendor}
                        placeholder="Supplier name"
                        onChange={(e) => updateRow(row.id, "vendor", e.target.value)}
                      />
                      <CellInput
                        value={row.quantity}
                        error={row._errors.quantity}
                        type="number"
                        min="1"
                        className="ana-qty-input"
                        onChange={(e) => updateRow(row.id, "quantity", e.target.value)}
                      />
                      <CellInput
                        value={row.purchaseDate}
                        error={row._errors.purchaseDate}
                        type="date"
                        onChange={(e) => updateRow(row.id, "purchaseDate", e.target.value)}
                      />
                      <CellInput
                        value={row.location}
                        placeholder="Site / room"
                        onChange={(e) => updateRow(row.id, "location", e.target.value)}
                      />
                      <td className="ana-td-photos">
                        <div className="ana-photo-cell">
                          <label className="ana-photo-btn">
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              style={{ display: "none" }}
                              onChange={(e) => {
                                uploadFiles(row.id, "photos", e.target.files);
                                e.target.value = "";
                              }}
                            />
                            Upload
                          </label>
                          {row.photos.length > 0 && (
                            <button
                              type="button"
                              className="ana-photo-count-btn"
                              onClick={() => {
                                setPreviewField("photos");
                                setPhotoPreview(row.id);
                              }}
                            >
                              {row.photos.length}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="ana-td-photos">
                        <div className="ana-photo-cell">
                          <label className="ana-photo-btn">
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              style={{ display: "none" }}
                              onChange={(e) => {
                                uploadFiles(row.id, "receipts", e.target.files);
                                e.target.value = "";
                              }}
                            />
                            Receipt
                          </label>
                          {row.receipts.length > 0 && (
                            <button
                              type="button"
                              className="ana-photo-count-btn"
                              onClick={() => {
                                setPreviewField("receipts");
                                setPhotoPreview(row.id);
                              }}
                            >
                              {row.receipts.length}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="ana-td-action">
                        <button
                          type="button"
                          className="ana-btn-rm-row"
                          onClick={() => removeRow(row.id)}
                          disabled={rows.length === 1}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button type="button" className="ana-btn-add-row" onClick={addRow}>+ Add Row</button>
          </section>

          <div className="ana-footer">
            <div className="ana-footer-info">
              {!allValid && submitted && (
                <span className="ana-footer-warn">Fix validation errors above before submitting</span>
              )}
              {successMsg && <span className="ana-footer-success">{successMsg}</span>}
            </div>
            <div className="ana-footer-actions">
              <button
                type="button"
                className="ana-btn-cancel"
                onClick={() => navigate(`${BASE}?cat=${encodeURIComponent(inventoryCategory)}`)}
              >
                Cancel
              </button>
              <button type="button" className="ana-btn-submit" onClick={handleSubmit}>
                Save to Inventory
              </button>
            </div>
          </div>
    </>
  );

  return (
    <>
      {compact ? (
        formBody
      ) : (
        <div className="ana-page">
          <main className="ana-main">
            <section className="ana-section">
              <div className="ana-section-head">
                <span className="ana-section-num">01</span>
                <h2>{sectionTitle}</h2>
              </div>
              {hint ? <p className="ana-office-hint">{hint}</p> : null}
            </section>
            {formBody}
          </main>
        </div>
      )}

      {photoPreview && (
        <PhotoModal
          photos={previewPhotos}
          onClose={() => setPhotoPreview(null)}
          onRemovePhoto={(i) => {
            removeFile(photoPreview, previewField, i);
            if (previewPhotos.length <= 1) setPhotoPreview(null);
          }}
        />
      )}
    </>
  );
}
