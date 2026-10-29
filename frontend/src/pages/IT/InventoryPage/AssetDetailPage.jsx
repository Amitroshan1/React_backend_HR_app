import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowLeft,
  Check,
  History,
  ImagePlus,
  Pencil,
  X,
} from "lucide-react";
import ClickableImage from "../../../components/ClickableImage";
import { isItamFlagEnabled } from "../../../utils/itamFlags";
import {
  deleteAssetUnitAPI,
  createDeviceTypeAPI,
  fetchDeviceTypesAPI,
  fetchInventoryItemAPI,
  fetchUnitsForInventoryAPI,
  getSoftwareInventory,
  notifyInventoryChange,
  setUnitStatusAPI,
  syncITDataFromAPI,
  toLocalInventory,
  toLocalUnit,
  toastITApiFailure,
  updateAssetUnitAPI,
  updateInventoryItemAPI,
} from "../Data";
import {
  canonicalizeInventoryCategory,
  getHardwareFields,
  getMobileTabletHardwareFields,
  getUnitBrandModelDisplay,
  isMobileTabletHwType,
  isStockInventoryCategory,
  isValidInventoryCategory,
  isVehicleInventoryCategory,
} from "../inventoryCategories";
import { AssetReviewsModal } from "../itam/AssetReviewsPanel";
import AssetHistoryTimeline from "../itam/AssetHistoryTimeline";
import { unitCustodyLabel, unitStatusLabel } from "../itam/lifecycleUi";
import { actionCodeForStatusChange, remarkPayload } from "../itam/transitionUi";
import { useTransitionRemark } from "../itam/TransitionRemarkModal";
import { formatDate } from "../../../utils/dateFormat";
import { encodeInventoryFiles, isUploadAbort, useInventoryUpload } from "./InventoryUploadLock";
import "./AssetDetailPage.css";
import "./InventoryDashboard.css";

const BASE = "/it/inventory";

const STATUS_ACTIONS = [
  { key: "repair", label: "Repair", className: "adp-action--repair" },
  { key: "notWorking", label: "Not Working", className: "adp-action--nw" },
  { key: "removed", label: "Remove", className: "adp-action--remove" },
];

export function inventoryAssetPath(itemId, category, extras = {}) {
  const params = new URLSearchParams();
  if (category) params.set("cat", category);
  Object.entries(extras).forEach(([key, value]) => {
    if (value === undefined || value === null || value === false || value === "") return;
    params.set(key, String(value));
  });
  const q = params.toString();
  return `${BASE}/item/${itemId}${q ? `?${q}` : ""}`;
}

function blankForm() {
  return {
    name: "",
    vendor: "",
    location: "",
    notes: "",
    purchaseDate: "",
    brand: "",
    make: "",
    model: "",
    serialNumber: "",
    imei1: "",
    imei2: "",
    projectCode: "",
    deviceLocation: "",
    deviceType: "",
  };
}

function formFrom(item, unit) {
  return {
    name: item?.name || "",
    vendor: item?.vendor || "",
    location: item?.location || "",
    notes: item?.notes || "",
    purchaseDate: item?.purchaseDate || "",
    brand: unit?.brand || "",
    make: unit?.make || "",
    model: unit?.model || "",
    serialNumber: unit?.serialNumber || "",
    imei1: unit?.imei1 || "",
    imei2: unit?.imei2 || "",
    projectCode: unit?.projectCode || "",
    deviceLocation: unit?.deviceLocation || "",
    deviceType: unit?.deviceType || "",
  };
}

export default function AssetDetailPage() {
  const { itemId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { requestRemark } = useTransitionRemark();
  const { runUpload, busy } = useInventoryUpload();

  const catHint = searchParams.get("cat");
  const unitHint = searchParams.get("unit");
  const startInEdit = searchParams.get("edit") === "1";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [item, setItem] = useState(null);
  const [units, setUnits] = useState([]);
  const [unitIndex, setUnitIndex] = useState(0);
  const [form, setForm] = useState(blankForm());
  const [tab, setTab] = useState("details");
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [draftPhotos, setDraftPhotos] = useState([]);
  const [photoDirty, setPhotoDirty] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [deviceTypes, setDeviceTypes] = useState(["EVT", "DVT", "PVT", "DV"]);
  const draftPhotosRef = useRef([]);
  const photoDirtyRef = useRef(false);

  useEffect(() => {
    fetchDeviceTypesAPI()
      .then((res) => {
        const extra = res?.deviceTypes || [];
        const seen = new Set();
        const merged = [];
        for (const name of ["EVT", "DVT", "PVT", "DV", ...extra]) {
          const label = String(name || "").trim();
          if (!label || seen.has(label.toLowerCase())) continue;
          seen.add(label.toLowerCase());
          merged.push(label);
        }
        setDeviceTypes(merged);
      })
      .catch(() => {});
  }, []);

  const replacePhotos = (next, dirty = false) => {
    const value = typeof next === "function" ? next(draftPhotosRef.current) : next;
    draftPhotosRef.current = value;
    photoDirtyRef.current = dirty;
    setDraftPhotos(value);
    setPhotoDirty(dirty);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemRes, unitsRes] = await Promise.all([
        fetchInventoryItemAPI(itemId),
        fetchUnitsForInventoryAPI(itemId).catch(() => ({ units: [] })),
      ]);
      const localItem = toLocalInventory(itemRes.item || itemRes);
      const localUnits = (unitsRes.units || []).map(toLocalUnit);
      setItem(localItem);
      setUnits(localUnits);
      const hintIdx = localUnits.findIndex((u) => String(u.id) === String(unitHint));
      const idx = hintIdx >= 0 ? hintIdx : 0;
      setUnitIndex(idx);
      setForm(formFrom(localItem, localUnits[idx] || null));
      const initialPhotos = localUnits[idx]?.photos?.length
        ? localUnits[idx].photos
        : (localItem.photos || []);
      replacePhotos(initialPhotos, false);
      setTab("details");
      setEditing(startInEdit);
    } catch (err) {
      toastITApiFailure(err, "Could not load this asset.");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [itemId, unitHint, startInEdit]);

  useEffect(() => {
    load();
  }, [load]);

  const unit = units[unitIndex] || null;
  const inventoryCategory = canonicalizeInventoryCategory(
    item?.inventoryCategory || catHint || "",
  );
  const stockMode = String(item?.category || "").toLowerCase() === "stock"
    || isStockInventoryCategory(inventoryCategory);
  const software = String(item?.category || "").toLowerCase() === "software";
  const mobile = isMobileTabletHwType(item?.hwType);
  const hwFields = mobile
    ? getMobileTabletHardwareFields(getHardwareFields(inventoryCategory, item?.category, item?.hwType))
    : getHardwareFields(inventoryCategory, item?.category, item?.hwType);
  const brandModel = unit
    ? getUnitBrandModelDisplay(unit, inventoryCategory)
    : { primary: "—", secondary: "" };
  const storedPhotos = unit?.photos?.length ? unit.photos : (item?.photos || []);
  const photos = draftPhotos.length || photoDirty ? draftPhotos : storedPhotos;
  const receipts = item?.receipts || [];
  const timelineOn = isItamFlagEnabled("itam_timeline_v1");
  const licenses = useMemo(
    () => getSoftwareInventory().filter((l) => String(l.inventoryId) === String(itemId)),
    [itemId, item],
  );

  const backTo = isValidInventoryCategory(catHint || inventoryCategory)
    ? `${BASE}?cat=${encodeURIComponent(catHint || inventoryCategory)}`
    : BASE;

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const startEdit = () => {
    setForm(formFrom(item, unit));
    replacePhotos(storedPhotos, false);
    setEditing(true);
    setTab("details");
  };

  const cancelEdit = () => {
    setForm(formFrom(item, unit));
    replacePhotos(storedPhotos, false);
    setEditing(false);
  };

  const addPhotos = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/") || !f.type);
    if (!files.length) {
      toast.error("Choose an image file.");
      return;
    }
    setUploadingPhotos(true);
    try {
      const encoded = await runUpload("Preparing photos…", ({ signal, setProgress }) =>
        encodeInventoryFiles(files, { imagesOnly: true, signal, onProgress: setProgress }),
      );
      replacePhotos((prev) => [...prev, ...encoded.map((e) => e.data)], true);
      if (!editing) setEditing(true);
    } catch (err) {
      if (!isUploadAbort(err)) toastITApiFailure(err, "Could not read that photo. Use a JPG or PNG.");
    } finally {
      setUploadingPhotos(false);
    }
  };

  const save = async () => {
    if (!item) return;
    const name = form.name.trim();
    if (!name) {
      toast.error("Asset name is required.");
      return;
    }
    if (busy || uploadingPhotos) {
      toast.warn("Please wait for the upload to finish.");
      return;
    }
    setSaving(true);
    try {
      const photosToSave = draftPhotosRef.current;
      const shouldSavePhotos = photoDirtyRef.current;
      const persist = async () => {
        await updateInventoryItemAPI(item.id, {
          name,
          vendor: form.vendor.trim() || null,
          location: form.location.trim() || null,
          notes: form.notes.trim() || null,
          purchase_date: form.purchaseDate || null,
          ...(shouldSavePhotos ? { photos: photosToSave } : {}),
        });
        if (unit?.id) {
          const modelValue = mobile ? (form.make || form.model) : form.model;
          await updateAssetUnitAPI(unit.id, {
            asset_name: name,
            brand: form.brand.trim() || null,
            make: form.make.trim() || null,
            model: String(modelValue || "").trim() || null,
            serial_number: form.serialNumber.trim() || null,
            imei1: form.imei1.trim() || null,
            imei2: form.imei2.trim() || null,
            project_code: form.projectCode.trim() || null,
            device_location: form.deviceLocation.trim() || null,
            device_type: form.deviceType.trim() || null,
            ...(shouldSavePhotos ? { photos: photosToSave } : {}),
          });
        }
      };
      if (shouldSavePhotos) {
        await runUpload("Saving photos…", persist);
      } else {
        await persist();
      }
      await syncITDataFromAPI().catch(() => {});
      notifyInventoryChange();
      toast.success("Asset saved.");
      setEditing(false);
      if (startInEdit) {
        navigate(inventoryAssetPath(item.id, inventoryCategory), { replace: true });
        return;
      }
      await load();
    } catch (err) {
      if (!isUploadAbort(err)) toastITApiFailure(err, "Could not save this asset.");
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (actionKey) => {
    if (software) return;
    if (!unit && stockMode) {
      toast.info("Use the quantity actions on the inventory list for stock lines.");
      return;
    }
    if (!unit?.id) {
      toast.error("No unit is available for this action.");
      return;
    }
    if (actionKey === "removed") {
      const remarkResult = await requestRemark("RETIRE", {
        force: true,
        assetLabel: unit.assetName || unit.serialNumber || item.name,
        subtitle: "Remove / retire from inventory",
        defaultReasonCode: "PERMANENT_DELETE",
        defaultConditionGrade: "Fail",
      });
      if (remarkResult === null) return;
      try {
        await deleteAssetUnitAPI(unit.id, remarkPayload(remarkResult));
        await syncITDataFromAPI();
        notifyInventoryChange();
        toast.success(`Removed "${item.name}".`);
        navigate(backTo);
      } catch (err) {
        toastITApiFailure(err, "Could not remove this asset.");
      }
      return;
    }
    const targetStatus = actionKey === "repair" ? "repair" : "notWorking";
    const remarkResult = await requestRemark(actionCodeForStatusChange(actionKey, unit.status), {
      force: true,
      assetLabel: unit.assetName || unit.serialNumber || item.name,
      subtitle: actionKey === "repair" ? "Mark as In Repair" : "Mark as Not Working",
    });
    if (remarkResult === null) return;
    try {
      await setUnitStatusAPI({
        unitId: unit.id,
        status: targetStatus,
        ...remarkPayload(remarkResult),
      });
      await syncITDataFromAPI();
      notifyInventoryChange();
      toast.success(actionKey === "repair" ? "Sent to Repair." : "Marked Not Working.");
      await load();
    } catch (err) {
      toastITApiFailure(err, "Could not update this unit.");
    }
  };

  if (loading) {
    return (
      <div className="adp-page">
        <p className="adp-muted">Loading asset…</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="adp-page">
        <button type="button" className="adp-back" onClick={() => navigate(backTo)}>
          <ArrowLeft size={16} /> Back to inventory
        </button>
        <p className="adp-muted">This asset was not found.</p>
      </div>
    );
  }

  const reviewTarget = {
    asset: item,
    units: units.filter((u) => u?.id != null),
    unitId: unit?.id ?? null,
    inventoryItemId: unit?.id == null ? item.id : null,
  };

  const showItemMeta =
    !stockMode &&
    (isVehicleInventoryCategory(inventoryCategory) ||
      String(item.category || "").toLowerCase() === "equipment");

  return (
    <div className="adp-page">
      <header className="adp-top">
        <button type="button" className="adp-back" onClick={() => navigate(backTo)}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="adp-top-main">
          <p className="adp-kicker">{editing ? "Edit asset" : "Asset details"}</p>
          <h1>{editing ? form.name || item.name : item.name}</h1>
          <div className="adp-badges">
            <span>{inventoryCategory || item.category}</span>
            {software ? (
              <span>{licenses.length} license{licenses.length !== 1 ? "s" : ""}</span>
            ) : !stockMode ? (
              <span>{units.length} unit{units.length !== 1 ? "s" : ""}</span>
            ) : (
              <span>Qty {item.totalQuantity ?? item.total ?? 0}</span>
            )}
            {unit ? <span>{unitStatusLabel(unit)}</span> : null}
          </div>
        </div>
        <div className="adp-top-actions">
          {editing ? (
            <>
              <button type="button" className="adp-btn adp-btn--ghost" onClick={cancelEdit} disabled={saving || busy}>
                <X size={15} /> Cancel
              </button>
              <button type="button" className="adp-btn adp-btn--primary" onClick={save} disabled={saving || busy}>
                <Check size={15} /> {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button type="button" className="adp-btn adp-btn--primary" onClick={startEdit}>
              <Pencil size={15} /> Edit
            </button>
          )}
        </div>
      </header>

      {units.length > 1 && (
        <div className="adp-units">
          {units.map((u, i) => (
            <button
              key={u.id || i}
              type="button"
              className={`adp-unit${i === unitIndex ? " adp-unit--on" : ""}`}
              onClick={() => {
                setUnitIndex(i);
                setForm(formFrom(item, u));
                replacePhotos(u.photos?.length ? u.photos : (item.photos || []), false);
                setEditing(false);
              }}
            >
              #{u.assetTag || u.assetId || i + 1}
            </button>
          ))}
        </div>
      )}

      {timelineOn && unit?.id ? (
        <div className="adp-tabs">
          <button type="button" className={tab === "details" ? "on" : ""} onClick={() => setTab("details")}>
            Details
          </button>
          <button type="button" className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
            <History size={14} /> History
          </button>
        </div>
      ) : null}

      {tab === "history" && unit?.id ? (
        <div className="adp-card">
          <AssetHistoryTimeline unitId={Number(unit.id)} assetLabel={unit.assetName || item.name} embedded />
        </div>
      ) : (
        <div className="adp-grid">
          <section className="adp-card">
            {showItemMeta && !editing && (
              <p className="adp-meta">
                {item.vendor ? <span>Vendor: {item.vendor}</span> : null}
                {item.purchaseDate ? <span>Purchase: {formatDate(item.purchaseDate)}</span> : null}
                {item.location ? <span>Location: {item.location}</span> : null}
              </p>
            )}

            {software ? (
              <FieldGrid
                editing={editing}
                form={form}
                setField={setField}
                rows={[
                  { key: "name", label: "Name", value: item.name },
                  { key: "notes", label: "Notes", value: item.notes || "—", textarea: true },
                ]}
              />
            ) : stockMode && !unit ? (
              <FieldGrid
                editing={editing}
                form={form}
                setField={setField}
                rows={[
                  { key: "name", label: "Name", value: item.name },
                  { key: "vendor", label: "Supplier", value: item.vendor || "—" },
                  { key: "purchaseDate", label: "Purchase date", value: item.purchaseDate || "—", type: "date" },
                  { key: "location", label: "Location", value: item.location || "—" },
                  { key: "notes", label: "Remarks", value: item.notes || "—", textarea: true },
                ]}
              />
            ) : mobile ? (
              <FieldGrid
                editing={editing}
                form={form}
                setField={setField}
                rows={[
                  { key: "name", label: "Asset name", value: item.name },
                  { key: "projectCode", label: hwFields.projectCode.label, value: unit?.projectCode || "—" },
                  { key: "brand", label: hwFields.brand.label, value: unit?.brand || brandModel.primary },
                  { key: "make", label: hwFields.make.label, value: unit?.make || unit?.model || "—" },
                  { key: "imei1", label: "IMEI 1", value: unit?.imei1 || "—", mono: true },
                  { key: "imei2", label: "IMEI 2", value: unit?.imei2 || "—", mono: true },
                  { key: "serialNumber", label: hwFields.serialNumber.label, value: unit?.serialNumber || "—", mono: true },
                  { key: "deviceType", label: "Device Type", value: unit?.deviceType || "—", selectOptions: deviceTypes },
                  { key: "deviceLocation", label: hwFields.deviceLocation.label, value: unit?.deviceLocation || "—" },
                  { key: "notes", label: "Comment", value: item.notes || "—", textarea: true },
                ]}
              />
            ) : (
              <FieldGrid
                editing={editing}
                form={form}
                setField={setField}
                rows={[
                  { key: "name", label: "Asset name", value: item.name },
                  { key: "brand", label: hwFields.brand?.label || "Brand", value: brandModel.primary },
                  { key: "make", label: hwFields.make?.label || "Make", value: unit?.make || "—" },
                  { key: "model", label: hwFields.model?.label || "Model", value: brandModel.secondary || unit?.model || "—" },
                  { key: "serialNumber", label: hwFields.serialNumber?.label || "Serial", value: unit?.serialNumber || "—", mono: true },
                  { key: "deviceType", label: "Device Type", value: unit?.deviceType || "—", selectOptions: deviceTypes },
                  { key: "notes", label: "Remarks", value: item.notes || "—", textarea: true },
                ]}
              />
            )}

            {unit && isItamFlagEnabled("itam_lifecycle_v1") ? (
              <p className="adp-status-line">
                Status: {unitStatusLabel(unit)}
                {unit.custodyType ? ` · Custody: ${unitCustodyLabel(unit)}` : ""}
              </p>
            ) : null}
          </section>

          <aside className="adp-card">
            <p className="adp-aside-title">Photos {photos.length ? `(${photos.length})` : ""}</p>
            {photos.length === 0 ? (
              <label className="adp-upload">
                <ImagePlus size={20} />
                <span>{uploadingPhotos ? "Adding…" : "Upload photo"}</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploadingPhotos || saving || busy}
                  onChange={(e) => {
                    addPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
                <small>Then click Save changes</small>
              </label>
            ) : (
              <>
                <div className="adp-photo-main">
                  <ClickableImage src={photos[0]} alt="" />
                </div>
                {photos.length > 1 && (
                  <div className="adp-photo-strip">
                    {photos.slice(1).map((src, i) => (
                      <ClickableImage key={i} src={src} alt="" className="adp-thumb" />
                    ))}
                  </div>
                )}
                {editing ? (
                  <label className="adp-upload adp-upload--inline">
                    <ImagePlus size={16} />
                    <span>{uploadingPhotos ? "Adding…" : "Add photos"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={uploadingPhotos || saving || busy}
                      onChange={(e) => {
                        addPhotos(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                ) : null}
              </>
            )}
            {receipts.length > 0 && (
              <>
                <p className="adp-aside-title">Receipts ({receipts.length})</p>
                <div className="adp-photo-strip">
                  {receipts.map((src, i) => (
                    <ClickableImage key={i} src={src} alt="" className="adp-thumb" />
                  ))}
                </div>
              </>
            )}
            {(stockMode || software) && (
              <dl className="adp-stats">
                <div><dt>Total</dt><dd>{item.totalQuantity ?? item.total ?? 0}</dd></div>
                <div><dt>Available</dt><dd>{item.availableQuantity ?? item.available ?? 0}</dd></div>
                <div><dt>Assigned</dt><dd>{item.assignedQuantity ?? item.assigned ?? 0}</dd></div>
              </dl>
            )}
          </aside>
        </div>
      )}

      {editing ? (
        <div className="adp-savebar">
          <button type="button" className="adp-btn adp-btn--ghost" onClick={cancelEdit} disabled={saving || busy}>
            <X size={15} /> Cancel
          </button>
          <button type="button" className="adp-btn adp-btn--primary" onClick={save} disabled={saving || busy}>
            <Check size={15} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      ) : !software ? (
        <footer className="adp-footer">
          {STATUS_ACTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`adp-action ${opt.className}`}
              onClick={() => handleStatus(opt.key)}
            >
              {opt.label}
            </button>
          ))}
          <button type="button" className="adp-action adp-action--review" onClick={() => setReviewsOpen(true)}>
            Reviews
          </button>
        </footer>
      ) : null}

      {reviewsOpen ? (
        <AssetReviewsModal target={reviewTarget} onClose={() => setReviewsOpen(false)} />
      ) : null}
    </div>
  );
}

function FieldGrid({ editing, form, setField, rows }) {
  return (
    <div className="adp-fields">
      {rows.map((row) => (
        <label key={row.key} className="adp-field">
          <span>{row.label}{row.required ? <em className="adp-req"> *</em> : null}</span>
          {editing ? (
            row.textarea ? (
              <textarea
                value={form[row.key] || ""}
                onChange={(e) => setField(row.key, e.target.value)}
                rows={3}
              />
            ) : row.selectOptions ? (
              <DeviceTypeSelect
                value={form[row.key] || ""}
                options={row.selectOptions}
                onChange={(next) => setField(row.key, next)}
              />
            ) : (
              <input
                type={row.type || "text"}
                value={form[row.key] || ""}
                onChange={(e) => setField(row.key, e.target.value)}
              />
            )
          ) : (
            <strong className={row.mono ? "adp-mono" : ""}>{row.value || "—"}</strong>
          )}
        </label>
      ))}
    </div>
  );
}

function DeviceTypeSelect({ value, options, onChange }) {
  const ADD = "__add_device_type__";
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");
  const selected = adding ? ADD : (value || "");

  const confirm = async () => {
    const name = custom.trim();
    if (!name) {
      toast.error("Enter a device type name.");
      return;
    }
    try {
      const res = await createDeviceTypeAPI(name);
      const saved = res?.name || name;
      onChange(saved);
      setAdding(false);
      setCustom("");
    } catch (err) {
      toastITApiFailure(err, "Could not save device type.");
    }
  };

  return (
    <>
      <select
        value={selected}
        onChange={(e) => {
          const next = e.target.value;
          if (next === ADD) {
            setAdding(true);
            return;
          }
          setAdding(false);
          onChange(next);
        }}
      >
        <option value="">Select (optional)</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
        {value && !options.includes(value) ? (
          <option value={value}>{value}</option>
        ) : null}
        <option value={ADD}>+ Add more…</option>
      </select>
      {adding ? (
        <div className="adp-device-type-add">
          <input
            type="text"
            maxLength={40}
            placeholder="New device type"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button type="button" onClick={confirm}>Add</button>
        </div>
      ) : null}
    </>
  );
}
