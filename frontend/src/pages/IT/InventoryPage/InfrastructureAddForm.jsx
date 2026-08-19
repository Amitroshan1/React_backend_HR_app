import { useState, useEffect, useCallback } from "react";
import { toast } from "react-toastify";
import StockInventoryForm from "./StockInventoryForm";
import InfraEquipmentForm from "./InfraEquipmentForm";
import {
  ADD_NEW_HW_TYPE_VALUE,
  addCustomHwType,
  getHwTypesForCategory,
  hwTypeOptionLabel,
  subscribeHwTypesChange,
} from "../inventoryCategories";
import "./AddnewAssets.css";

const INV_CAT = "Infrastructure Assets";

export default function InfrastructureAddForm() {
  const [mode, setMode] = useState("stock");
  const [equipTypes, setEquipTypes] = useState(() =>
    getHwTypesForCategory(INV_CAT, { includeAddNew: true }),
  );
  const [equipmentType, setEquipmentType] = useState(
    () => getHwTypesForCategory(INV_CAT)[0] || "Networking",
  );
  const [customType, setCustomType] = useState("");

  useEffect(() => {
    const refresh = () => setEquipTypes(getHwTypesForCategory(INV_CAT, { includeAddNew: true }));
    refresh();
    return subscribeHwTypesChange(refresh);
  }, []);

  const isAddingNew = equipmentType === ADD_NEW_HW_TYPE_VALUE;

  const confirmNewType = useCallback(() => {
    const saved = addCustomHwType(INV_CAT, customType);
    if (!saved) {
      toast.error("Enter a valid equipment type name.");
      return;
    }
    setEquipTypes(getHwTypesForCategory(INV_CAT, { includeAddNew: true }));
    setEquipmentType(saved);
    setCustomType("");
    toast.success(`Equipment type “${saved}” added`);
  }, [customType]);

  return (
    <div className="ana-page">
      <main className="ana-main">
        <section className="ana-section">
          <div className="ana-section-head">
            <span className="ana-section-num">01</span>
            <h2>Infrastructure inventory</h2>
          </div>
          <div className="ana-chip-group">
            <button
              type="button"
              className={`ana-chip ${mode === "stock" ? "selected" : ""}`}
              onClick={() => setMode("stock")}
            >
              Bulk stock
            </button>
            <button
              type="button"
              className={`ana-chip ${mode === "equipment" ? "selected" : ""}`}
              onClick={() => setMode("equipment")}
            >
              Installed equipment
            </button>
          </div>
          <p className="ana-office-hint">
            {mode === "stock"
              ? "Quantity items: cabling, spare UPS batteries, racks — supplier, date, receipts."
              : "Fixed installs with asset tag and site location (switch, generator, AP)."}
          </p>
          {mode === "equipment" && (
            <div className="ana-category-row" style={{ marginTop: 12 }}>
              <div className="ana-hwtype-dropdown-wrap">
                <div className="ana-hwtype-select-block">
                  <label className="ana-hwtype-label">Equipment type</label>
                  <div className="ana-hwtype-select-wrap">
                    <select
                      className="ana-hwtype-select"
                      value={equipmentType}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEquipmentType(v);
                        setCustomType("");
                      }}
                    >
                      {equipTypes.map((t) => (
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
                    <label className="ana-hwtype-label">New type name</label>
                    <div className="ana-hwtype-custom-row">
                      <input
                        className="ana-hwtype-custom-input"
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
          )}
        </section>

        {mode === "stock" ? (
          <StockInventoryForm
            compact
            inventoryCategory={INV_CAT}
            sectionTitle="Bulk stock"
            tableTitle="Add infrastructure stock lines"
            hint=""
            stockCategory="Stock"
            saveErrorMessage="Failed to save infrastructure stock."
          />
        ) : isAddingNew ? (
          <p className="ana-office-hint" style={{ marginTop: 12 }}>
            Add and confirm the new equipment type above to continue.
          </p>
        ) : (
          <InfraEquipmentForm equipmentType={equipmentType} />
        )}
      </main>
    </div>
  );
}
