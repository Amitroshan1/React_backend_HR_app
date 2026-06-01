import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  getEmployees,
  getAssetUnitsFromStorage,
  getSoftwareInventory,
  getITApiErrorMessage,
  syncITDataFromAPI,
} from "../Data";
import "./ActiveDevice.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const ASSET_CATEGORIES = ["Hardware", "Software", "Accessories", "Consumables"];
const TABS = ["All", ...ASSET_CATEGORIES];
const CAT_ICONS = {
  All: "📋",
  Hardware: "🖥",
  Software: "💿",
  Accessories: "🖱",
  Consumables: "🖨",
};

const fmt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const normCat = (c) => {
  if (!c) return "Hardware";
  if (c === "Consumable") return "Consumables";
  return c;
};

// ─── Build merged active-device list (localStorage only) ─────────────────────
function getMergedActiveDevices() {
  const employees = getEmployees() || [];

  // 1. Individual hardware units that have been assigned (via AddEmployee)
  const units = (getAssetUnitsFromStorage() || [])
    .filter((u) => {
      const cat = normCat(u.category);
      return (
        u.status === "assigned" && u.assignedTo && ASSET_CATEGORIES.includes(cat)
      );
    })
    .map((u) => {
      const isObj = typeof u.assignedTo === "object" && u.assignedTo !== null;
      const empId = isObj ? u.assignedTo.empId || u.assignedTo.id || "—" : "—";
      const assignedTo = isObj
        ? u.assignedTo.name || String(u.assignedTo)
        : String(u.assignedTo);

      // ── KEY FIX ──────────────────────────────────────────────────────────
      // assetTag  → shown as "Asset ID" (the human-readable tag like HW-001)
      // assetId   → internal inventory reference (fallback)
      // id        → unit's own UUID (last fallback)
      // serialNumber → always its own separate field
      const assetId =
        u.assetTag ||          // prefer the asset tag as the display "Asset ID"
        u.assetId ||           // inventory-level ID
        u.id ||                // unit UUID
        "—";

      const serialNumber =
        u.serialNumber && u.serialNumber !== assetId
          ? u.serialNumber      // only use if it differs from assetId
          : u.serialNumber || "—";

      return {
        id: assetId,
        serialNumber,
        name: u.assetName || u.name || "—",
        category: normCat(u.category),
        assignedTo,
        assignedDate:
          u.assignedDate || u.repairDate || new Date().toISOString(),
        empId,
        // keep raw unit id for dedup
        _unitId: u.id,
      };
    });

  // 2. Software licenses assigned to employees
  const software = (getSoftwareInventory() || [])
    .filter((s) => s.status === "assigned" && s.assignedTo)
    .map((s) => {
      const isObj = typeof s.assignedTo === "object" && s.assignedTo !== null;
      const empId = isObj ? s.assignedTo.empId || s.assignedTo.id || "—" : String(s.assignedTo || "—");
      const assignedTo = isObj ? s.assignedTo.name || String(s.assignedTo) : String(s.assignedTo);
      return {
        id: `LIC-${s.licenseCode || s.id}`,
        serialNumber: s.licenseCode || String(s.id || "—"),
        name: s.name || "Software",
        category: "Software",
        assignedTo,
        assignedDate: s.assignedDate || new Date().toISOString(),
        empId,
        _unitId: `sw-${s.id}`,
      };
    });

  // 3. Quantity-based assignments (Accessories / Consumables) from employee assignedAssets.
  // These do not always exist as unit rows, so include them explicitly.
  const quantityAssets = [];
  for (const emp of employees) {
    const empId = String(emp.empId || emp.id || "—");
    const assignedTo = String(emp.name || "—");
    for (const a of emp.assignedAssets || []) {
      const cat = normCat(a.category);
      if (cat !== "Accessories" && cat !== "Consumables") continue;
      const qty = Math.max(1, Number(a.quantity) || 1);
      const baseName = a.name || "Inventory item";
      quantityAssets.push({
        id: `INV-${a.inventoryId || a.inventoryAssignmentId || a.id || baseName}`,
        serialNumber: qty > 1 ? `Qty ${qty}` : "Qty 1",
        name: qty > 1 ? `${baseName} (x${qty})` : baseName,
        category: cat,
        assignedTo,
        assignedDate: a.assignedDate || new Date().toISOString(),
        empId,
        _unitId: `inv-${empId}-${a.inventoryId || a.inventoryAssignmentId || a.id || baseName}-${qty}`,
      });
    }
  }

  // Deduplicate by unique source key
  const seen = new Set();
  return [...units, ...software, ...quantityAssets].filter((d) => {
    const key = d._unitId || d.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ActiveDevice({ onBack }) {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("All");
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    syncITDataFromAPI().catch((err) => {
      console.error("[ActiveDevice] API sync failed, using cached data:", err);
      toast.error(
        getITApiErrorMessage(
          err,
          "Could not refresh devices from the server. Showing cached assignments.",
        ),
      );
    });
  }, []);

  const allDevices = getMergedActiveDevices();

  const filtered = useMemo(() => {
    let r =
      activeTab === "All"
        ? allDevices
        : allDevices.filter((a) => a.category === activeTab);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      r = r.filter(
        (a) =>
          String(a.id ?? "").toLowerCase().includes(q) ||
          String(a.serialNumber ?? "").toLowerCase().includes(q) ||
          String(a.name ?? "").toLowerCase().includes(q) ||
          String(a.assignedTo ?? "").toLowerCase().includes(q) ||
          String(a.empId ?? "").toLowerCase().includes(q),
      );
    }
    return r;
  }, [allDevices, activeTab, searchQuery]);

  const handleSearch = () => setSearchQuery(search);
  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleView = (empId, assetRow) => {
    if (!empId || empId === "—") {
      alert("No employee ID is linked to this asset.");
      return;
    }

    let employee = getEmployees().find(
      (e) => (e.id || e.empId || "").toUpperCase() === empId.toUpperCase(),
    );

    if (!employee && assetRow) {
      employee = {
        id: empId,
        empId,
        name: assetRow.assignedTo,
        type: "—",
        circle: "—",
        email: "—",
        photo: "",
        activated: true,
        assignedAssets: [],
      };
    }

    navigate(`/it/employee/${empId}`, {
      state: { employee: employee || null },
    });
  };

  const handleBack = () => {
    if (onBack) onBack();
    else navigate(-1);
  };

  const secondColHeader =
    activeTab === "Software"
      ? "License Code"
      : activeTab === "Accessories" || activeTab === "Consumables"
        ? "Quantity"
        : activeTab === "All"
          ? "Serial / License / Qty"
          : "Serial No.";

  const tableColSpan = activeTab === "All" ? 7 : 6;

  return (
    <div className="asd-page">
      <div className="asd-container">
        {/* ── Top Bar ── */}
        <div className="asd-topbar">
          <div className="asd-topbar-left">
            <button className="asd-back-btn" onClick={handleBack}>
              ← Back
            </button>
            <div className="asd-tabs">
              {TABS.map((cat) => (
                <button
                  key={cat}
                  className={`asd-tab ${activeTab === cat ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab(cat);
                    setSearch("");
                    setSearchQuery("");
                  }}
                >
                  <span className="asd-tab-icon">{CAT_ICONS[cat]}</span>
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="asd-search-row">
            <div className="asd-search-wrap">
              <input
                className="asd-search-input"
                placeholder="Search by Asset ID / Serial No. / Asset Name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              {search && (
                <button
                  className="asd-search-clear"
                  onClick={() => {
                    setSearch("");
                    setSearchQuery("");
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <button className="asd-search-btn" onClick={handleSearch}>
              Search
            </button>
          </div>
        </div>

        {/* ── Table Card ── */}
        <div className="asd-table-card">
          <div className="asd-table-head-bar">
            <div className="asd-table-head-left">
              <span className="asd-table-icon">{CAT_ICONS[activeTab]}</span>
              <span className="asd-table-title">
                {activeTab === "All" ? "All" : activeTab} Assets
              </span>
            </div>
            <span className="asd-table-count">
              {filtered.length} record{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="asd-table-scroll">
            <table className="asd-table">
              <thead>
                <tr>
                  <th>Asset ID</th>
                  {activeTab === "All" && <th>Category</th>}
                  <th>{secondColHeader}</th>
                  <th>Asset Name</th>
                  <th>Assigned To</th>
                  <th>Assigned Date</th>
                  <th>View</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={tableColSpan} className="asd-empty">
                      <div className="asd-empty-inner">
                        <span>🔍</span>
                        <p>No assets found</p>
                        {searchQuery && (
                          <span className="asd-empty-hint">
                            Try clearing the search
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((asset, i) => (
                    <tr
                      key={(asset._unitId || asset.id) + i}
                      className={`asd-row ${
                        i % 2 === 0 ? "asd-row-even" : "asd-row-odd"
                      }`}
                    >
                      {/* Asset ID */}
                      <td>
                        <span className="asd-asset-id">{asset.id}</span>
                      </td>
                      {activeTab === "All" && (
                        <td>
                          <span className="asd-cat-pill">{asset.category}</span>
                        </td>
                      )}
                      <td>
                        <span className="asd-asset-id">{asset.serialNumber}</span>
                      </td>
                      <td className="asd-asset-name">{asset.name}</td>
                      <td>
                        <div className="asd-assignee">
                          <span className="asd-assignee-avatar">
                            {(asset.assignedTo || "?").charAt(0)}
                          </span>
                          <div className="asd-assignee-info">
                            <span className="asd-assignee-name">
                              {asset.assignedTo}
                            </span>
                            <span className="asd-assignee-id">
                              {asset.empId}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="asd-date">{fmt(asset.assignedDate)}</td>
                      <td>
                        <button
                          className="asd-view-btn"
                          onClick={() => handleView(asset.empId, asset)}
                          title={`View ${asset.assignedTo}'s profile`}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}


// import { useState, useMemo } from "react";
// import { useNavigate } from "react-router-dom";
// import { getEmployees, saveEmployees, getAssetUnitsFromStorage } from "../Data";
// import "./ActiveDevice.css";

// // ─── Constants ────────────────────────────────────────────────────────────────
// const CATEGORIES = ["Hardware", "Accessories", "Consumables"];
// const CAT_ICONS = { Hardware: "🖥", Accessories: "🖱", Consumables: "🖨" };

// const fmt = (iso) => {
//   if (!iso) return "—";
//   const d = new Date(iso);
//   if (isNaN(d)) return iso;
//   return d.toLocaleDateString("en-IN", {
//     day: "2-digit",
//     month: "short",
//     year: "numeric",
//   });
// };

// const normCat = (c) => {
//   if (!c) return "Hardware";
//   if (c === "Consumable") return "Consumables";
//   return c;
// };

// // ─── Build merged active-device list (localStorage only) ─────────────────────
// function getMergedActiveDevices() {
//   // 1. Individual hardware units that have been assigned (via AddEmployee)
//   const units = (getAssetUnitsFromStorage() || [])
//     .filter((u) => {
//       const cat = normCat(u.category);
//       return (
//         u.status === "assigned" && u.assignedTo && CATEGORIES.includes(cat)
//       );
//     })
//     .map((u) => {
//       const isObj = typeof u.assignedTo === "object" && u.assignedTo !== null;
//       const empId = isObj ? u.assignedTo.empId || u.assignedTo.id || "—" : "—";
//       const assignedTo = isObj
//         ? u.assignedTo.name || String(u.assignedTo)
//         : String(u.assignedTo);
//       return {
//         id: u.assetId || u.id,
//         name: u.assetName || u.name,
//         category: normCat(u.category),
//         assignedTo,
//         assignedDate:
//           u.assignedDate || u.repairDate || new Date().toISOString(),
//         empId,
//       };
//     });

//   // 2. pcl_assigned_assets (written by AddEmployee save flow)
//   const pcl = JSON.parse(localStorage.getItem("pcl_assigned_assets") || "[]")
//     .filter((a) => {
//       const cat = normCat(a.category);
//       return a.category !== "Software" && CATEGORIES.includes(cat);
//     })
//     .map((a) => ({
//       id: a.assetInventoryId || a.id,
//       name: a.name,
//       category: normCat(a.category),
//       assignedTo: a.empName || "—",
//       assignedDate: a.assignedDate || new Date().toISOString(),
//       empId: a.empId || "—",
//     }));

//   // Deduplicate by id — prefer pcl entries over unit entries
//   const seen = new Set();
//   return [...units, ...pcl].filter((d) => {
//     if (seen.has(d.id)) return false;
//     seen.add(d.id);
//     return true;
//   });
// }

// // ─── Main Component ───────────────────────────────────────────────────────────
// export default function ActiveDevice({ onBack }) {
//   const navigate = useNavigate();

//   const [activeTab, setActiveTab] = useState("Hardware");
//   const [search, setSearch] = useState("");
//   const [searchQuery, setSearchQuery] = useState("");

//   const allDevices = getMergedActiveDevices();

//   const filtered = useMemo(() => {
//     let r = allDevices.filter((a) => a.category === activeTab);
//     if (searchQuery.trim()) {
//       const q = searchQuery.toLowerCase();
//       r = r.filter(
//         (a) =>
//           a.id.toLowerCase().includes(q) ||
//           a.name.toLowerCase().includes(q) ||
//           a.assignedTo.toLowerCase().includes(q) ||
//           a.empId.toLowerCase().includes(q),
//       );
//     }
//     return r;
//   }, [allDevices, activeTab, searchQuery]);

//   const handleSearch = () => setSearchQuery(search);
//   const handleKeyDown = (e) => {
//     if (e.key === "Enter") handleSearch();
//   };

//   // ✅ Fixed: guard against missing empId, navigate to IT-specific route
//   const handleView = (empId, assetRow) => {
//     if (!empId || empId === "—") {
//       alert("No employee ID is linked to this asset.");
//       return;
//     }

//     let employee = getEmployees().find(
//       (e) => (e.id || e.empId || "").toUpperCase() === empId.toUpperCase(),
//     );

//     if (!employee && assetRow) {
//       employee = {
//         id: empId,
//         empId,
//         name: assetRow.assignedTo,
//         type: "—",
//         circle: "—",
//         email: "—",
//         photo: "",
//         activated: true,
//         assignedAssets: [],
//       };
//     }

//     // ✅ Navigate to the IT employee details route
//     navigate(`/it/employee/${empId}`, {
//       state: { employee: employee || null },
//     });
//   };

//   const handleBack = () => {
//     if (onBack) onBack();
//     else navigate(-1);
//   };

//   return (
//     <div className="asd-page">
//       <div className="asd-container">
//         {/* ── Top Bar ── */}
//         <div className="asd-topbar">
//           <div className="asd-topbar-left">
//             <button className="asd-back-btn" onClick={handleBack}>
//               ← Back
//             </button>
//             <div className="asd-tabs">
//               {CATEGORIES.map((cat) => (
//                 <button
//                   key={cat}
//                   className={`asd-tab ${activeTab === cat ? "active" : ""}`}
//                   onClick={() => {
//                     setActiveTab(cat);
//                     setSearch("");
//                     setSearchQuery("");
//                   }}
//                 >
//                   <span className="asd-tab-icon">{CAT_ICONS[cat]}</span>
//                   {cat}
//                 </button>
//               ))}
//             </div>
//           </div>

//           <div className="asd-search-row">
//             <div className="asd-search-wrap">
//               <input
//                 className="asd-search-input"
//                 placeholder="Search by Asset ID / Asset Name"
//                 value={search}
//                 onChange={(e) => setSearch(e.target.value)}
//                 onKeyDown={handleKeyDown}
//               />
//               {search && (
//                 <button
//                   className="asd-search-clear"
//                   onClick={() => {
//                     setSearch("");
//                     setSearchQuery("");
//                   }}
//                 >
//                   ×
//                 </button>
//               )}
//             </div>
//             <button className="asd-search-btn" onClick={handleSearch}>
//               Search
//             </button>
//           </div>
//         </div>

//         {/* ── Table Card ── */}
//         <div className="asd-table-card">
//           <div className="asd-table-head-bar">
//             <div className="asd-table-head-left">
//               <span className="asd-table-icon">{CAT_ICONS[activeTab]}</span>
//               <span className="asd-table-title">{activeTab} Assets</span>
//             </div>
//             <span className="asd-table-count">
//               {filtered.length} record{filtered.length !== 1 ? "s" : ""}
//             </span>
//           </div>

//           <div className="asd-table-scroll">
//             <table className="asd-table">
//               <thead>
//                 <tr>
//                   <th>Asset ID</th>
//                   <th>Asset Name</th>
//                   <th>Assigned To</th>
//                   <th>Assigned Date</th>
//                   <th>View</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {filtered.length === 0 ? (
//                   <tr>
//                     <td colSpan={5} className="asd-empty">
//                       <div className="asd-empty-inner">
//                         <span>🔍</span>
//                         <p>No assets found</p>
//                         {searchQuery && (
//                           <span className="asd-empty-hint">
//                             Try clearing the search
//                           </span>
//                         )}
//                       </div>
//                     </td>
//                   </tr>
//                 ) : (
//                   filtered.map((asset, i) => (
//                     <tr
//                       key={asset.id + i}
//                       className={`asd-row ${
//                         i % 2 === 0 ? "asd-row-even" : "asd-row-odd"
//                       }`}
//                     >
//                       <td>
//                         <span className="asd-asset-id">{asset.id}</span>
//                       </td>
//                       <td className="asd-asset-name">{asset.name}</td>
//                       <td>
//                         <div className="asd-assignee">
//                           <span className="asd-assignee-avatar">
//                             {(asset.assignedTo || "?").charAt(0)}
//                           </span>
//                           <div className="asd-assignee-info">
//                             <span className="asd-assignee-name">
//                               {asset.assignedTo}
//                             </span>
//                             <span className="asd-assignee-id">
//                               {asset.empId}
//                             </span>
//                           </div>
//                         </div>
//                       </td>
//                       <td className="asd-date">{fmt(asset.assignedDate)}</td>
//                       <td>
//                         <button
//                           className="asd-view-btn"
//                           onClick={() => handleView(asset.empId, asset)}
//                           title={`View ${asset.assignedTo}'s profile`}
//                         >
//                           View 
//                         </button>
//                       </td>
//                     </tr>
//                   ))
//                 )}
//               </tbody>
//             </table>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }
