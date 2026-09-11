import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  assignDayUseUnitAPI,
  fetchDayUseAvailableUnitsAPI,
  fetchDayUseRequestAPI,
  toastITApiFailure,
} from "./Data";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import {
  getAssetCodeField,
  isMobileTabletHwType,
} from "./inventoryCategories";
import "./DailyAssets.css";

function itemsFromRequest(req) {
  if (Array.isArray(req?.items) && req.items.length) return req.items;
  if (req?.requested_hw_type) {
    return [{ line_type: "device", hw_type: req.requested_hw_type, quantity: 1 }];
  }
  return [];
}

function buildDeviceSlots(items) {
  const slots = [];
  (items || []).forEach((it, line_index) => {
    if ((it.line_type || "device") === "accessory") return;
    const hw = String(it.hw_type || "").trim();
    if (!hw) return;
    const qty = Math.max(1, Math.min(50, Number(it.quantity) || 1));
    for (let slot = 0; slot < qty; slot += 1) {
      slots.push({
        key: `${line_index}:${slot}`,
        line_index,
        slot,
        hw_type: hw,
        label: qty > 1 ? `${hw} #${slot + 1}` : hw,
      });
    }
  });
  return slots;
}

function displayOrDash(value) {
  const v = String(value || "").trim();
  return v || "—";
}

function columnsForHwType(hwType) {
  if (isMobileTabletHwType(hwType)) {
    return [
      { key: "brand", label: "Brand", get: (u) => displayOrDash(u.brand) },
      { key: "projectCode", label: "Project Code", get: (u) => displayOrDash(u.projectCode) },
      { key: "imei1", label: "IMEI 1", get: (u) => displayOrDash(u.imei1), mono: true },
      { key: "imei2", label: "IMEI 2", get: (u) => displayOrDash(u.imei2), mono: true },
    ];
  }
  const codeLabel = getAssetCodeField(hwType || "Laptop").label;
  return [
    { key: "brand", label: "Brand", get: (u) => displayOrDash(u.brand) },
    { key: "modelName", label: "Model", get: (u) => displayOrDash(u.make) },
    {
      key: "laptopCode",
      label: codeLabel,
      get: (u) => displayOrDash(u.model || u.unitCode),
      mono: true,
    },
    {
      key: "serial",
      label: "Serial number",
      get: (u) => displayOrDash(u.serialNumber || u.unitCode),
      mono: true,
    },
  ];
}

export default function ITDailyCheckoutAssignPage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState(null);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState("");
  const [activeSlotKey, setActiveSlotKey] = useState(null);
  const [selections, setSelections] = useState({}); // key -> { unitId, remarks, unit }
  const [accessoryComments, setAccessoryComments] = useState({});

  const items = useMemo(() => itemsFromRequest(request), [request]);
  const deviceSlots = useMemo(() => buildDeviceSlots(items), [items]);
  const accessoryLines = useMemo(
    () =>
      items
        .map((it, line_index) => ({ ...it, line_index }))
        .filter((it) => (it.line_type || "") === "accessory"),
    [items],
  );

  const activeSlot = useMemo(
    () => deviceSlots.find((s) => s.key === activeSlotKey) || deviceSlots[0] || null,
    [deviceSlots, activeSlotKey],
  );

  const columns = useMemo(
    () => columnsForHwType(activeSlot?.hw_type || "Laptop"),
    [activeSlot],
  );

  const takenUnitIds = useMemo(() => {
    const ids = new Set();
    Object.entries(selections).forEach(([key, sel]) => {
      if (key !== activeSlot?.key && sel?.unitId) ids.add(Number(sel.unitId));
    });
    return ids;
  }, [selections, activeSlot]);

  const visibleUnits = useMemo(
    () => units.filter((u) => !takenUnitIds.has(Number(u.id))),
    [units, takenUnitIds],
  );

  const selectedCount = deviceSlots.filter((s) => selections[s.key]?.unitId).length;
  const allDevicesSelected = deviceSlots.length > 0 && selectedCount === deviceSlots.length;

  const loadRequest = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDayUseRequestAPI(requestId);
      const req = data.request || data;
      setRequest(req);
      const slots = buildDeviceSlots(itemsFromRequest(req));
      setActiveSlotKey(slots[0]?.key || null);
      const accInit = {};
      (Array.isArray(req.items) ? req.items : []).forEach((it, idx) => {
        if (it.line_type === "accessory") accInit[idx] = "";
      });
      setAccessoryComments(accInit);
      setSelections({});
    } catch (err) {
      toastITApiFailure(err, "Unable to load request");
      navigate("/it/daily-checkout");
    } finally {
      setLoading(false);
    }
  }, [requestId, navigate]);

  const loadUnits = useCallback(async () => {
    if (!activeSlot?.hw_type) {
      setUnits([]);
      return;
    }
    try {
      const data = await fetchDayUseAvailableUnitsAPI(activeSlot.hw_type, search || undefined);
      setUnits(data.units || []);
    } catch (err) {
      toastITApiFailure(err, "Unable to load inventory");
    }
  }, [activeSlot?.hw_type, search]);

  useEffect(() => {
    loadRequest();
  }, [loadRequest]);

  useEffect(() => {
    if (!request || !activeSlot) return;
    const t = setTimeout(() => loadUnits(), 200);
    return () => clearTimeout(t);
  }, [request, activeSlot, loadUnits]);

  const selectUnitForActive = (unit) => {
    if (!activeSlot) return;
    setSelections((prev) => ({
      ...prev,
      [activeSlot.key]: {
        unitId: unit.id,
        unit,
        remarks: prev[activeSlot.key]?.remarks || "",
      },
    }));
  };

  const setRemarksForActive = (value) => {
    if (!activeSlot) return;
    setSelections((prev) => ({
      ...prev,
      [activeSlot.key]: {
        ...(prev[activeSlot.key] || {}),
        remarks: value,
      },
    }));
  };

  const onSubmit = async () => {
    if (!allDevicesSelected) {
      const missing = deviceSlots.filter((s) => !selections[s.key]?.unitId).map((s) => s.label);
      toast.error(`Select a unit for: ${missing.join(", ")}`);
      return;
    }
    for (const acc of accessoryLines) {
      if (!String(accessoryComments[acc.line_index] || "").trim()) {
        toast.error(`Add a comment for accessory: ${acc.description || "Accessory"}`);
        return;
      }
    }
    setSaving(true);
    try {
      await assignDayUseUnitAPI(request.id, {
        devices: deviceSlots.map((s) => ({
          line_index: s.line_index,
          slot: s.slot,
          hw_type: s.hw_type,
          asset_unit_id: Number(selections[s.key].unitId),
          remarks: String(selections[s.key].remarks || "").trim() || undefined,
        })),
        accessoryComments: accessoryLines.map((acc) => ({
          line_index: acc.line_index,
          description: acc.description,
          quantity: acc.quantity || 1,
          comment: String(accessoryComments[acc.line_index] || "").trim(),
        })),
      });
      toast.success(
        deviceSlots.length > 1
          ? `${deviceSlots.length} devices assigned`
          : "Asset assigned",
      );
      navigate("/it/daily-checkout");
    } catch (err) {
      toastITApiFailure(err, "Could not assign asset");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !request) {
    return (
      <div className="da-page">
        <div className="da-container">
          <div className="da-loading">Loading assign page…</div>
        </div>
      </div>
    );
  }

  if (String(request.status || "").toLowerCase() !== "approved") {
    return (
      <div className="da-page">
        <div className="da-container">
          <header className="da-topbar">
            <button type="button" className="da-back" onClick={() => navigate("/it/daily-checkout")}>
              ← Inbox
            </button>
            <div className="da-title-block">
              <p className="da-kicker">IT · Day-use</p>
              <h1 className="da-title">Assign asset</h1>
            </div>
          </header>
          <div className="da-card">
            <p className="da-muted">
              Request {request.request_code} is not approved (status: {request.status}). Approve it in the inbox
              first.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const activeSelection = activeSlot ? selections[activeSlot.key] : null;
  const searchPlaceholder = isMobileTabletHwType(activeSlot?.hw_type)
    ? "Brand, project code, IMEI…"
    : "Brand, model, code, serial…";

  return (
    <div className="da-page">
      <div className="da-container da-assign-page">
        <header className="da-topbar">
          <button type="button" className="da-back" onClick={() => navigate("/it/daily-checkout")}>
            ← Inbox
          </button>
          <div className="da-title-block">
            <p className="da-kicker">IT · Day-use</p>
            <h1 className="da-title">Assign · {request.request_code}</h1>
          </div>
          <p className="da-total">
            <strong>{selectedCount}</strong> / {deviceSlots.length} device
            {deviceSlots.length === 1 ? "" : "s"}
          </p>
        </header>

        <div className="da-card da-assign-summary">
          <div className="da-cell-stack">
            <strong>
              {request.requester_name} · {request.requester_emp_id}
            </strong>
            <span className="da-muted">
              Due {formatDateTimeDDMMYYYY(request.expected_return_at) || "—"}
              {request.requested_notes?.trim() ? ` · Notes: ${request.requested_notes}` : ""}
            </span>
          </div>
          <div className="da-assign-req-items">
            {deviceSlots.map((s) => (
              <span
                key={s.key}
                className={`da-chip${selections[s.key]?.unitId ? " da-chip--ok" : ""}`}
              >
                {s.label}
                {selections[s.key]?.unitId ? " ✓" : ""}
              </span>
            ))}
            {accessoryLines.map((a) => (
              <span key={`a-${a.line_index}`} className="da-chip da-chip--acc">
                {a.description} ×{a.quantity || 1}
              </span>
            ))}
          </div>
        </div>

        <div className="da-assign-layout">
          <section className="da-card da-assign-inventory">
            <div className="da-assign-inventory-head">
              <div>
                <h2>Select inventory unit</h2>
                <p className="da-muted da-form-hint">
                  Pick a unit for each requested device. Switch tabs below — Mobile and Tablet (or any mix) can
                  all be assigned on this request.
                </p>
              </div>
              <span className="da-assign-count">
                <strong>{visibleUnits.length}</strong> available
              </span>
            </div>

            <div className="da-hw-type-tabs" role="tablist" aria-label="Device slots">
              {deviceSlots.map((s) => {
                const done = Boolean(selections[s.key]?.unitId);
                const active = activeSlot?.key === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`${active ? "active" : ""}${done ? " done" : ""}`}
                    onClick={() => {
                      setActiveSlotKey(s.key);
                      setSearch("");
                    }}
                  >
                    {s.label}
                    {done ? " ✓" : ""}
                  </button>
                );
              })}
            </div>

            <label className="da-field da-assign-search">
              Search {activeSlot?.hw_type || ""}
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
              />
            </label>

            {visibleUnits.length === 0 ? (
              <div className="da-assign-empty">
                <p>No available {activeSlot?.hw_type || "units"} in inventory.</p>
                <span>Only units with status Available appear here.</span>
              </div>
            ) : (
              <div className="da-unit-pick-list">
                {visibleUnits.map((u) => {
                  const selected = Number(activeSelection?.unitId) === Number(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      className={`da-unit-pick${selected ? " da-unit-pick--selected" : ""}`}
                      onClick={() => selectUnitForActive(u)}
                    >
                      <span className="da-unit-pick-check" aria-hidden>
                        {selected ? "✓" : ""}
                      </span>
                      <div className="da-unit-pick-grid">
                        {columns.map((col) => (
                          <div key={col.key} className="da-unit-pick-cell">
                            <span className="da-unit-pick-label">{col.label}</span>
                            <span className={col.mono ? "da-unit-pick-mono" : "da-unit-pick-value"}>
                              {col.get(u)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="da-card da-assign-side">
            <h2>Assignment details</h2>

            <div className="da-slot-progress">
              {deviceSlots.map((s) => {
                const sel = selections[s.key];
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`da-slot-progress-item${activeSlot?.key === s.key ? " active" : ""}${
                      sel?.unitId ? " filled" : ""
                    }`}
                    onClick={() => {
                      setActiveSlotKey(s.key);
                      setSearch("");
                    }}
                  >
                    <strong>{s.label}</strong>
                    <span>
                      {sel?.unit
                        ? [sel.unit.brand, sel.unit.model || sel.unit.projectCode || sel.unit.unitCode]
                            .filter(Boolean)
                            .join(" · ") || `Unit #${sel.unitId}`
                        : "Not selected"}
                    </span>
                  </button>
                );
              })}
            </div>

            {activeSelection?.unit ? (
              <div className="da-selected-unit">
                <p className="da-kicker">Selected · {activeSlot?.label}</p>
                <div className="da-selected-unit-facts">
                  {columns.map((col) => (
                    <div key={col.key}>
                      <span>{col.label}</span>
                      <strong className={col.mono ? "da-unit-pick-mono" : undefined}>
                        {col.get(activeSelection.unit)}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="da-muted">Select a {activeSlot?.hw_type || "unit"} from the list.</p>
            )}

            <label className="da-field">
              Remarks for {activeSlot?.label || "asset"}
              <textarea
                rows={3}
                maxLength={500}
                disabled={!activeSelection?.unitId}
                value={activeSelection?.remarks || ""}
                onChange={(e) => setRemarksForActive(e.target.value)}
                placeholder={
                  activeSelection?.unitId
                    ? "Condition, checkout notes for this device…"
                    : "Select a unit first"
                }
              />
            </label>

            <h3 className="da-side-subhead">Accessories</h3>
            {accessoryLines.length === 0 ? (
              <p className="da-muted">No accessories on this request.</p>
            ) : (
              <div className="da-acc-comments">
                {accessoryLines.map((acc) => (
                  <label key={acc.line_index} className="da-field">
                    {acc.description || "Accessory"} ×{acc.quantity || 1}
                    <textarea
                      rows={2}
                      maxLength={500}
                      placeholder="IT comment — what was issued, SIM details, etc."
                      value={accessoryComments[acc.line_index] || ""}
                      onChange={(e) =>
                        setAccessoryComments((prev) => ({
                          ...prev,
                          [acc.line_index]: e.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="da-assign-actions da-assign-actions--stack">
              <button
                type="button"
                className="da-btn da-btn--primary"
                disabled={saving || !allDevicesSelected}
                onClick={onSubmit}
              >
                {saving
                  ? "Assigning…"
                  : allDevicesSelected
                    ? `Confirm ${deviceSlots.length} assignment${deviceSlots.length > 1 ? "s" : ""}`
                    : `Select ${deviceSlots.length - selectedCount} more`}
              </button>
              <button
                type="button"
                className="da-btn da-btn--ghost"
                disabled={saving}
                onClick={() => navigate("/it/daily-checkout")}
              >
                Cancel
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
