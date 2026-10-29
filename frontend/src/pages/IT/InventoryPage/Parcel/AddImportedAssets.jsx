
import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast as rtToast } from "react-toastify";
import ClickableImage from "../../../../components/ClickableImage";
import { createParcelImportsAPI, toastITApiFailure, syncParcelsFromAPI } from "../../Data";
import { encodeInventoryFiles, isUploadAbort, useInventoryUpload } from "../InventoryUploadLock";
import "./AddImportedAssets.css";

const BACK_PATH = "/it/inventory/parcels";

const createBlankRow = () => ({
  id: Date.now() + Math.random(),
  assetName: "",
  count: "",
  from: "",
  date: "",
  idNo: "",
  receivedBy: "",
  photos: [],
  _errors: {},
});

const validateRow = (row) => {
  const errors = {};
  if (!row.assetName.trim())                 errors.assetName  = "Required";
  if (!row.count || parseInt(row.count) < 1) errors.count      = "Min 1";
  if (!row.from.trim())                      errors.from       = "Required";
  if (!row.date)                             errors.date       = "Required";
  if (!row.receivedBy.trim())                errors.receivedBy = "Required";
  return errors;
};

const hasErrors = (row) => Object.keys(row._errors).length > 0;

function Field({ label, required, optional, error, children }) {
  return (
    <label className={`ai-field${error ? " has-error" : ""}`}>
      <span className="ai-field-label">
        {label}
        {required ? <span className="req"> *</span> : null}
        {optional ? <span className="ai-optional">optional</span> : null}
      </span>
      {children}
      {error ? <span className="ai-cell-err">{error}</span> : null}
    </label>
  );
}

function PhotoField({ rowId, photos, busy, onUpload, onRemove }) {
  const handleChange = (e) => {
    onUpload(rowId, e.target.files);
    e.target.value = null;
  };

  return (
    <div className="ai-field ai-field-photos">
      <span className="ai-field-label">
        Photos <span className="ai-optional">optional</span>
      </span>
      <div className="ai-photo-row">
        <label className={`ai-photo-btn${busy ? " is-busy" : ""}`}>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            style={{ display: "none" }}
            onChange={handleChange}
          />
          {busy ? "Uploading…" : "+ Upload photos"}
        </label>
        {photos.length > 0 && (
          <span className="ai-photo-count">{photos.length} attached</span>
        )}
      </div>
      {photos.length > 0 && (
        <div className="ai-photo-thumbs">
          {photos.map((src, i) => (
            <div key={i} className="ai-photo-thumb-wrap">
              <ClickableImage src={src} alt={`photo-${i}`} className="ai-photo-thumb" />
              <button
                type="button"
                className="ai-photo-thumb-remove"
                onClick={() => onRemove(rowId, i)}
                aria-label="Remove photo"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportCard({ row, index, isOnly, busy, onUpdate, onRemove, onPhotoUpload, onPhotoRemove }) {
  const set = (field) => (e) => onUpdate(row.id, field, e.target.value);

  return (
    <article className={`ai-record${hasErrors(row) ? " is-invalid" : ""}`}>
      <header className="ai-record-head">
        <div className="ai-record-title">
          <span className="ai-record-num">{String(index + 1).padStart(2, "0")}</span>
          <div>
            <h3>Import record</h3>
            <p>{row.assetName.trim() || "Untitled shipment"}</p>
          </div>
        </div>
        <button
          type="button"
          className="ai-btn-remove"
          onClick={() => onRemove(row.id)}
          disabled={isOnly}
          title={isOnly ? "At least one record is required" : "Remove record"}
          aria-label="Remove record"
        >
          Remove
        </button>
      </header>

      <div className="ai-record-grid">
        <Field label="Asset name" required error={row._errors.assetName}>
          <input
            className="ai-cell-input"
            value={row.assetName}
            placeholder="e.g. Dell Laptop"
            onChange={set("assetName")}
          />
        </Field>
        <Field label="Count" required error={row._errors.count}>
          <input
            className="ai-cell-input ai-input-narrow"
            type="number"
            min="1"
            value={row.count}
            placeholder="Qty"
            onChange={set("count")}
          />
        </Field>
        <Field label="From" required error={row._errors.from}>
          <input
            className="ai-cell-input"
            value={row.from}
            placeholder="Supplier / source"
            onChange={set("from")}
          />
        </Field>
        <Field label="Date" required error={row._errors.date}>
          <input
            className="ai-cell-input"
            type="date"
            value={row.date}
            onChange={set("date")}
          />
        </Field>
        <Field label="ID number" optional>
          <input
            className="ai-cell-input"
            value={row.idNo}
            placeholder="e.g. INV-2024-001"
            onChange={set("idNo")}
          />
        </Field>
        <Field label="Received by" required error={row._errors.receivedBy}>
          <input
            className="ai-cell-input"
            value={row.receivedBy}
            placeholder="Name of receiver"
            onChange={set("receivedBy")}
          />
        </Field>
        <PhotoField
          rowId={row.id}
          photos={row.photos}
          busy={busy}
          onUpload={onPhotoUpload}
          onRemove={onPhotoRemove}
        />
      </div>
    </article>
  );
}

export default function AddImportedAssets() {
  const navigate = useNavigate();
  const { runUpload, busy } = useInventoryUpload();

  const [rows,        setRows]        = useState([createBlankRow()]);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [toast,       setToast]       = useState("");

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

  const addRow = () => setRows((prev) => [...prev, createBlankRow()]);

  const removeRow = (id) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));

  const updateRow = useCallback(
    (id, field, value) => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.id !== id) return row;
          const updated = { ...row, [field]: value };
          if (isSubmitted) updated._errors = validateRow(updated);
          return updated;
        })
      );
    },
    [isSubmitted]
  );

  const handlePhotoUpload = useCallback(async (rowId, files) => {
    if (!files?.length || busy) return;
    try {
      const encoded = await runUpload("Preparing photos…", ({ signal, setProgress }) =>
        encodeInventoryFiles(files, { imagesOnly: true, signal, onProgress: setProgress }),
      );
      const dataURLs = encoded.map((e) => e.data);
      setRows((prev) =>
        prev.map((row) =>
          row.id === rowId ? { ...row, photos: [...row.photos, ...dataURLs] } : row
        )
      );
    } catch (e) {
      if (!isUploadAbort(e)) rtToast.error(e?.message || "Photo upload failed.");
    }
  }, [busy, runUpload]);

  const removePhoto = useCallback((rowId, photoIndex) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? { ...row, photos: row.photos.filter((_, i) => i !== photoIndex) }
          : row
      )
    );
  }, []);

  const handleSubmit = async () => {
    if (busy) {
      rtToast.warn("Please wait for uploads to finish.");
      return;
    }
    setIsSubmitted(true);

    const validatedRows = rows.map((r) => ({ ...r, _errors: validateRow(r) }));
    setRows(validatedRows);
    if (!validatedRows.every((r) => !hasErrors(r))) return;

    const newEntries = validatedRows.map((r) => ({
      id:         `IMP-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`,
      assetName:  r.assetName.trim(),
      count:      parseInt(r.count, 10),
      from:       r.from.trim(),
      date:       r.date,
      idNo:       r.idNo.trim(),
      receivedBy: r.receivedBy.trim(),
      photos:     r.photos,
    }));

    try {
      await createParcelImportsAPI(newEntries);
      try {
        await syncParcelsFromAPI();
      } catch (syncErr) {
        console.warn("[AddImportedAssets] Sync after save failed:", syncErr);
        try {
          const existing = JSON.parse(localStorage.getItem("pcl_imported") || "[]");
          localStorage.setItem(
            "pcl_imported",
            JSON.stringify([...newEntries, ...(Array.isArray(existing) ? existing : [])]),
          );
          window.dispatchEvent(new Event("inventory-updated"));
        } catch {
          /* ignore local cache merge errors */
        }
      }

      showToast(`✅ ${newEntries.length} import record${newEntries.length !== 1 ? "s" : ""} saved!`);
      setRows([createBlankRow()]);
      setIsSubmitted(false);
    } catch (e) {
      console.error("[AddImportedAssets] Save failed:", e);
      const msg = toastITApiFailure(e, "Failed to save import records.");
      showToast(`⚠️ ${msg}`);
    }
  };

  const handleCancel = () => navigate(BACK_PATH);
  const invalidCount = isSubmitted ? rows.filter(hasErrors).length : 0;

  return (
    <div className="ai-page">
      {toast && <div className="ai-toast" role="status">{toast}</div>}

      <div className="ai-topbar">
        <button type="button" className="ai-back-btn" onClick={handleCancel}>
          ← Back to Import/Export
        </button>
        <div className="ai-topbar-copy">
          <h1 className="ai-title">Add Imported Assets</h1>
          <p className="ai-subtitle">Record incoming shipments. Fields marked <span className="req">*</span> are required.</p>
        </div>
      </div>

      <main className="ai-main">
        <section className="ai-card">
          <div className="ai-card-head">
            <div>
              <span className="ai-section-num">01</span>
              <span className="ai-card-title">Import records</span>
            </div>
            <span className="ai-row-count">
              {rows.length} record{rows.length !== 1 ? "s" : ""}
            </span>
          </div>

          <p className="ai-required-legend">
            Required: Asset name, Count, From, Date, Received by. ID number and photos are optional.
          </p>

          <div className="ai-records">
            {rows.map((row, index) => (
              <ImportCard
                key={row.id}
                row={row}
                index={index}
                isOnly={rows.length === 1}
                busy={busy}
                onUpdate={updateRow}
                onRemove={removeRow}
                onPhotoUpload={handlePhotoUpload}
                onPhotoRemove={removePhoto}
              />
            ))}
          </div>

          <button type="button" className="ai-btn-add-row" onClick={addRow}>
            + Add another record
          </button>
        </section>
      </main>

      <div className="ai-footer">
        <div className="ai-footer-info">
          {invalidCount > 0 && (
            <span className="ai-footer-warn">
              Fix {invalidCount} record{invalidCount !== 1 ? "s" : ""} before saving
            </span>
          )}
        </div>
        <div className="ai-footer-actions">
          <button type="button" className="ai-btn-cancel" onClick={handleCancel}>
            Cancel
          </button>
          <button type="button" className="ai-btn-submit" onClick={handleSubmit} disabled={busy}>
            Save import records
          </button>
        </div>
      </div>
    </div>
  );
}
