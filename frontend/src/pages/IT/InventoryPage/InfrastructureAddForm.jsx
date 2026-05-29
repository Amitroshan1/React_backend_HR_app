import { useState } from "react";
import StockInventoryForm from "./StockInventoryForm";
import InfraEquipmentForm from "./InfraEquipmentForm";
import { INVENTORY_CATEGORY_CONFIG } from "../inventoryCategories";
import "./AddnewAssets.css";

const INV_CAT = "Infrastructure Assets";
const EQUIP_TYPES =
  INVENTORY_CATEGORY_CONFIG[INV_CAT]?.equipmentTypes ||
  ["Networking", "Power", "Cooling", "Security", "Other"];

export default function InfrastructureAddForm() {
  const [mode, setMode] = useState("stock");
  const [equipmentType, setEquipmentType] = useState(EQUIP_TYPES[0]);
  const [customType, setCustomType] = useState("");

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
                        setEquipmentType(e.target.value);
                        if (e.target.value !== "Other") setCustomType("");
                      }}
                    >
                      {EQUIP_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <span className="ana-hwtype-chevron">▾</span>
                  </div>
                </div>
                {equipmentType === "Other" && (
                  <div className="ana-hwtype-custom-block">
                    <label className="ana-hwtype-label">Type name</label>
                    <input
                      className="ana-hwtype-custom-input"
                      value={customType}
                      onChange={(e) => setCustomType(e.target.value)}
                    />
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
        ) : (
          <InfraEquipmentForm equipmentType={equipmentType} customType={customType} />
        )}
      </main>
    </div>
  );
}
