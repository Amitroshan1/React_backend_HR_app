import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  createHardwareUnitsAPI,
  createInventoryItemAPI,
  toastITApiFailure,
  syncITDataFromAPI,
} from "../Data";
import {
  encodeInventoryFiles,
  getFieldMeta,
  InventoryFileCell,
} from "./inventoryFileUpload";
import {
  ADD_NEW_HW_TYPE_VALUE,
  addCustomHwType,
  getHwTypesForCategory,
  hwTypeOptionLabel,
  subscribeHwTypesChange,
} from "../inventoryCategories";
import "./AddnewAssets.css";

const BASE = "/it/inventory";
const INV_CAT = "Transport Assets";

const blankRow = () => ({
  id: Date.now() + Math.random(),
  fleet: "",
  make: "",
  model: "",
  registration: "",
  vendor: "",
  purchaseDate: "",
  location: "",
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

function validateRow(row) {
  const errors = {};
  if (!row.fleet.trim()) errors.fleet = "Required";
  if (!row.make.trim()) errors.make = "Required";
  if (!row.model.trim()) errors.model = "Required";
  if (!row.registration.trim()) {
    errors.registration = "Required";
  } else {
    const reg = row.registration.trim();
    if (reg.length < 4) errors.registration = "Min 4 characters";
    else if (!/^[A-Za-z0-9][A-Za-z0-9\s-]*$/.test(reg)) {
      errors.registration = "Invalid format";
    }
  }
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

export default function TransportVehicleForm() {
  const navigate = useNavigate();
  const [hwTypes, setHwTypes] = useState(() =>
    getHwTypesForCategory(INV_CAT, { includeAddNew: true }),
  );
  const [vehicleType, setVehicleType] = useState(
    () => getHwTypesForCategory(INV_CAT)[0] || "Car",
  );
  const [customType, setCustomType] = useState("");
  const [rows, setRows] = useState([blankRow()]);
  const [submitted, setSubmitted] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const refresh = () => setHwTypes(getHwTypesForCategory(INV_CAT, { includeAddNew: true }));
    refresh();
    return subscribeHwTypesChange(refresh);
  }, []);

  const isAddingNew = vehicleType === ADD_NEW_HW_TYPE_VALUE;
  const effectiveType = isAddingNew ? "" : vehicleType;

  const confirmNewType = useCallback(() => {
    const saved = addCustomHwType(INV_CAT, customType);
    if (!saved) {
      toast.error("Enter a valid vehicle type name.");
      return;
    }
    setHwTypes(getHwTypesForCategory(INV_CAT, { includeAddNew: true }));
    setVehicleType(saved);
    setCustomType("");
    toast.success(`Vehicle type “${saved}” added`);
  }, [customType]);

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
      if (names.length === 1) {
        toast.success(`"${names[0]}" added.`);
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

  const handleSubmit = useCallback(async () => {
    setSubmitted(true);
    if (isAddingNew) {
      toast.error("Confirm the new vehicle type before saving.");
      return;
    }
    const validated = rows.map((r) => ({ ...r, _errors: validateRow(r) }));
    setRows(validated);
    if (!validated.every((r) => Object.keys(r._errors).length === 0)) return;
    if (validated.some((r) => r.photoUploading || r.receiptUploading)) {
      toast.warn("Please wait for uploads to finish.");
      return;
    }

    setSaving(true);
    try {
      const groups = new Map();
      validated.forEach((row) => {
        const key = `${row.fleet.trim().toLowerCase()}|${effectiveType.toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      });

      let added = 0;
      for (const groupRows of groups.values()) {
        const head = groupRows[0];
        const fleetName = head.fleet.trim();
        const fleetReceipts = groupRows.flatMap((r) => r.receipts || []);
        const invRes = await createInventoryItemAPI({
          name: fleetName,
          category: "Vehicle",
          inventoryCategory: INV_CAT,
          hwType: effectiveType,
          vendor: head.vendor.trim() || null,
          purchaseDate: head.purchaseDate,
          receipts: fleetReceipts,
          location: head.location.trim() || null,
          photos: [],
        });
        const inventoryItemId = invRes?.item?.id;
        if (!inventoryItemId) continue;

        await createHardwareUnitsAPI({
          inventoryItemId,
          assetName: fleetName,
          category: "Vehicle",
          hwType: effectiveType,
          rows: groupRows.map((r) => ({
            brand: r.fleet.trim(),
            make: r.make.trim(),
            model: r.model.trim(),
            serialNumber: r.registration.trim(),
            photos: r.photos || [],
          })),
        });
        added += groupRows.length;
      }

      await syncITDataFromAPI();
      const msg = `${added} vehicle${added !== 1 ? "s" : ""} registered.`;
      setSuccessMsg(`✅ ${msg}`);
      toast.success(msg);
      setRows([blankRow()]);
      setSubmitted(false);
    } catch (err) {
      toastITApiFailure(err, "Failed to save vehicles.");
    } finally {
      setSaving(false);
    }
  }, [rows, vehicleType, effectiveType, isAddingNew]);

  return (
    <div className="ana-page">
      <main className="ana-main">
        <section className="ana-section">
          <div className="ana-section-head">
            <span className="ana-section-num">01</span>
            <h2>Vehicle register</h2>
          </div>
          <p className="ana-office-hint">
            One row per vehicle (registration number). Track repair and status per vehicle — not assigned to employees in HR assign flow.
          </p>
          <div className="ana-category-row" style={{ marginTop: 12 }}>
            <div className="ana-hwtype-dropdown-wrap">
              <div className="ana-hwtype-select-block">
                <label className="ana-hwtype-label" htmlFor="transport-type">Vehicle type</label>
                <div className="ana-hwtype-select-wrap">
                  <select
                    id="transport-type"
                    className="ana-hwtype-select"
                    value={vehicleType}
                    onChange={(e) => {
                      const v = e.target.value;
                      setVehicleType(v);
                      setCustomType("");
                    }}
                  >
                    {hwTypes.map((t) => (
                      <option key={t} value={t}>
                        {hwTypeOptionLabel(t)}
                      </option>
                    ))}
                  </select>
                  <span className="ana-hwtype-chevron">▾</span>
                </div>
              </div>
              {isAddingNew && (
                <div className="ana-hwtype-custom-block">
                  <label className="ana-hwtype-label">
                    New type name <span className="req">*</span>
                  </label>
                  <div className="ana-hwtype-custom-row">
                    <input
                      className="ana-hwtype-custom-input"
                      placeholder="e.g. Forklift"
                      value={customType}
                      onChange={(e) => setCustomType(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          confirmNewType();
                        }
                      }}
                    />
                    <button type="button" className="ana-hwtype-add-btn" onClick={confirmNewType}>
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {!isAddingNew && (
          <>
            <section className="ana-section ana-section-table">
              <div className="ana-section-head">
                <span className="ana-section-num">02</span>
                <h2>Add vehicles — {effectiveType || "Vehicle"}</h2>
              </div>
              <div className="ana-table-wrap">
                <table className="ana-table">
                  <thead>
                    <tr>
                      <th className="ana-th-idx">#</th>
                      <th>Fleet / owner <span className="req">*</span></th>
                      <th>Make <span className="req">*</span></th>
                      <th>Model <span className="req">*</span></th>
                      <th>Registration <span className="req">*</span></th>
                      <th>Dealer / vendor</th>
                      <th>Purchase date <span className="req">*</span></th>
                      <th>Parking / location</th>
                      <th>Photos</th>
                      <th>Receipt</th>
                      <th className="ana-th-action" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={row.id} className={Object.keys(row._errors).length ? "row-invalid" : ""}>
                        <td className="ana-td-idx">{idx + 1}</td>
                        <CellInput value={row.fleet} error={row._errors.fleet} placeholder="Company fleet" onChange={(e) => updateRow(row.id, "fleet", e.target.value)} />
                        <CellInput value={row.make} error={row._errors.make} placeholder="Toyota" onChange={(e) => updateRow(row.id, "make", e.target.value)} />
                        <CellInput value={row.model} error={row._errors.model} placeholder="Innova" onChange={(e) => updateRow(row.id, "model", e.target.value)} />
                        <CellInput value={row.registration} error={row._errors.registration} placeholder="MH12AB1234" className="mono" onChange={(e) => updateRow(row.id, "registration", e.target.value)} />
                        <CellInput value={row.vendor} placeholder="Dealer" onChange={(e) => updateRow(row.id, "vendor", e.target.value)} />
                        <CellInput value={row.purchaseDate} error={row._errors.purchaseDate} type="date" onChange={(e) => updateRow(row.id, "purchaseDate", e.target.value)} />
                        <CellInput value={row.location} placeholder="Parking" onChange={(e) => updateRow(row.id, "location", e.target.value)} />
                        <InventoryFileCell
                          row={row}
                          field="photos"
                          buttonLabel="Upload"
                          accept="image/*"
                          imagesOnly
                          onUpload={uploadFiles}
                        />
                        <InventoryFileCell
                          row={row}
                          field="receipts"
                          buttonLabel="Receipt"
                          accept="*/*"
                          imagesOnly={false}
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
        )}
      </main>
    </div>
  );
}
