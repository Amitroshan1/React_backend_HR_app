
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import {
  getEmployees,
  saveEmployees,
  getAssetUnitsFromStorage,
  getInventoryFromStorage,
  getSoftwareInventory,
  returnAssetUnit,
  returnSoftwareLicense,
} from "./Data";
import "./EmployeeAssetsDetails.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const swDaysRemaining = (endDate) => {
  if (!endDate) return null;
  return Math.ceil((new Date(endDate) - new Date()) / (1000 * 60 * 60 * 24));
};

const enrichHardware = (asset) => {
  const unit    = getAssetUnitsFromStorage().find((u) => u.assetId === asset.assetId) || {};
  const invItem = getInventoryFromStorage().find(
    (i) => i.name === asset.name && i.category === "Hardware",
  ) || {};
  const assetTag = (asset.assetTag || unit.assetTag || "").trim();
  const photos   =
    asset.status?.toLowerCase() === "available"
      ? unit.photos || []
      : unit.assignmentPhotos?.length
        ? unit.assignmentPhotos
        : asset.photos || [];
  return {
    ...asset,
    displayAssetId: assetTag || "—",
    brand:        unit.brand        || invItem.brand  || asset.brand  || "—",
    make:         unit.make         || invItem.make   || asset.make   || "—",
    model:        unit.model        || invItem.model  || asset.model  || "—",
    serialNumber: unit.serialNumber || asset.serialNumber             || "—",
    imei1:        unit.imei1        || asset.imei1                    || null,
    imei2:        unit.imei2        || asset.imei2                    || null,
    photos,
  };
};

const makeAvatar = (name = "") => {
  const parts    = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (parts[0]?.[0] || "?").toUpperCase();
  const canvas   = document.createElement("canvas");
  canvas.width   = canvas.height = 128;
  const ctx      = canvas.getContext("2d");
  ctx.fillStyle  = "#4CAF50";
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle  = "#fff";
  ctx.font       = "bold 52px Arial";
  ctx.textAlign  = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials, 64, 64);
  return canvas.toDataURL("image/png");
};

// ─── Constants ────────────────────────────────────────────────────────────────
const TABS = ["All", "Hardware", "Software", "Accessories", "Consumables"];

const STATUS_CLS = {
  Assigned: "assigned", Available: "available",
  "Not Working": "not-working", Repair: "repair",
};
const statusCls = (s) => STATUS_CLS[s] || "assigned";

// ─── Sub-components ───────────────────────────────────────────────────────────
const PhotosCell = ({ photos, onOpen }) =>
  photos?.length ? (
    <button className="ea-btn-photos" onClick={() => onOpen(photos, 0)}>
      View ({photos.length})
    </button>
  ) : (
    <span className="ea-no-photos">No photos</span>
  );

const HardwareTable = ({ assets, onRemove, onViewDetails, onOpenPhotos }) => (
  <div className="ea-table-wrap">
    <table className="ea-table">
      <thead>
        <tr>
          <th>Asset Name</th><th>Details</th>
          <th>Status</th><th>Photos</th><th>Action</th>
        </tr>
      </thead>
      <tbody>
        {assets.length === 0 ? (
          <tr><td colSpan={5} className="ea-empty">No hardware assets assigned</td></tr>
        ) : (
          assets.map((a) => (
            <tr key={a.id}>
              <td>
                <strong className="ea-asset-name">{a.name}</strong>
                {(a.assetTag || a.assetId) && (
                  <div className="ea-asset-id-sub">#{a.assetTag || a.assetId}</div>
                )}
              </td>
              <td>
                <button className="ea-btn-view-details" onClick={() => onViewDetails(a)}>
                  View Details
                </button>
              </td>
              <td><span className={`ea-status-badge ${statusCls(a.status)}`}>{a.status}</span></td>
              <td><PhotosCell photos={a.photos} onOpen={onOpenPhotos} /></td>
              <td>
                <button className="ea-btn-remove" onClick={() => onRemove(a.assetId, a.id)}>
                  Remove
                </button>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

const SoftwareTable = ({ assets, onRemove }) => (
  <div className="ea-table-wrap">
    <table className="ea-table ea-sw-table">
      <thead>
        <tr>
          <th>Software Name</th><th>License ID</th>
          <th>Start Date</th><th>Valid Till</th>
          <th>Days Left</th><th>Status</th><th>Action</th>
        </tr>
      </thead>
      <tbody>
        {assets.length === 0 ? (
          <tr><td colSpan={7} className="ea-empty">No software assigned</td></tr>
        ) : (
          assets.map((a) => {
            const days      = swDaysRemaining(a.subscriptionEnd || a.licenseExpiry);
            const isExpired = days !== null && days < 0;
            const isWarning = !isExpired && days !== null && days <= 30;
            return (
              <tr
                key={a.id}
                className={isExpired ? "ea-sw-expired" : isWarning ? "ea-sw-warning" : ""}
              >
                <td><strong className="ea-asset-name">{a.name}</strong></td>
                <td>
                  <span className="ea-sw-license-id">{a.licenseId || a.swId || "—"}</span>
                </td>
                <td className="ea-sw-date">
                  {a.subscriptionStart
                    ? new Date(a.subscriptionStart).toLocaleDateString("en-IN") : "—"}
                </td>
                <td className="ea-sw-date">
                  {a.subscriptionEnd || a.licenseExpiry
                    ? new Date(a.subscriptionEnd || a.licenseExpiry).toLocaleDateString("en-IN")
                    : "—"}
                </td>
                <td>
                  {days === null ? "—" : (
                    <span className={`ea-sw-days ${isExpired ? "expired" : isWarning ? "warning" : "ok"}`}>
                      {isExpired ? "Expired" : `${days}d`}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`ea-status-badge ${isExpired ? "not-working" : "assigned"}`}>
                    {isExpired ? "Expired" : a.status || "Assigned"}
                  </span>
                </td>
                <td>
                  <button className="ea-btn-remove" onClick={() => onRemove(null, a.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  </div>
);

const NonHardwareTable = ({ assets, onRemove, onOpenPhotos }) => (
  <div className="ea-table-wrap">
    <table className="ea-table">
      <thead>
        <tr>
          <th>Asset Name</th><th>Category</th>
          <th>Status</th><th>Photos</th><th>Action</th>
        </tr>
      </thead>
      <tbody>
        {assets.length === 0 ? (
          <tr><td colSpan={5} className="ea-empty">No assets in this category</td></tr>
        ) : (
          assets.map((a) => (
            <tr key={a.id}>
              <td><strong className="ea-asset-name">{a.name}</strong></td>
              <td>
                <span className={`ea-cat-badge ${a.category.toLowerCase()}`}>{a.category}</span>
              </td>
              <td><span className={`ea-status-badge ${statusCls(a.status)}`}>{a.status}</span></td>
              <td><PhotosCell photos={a.photos} onOpen={onOpenPhotos} /></td>
              <td>
                <button className="ea-btn-remove" onClick={() => onRemove(a.assetId, a.id)}>
                  Remove
                </button>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────
const EmployeeDetails = () => {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { empId } = useParams();

  const [employee,   setEmployee  ] = useState(null);
  const [loading,    setLoading   ] = useState(true);
  const [filterTab,  setFilterTab ] = useState("All");
  const [imageModal, setImageModal] = useState(null);
  const [hwModal,    setHwModal   ] = useState(null);
  const [hwPhotoIdx, setHwPhotoIdx] = useState(0);

  useEffect(() => {
    // Priority 1: employee passed via navigate state (from ActiveDevice)
    const fromState = location.state?.employee;
    if (fromState) { setEmployee(fromState); setLoading(false); return; }
    // Priority 2: look up by URL param
    const id = empId || "";
    const found = getEmployees().find(
      (e) =>
        (e.id    || "").toUpperCase() === id.toUpperCase() ||
        (e.empId || "").toUpperCase() === id.toUpperCase(),
    );
    setEmployee(found || null);
    setLoading(false);
  }, [empId, location.state]);

  const allAssets = employee?.assignedAssets || [];

  const tabCount = useCallback(
    (tab) =>
      tab === "All"
        ? allAssets.length
        : allAssets.filter((a) => a.category === tab).length,
    [allAssets],
  );

  const filtered = useMemo(
    () =>
      filterTab === "All"
        ? allAssets
        : allAssets.filter((a) => a.category === filterTab),
    [allAssets, filterTab],
  );

  const hardwareAssets = useMemo(() => filtered.filter((a) => a.category === "Hardware"),  [filtered]);
  const softwareAssets = useMemo(() => filtered.filter((a) => a.category === "Software"),  [filtered]);
  const accConAssets   = useMemo(
    () => filtered.filter((a) => a.category === "Accessories" || a.category === "Consumables"),
    [filtered],
  );

  const handleRemove = useCallback(
    (assetId, entryId) => {
      if (!window.confirm("Remove this asset from the employee?")) return;
      if (assetId) returnAssetUnit(assetId);
      const entry = (employee.assignedAssets || []).find((a) => a.id === entryId);
      if (entry?.category === "Software" && entry?.licenseId)
        returnSoftwareLicense(entry.licenseId);
      const updated = {
        ...employee,
        assignedAssets: employee.assignedAssets.filter((a) => a.id !== entryId),
      };
      saveEmployees(getEmployees().map((e) => (e.id === employee.id ? updated : e)));
      setEmployee(updated);
    },
    [employee],
  );

  const openHwModal    = useCallback((asset) => { setHwModal(enrichHardware(asset)); setHwPhotoIdx(0); }, []);
  const closeHwModal   = useCallback(() => setHwModal(null), []);
  const openImageModal = useCallback((photos, idx = 0) => setImageModal({ photos, currentIndex: idx }), []);
  const closeImgModal  = useCallback(() => setImageModal(null), []);
  const prevImg        = useCallback(
    () => setImageModal((m) => ({ ...m, currentIndex: (m.currentIndex - 1 + m.photos.length) % m.photos.length })),
    [],
  );
  const nextImg = useCallback(
    () => setImageModal((m) => ({ ...m, currentIndex: (m.currentIndex + 1) % m.photos.length })),
    [],
  );

  if (loading)   return <div className="ea-loading">Loading…</div>;
  if (!employee) return <div className="ea-loading">Employee not found.</div>;

  const avatarSrc = employee.photo || makeAvatar(employee.name);

  return (
    <div className="employee-assets">

      {/* ── Back ── */}
      <div className="back-button-container">
        <button className="btn-back" onClick={() => navigate(-1)}>
          ← Back to Active Devices
        </button>
      </div>

      {/* ── Profile Card ── */}
      <div className="employee-details-card">
        <div className="employee-layout">
          <div className="employee-photo-section">
            <div className="photo-container">
              <img
                src={avatarSrc}
                alt={employee.name}
                onError={(e) => { e.target.src = makeAvatar(employee.name); }}
              />
            </div>
          </div>
          <div className="employee-info-section">
            <h1>{employee.name}</h1>
            <div className="info-grid">
              {[
                ["Employee ID",  employee.id     ],
                ["Type",         employee.type   ],
                ["Circle",       employee.circle ],
                ["Email",        employee.email  ],
                ["Total Assets", allAssets.length],
              ].map(([label, value]) => (
                <div key={label} className="info-item">
                  <span className="info-label">{label}</span>
                  <span className="info-value">{value || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Assets Section ── */}
      <div className="assets-section">
        <h2>Assigned Assets ({allAssets.length})</h2>

        {/* Tabs */}
        <div className="filter-tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              className={`filter-tab ${filterTab === tab ? "active" : ""}`}
              onClick={() => setFilterTab(tab)}
            >
              {tab} <span className="count-badge">{tabCount(tab)}</span>
            </button>
          ))}
        </div>

        {filterTab === "All" && (
          <>
            {hardwareAssets.length > 0 && (
              <>
                <div className="ea-section-label">
                  <span className="ea-section-dot hardware" /> Hardware Assets
                </div>
                <HardwareTable
                  assets={hardwareAssets} onRemove={handleRemove}
                  onViewDetails={openHwModal} onOpenPhotos={openImageModal}
                />
              </>
            )}
            {softwareAssets.length > 0 && (
              <>
                <div className="ea-section-label">
                  <span className="ea-section-dot software" /> Software Assets
                </div>
                <SoftwareTable assets={softwareAssets} onRemove={handleRemove} />
              </>
            )}
            {accConAssets.length > 0 && (
              <>
                <div className="ea-section-label">
                  <span className="ea-section-dot other" /> Accessories / Consumables
                </div>
                <NonHardwareTable
                  assets={accConAssets} onRemove={handleRemove} onOpenPhotos={openImageModal}
                />
              </>
            )}
            {allAssets.length === 0 && (
              <div className="ea-table-wrap">
                <p className="ea-empty">No assets assigned yet.</p>
              </div>
            )}
          </>
        )}

        {filterTab === "Hardware" && (
          <HardwareTable
            assets={filtered} onRemove={handleRemove}
            onViewDetails={openHwModal} onOpenPhotos={openImageModal}
          />
        )}
        {filterTab === "Software" && (
          <SoftwareTable assets={filtered} onRemove={handleRemove} />
        )}
        {(filterTab === "Accessories" || filterTab === "Consumables") && (
          <NonHardwareTable
            assets={filtered} onRemove={handleRemove} onOpenPhotos={openImageModal}
          />
        )}
      </div>

      {/* ── Hardware Details Modal ── */}
      {hwModal && (
        <div className="hdm-backdrop" onClick={closeHwModal}>
          <div className="hdm-panel" onClick={(e) => e.stopPropagation()}>
            <div className="hdm-header">
              <div className="hdm-header-left">
                <div>
                  <h2 className="hdm-title">{hwModal.name}</h2>
                  <div className="hdm-header-meta">
                    <span className="ea-cat-badge hardware">Hardware</span>
                    <span className={`ea-status-badge ${statusCls(hwModal.status)}`}>
                      {hwModal.status}
                    </span>
                  </div>
                </div>
              </div>
              <button className="hdm-close" onClick={closeHwModal}>×</button>
            </div>

            <div className="hdm-body">
              <div className="hdm-specs">
                <p className="hdm-col-title">Hardware Specifications</p>
                <div className="hdm-detail-list">
                  {[
                    { label: "Asset ID",      value: hwModal.displayAssetId, mono: true, highlight: true },
                    { label: "Brand",         value: hwModal.brand },
                    { label: "Make",          value: hwModal.make  },
                    { label: "Model",         value: hwModal.model },
                    { label: "Serial Number", value: hwModal.serialNumber, mono: true },
                  ].map(({ label, value, mono, highlight }) => (
                    <div key={label} className={`hdm-row ${highlight ? "highlight" : ""}`}>
                      <span className="hdm-row-label">{label}</span>
                      <span className={`hdm-row-value ${mono ? "mono" : ""}`}>{value || "—"}</span>
                    </div>
                  ))}
                  {hwModal.imei1 && hwModal.imei1 !== "—" && (
                    <>
                      <div className="hdm-imei-heading">Mobile IMEI</div>
                      <div className="hdm-row highlight">
                        <span className="hdm-row-label">IMEI 1</span>
                        <span className="hdm-row-value mono">{hwModal.imei1}</span>
                      </div>
                      <div className="hdm-row">
                        <span className="hdm-row-label">IMEI 2</span>
                        <span className="hdm-row-value mono">{hwModal.imei2 || "—"}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="hdm-photos">
                <p className="hdm-col-title">Photos</p>
                {!hwModal.photos?.length ? (
                  <div className="hdm-no-photos">
                    <div className="hdm-no-photo-icon">📷</div>
                    <p>No photos available</p>
                  </div>
                ) : (
                  <div className="hdm-photo-viewer">
                    <div className="hdm-main-wrap">
                      <img src={hwModal.photos[hwPhotoIdx]} alt="" className="hdm-main-img" />
                      {hwModal.photos.length > 1 && (
                        <>
                          <button
                            className="hdm-nav prev"
                            onClick={(e) => { e.stopPropagation(); setHwPhotoIdx((i) => (i - 1 + hwModal.photos.length) % hwModal.photos.length); }}
                          >‹</button>
                          <button
                            className="hdm-nav next"
                            onClick={(e) => { e.stopPropagation(); setHwPhotoIdx((i) => (i + 1) % hwModal.photos.length); }}
                          >›</button>
                          <div className="hdm-photo-counter">{hwPhotoIdx + 1} / {hwModal.photos.length}</div>
                        </>
                      )}
                    </div>
                    {hwModal.photos.length > 1 && (
                      <div className="hdm-thumbs">
                        {hwModal.photos.map((p, i) => (
                          <img
                            key={i} src={p} alt=""
                            className={`hdm-thumb ${i === hwPhotoIdx ? "active" : ""}`}
                            onClick={() => setHwPhotoIdx(i)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="hdm-footer">
              <button className="hdm-btn-close" onClick={closeHwModal}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Image Carousel Modal ── */}
      {imageModal && (
        <div className="image-modal-overlay" onClick={closeImgModal}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={closeImgModal}>×</button>
            <div className="carousel-container">
              {imageModal.photos.length > 1 && (
                <button className="carousel-btn prev" onClick={prevImg}>‹</button>
              )}
              <div className="carousel-image-wrapper">
                <img src={imageModal.photos[imageModal.currentIndex]} alt="" />
                {imageModal.photos.length > 1 && (
                  <div className="image-counter">
                    {imageModal.currentIndex + 1} / {imageModal.photos.length}
                  </div>
                )}
              </div>
              {imageModal.photos.length > 1 && (
                <button className="carousel-btn next" onClick={nextImg}>›</button>
              )}
            </div>
            {imageModal.photos.length > 1 && (
              <div className="thumbnail-navigation">
                {imageModal.photos.map((p, i) => (
                  <img
                    key={i} src={p} alt=""
                    className={`thumbnail ${i === imageModal.currentIndex ? "active" : ""}`}
                    onClick={() => setImageModal((m) => ({ ...m, currentIndex: i }))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeDetails;
