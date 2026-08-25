import { useCallback, useEffect, useState } from "react";
import {
  createInventoryReviewAPI,
  createUnitReviewAPI,
  fetchInventoryReviewsAPI,
  fetchUnitReviewsAPI,
} from "../Data";
import "./AssetReviewsPanel.css";

function formatWhen(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch {
    return String(iso);
  }
}

function unitNumericId(unit) {
  if (!unit) return null;
  const n = Number(unit.id);
  return Number.isFinite(n) ? n : null;
}

/**
 * List past device reviews and add a new one. Does not change asset status.
 */
export default function AssetReviewsPanel({
  assetLabel = "Asset",
  units = [],
  unitId = null,
  inventoryItemId = null,
  onClose,
}) {
  const numberedUnits = (units || []).filter((u) => unitNumericId(u) != null);
  const [activeUnitId, setActiveUnitId] = useState(
    unitId != null && Number.isFinite(Number(unitId)) ? Number(unitId) : unitNumericId(numberedUnits[0]),
  );

  useEffect(() => {
    if (unitId != null && Number.isFinite(Number(unitId))) {
      setActiveUnitId(Number(unitId));
    }
  }, [unitId]);
  const [text, setText] = useState("");
  const [grade, setGrade] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const scopeUnitId = numberedUnits.length > 0 ? activeUnitId : null;
  const scopeInventoryId =
    scopeUnitId == null && inventoryItemId != null && Number.isFinite(Number(inventoryItemId))
      ? Number(inventoryItemId)
      : null;

  const load = useCallback(async () => {
    if (scopeUnitId == null && scopeInventoryId == null) {
      setRows([]);
      setError("No device selected for reviews.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = scopeUnitId != null
        ? await fetchUnitReviewsAPI(scopeUnitId)
        : await fetchInventoryReviewsAPI(scopeInventoryId);
      setRows(Array.isArray(data?.reviews) ? data.reviews : []);
    } catch (err) {
      setError(err?.message || "Could not load reviews");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [scopeUnitId, scopeInventoryId]);

  useEffect(() => {
    load();
  }, [load]);

  const onSubmit = async (e) => {
    e.preventDefault();
    const reviewText = text.trim();
    if (reviewText.length < 3) {
      setError("Enter at least 3 characters.");
      return;
    }
    if (scopeUnitId == null && scopeInventoryId == null) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        reviewText,
        conditionGrade: grade || null,
      };
      if (scopeUnitId != null) {
        await createUnitReviewAPI(scopeUnitId, payload);
      } else {
        await createInventoryReviewAPI(scopeInventoryId, payload);
      }
      setText("");
      setGrade("");
      await load();
    } catch (err) {
      setError(err?.message || "Could not save review");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="inv-reviews">
      <header className="inv-reviews-header">
        <div>
          <p className="inv-reviews-kicker">Device reviews</p>
          <h3>{assetLabel}</h3>
        </div>
        {onClose ? (
          <button type="button" className="inv-reviews-close" onClick={onClose} aria-label="Close reviews">
            ×
          </button>
        ) : null}
      </header>

      {numberedUnits.length > 1 ? (
        <div className="inv-reviews-units">
          <span>Unit</span>
          {numberedUnits.map((u) => {
            const id = unitNumericId(u);
            return (
              <button
                key={id}
                type="button"
                className={`inv-reviews-unit${id === activeUnitId ? " inv-reviews-unit--active" : ""}`}
                onClick={() => setActiveUnitId(id)}
              >
                #{u.assetTag || u.assetId || id}
              </button>
            );
          })}
        </div>
      ) : null}

      <form className="inv-reviews-form" onSubmit={onSubmit}>
        <label className="inv-reviews-label" htmlFor="inv-review-text">
          Add review
        </label>
        <textarea
          id="inv-review-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Condition, issues, or notes about this device…"
        />
        <div className="inv-reviews-form-row">
          <label>
            Condition
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">Optional</option>
              <option value="Good">Good</option>
              <option value="Fair">Fair</option>
              <option value="Poor">Poor</option>
            </select>
          </label>
          <button type="submit" className="inv-reviews-submit" disabled={saving}>
            {saving ? "Saving…" : "Save review"}
          </button>
        </div>
      </form>

      {error ? <p className="inv-reviews-error">{error}</p> : null}

      <p className="inv-reviews-list-title">Past reviews</p>
      {loading ? <p className="inv-reviews-muted">Loading…</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="inv-reviews-muted">No reviews yet for this device.</p>
      ) : null}
      <ul className="inv-reviews-list">
        {rows.map((r) => (
          <li key={r.id} className="inv-reviews-item">
            <div className="inv-reviews-item-top">
              <span className="inv-reviews-when">{formatWhen(r.createdAt)}</span>
              {r.conditionGrade ? <span className="inv-reviews-grade">{r.conditionGrade}</span> : null}
            </div>
            <p className="inv-reviews-text">{r.reviewText}</p>
            {r.createdByName ? <p className="inv-reviews-author">by {r.createdByName}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AssetReviewsModal({ target, onClose }) {
  if (!target) return null;
  const asset = target.asset || {};
  const label =
    asset.name ||
    target.units?.[0]?.assetName ||
    target.units?.[0]?.serialNumber ||
    "Asset";

  return (
    <div
      className="inv-reviews-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Device reviews"
      onClick={onClose}
    >
      <div className="inv-reviews-modal" onClick={(e) => e.stopPropagation()}>
        <AssetReviewsPanel
          assetLabel={label}
          units={target.units || []}
          unitId={target.unitId}
          inventoryItemId={target.inventoryItemId}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
