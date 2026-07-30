
import { useState, useMemo, useCallback, useEffect } from "react";
import { toast as rtToast } from "react-toastify";
import { useRefreshOnNavigate } from "../../../hooks/useRefreshOnNavigate";
import {
  getAssetUnitsFromStorage,
  getDeletedAssetsFromStorage,
  getInventoryFromStorage,
  toastITApiFailure,
  syncDeletedLogsFromAPI,
  wipeAllDeletedLogsAPI,
  wipeDeletedLogAPI
} from "../Data";
import {
  deletedLogBelongsToInventoryCategory,
  getInventoryStatusCategoryTabs,
  showInventoryStatusCategoryTabs,
} from "../inventoryCategories";
import "./InventoryDashboard.css";
import "./RemovedAssets.css";
import {
  InventoryPanel,
  InventoryFiltersInner,
  InventoryFilterSearch,
  InventoryCategoryTabs,
} from "./InventoryPanel";
import { formatDate } from "../../../utils/dateFormat";

// ─── Constants ────────────────────────────────────────────────────────────────
const SEARCH_FIELDS = ["brand", "assetName", "serialNumber"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── DetailModal ──────────────────────────────────────────────────────────────

function DetailModal({ asset, onClose }) {
  const displayName = asset.brand
    ? `${asset.brand} ${asset.model || ""}`.trim()
    : asset.assetName;

  const fields = [
    { label: "Category",   value: asset.category     || "—" },
    { label: "Serial No",  value: asset.serialNumber  || "—" },
    { label: "Deleted By", value: asset.deletedBy     || "—" },
    { label: "Deleted On", value: formatDate(asset.deletedAt) },
  ];

  return (
    <div className="del-modal-backdrop" onClick={onClose}>
      <div className="del-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="del-modal-head">
          <h3 className="del-modal-title">{displayName}</h3>
          <button className="del-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="del-modal-body">
          {fields.map(({ label, value }) => (
            <div key={label} className="del-modal-row">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
          <div className="del-modal-row full">
            <span>Reason</span>
            <p className="del-modal-reason">{asset.deleteReason || "No reason provided"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ConfirmWipeModal ─────────────────────────────────────────────────────────

function ConfirmWipeModal({ asset, onConfirm, onCancel }) {
  const targetLabel = asset
    ? `"${asset.brand || asset.assetName}"`
    : "all records";

  return (
    <div className="del-modal-backdrop" onClick={onCancel}>
      <div className="del-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="del-modal-title">Permanently Remove?</h3>
        <p className="del-modal-sub">
          This will permanently delete <strong>{targetLabel}</strong> from
          history. Cannot be undone.
        </p>
        <div className="del-modal-actions">
          <button className="del-btn-danger" onClick={onConfirm}>Yes, Remove</button>
          <button className="del-btn-cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── DeletedAssetRow ──────────────────────────────────────────────────────────

function DeletedAssetRow({ record, index, onView, onWipe }) {
  return (
    <tr className={index % 2 === 0 ? "tr-even" : "tr-odd"}>
      <td data-label="Brand / Name">
        <span className="del-brand">{record.brand || record.assetName}</span>
        {record.model && <span className="del-model"> {record.model}</span>}
      </td>
      <td data-label="Category">
        <span className="inv-category-badge">{record.category || "—"}</span>
      </td>
      <td data-label="Serial No">
        {record.serialNumber
          ? <span className="del-serial">{record.serialNumber}</span>
          : "—"}
      </td>
      <td data-label="Removed Date">{formatDate(record.deletedAt)}</td>
      <td data-label="Removed By"><span className="del-by">{record.deletedBy || "—"}</span></td>
      <td data-label="Actions">
        <button className="del-btn-view" onClick={() => onView(record)}>View</button>
        <button className="del-btn-wipe" onClick={() => onWipe(record)}>Wipe</button>
      </td>
    </tr>
  );
}

// ─── RemovedAssets (default export) ──────────────────────────────────────────

export default function RemovedAssets({ inventoryCategory = "IT Assets" }) {
  const categoryTabs = getInventoryStatusCategoryTabs(inventoryCategory);
  const showCategoryTabs = showInventoryStatusCategoryTabs(inventoryCategory);
  const [records,        setRecords]        = useState([]);
  const [activeCategory, setActiveCategory] = useState("All");

  useEffect(() => {
    setActiveCategory("All");
  }, [inventoryCategory]);
  const [searchQuery,    setSearchQuery]    = useState("");
  const [detailAsset,    setDetailAsset]    = useState(null);
  // undefined = modal closed | null = wipe all | object = wipe single
  const [wipeTarget,     setWipeTarget]     = useState(undefined);
  const [toast,          setToast]          = useState("");

  const reload = useCallback(async () => {
    try {
      await syncDeletedLogsFromAPI();
    } catch (err) {
      console.error("[RemovedAssets] API sync failed, using cached logs:", err);
      toastITApiFailure(
          err,
          "Could not load removal history from the server. Showing cached records.",
        );
    }
    setRecords(getDeletedAssetsFromStorage());
  }, []);
  useRefreshOnNavigate(reload, [inventoryCategory]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2_500);
  }, []);

  // ── Derived rows ────────────────────────────────────────────────────────────
  const inventoryRows = useMemo(() => getInventoryFromStorage() || [], [records]);

  const scopedRecords = useMemo(
    () =>
      records.filter((r) =>
        deletedLogBelongsToInventoryCategory(r, inventoryCategory, {
          inventory: inventoryRows,
          units: getAssetUnitsFromStorage() || [],
        }),
      ),
    [records, inventoryCategory, inventoryRows],
  );

  const filteredRows = useMemo(() => {
    let rows = scopedRecords;
    if (activeCategory !== "All") rows = rows.filter((r) => r.category === activeCategory);
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      rows = rows.filter((r) =>
        SEARCH_FIELDS.some((field) =>
          String(r[field] ?? "").toLowerCase().includes(query),
        ),
      );
    }
    return rows;
  }, [scopedRecords, activeCategory, searchQuery]);

  const getCategoryCount = useCallback(
    (cat) => scopedRecords.filter((r) => r.category === cat).length,
    [scopedRecords],
  );

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleWipeConfirm = useCallback(async () => {
    try {
      if (wipeTarget) {
        await wipeDeletedLogAPI(wipeTarget.deletedId);
      } else {
        await wipeAllDeletedLogsAPI();
      }
      await reload();
      setWipeTarget(undefined);
      showToast("Record permanently removed ✓");
    } catch (err) {
      console.error("[RemovedAssets] wipe failed:", err);
      const msg = toastITApiFailure(err, "Failed to remove record on the server.");
      showToast(msg);
    }
  }, [wipeTarget, reload, showToast]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {toast && <div className="inv-toast">{toast}</div>}

      <InventoryPanel
        eyebrow={inventoryCategory}
        title="Dead Assets"
        subtitle="Full audit trail of all dead assets"
        recordCount={filteredRows.length}
        filterBadge={
          activeCategory !== "All" ? (
            <span className="inv-table-filter-badge">{activeCategory}</span>
          ) : null
        }
        filters={
          <InventoryFiltersInner>
            <InventoryFilterSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search by brand or serial…"
            />
            {showCategoryTabs && (
              <InventoryCategoryTabs
                tabs={categoryTabs}
                active={activeCategory}
                onChange={setActiveCategory}
                getCount={getCategoryCount}
              />
            )}
          </InventoryFiltersInner>
        }
        footer={
          <>
            Assets appear here when removed from <strong>Not Working</strong> or{" "}
            <strong>In Repair</strong>. Click <strong>View</strong> for full details.
          </>
        }
      >
        <div className="inv-table-scroll inv-table-scroll--responsive">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Brand / Name</th>
                <th>Category</th>
                <th>Serial No</th>
                <th>Removed Date</th>
                <th>Removed By</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr><td colSpan={6} className="inv-empty-row">No dead assets found</td></tr>
              ) : (
                filteredRows.map((rec, i) => (
                  <DeletedAssetRow
                    key={rec.deletedId}
                    record={rec}
                    index={i}
                    onView={setDetailAsset}
                    onWipe={setWipeTarget}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </InventoryPanel>

      {detailAsset && (
        <DetailModal asset={detailAsset} onClose={() => setDetailAsset(null)} />
      )}

      {wipeTarget !== undefined && (
        <ConfirmWipeModal
          asset={wipeTarget}
          onConfirm={handleWipeConfirm}
          onCancel={() => setWipeTarget(undefined)}
        />
      )}
    </>
  );
}
