import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "react-toastify";
import {
  fetchOfficeStockDeploymentsAPI,
  getAssetUnitsFromStorage,
  getITApiErrorMessage,
  inventoryStockDeployAPI,
  inventoryStockReturnAPI,
  syncITDataFromAPI,
} from "../Data";
import {
  getDeployModalConfig,
  isUnitDeployRow,
} from "../inventoryCategories";

function availableUnitsForAsset(asset, inventoryCategory) {
  const units = getAssetUnitsFromStorage() || [];
  return units.filter((u) => {
    if (String(u.inventoryId) !== String(asset?.id)) return false;
    const st = String(u.status || "").toLowerCase();
    return st === "available" || st === "";
  }).map((u) => ({
    id: u.id,
    label:
      [u.serialNumber, u.make, u.model].filter(Boolean).join(" · ") ||
      u.assetName ||
      `Unit #${u.id}`,
  }));
}

function InventoryIssueModal({ asset, inventoryCategory, onClose, onSuccess }) {
  const config = getDeployModalConfig(inventoryCategory);
  const unitMode = isUnitDeployRow(asset, inventoryCategory);
  const unitOptions = useMemo(
    () => (unitMode ? availableUnitsForAsset(asset, inventoryCategory) : []),
    [asset, inventoryCategory, unitMode],
  );

  const maxQty = unitMode ? 1 : Math.max(0, Number(asset?.available ?? 0));
  const [quantity, setQuantity] = useState(maxQty > 0 ? "1" : "0");
  const [unitId, setUnitId] = useState(unitOptions[0]?.id ?? "");
  const [location, setLocation] = useState(
    asset?.location && asset.location !== "—" ? asset.location : "",
  );
  const [custodianName, setCustodianName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (unitMode && unitOptions.length > 0) {
      setUnitId(unitOptions[0].id);
    }
  }, [unitMode, unitOptions]);

  const submit = async () => {
    const loc = location.trim();
    if (!loc) {
      setError(`${config.locationLabel} is required.`);
      return;
    }

    let qty = 1;
    if (!unitMode) {
      qty = Number.parseInt(quantity, 10);
      if (!Number.isFinite(qty) || qty < 1 || qty > maxQty) {
        setError(`Enter a quantity between 1 and ${maxQty}.`);
        return;
      }
    } else if (!unitId) {
      setError("Select a vehicle or unit to issue.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      await inventoryStockDeployAPI({
        inventoryItemId: asset.id,
        quantity: qty,
        deploymentLocation: loc,
        custodianName: custodianName.trim() || null,
        assetUnitId: unitMode ? unitId : null,
      });
      await syncITDataFromAPI();
      toast.success(unitMode ? `Issued to ${loc}` : `Issued ${qty} to ${loc}`);
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = getITApiErrorMessage(err, "Could not issue item.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = unitMode
    ? unitOptions.length > 0 && location.trim()
    : maxQty >= 1 && location.trim();

  return (
    <div className="inv-modal-backdrop" onClick={onClose}>
      <div className="inv-modal-box inv-modal-box--office" onClick={(e) => e.stopPropagation()}>
        <div className="inv-modal-hero">
          <p className="inv-modal-hero-label">{config.label}</p>
          <h2 className="inv-modal-hero-title">Issue / deploy</h2>
          <p className="inv-modal-hero-sub">{asset?.name}</p>
        </div>
        <div className="inv-modal-body">
          <p className="inv-modal-hint">{config.hint}</p>

          {unitMode && (
            <div className="inv-modal-field">
              <label className="inv-modal-label">
                {inventoryCategory === "Transport Assets" ? "Vehicle" : "Unit"}{" "}
                <span className="req">*</span>
              </label>
              {unitOptions.length === 0 ? (
                <p className="inv-modal-hint-sub">No available units.</p>
              ) : (
                <select
                  className="inv-modal-input"
                  value={unitId}
                  onChange={(e) => {
                    setUnitId(e.target.value);
                    setError("");
                  }}
                >
                  {unitOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {!unitMode && (
            <div className="inv-modal-field">
              <label className="inv-modal-label">
                Quantity <span className="req">*</span>
              </label>
              <input
                className="inv-modal-input"
                type="number"
                min={1}
                max={maxQty}
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setError("");
                }}
                disabled={maxQty < 1}
              />
              <span className="inv-modal-hint-sub">Available: {maxQty}</span>
            </div>
          )}

          <div className="inv-modal-field">
            <label className="inv-modal-label">
              {config.locationLabel} <span className="req">*</span>
            </label>
            <input
              className="inv-modal-input"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setError("");
              }}
              placeholder={config.locationPlaceholder}
            />
          </div>
          <div className="inv-modal-field">
            <label className="inv-modal-label">
              {unitMode ? "Driver / operator (optional)" : "Custodian name (optional)"}
            </label>
            <input
              className="inv-modal-input"
              value={custodianName}
              onChange={(e) => setCustodianName(e.target.value)}
              placeholder={unitMode ? "Name" : "Person responsible"}
            />
          </div>
          <div className="inv-modal-field">
            <label className="inv-modal-label">Notes (optional)</label>
            <textarea
              className="inv-modal-input inv-modal-textarea"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional note"
            />
          </div>
          {error && <span className="inv-modal-err">{error}</span>}
          <div className="inv-modal-actions">
            <button
              type="button"
              className="inv-modal-btn-confirm"
              onClick={submit}
              disabled={saving || !canSubmit}
            >
              {saving ? "Saving…" : "Issue"}
            </button>
            <button type="button" className="inv-modal-btn-cancel" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InventoryReturnModal({ asset, inventoryCategory, onClose, onSuccess }) {
  const config = getDeployModalConfig(inventoryCategory);
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = deployments.find((d) => d.id === selectedId);
  const isUnitRow = Boolean(selected?.assetUnitId);
  const maxQty = selected ? Number(selected.quantity) || 0 : 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchOfficeStockDeploymentsAPI(asset?.id);
      setDeployments(rows);
      if (rows.length > 0) setSelectedId(rows[0].id);
    } catch (err) {
      toast.error(getITApiErrorMessage(err, "Could not load issued records."));
      setDeployments([]);
    } finally {
      setLoading(false);
    }
  }, [asset?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selected) setQuantity(String(isUnitRow ? 1 : Math.min(1, maxQty) || 1));
  }, [selectedId, selected, maxQty, isUnitRow]);

  const submit = async () => {
    if (!selected) {
      setError("Select an issued record.");
      return;
    }
    const qty = isUnitRow ? 1 : Number.parseInt(quantity, 10);
    if (!Number.isFinite(qty) || qty < 1 || qty > maxQty) {
      setError(`Enter a quantity between 1 and ${maxQty}.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await inventoryStockReturnAPI({ deploymentId: selected.id, quantity: qty });
      await syncITDataFromAPI();
      toast.success(`Returned ${qty} to available`);
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = getITApiErrorMessage(err, "Could not return item.");
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const formatOption = (d) => {
    const parts = [d.deploymentLocation];
    if (d.unitLabel) parts.push(d.unitLabel);
    parts.push(`qty ${d.quantity}`);
    if (d.custodianName) parts.push(`(${d.custodianName})`);
    return parts.join(" — ");
  };

  return (
    <div className="inv-modal-backdrop" onClick={onClose}>
      <div className="inv-modal-box inv-modal-box--office inv-modal-box--wide" onClick={(e) => e.stopPropagation()}>
        <div className="inv-modal-hero">
          <p className="inv-modal-hero-label">{config.label}</p>
          <h2 className="inv-modal-hero-title">Return to available</h2>
          <p className="inv-modal-hero-sub">{asset?.name}</p>
        </div>
        <div className="inv-modal-body">
          {loading ? (
            <p className="inv-modal-hint">Loading issued records…</p>
          ) : deployments.length === 0 ? (
            <p className="inv-modal-hint">Nothing is currently issued for this item.</p>
          ) : (
            <>
              <div className="inv-modal-field">
                <label className="inv-modal-label">Issued at</label>
                <select
                  className="inv-modal-input"
                  value={selectedId ?? ""}
                  onChange={(e) => {
                    setSelectedId(Number(e.target.value));
                    setError("");
                  }}
                >
                  {deployments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {formatOption(d)}
                    </option>
                  ))}
                </select>
              </div>
              {!isUnitRow && (
                <div className="inv-modal-field">
                  <label className="inv-modal-label">
                    Quantity to return <span className="req">*</span>
                  </label>
                  <input
                    className="inv-modal-input"
                    type="number"
                    min={1}
                    max={maxQty}
                    value={quantity}
                    onChange={(e) => {
                      setQuantity(e.target.value);
                      setError("");
                    }}
                  />
                  <span className="inv-modal-hint-sub">Issued at this location: {maxQty}</span>
                </div>
              )}
            </>
          )}
          {error && <span className="inv-modal-err">{error}</span>}
          <div className="inv-modal-actions">
            <button
              type="button"
              className="inv-modal-btn-confirm"
              onClick={submit}
              disabled={saving || loading || deployments.length === 0}
            >
              {saving ? "Saving…" : "Return"}
            </button>
            <button type="button" className="inv-modal-btn-cancel" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export {
  InventoryIssueModal,
  InventoryReturnModal,
  InventoryIssueModal as OfficeIssueModal,
  InventoryReturnModal as OfficeReturnModal,
};
