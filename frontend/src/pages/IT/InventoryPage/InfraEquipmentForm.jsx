import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  createHardwareUnitsAPI,
  createInventoryItemAPI,
  getITApiErrorMessage,
  syncITDataFromAPI,
} from "../Data";
import {
  encodeInventoryFiles,
  getFieldMeta,
  InventoryFileCell,
} from "./inventoryFileUpload";
import { INVENTORY_CATEGORY_CONFIG } from "../inventoryCategories";
import "./AddnewAssets.css";

const BASE = "/it/inventory";
const INV_CAT = "Infrastructure Assets";
const EQUIP_TYPES =
  INVENTORY_CATEGORY_CONFIG[INV_CAT]?.equipmentTypes ||
  ["Networking", "Power", "Cooling", "Security", "Other"];

const blankRow = () => ({
  id: Date.now() + Math.random(),
  assetName: "",
  location: "",
  assetTag: "",
  make: "",
  model: "",
  vendor: "",
  purchaseDate: "",
  photos: [],
  photoNames: [],
  photoUploading: false,
  _uploadingPhotoNames: [],
  _errors: {},
});

function validateRow(row) {
  const errors = {};
  if (!row.assetName.trim()) errors.assetName = "Required";
  if (!row.location.trim()) errors.location = "Required";
  if (!row.assetTag.trim()) errors.assetTag = "Required";
  if (!row.purchaseDate) errors.purchaseDate = "Required";
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

export default function InfraEquipmentForm({ equipmentType, customType }) {
  const navigate = useNavigate();
  const effectiveType = equipmentType === "Other" ? customType.trim() : equipmentType;
  const [rows, setRows] = useState([blankRow()]);
  const [submitted, setSubmitted] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const updateRow = useCallback((id, field, value) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const updated = { ...r, [field]: value };
        if (submitted) updated._errors = validateRow(updated);
        return updated;
      }),
    );
  }, [submitted]);

  const uploadFiles = useCallback(async (rowId, field, files, { imagesOnly = true } = {}) => {
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
      if (names.length === 1) {
        toast.success(`Photo "${names[0]}" added.`);
      } else {
        toast.success(`${names.length} photos added.`);
      }
    } catch (err) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? { ...r, [meta.uploadingKey]: false, [meta.pendingKey]: [] }
            : r,
        ),
      );
      toast.error(err?.message || "Could not process image.");
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    setSubmitted(true);
    if (equipmentType === "Other" && !customType.trim()) {
      toast.error("Enter equipment type for Other.");
      return;
    }
    const validated = rows.map((r) => ({ ...r, _errors: validateRow(r) }));
    setRows(validated);
    if (!validated.every((r) => Object.keys(r._errors).length === 0)) return;
    if (validated.some((r) => r.photoUploading)) {
      toast.warn("Please wait for uploads to finish.");
      return;
    }

    setSaving(true);
    try {
      let added = 0;
      for (const row of validated) {
        const name = row.assetName.trim();
        const invRes = await createInventoryItemAPI({
          name,
          category: "Equipment",
          inventoryCategory: INV_CAT,
          hwType: effectiveType,
          vendor: row.vendor.trim() || null,
          purchaseDate: row.purchaseDate,
          location: row.location.trim(),
          photos: row.photos || [],
        });
        const inventoryItemId = invRes?.item?.id;
        if (!inventoryItemId) continue;

        await createHardwareUnitsAPI({
          inventoryItemId,
          assetName: name,
          category: "Equipment",
          hwType: effectiveType,
          rows: [
            {
              brand: row.make.trim() || name,
              make: row.make.trim() || "",
              model: row.model.trim() || "—",
              serialNumber: row.assetTag.trim(),
              photos: row.photos || [],
            },
          ],
        });
        added += 1;
      }

      await syncITDataFromAPI();
      const msg = `${added} equipment item${added !== 1 ? "s" : ""} saved.`;
      setSuccessMsg(`✅ ${msg}`);
      toast.success(msg);
      setRows([blankRow()]);
      setSubmitted(false);
    } catch (err) {
      toast.error(getITApiErrorMessage(err, "Failed to save equipment."));
    } finally {
      setSaving(false);
    }
  }, [rows, equipmentType, customType, effectiveType]);

  return (
    <>
      <section className="ana-section ana-section-table">
        <div className="ana-section-head">
          <span className="ana-section-num">02</span>
          <h2>Installed equipment — {effectiveType || "Other"}</h2>
        </div>
        <div className="ana-table-wrap">
          <table className="ana-table">
            <thead>
              <tr>
                <th className="ana-th-idx">#</th>
                <th>Asset name <span className="req">*</span></th>
                <th>Site / location <span className="req">*</span></th>
                <th>Asset tag / ID <span className="req">*</span></th>
                <th>Make</th>
                <th>Model</th>
                <th>Vendor</th>
                <th>Purchase date <span className="req">*</span></th>
                <th>Photos</th>
                <th className="ana-th-action" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id} className={Object.keys(row._errors).length ? "row-invalid" : ""}>
                  <td className="ana-td-idx">{idx + 1}</td>
                  <CellInput value={row.assetName} error={row._errors.assetName} placeholder="e.g. Core switch" onChange={(e) => updateRow(row.id, "assetName", e.target.value)} />
                  <CellInput value={row.location} error={row._errors.location} placeholder="Server room A" onChange={(e) => updateRow(row.id, "location", e.target.value)} />
                  <CellInput value={row.assetTag} error={row._errors.assetTag} placeholder="INF-001" className="mono" onChange={(e) => updateRow(row.id, "assetTag", e.target.value)} />
                  <CellInput value={row.make} placeholder="Cisco" onChange={(e) => updateRow(row.id, "make", e.target.value)} />
                  <CellInput value={row.model} placeholder="2960" onChange={(e) => updateRow(row.id, "model", e.target.value)} />
                  <CellInput value={row.vendor} placeholder="Supplier" onChange={(e) => updateRow(row.id, "vendor", e.target.value)} />
                  <CellInput value={row.purchaseDate} error={row._errors.purchaseDate} type="date" onChange={(e) => updateRow(row.id, "purchaseDate", e.target.value)} />
                  <InventoryFileCell
                    row={row}
                    field="photos"
                    buttonLabel="Upload"
                    accept="image/*"
                    imagesOnly
                    onUpload={uploadFiles}
                  />
                  <td className="ana-td-action">
                    <button type="button" className="ana-btn-rm-row" onClick={() => setRows((p) => (p.length > 1 ? p.filter((r) => r.id !== row.id) : p))} disabled={rows.length === 1}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="ana-btn-add-row" onClick={() => setRows((p) => [...p, blankRow()])}>+ Add Row</button>
      </section>

      <div className="ana-footer">
        <div className="ana-footer-info">{successMsg && <span className="ana-footer-success">{successMsg}</span>}</div>
        <div className="ana-footer-actions">
          <button type="button" className="ana-btn-cancel" onClick={() => navigate(`${BASE}?cat=${encodeURIComponent(INV_CAT)}`)}>Cancel</button>
          <button type="button" className="ana-btn-submit" onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving…" : "Save to Inventory"}
          </button>
        </div>
      </div>
    </>
  );
}
