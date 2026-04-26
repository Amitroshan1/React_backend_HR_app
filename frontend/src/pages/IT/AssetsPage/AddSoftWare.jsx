
import React, { useState, useCallback, useMemo, memo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  createInventoryItemAPI,
  createSoftwareLicensesAPI,
  getITApiErrorMessage,
  syncITDataFromAPI,
} from "../Data";
import "./AddSoftWare.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLUMN_HEADERS = [
  { label: "Software Name",  required: true  },
  { label: "Start Date",     required: true  },
  { label: "Valid Till",     required: true  },
  { label: "Licenses",       required: true  },
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Collision-safe id for transient row identity (never stored). */
const newRowId = () =>
  `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Returns a fresh blank row. Kept outside component — no closure needed. */
const createBlankRow = () => ({
  id:                newRowId(),
  name:              "",
  subscriptionStart: "",
  subscriptionEnd:   "",
  quantity:          "1",
  _errors:           {},
});

/**
 * Pure validation — returns an error map (empty = valid).
 * Extracted so it can be unit-tested independently.
 */
const validateRow = (row) => {
  const errors = {};

  if (!row.name.trim()) errors.name = "Required";
  if (!row.subscriptionStart) errors.subscriptionStart = "Required";
  if (!row.subscriptionEnd) errors.subscriptionEnd = "Required";

  if (row.subscriptionStart && row.subscriptionEnd) {
    const ds = new Date(`${row.subscriptionStart}T00:00:00`);
    const de = new Date(`${row.subscriptionEnd}T00:00:00`);
    if (!Number.isNaN(ds.getTime()) && !Number.isNaN(de.getTime()) && de <= ds) {
      errors.subscriptionEnd = "Must be after start date";
    }
  }

  const qty = parseInt(row.quantity, 10);
  if (!row.quantity || Number.isNaN(qty) || qty < 1) errors.quantity = "Min 1";
  if (!Number.isNaN(qty) && qty > 9_999) errors.quantity = "Max 9999";

  return errors;
};

const isRowClean = (row) => Object.keys(validateRow(row)).length === 0;

// ─── CellInput ────────────────────────────────────────────────────────────────
// memo: only re-renders when its own value / error changes, not when siblings do.

const CellInput = memo(({ value, onChange, placeholder, error, type = "text", className = "", ...rest }) => (
  <td>
    <input
      type={type}
      className={`ana-cell-input${className ? ` ${className}` : ""}${error ? " err" : ""}`}
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      {...rest}
    />
    {error && <span className="ana-cell-err">{error}</span>}
  </td>
));

CellInput.displayName = "CellInput";

// ─── AddSoftwarePage ──────────────────────────────────────────────────────────

const AddSoftwarePage = () => {
  const navigate = useNavigate();

  const [rows,       setRows]       = useState([createBlankRow()]);
  const [submitted,  setSubmitted]  = useState(false);
  const [banner,     setBanner]     = useState({ type: null, message: "" }); // type: "success" | "error"
  const [saving,     setSaving]     = useState(false);

  // ── Row mutations ──────────────────────────────────────────────────────────

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, createBlankRow()]);
  }, []);

  const removeRow = useCallback((id) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }, []);

  
  const updateField = useCallback(
    (id, field, value) => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.id !== id) return row;
          const updated = { ...row, [field]: value };
          if (submitted) updated._errors = validateRow(updated);
          return updated;
        }),
      );
    },
    [submitted],
  );

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    setSubmitted(true);

    // Run full validation pass and surface errors in UI
    const validated = rows.map((r) => ({ ...r, _errors: validateRow(r) }));
    setRows(validated);

    const hasErrors = validated.some((r) => Object.keys(r._errors).length > 0);
    if (hasErrors) return;

    setSaving(true);
    setBanner({ type: null, message: "" });

    try {
      let totalLicenses = 0;

      for (const row of validated) {
        const qty = parseInt(row.quantity, 10) || 1;
        const invRes = await createInventoryItemAPI({
          name: row.name.trim(),
          category: "Software",
          inventoryCategory: "IT Assets",
        });
        const inventoryItemId = invRes?.item?.id;
        if (!inventoryItemId) {
          throw new Error("Server did not return an inventory item id.");
        }
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
      window.dispatchEvent(new Event("inventory-updated"));

      const msg = `✅ ${totalLicenses} license${totalLicenses !== 1 ? "s" : ""} added to inventory.`;
      setBanner({ type: "success", message: msg });
      toast.success(msg);

      setRows([createBlankRow()]);
      setSubmitted(false);
    } catch (err) {
      console.error("[AddSoftwarePage] handleSubmit error:", err);
      const detail = getITApiErrorMessage(err, "Could not save to the server.");
      setBanner({
        type: "error",
        message: `❌ Failed to save: ${detail}`,
      });
      toast.error(detail);
    } finally {
      setSaving(false);
    }
  }, [rows]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const allValid      = useMemo(() => rows.every(isRowClean), [rows]);
  const totalLicenses = useMemo(
    () => rows.reduce((sum, r) => sum + (parseInt(r.quantity, 10) || 0), 0),
    [rows],
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="ana-page">
      <main className="ana-main">

        {/* Header */}
        <div className="ana-main-header">
          <div className="ana-header-top-row">
            <button className="ana-back-top" onClick={() => navigate(-1)}>← Back</button>
            <h1>Add Software Licenses</h1>
          </div>
          <p className="ana-subtitle">
            Fill in the details below. Add multiple rows before saving.
          </p>
        </div>

        {/* Status banner */}
        {banner.type && (
          <div className={`ana-banner ana-banner--${banner.type}`}>
            {banner.message}
          </div>
        )}

        {/* License table section */}
        <section className="ana-section ana-section-table">
          <div className="ana-section-head">
            <span className="ana-section-num">01</span>
            <h2>Software License Details</h2>
            <span className="ana-row-count">
              {rows.length} row{rows.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="ana-table-wrap">
            <table className="ana-table">
              <thead>
                <tr>
                  <th className="ana-th-idx">#</th>
                  {COLUMN_HEADERS.map(({ label, required }) => (
                    <th key={label}>
                      {label} {required && <span className="req">*</span>}
                    </th>
                  ))}
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

                    <CellInput
                      value={row.name}
                      error={row._errors.name}
                      placeholder="e.g. Microsoft Office 365"
                      onChange={(e) => updateField(row.id, "name", e.target.value)}
                    />
                    <CellInput
                      type="date"
                      value={row.subscriptionStart}
                      error={row._errors.subscriptionStart}
                      onChange={(e) => updateField(row.id, "subscriptionStart", e.target.value)}
                    />
                    <CellInput
                      type="date"
                      value={row.subscriptionEnd}
                      error={row._errors.subscriptionEnd}
                      onChange={(e) => updateField(row.id, "subscriptionEnd", e.target.value)}
                    />
                    <CellInput
                      type="number"
                      value={row.quantity}
                      error={row._errors.quantity}
                      min="1"
                      max="9999"
                      placeholder="1"
                      className="ana-qty-input"
                      onChange={(e) => updateField(row.id, "quantity", e.target.value)}
                    />

                    <td className="ana-td-action">
                      <button
                        type="button"
                        className="ana-btn-rm-row"
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length === 1}
                        title="Remove row"
                        aria-label="Remove row"
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

        {/* Summary strip */}
        {totalLicenses > 0 && (
          <div className="ana-summary-strip">
            <span className="ana-summary-icon">📋</span>
            <p className="ana-summary-text">
              Ready to add <strong>{totalLicenses}</strong> license{totalLicenses !== 1 ? "s" : ""} across{" "}
              <strong>{rows.length}</strong> row{rows.length !== 1 ? "s" : ""}.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="ana-footer">
          <div className="ana-footer-info">
            {submitted && !allValid && (
              <span className="ana-footer-warn">
                ⚠ Fix validation errors above before submitting
              </span>
            )}
          </div>
          <div className="ana-footer-actions">
            <button
              type="button"
              className="ana-btn-cancel"
              onClick={() => navigate(-1)}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ana-btn-submit"
              onClick={handleSubmit}
              disabled={saving}
              aria-busy={saving}
            >
              {saving ? "⏳ Saving…" : "Save to Inventory"}
            </button>
          </div>
        </div>

      </main>
    </div>
  );
};

export default AddSoftwarePage;



