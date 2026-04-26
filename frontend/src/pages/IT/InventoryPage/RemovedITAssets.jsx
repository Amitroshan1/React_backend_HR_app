
import { useState, useEffect, useCallback } from "react";
import { toast } from "react-toastify";
import {
  createDeletedLogAPI,
  getRemovedITAssets,
  getITApiErrorMessage,
  removeRemovedITAssetAPI,
  setUnitStatusAPI,
  syncRemovedITFromAPI,
  getAssetUnitsFromStorage,
  saveAssetUnitsToStorage,
  syncDeletedLogsFromAPI,
  syncITDataFromAPI,
} from "../Data";
import "./RemovedITAssets.css";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = ["All", "Hardware", "Accessories", "Consumables"];

const CATEGORY_COLORS = {
  Hardware:    { bg: "#eff6ff", text: "#2563eb", dot: "#3b82f6" },
  Accessories: { bg: "#f0fdf4", text: "#16a34a", dot: "#22c55e" },
  Consumables: { bg: "#fff7ed", text: "#ea580c", dot: "#f97316" },
};

// ─────────────────────────────────────────────────────────────────────────────
// FilterBar
// ─────────────────────────────────────────────────────────────────────────────

function FilterBar({ active, onChange, search, onSearch, assets }) {
  const counts = CATEGORIES.reduce((acc, cat) => {
    acc[cat] =
      cat === "All"
        ? assets.length
        : assets.filter((a) => a.category === cat).length;
    return acc;
  }, {});

  return (
    <div className="filter-row">
      <div className="filter-pills">
        {CATEGORIES.map((cat) => {
          const isActive = active === cat;
          return (
            <button
              key={cat}
              onClick={() => onChange(cat)}
              className={`filter-pill ${isActive ? "filter-pill--active" : "filter-pill--inactive"}`}
            >
              {cat}
              <span className={`filter-badge ${isActive ? "filter-badge--active" : "filter-badge--inactive"}`}>
                {counts[cat]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="search-wrap">
        <svg className="search-icon" viewBox="0 0 20 20" fill="none">
          <circle cx="9" cy="9" r="6" stroke="#94a3b8" strokeWidth="1.6" />
          <path d="M13.5 13.5L17 17" stroke="#94a3b8" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          className="search-input"
          placeholder="Search assets or owners…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AssetTable
// ─────────────────────────────────────────────────────────────────────────────

function AssetTable({ assets, onView }) {
  if (assets.length === 0) {
    return (
      <div className="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="3" stroke="#cbd5e1" strokeWidth="1.5" />
          <path d="M9 12h6M12 9v6" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <p>No removed IT assets found</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="asset-table">
        <thead>
          <tr>
            {["Asset Name", "Asset ID", "Category", "Owner / Assignee", "Detail"].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => {
            const c = CATEGORY_COLORS[asset.category] || {};
            return (
              <tr key={asset.id}>
                <td>
                  <div className="asset-name-cell">
                    <div className="asset-icon">{(asset.name || "?").charAt(0)}</div>
                    <span className="asset-name-text">{asset.name}</span>
                  </div>
                </td>
                <td>
                  <code className="asset-id-code">{asset.id}</code>
                </td>
                <td>
                  <span className="cat-badge" style={{ background: c.bg, color: c.text }}>
                    <span className="cat-badge__dot" style={{ background: c.dot }} />
                    {asset.category}
                  </span>
                </td>
                <td>
                  <div className="owner-cell">
                    <div className="owner-avatar">
                      {(asset.owner || "?").split(" ").map((w) => w[0]).join("").slice(0, 2)}
                    </div>
                    <span className="owner-name">{asset.owner || "—"}</span>
                  </div>
                </td>
                <td>
                  <button className="view-btn" onClick={() => onView(asset)}>
                    View
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ActionModal
// ─────────────────────────────────────────────────────────────────────────────

function ActionModal({ asset, onClose, onActionDone }) {
  const [showPermRemove, setShowPermRemove] = useState(false);
  const [permReason,     setPermReason    ] = useState("");
  const [submitted,      setSubmitted     ] = useState(null);
  const [error,          setError         ] = useState("");

  if (!asset) return null;

  const c = CATEGORY_COLORS[asset.category] || {};

  // Send to Repair — moves asset unit to "repair" status in assetUnits
  const handleRepair = () => {
    void (async () => {
      try {
        const units = getAssetUnitsFromStorage();
        const row = units.find(
          (u) => u.id === asset.id || u.assetId === asset.id || u.assetName === asset.name,
        );
        if (row?.id) {
          await setUnitStatusAPI({ unitId: row.id, status: "repair" });
        }
        if (asset.id) {
          await removeRemovedITAssetAPI(asset.id);
        }
        await syncITDataFromAPI();
        await syncRemovedITFromAPI();
        setSubmitted("repair");
        onActionDone?.();
      } catch (err) {
        console.error("[RemovedITAssets] Repair action failed:", err);
        toast.error(getITApiErrorMessage(err, "Could not send this asset to repair on the server."));
      }
    })();
  };

  const handleRemoveClick = () => {
    if (!showPermRemove) {
      setShowPermRemove(true);
    } else {
      if (!permReason.trim()) { setError("Please enter a reason."); return; }
      void (async () => {
        try {
          await createDeletedLogAPI({
            asset_name: asset.name,
            category: asset.category,
            reason: permReason.trim(),
          });
          await syncDeletedLogsFromAPI();
          const units = getAssetUnitsFromStorage();
          const updated = units.filter(
            (u) => u.id !== asset.id && u.assetId !== asset.id,
          );
          saveAssetUnitsToStorage(updated);
          await removeRemovedITAssetAPI(asset.id);
          await syncRemovedITFromAPI();
          setSubmitted("removed");
          onActionDone?.();
        } catch (err) {
          console.error("[RemovedITAssets] Permanent remove failed:", err);
          toast.error(
            getITApiErrorMessage(err, "Could not complete removal on the server."),
          );
        }
      })();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header">
          <div>
            <p className="modal-sub">Asset Action Panel</p>
            <h2 className="modal-title">{asset.name}</h2>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 2l12 12M14 2L2 14" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Meta chips */}
        <div className="modal-meta-row">
          <div className="modal-meta-chip">
            <span className="modal-meta-label">ID</span>
            <span className="modal-meta-val modal-meta-val--mono">{asset.id}</span>
          </div>
          <div className="modal-meta-chip">
            <span className="modal-meta-label">Category</span>
            <span className="cat-badge" style={{ background: c.bg, color: c.text }}>
              <span className="cat-badge__dot" style={{ background: c.dot }} />
              {asset.category}
            </span>
          </div>
          <div className="modal-meta-chip">
            <span className="modal-meta-label">Assigned To</span>
            <span className="modal-meta-val">{asset.owner || "—"}</span>
          </div>
        </div>

        <div className="modal-divider" />

        {/* ── Success screen ── */}
        {submitted ? (
          <div className="success-box">
            <div className="success-icon">{submitted === "repair" ? "🔧" : "🗑️"}</div>
            <p className="success-title">
              {submitted === "repair" ? "Sent to Repair" : "Permanently Removed"}
            </p>
            <p className="success-sub">
              {submitted === "repair"
                ? "This asset has been queued for repair successfully."
                : "This asset has been permanently removed from inventory."}
            </p>
            <button className="btn-done" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            {/* IT Panel Reason */}
            <div className="it-reason-block">
              <div className="it-reason-block__header">
                <span className="it-reason-block__badge">IT Panel</span>
                <span className="it-reason-block__label">Reason sent from IT</span>
              </div>
              <p className="it-reason-block__text">{asset.itReason || "No reason provided."}</p>
            </div>

            {showPermRemove && (
              <div className="field-group perm-reason-block">
                <label className="field-label">
                  Reason for Permanent Remove<span className="required"> *</span>
                </label>
                <textarea
                  className={`field-textarea ${error ? "err" : ""}`}
                  rows={3}
                  placeholder="Explain why this asset should be permanently removed…"
                  value={permReason}
                  onChange={(e) => { setPermReason(e.target.value); setError(""); }}
                />
                {error && <span className="ria-field-err">{error}</span>}
              </div>
            )}

            {/* Action buttons */}
            <div className="modal-action-row">
              <button className="btn-repair" onClick={handleRepair}>
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M14.5 2.5a3 3 0 00-4.24 4.24L3 14l3 3 7.26-7.26A3 3 0 0014.5 2.5z"
                    stroke="white" strokeWidth="1.5" strokeLinejoin="round"
                  />
                </svg>
                Send to Repair
              </button>

              <button
                className={`btn-remove ${showPermRemove ? "btn-remove--active" : ""}`}
                onClick={handleRemoveClick}
              >
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
                  <path d="M6 6l8 8M14 6l-8 8" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                {showPermRemove ? "Confirm Remove" : "Removed Permanent"}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RemovedITAssets  (default export) — fully localStorage-driven
// ─────────────────────────────────────────────────────────────────────────────

export default function RemovedITAssets() {
  const [activeFilter,  setActiveFilter ] = useState("All");
  const [search,        setSearch       ] = useState("");
  const [assets,        setAssets       ] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState(null);

  const reload = useCallback(() => {
    setAssets(getRemovedITAssets());
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        await syncRemovedITFromAPI();
        await syncITDataFromAPI();
      } catch (err) {
        console.error("[RemovedITAssets] API sync failed, using cached data:", err);
        toast.error(
          getITApiErrorMessage(
            err,
            "Could not sync removed IT assets from the server. Showing cached data.",
          ),
        );
      }
      reload();
    };
    load();
  }, [reload]);

  const filteredAssets = assets.filter((asset) => {
    const matchCat    = activeFilter === "All" || asset.category === activeFilter;
    const q           = search.toLowerCase();
    const matchSearch =
      !q ||
      (asset.name  || "").toLowerCase().includes(q) ||
      (asset.id    || "").toLowerCase().includes(q) ||
      (asset.owner || "").toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const handleActionDone = () => {
    reload();
    setSelectedAsset(null);
  };

  return (
    <div className="ria-page">

      {/* Page Header */}
      <div className="ria-page-header">
        <div>
          <p className="ria-breadcrumb">IT Management › Assets</p>
          <h1 className="ria-page-title">Removed IT Assets From IT</h1>
          {/* <p className="ria-page-desc">Manage, track, and take action on all IT assets.</p> */}
        </div>

        <div className="ria-header-stats">
          <div className="ria-stat-card">
            <span className="ria-stat-num">{assets.length}</span>
            <span className="ria-stat-label">Total Assets</span>
          </div>
          <div className="ria-stat-card ria-stat-card--blue">
            <span className="ria-stat-num ria-stat-num--blue">
              {assets.filter((a) => a.category === "Hardware").length}
            </span>
            <span className="ria-stat-label">Hardware</span>
          </div>
        </div>
      </div>

      {/* Main Card */}
      <div className="ria-card">
        <FilterBar
          active={activeFilter}
          onChange={setActiveFilter}
          search={search}
          onSearch={setSearch}
          assets={assets}
        />

        <AssetTable assets={filteredAssets} onView={setSelectedAsset} />

        <div className="ria-table-footer">
          Showing <strong>{filteredAssets.length}</strong> of{" "}
          <strong>{assets.length}</strong> assets
        </div>
      </div>

      {/* Modal */}
      <ActionModal
        asset={selectedAsset}
        onClose={() => setSelectedAsset(null)}
        onActionDone={handleActionDone}
      />
    </div>
  );
}
