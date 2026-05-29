import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  compressImage,
  createHardwareUnitsAPI,
  createInventoryItemAPI,
  getITApiErrorMessage,
  syncITDataFromAPI,
} from "../Data";
import { INVENTORY_CATEGORY_CONFIG } from "../inventoryCategories";
import "./AddnewAssets.css";

const BASE = "/it/inventory";
const INV_CAT = "Transport Assets";
const HW_TYPES = INVENTORY_CATEGORY_CONFIG[INV_CAT]?.hwTypes || ["Car", "Van", "Other"];

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
  receipts: [],
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
  const [vehicleType, setVehicleType] = useState(HW_TYPES[0]);
  const [customType, setCustomType] = useState("");
  const [rows, setRows] = useState([blankRow()]);
  const [submitted, setSubmitted] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const effectiveType = vehicleType === "Other" ? customType.trim() : vehicleType;

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

  const handleSubmit = useCallback(async () => {
    setSubmitted(true);
    if (vehicleType === "Other" && !customType.trim()) {
      toast.error("Enter a vehicle type for Other.");
      return;
    }
    const validated = rows.map((r) => ({ ...r, _errors: validateRow(r) }));
    setRows(validated);
    if (!validated.every((r) => Object.keys(r._errors).length === 0)) return;

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
        const invRes = await createInventoryItemAPI({
          name: fleetName,
          category: "Vehicle",
          inventoryCategory: INV_CAT,
          hwType: effectiveType,
          vendor: head.vendor.trim() || null,
          purchaseDate: head.purchaseDate,
          receipts: head.receipts || [],
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
      setSuccessMsg(`✅ ${added} vehicle${added !== 1 ? "s" : ""} registered.`);
      setRows([blankRow()]);
      setSubmitted(false);
    } catch (err) {
      toast.error(getITApiErrorMessage(err, "Failed to save vehicles."));
    }
  }, [rows, vehicleType, customType, effectiveType]);

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
                      setVehicleType(e.target.value);
                      if (e.target.value !== "Other") setCustomType("");
                    }}
                  >
                    {HW_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <span className="ana-hwtype-chevron">▾</span>
                </div>
              </div>
              {vehicleType === "Other" && (
                <div className="ana-hwtype-custom-block">
                  <label className="ana-hwtype-label">Type name <span className="req">*</span></label>
                  <input
                    className="ana-hwtype-custom-input"
                    placeholder="e.g. Forklift"
                    value={customType}
                    onChange={(e) => setCustomType(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="ana-section ana-section-table">
          <div className="ana-section-head">
            <span className="ana-section-num">02</span>
            <h2>Add vehicles — {effectiveType || "Other"}</h2>
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
                    <td className="ana-td-photos">
                      <label className="ana-photo-btn">
                        <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { uploadFiles(row.id, "photos", e.target.files); e.target.value = ""; }} />
                        Upload
                      </label>
                    </td>
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
            <button type="button" className="ana-btn-submit" onClick={handleSubmit}>Save to Inventory</button>
          </div>
        </div>
      </main>
    </div>
  );
}
