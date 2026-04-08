
import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "./AddImportedAssets.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const BACK_PATH = "/it/inventory/parcels";

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

const readFilesAsDataURLs = (files) =>
  Promise.all(
    Array.from(files).map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload  = (e) => resolve(e.target.result);
          reader.onerror = () => reject(new Error(`Failed to read: ${file.name}`));
          reader.readAsDataURL(file);
        })
    )
  );

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Single table cell with an input + optional inline error. */
const CellInput = ({ value, onChange, placeholder, error, type = "text", ...rest }) => (
  <td>
    <input
      className={`ai-cell-input${error ? " err" : ""}`}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      {...rest}
    />
    {error && <span className="ai-cell-err">{error}</span>}
  </td>
);

/** Photo upload button + thumbnail strip for a single row. */
const PhotoCell = ({ rowId, photos, onUpload, onRemove }) => {
  const handleChange = (e) => {
    onUpload(rowId, e.target.files);
    e.target.value = null;
  };

  return (
    <td className="ai-td-photos">
      <label className="ai-photo-btn">
        <input
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={handleChange}
        />
        + Upload
      </label>

      {photos.length > 0 && (
        <div className="ai-photo-thumbs">
          {photos.map((src, i) => (
            <div key={i} className="ai-photo-thumb-wrap">
              <img src={src} alt={`photo-${i}`} className="ai-photo-thumb" />
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
    </td>
  );
};

/** One editable import row. */
const ImportRow = ({ row, index, isOnly, onUpdate, onRemove, onPhotoUpload, onPhotoRemove }) => (
  <tr className={hasErrors(row) ? "row-invalid" : ""}>
    <td className="ai-td-idx">{index + 1}</td>

    <CellInput
      value={row.assetName}
      error={row._errors.assetName}
      placeholder="e.g. Dell Laptop"
      onChange={(e) => onUpdate(row.id, "assetName", e.target.value)}
    />
    <CellInput
      value={row.count}
      error={row._errors.count}
      placeholder="Qty"
      type="number"
      min="1"
      onChange={(e) => onUpdate(row.id, "count", e.target.value)}
    />
    <CellInput
      value={row.from}
      error={row._errors.from}
      placeholder="Supplier / Source"
      onChange={(e) => onUpdate(row.id, "from", e.target.value)}
    />
    <CellInput
      value={row.date}
      error={row._errors.date}
      type="date"
      onChange={(e) => onUpdate(row.id, "date", e.target.value)}
    />
    <CellInput
      value={row.idNo}
      placeholder="e.g. INV-2024-001"
      onChange={(e) => onUpdate(row.id, "idNo", e.target.value)}
    />
    <CellInput
      value={row.receivedBy}
      error={row._errors.receivedBy}
      placeholder="Name of receiver"
      onChange={(e) => onUpdate(row.id, "receivedBy", e.target.value)}
    />

    <PhotoCell
      rowId={row.id}
      photos={row.photos}
      onUpload={onPhotoUpload}
      onRemove={onPhotoRemove}
    />

    <td>
      <button
        type="button"
        className="ai-btn-remove"
        onClick={() => onRemove(row.id)}
        disabled={isOnly}
        title="Remove row"
        aria-label="Remove row"
      >
        ✕
      </button>
    </td>
  </tr>
);

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AddImportedAssets() {
  const navigate = useNavigate();

  const [rows,        setRows]        = useState([createBlankRow()]);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [toast,       setToast]       = useState("");

  // ── Toast ──────────────────────────────────────────────────────────────────
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

  // ── Row management ─────────────────────────────────────────────────────────
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

  // ── Photo management ────────────────────────────────────────────────────────
  const handlePhotoUpload = useCallback(async (rowId, files) => {
    if (!files?.length) return;
    try {
      const dataURLs = await readFilesAsDataURLs(files);
      setRows((prev) =>
        prev.map((row) =>
          row.id === rowId ? { ...row, photos: [...row.photos, ...dataURLs] } : row
        )
      );
    } catch (e) {
      console.error("[AddImportedAssets] Photo upload failed:", e);
    }
  }, []);

  const removePhoto = useCallback((rowId, photoIndex) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? { ...row, photos: row.photos.filter((_, i) => i !== photoIndex) }
          : row
      )
    );
  }, []);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = () => {
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
      const existing = JSON.parse(localStorage.getItem("pcl_imported") || "[]");
      localStorage.setItem("pcl_imported", JSON.stringify([...newEntries, ...existing]));
      window.dispatchEvent(new Event("inventory-updated"));

      showToast(`✅ ${newEntries.length} import record${newEntries.length !== 1 ? "s" : ""} saved!`);
      setRows([createBlankRow()]);
      setIsSubmitted(false);
    } catch (e) {
      console.error("[AddImportedAssets] Save failed:", e);
      showToast("❌ Failed to save. Please try again.");
    }
  };

  const handleCancel = () => navigate(BACK_PATH);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="ai-page">
      {toast && <div className="ai-toast" role="status">{toast}</div>}

      {/* Top Bar */}
      <div className="ai-topbar">
        <button type="button" className="ai-back-btn" onClick={handleCancel}>
          ← Back to Parcels
        </button>
        <div>
          <h1 className="ai-title">Add Imported Assets</h1>
        </div>
      </div>

      {/* Table Card */}
      <div className="ai-card">
        <div className="ai-card-head">
          <span className="ai-card-title">Import Records</span>
          <span className="ai-row-count">
            {rows.length} row{rows.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="ai-table-wrap ai-table-wrap--scroll">
          <table className="ai-table">
            <thead className="ai-thead-sticky">
              <tr>
                <th className="ai-th-sticky">#</th>
                <th className="ai-th-sticky">Assets Name <span className="req">*</span></th>
                <th className="ai-th-sticky">Count <span className="req">*</span></th>
                <th className="ai-th-sticky">From <span className="req">*</span></th>
                <th className="ai-th-sticky">Date <span className="req">*</span></th>
                <th className="ai-th-sticky">ID No</th>
                <th className="ai-th-sticky">Received By <span className="req">*</span></th>
                <th className="ai-th-sticky">Photos</th>
                <th className="ai-th-sticky" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <ImportRow
                  key={row.id}
                  row={row}
                  index={index}
                  isOnly={rows.length === 1}
                  onUpdate={updateRow}
                  onRemove={removeRow}
                  onPhotoUpload={handlePhotoUpload}
                  onPhotoRemove={removePhoto}
                />
              ))}
            </tbody>
          </table>
        </div>

        <button type="button" className="ai-btn-add-row" onClick={addRow}>
          + Add Row
        </button>
      </div>

      {/* Footer */}
      <div className="ai-footer">
        <button type="button" className="ai-btn-cancel" onClick={handleCancel}>
          Cancel
        </button>
        <button type="button" className="ai-btn-submit" onClick={handleSubmit}>
          Save Import Records
        </button>
      </div>
    </div>
  );
}


