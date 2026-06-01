import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  createInventoryItemAPI,
  getITApiErrorMessage,
  syncITDataFromAPI,
} from "../Data";
import {
  buildPreviewItems,
  encodeInventoryFiles,
  FilePreviewModal,
  getFieldMeta,
  InventoryFileCell,
} from "./inventoryFileUpload";
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
  photoNames: [],
  photoUploading: false,
  _uploadingPhotoNames: [],
  receipts: [],
  receiptNames: [],
  receiptUploading: false,
  _uploadingReceiptNames: [],
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
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);

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

  const uploadFiles = useCallback(async (rowId, field, files, { imagesOnly = false } = {}) => {
    if (!files?.length) return;
    const meta = getFieldMeta(field);
    const fileList = Array.from(files);
    const pendingNames = fileList.map((f) => f.name);

    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? { ...r, [meta.uploadingKey]: true, [meta.pendingKey]: pendingNames }
          : r,
      ),
    );

    try {
      const encoded = await encodeInventoryFiles(fileList, { imagesOnly });
      const dataUrls = encoded.map((e) => e.data);
      const names = encoded.map((e) => e.name);

      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                [field]: [...(r[field] || []), ...dataUrls],
                [meta.namesKey]: [...(r[meta.namesKey] || []), ...names],
                [meta.uploadingKey]: false,
                [meta.pendingKey]: [],
              }
            : r,
        ),
      );

      const label = imagesOnly ? "Photo" : "File";
      if (names.length === 1) {
        toast.success(`${label} "${names[0]}" added.`);
      } else {
        toast.success(`${names.length} files added.`);
      }
    } catch (err) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? { ...r, [meta.uploadingKey]: false, [meta.pendingKey]: [] }
            : r,
        ),
      );
      toast.error(err?.message || "Could not read file.");
    }
  }, []);

  const removeFile = useCallback((rowId, field, index) => {
    const meta = getFieldMeta(field);
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              [field]: (r[field] || []).filter((_, i) => i !== index),
              [meta.namesKey]: (r[meta.namesKey] || []).filter((_, i) => i !== index),
            }
          : r,
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
    if (validated.some((r) => r.photoUploading || r.receiptUploading)) {
      toast.warn("Please wait for uploads to finish.");
      return;
    }

    setSaving(true);
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
      const msg = `${validated.length} line${validated.length !== 1 ? "s" : ""} saved (qty ${totalQty}).`;
      setSuccessMsg(`✅ ${msg}`);
      toast.success(msg);
      setRows([blankRow()]);
      setSubmitted(false);
    } catch (err) {
      toast.error(getITApiErrorMessage(err, saveErrorMessage));
    } finally {
      setSaving(false);
    }
  }, [rows, inventoryCategory, stockCategory, saveErrorMessage, validateOpts]);

  const previewRow = preview ? rows.find((r) => r.id === preview.rowId) : null;
  const previewItems = previewRow
    ? buildPreviewItems(previewRow[preview.field], previewRow[getFieldMeta(preview.field).namesKey])
    : [];

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
                  <InventoryFileCell
                    row={row}
                    field="photos"
                    buttonLabel="Upload"
                    accept="image/*"
                    imagesOnly
                    onUpload={uploadFiles}
                    onPreview={(rowId, field) => setPreview({ rowId, field })}
                  />
                  <InventoryFileCell
                    row={row}
                    field="receipts"
                    buttonLabel="Receipt"
                    accept="*/*"
                    imagesOnly={false}
                    onUpload={uploadFiles}
                    onPreview={(rowId, field) => setPreview({ rowId, field })}
                  />
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

        <button type="button" className="ana-btn-add-row" onClick={addRow}>
          + Add Row
        </button>
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
          <button type="button" className="ana-btn-submit" onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving…" : "Save to Inventory"}
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

      {preview && previewItems.length > 0 && (
        <FilePreviewModal
          items={previewItems}
          title={preview.field === "receipts" ? "Receipts" : "Photos"}
          onClose={() => setPreview(null)}
          onRemove={(i) => {
            removeFile(preview.rowId, preview.field, i);
            if (previewItems.length <= 1) setPreview(null);
          }}
        />
      )}
    </>
  );
}
