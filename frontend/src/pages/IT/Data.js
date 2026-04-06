// ══════════════════════════════════════════════════════════════════════════════
//  STORAGE KEYS
// ══════════════════════════════════════════════════════════════════════════════

export const UNITS_KEY = "assetUnits";
export const DELETED_KEY = "deletedAssets";
export const INVENTORY_KEY = "inventory";
export const EMPLOYEES_KEY = "employees";
export const SOFTWARE_KEY = "softwareInventory";
export const TICKETS_KEY = "support_tickets";
export const REMOVED_IT_KEY = "removedITAssets";

const SEED_FLAG_KEY = "app_seeded_v3"; // bumped: employees-only seeding

// ══════════════════════════════════════════════════════════════════════════════
//  SEED DATA  — employees only

export const SEED_EMPLOYEES = [
  {
    id: "EMP001",
    empId: "EMP001",
    name: "Aarav Sharma",
    email: "aarav.sharma@company.com",
    type: "Full-Time",
    circle: "North",
    photo: "",
    activated: false,
    assignedAssets: [],
  },
  {
    id: "EMP002",
    empId: "EMP002",
    name: "Priya Mehta",
    email: "priya.mehta@company.com",
    type: "Full-Time",
    circle: "West",
    photo: "",
    activated: false,
    assignedAssets: [],
  },
  {
    id: "EMP003",
    empId: "EMP003",
    name: "Rohan Desai",
    email: "rohan.desai@company.com",
    type: "Contract",
    circle: "South",
    photo: "",
    activated: false,
    assignedAssets: [],
  },
  {
    id: "EMP004",
    empId: "EMP004",
    name: "Neha Patel",
    email: "neha.patel@company.com",
    type: "Full-Time",
    circle: "East",
    photo: "",
    activated: false,
    assignedAssets: [],
  },
  {
    id: "EMP005",
    empId: "EMP005",
    name: "Vikram Singh",
    email: "vikram.singh@company.com",
    type: "Full-Time",
    circle: "North",
    photo: "",
    activated: false,
    assignedAssets: [],
  },
];

const _isSeedFlagSet = () =>
  localStorage.getItem(SEED_FLAG_KEY) === "true" ||
  sessionStorage.getItem(SEED_FLAG_KEY) === "true";

const _stampSeedFlag = () => {
  localStorage.setItem(SEED_FLAG_KEY, "true");
  sessionStorage.setItem(SEED_FLAG_KEY, "true");
};

// Only seeds employees — all other stores start as empty arrays.
const _writeSeedData = () => {
  localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(SEED_EMPLOYEES));
  localStorage.setItem(INVENTORY_KEY, JSON.stringify([]));
  localStorage.setItem(UNITS_KEY, JSON.stringify([]));
  localStorage.setItem(SOFTWARE_KEY, JSON.stringify([]));
  localStorage.setItem(DELETED_KEY, JSON.stringify([]));
  localStorage.setItem(TICKETS_KEY, JSON.stringify([]));
  localStorage.setItem(REMOVED_IT_KEY, JSON.stringify([]));
};

const initStorage = () => {
  if (_isSeedFlagSet()) {
    console.debug("[Data] Already seeded — skipping initStorage.");
    return;
  }
  // First-ever run: seed employees + empty stores, then stamp flag.
  _writeSeedData();
  _stampSeedFlag();
  console.debug(
    "[Data] Employee seed written. All asset stores initialised empty.",
  );
};

// Run on module load.
initStorage();

export const resetToSeedData = () => {
  localStorage.removeItem(SEED_FLAG_KEY);
  sessionStorage.removeItem(SEED_FLAG_KEY);
  _writeSeedData();
  _stampSeedFlag();
  window.dispatchEvent(new Event("inventory-updated"));
  console.log(
    "✅ [Data] Reset complete — 5 seed employees restored, all asset stores cleared.",
  );
};

export const clearAllData = () => {
  // Wipe EVERYTHING including the seed flag — app shows fully empty on next load.
  [
    UNITS_KEY,
    DELETED_KEY,
    INVENTORY_KEY,
    EMPLOYEES_KEY,
    SOFTWARE_KEY,
    TICKETS_KEY,
    REMOVED_IT_KEY,
    SEED_FLAG_KEY,
  ].forEach((k) => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
  window.dispatchEvent(new Event("inventory-updated"));
  console.log("🗑️ [Data] All data cleared. App is now fully empty.");
};

if (process.env.NODE_ENV === "development") {
  window.__resetStorage = resetToSeedData;
  window.__clearStorage = clearAllData;
  window.__debugStorage = () => {
    const keys = [
      UNITS_KEY,
      DELETED_KEY,
      INVENTORY_KEY,
      EMPLOYEES_KEY,
      SOFTWARE_KEY,
      TICKETS_KEY,
      REMOVED_IT_KEY,
      SEED_FLAG_KEY,
    ];
    console.group("📦 localStorage Snapshot");
    keys.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (raw === null) {
        console.warn(`${key} → NOT SET`);
        return;
      }
      try {
        const val = JSON.parse(raw);
        console.log(
          `${key} (${Array.isArray(val) ? val.length + " entries" : typeof val})`,
          val,
        );
      } catch {
        console.log(`${key} → raw:`, raw);
      }
    });
    console.log("sessionStorage flag:", sessionStorage.getItem(SEED_FLAG_KEY));
    console.groupEnd();
  };
}

export const getAssetUnitsFromStorage = () => {
  try {
    return JSON.parse(localStorage.getItem(UNITS_KEY)) || [];
  } catch {
    return [];
  }
};

export const saveAssetUnitsToStorage = (units) => {
  // Dedup by `id` before saving — last-write-wins for same id.
  const seen = new Map();
  units.forEach((u) => seen.set(u.id, u));
  localStorage.setItem(UNITS_KEY, JSON.stringify([...seen.values()]));
};

const saveUnits = saveAssetUnitsToStorage;

// ─── Unit status transitions ──────────────────────────────────────────────────

export const moveHwUnitToRepair = (id) => {
  const units = getAssetUnitsFromStorage();
  const idx = units.findIndex((u) => u.id === id);
  if (idx === -1) return;
  units[idx] = {
    ...units[idx],
    status: "repair",
    repairDate: new Date().toISOString(),
  };
  saveUnits(units);
};

export const returnUnitFromRepair = (id) => {
  const units = getAssetUnitsFromStorage();
  const idx = units.findIndex((u) => u.id === id);
  if (idx === -1) return;
  units[idx] = { ...units[idx], status: "available", repairDate: null };
  saveUnits(units);
};

export const deleteHwUnit = (id) =>
  saveUnits(getAssetUnitsFromStorage().filter((u) => u.id !== id));
export const deleteAssetUnit = deleteHwUnit; // alias for InRepair

export const deleteInventoryItem = (assetName, category) =>
  saveUnits(
    getAssetUnitsFromStorage().filter(
      (u) => !(u.assetName === assetName && u.category === category),
    ),
  );

// ─── Assignment ───────────────────────────────────────────────────────────────

export const assignUnitToEmployee = (
  unitId,
  empId,
  assetTag,
  assignmentPhotos = [],
) => {
  const units = getAssetUnitsFromStorage();
  const idx = units.findIndex((u) => u.id === unitId || u.assetId === unitId);
  if (idx === -1) {
    console.warn("[Data] assignUnitToEmployee: unit not found —", unitId);
    return;
  }
  const unit = units[idx];
  units[idx] = {
    ...unit,
    status: "assigned",
    assignedTo: empId,
    assetTag,
    assignmentPhotos,
    assignedDate: new Date().toISOString(),
  };
  saveUnits(units);
  _syncInventoryOnAssign(unit.inventoryId || unit.assetName);
  notifyInventoryChange();
};

export const returnAssetUnit = (assetId) => {
  const units = getAssetUnitsFromStorage();
  const idx = units.findIndex((u) => u.assetId === assetId || u.id === assetId);
  if (idx === -1) return;
  const unit = units[idx];
  units[idx] = {
    ...unit,
    status: "available",
    assignedTo: null,
    assignmentPhotos: [],
  };
  saveUnits(units);
  _syncInventoryOnReturn(unit.inventoryId || unit.assetName);
  notifyInventoryChange();
};

// ─── Inventory sync helpers (keep catalog counts accurate) ───────────────────

function _findInventoryIdx(inv, inventoryIdOrName) {
  return inv.findIndex(
    (i) =>
      String(i.id) === String(inventoryIdOrName) ||
      i.name === inventoryIdOrName,
  );
}

function _syncInventoryOnAssign(inventoryIdOrName) {
  try {
    const inv = getInventoryFromStorage();
    const idx = _findInventoryIdx(inv, inventoryIdOrName);
    if (idx < 0) return;
    const item = { ...inv[idx] };
    item.assignedQuantity = (Number(item.assignedQuantity) || 0) + 1;
    item.availableQuantity = Math.max(
      0,
      (Number(item.availableQuantity) || 0) - 1,
    );
    inv[idx] = item;
    saveInventoryToStorage(inv);
    console.debug(
      "[Data] Inventory synced on assign:",
      item.name,
      "→ avail:",
      item.availableQuantity,
      "assigned:",
      item.assignedQuantity,
    );
  } catch (e) {
    console.error("[Data] _syncInventoryOnAssign:", e);
  }
}

function _syncInventoryOnReturn(inventoryIdOrName) {
  try {
    const inv = getInventoryFromStorage();
    const idx = _findInventoryIdx(inv, inventoryIdOrName);
    if (idx < 0) return;
    const item = { ...inv[idx] };
    item.assignedQuantity = Math.max(
      0,
      (Number(item.assignedQuantity) || 0) - 1,
    );
    item.availableQuantity = (Number(item.availableQuantity) || 0) + 1;
    inv[idx] = item;
    saveInventoryToStorage(inv);
    console.debug("[Data] Inventory synced on return:", item.name);
  } catch (e) {
    console.error("[Data] _syncInventoryOnReturn:", e);
  }
}

export const syncCatalogAfterBulkAssign = (assignedUnits = []) => {
  if (!assignedUnits.length) return;
  assignedUnits.forEach((unit) => {
    _syncInventoryOnAssign(unit.inventoryId || unit.assetId || unit.assetName);
  });
  notifyInventoryChange();
};

export const getDeletedAssetsFromStorage = () => {
  try {
    return JSON.parse(localStorage.getItem(DELETED_KEY)) || [];
  } catch {
    return [];
  }
};

export const logDeletedAsset = (unit, deletedBy, deleteReason) => {
  const deleted = getDeletedAssetsFromStorage();
  // Use unit.id as stable deletedId — prevents phantom duplicates on re-render.
  const deletedId = `del-${unit.id || unit.assetId || unit.assetName}-${deleted.length}`;
  deleted.unshift({
    deletedId,
    assetName: unit.assetName,
    brand: unit.brand || null,
    model: unit.model || null,
    category: unit.category,
    hwType: unit.hwType || null,
    serialNumber: unit.serialNumber || null,
    repairDate: unit.repairDate || null,
    deletedAt: new Date().toISOString(),
    deletedBy,
    deleteReason,
  });
  localStorage.setItem(DELETED_KEY, JSON.stringify(deleted));
};

export const permanentlyWipeDeletedAsset = (deletedId) =>
  localStorage.setItem(
    DELETED_KEY,
    JSON.stringify(
      getDeletedAssetsFromStorage().filter((d) => d.deletedId !== deletedId),
    ),
  );

export const permanentlyWipeAllDeletedAssets = () =>
  localStorage.setItem(DELETED_KEY, JSON.stringify([]));

// ══════════════════════════════════════════════════════════════════════════════
//  INVENTORY CATALOG — CRUD

export const getInventoryFromStorage = () => {
  try {
    return JSON.parse(localStorage.getItem(INVENTORY_KEY)) || [];
  } catch {
    return [];
  }
};

export const saveInventoryToStorage = (inventory) => {
  // Dedup by `id` before saving.
  const seen = new Map();
  inventory.forEach((i) => seen.set(i.id, i));
  localStorage.setItem(INVENTORY_KEY, JSON.stringify([...seen.values()]));
};

// ─── Deterministic ID generator — NO Date.now() ───────────────────────────────
// Format: "inv-{3-digit sequential}"
export const generateInventoryId = (inventory) => {
  const existing = inventory.map((i) => {
    const match = String(i.id).match(/^inv-(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  });
  const max = existing.length > 0 ? Math.max(...existing) : 0;
  return `inv-${String(max + 1).padStart(3, "0")}`;
};

export const addToInventory = (name, category, quantity, extra = {}) => {
  const inventory = getInventoryFromStorage();
  const existing = inventory.find(
    (i) =>
      i.name.toLowerCase() === name.toLowerCase() && i.category === category,
  );
  if (existing) {
    existing.totalQuantity = (Number(existing.totalQuantity) || 0) + quantity;
    existing.availableQuantity =
      (Number(existing.availableQuantity) || 0) + quantity;
  } else {
    inventory.push({
      id: generateInventoryId(inventory),
      name,
      category,
      inventoryCategory: extra.inventoryCategory || "IT Assets",
      hwType: extra.hwType || null,
      totalQuantity: quantity,
      availableQuantity: quantity,
      assignedQuantity: 0,
      notWorkingQuantity: 0,
      repairQuantity: 0,
    });
  }
  saveInventoryToStorage(inventory);
};

export const addSoftwareToInventory = ({
  name,
  subscriptionStart,
  subscriptionEnd,
  quantity,
}) => {
  // ── 1. Update the inventory CATALOG (display counts in dashboards) ──────────
  const inventory = getInventoryFromStorage();
  const normalizedName = (name || "").trim().toLowerCase();
  const existing = inventory.find(
    (i) =>
      (i.category || "").toLowerCase() === "software" &&
      (i.name || "").trim().toLowerCase() === normalizedName,
  );

  if (existing) {
    existing.totalQuantity = (Number(existing.totalQuantity) || 0) + quantity;
    existing.availableQuantity =
      (Number(existing.availableQuantity) || 0) + quantity;
    if (!existing.subscriptionEnd || subscriptionEnd > existing.subscriptionEnd)
      existing.subscriptionEnd = subscriptionEnd;
    if (
      !existing.subscriptionStart ||
      subscriptionStart < existing.subscriptionStart
    )
      existing.subscriptionStart = subscriptionStart;
    existing.category = "Software";
  } else {
    inventory.push({
      id: generateInventoryId(inventory),
      name: name.trim(),
      category: "Software",
      inventoryCategory: "IT Assets",
      subscriptionStart,
      subscriptionEnd,
      totalQuantity: quantity,
      availableQuantity: quantity,
      assignedQuantity: 0,
    });
  }
  saveInventoryToStorage(inventory);

  addSoftwareLicensesToPool({
    name: name.trim(),
    subscriptionStart,
    subscriptionEnd,
    quantity,
  });
};

export const syncInventoryCount = (unit, action) => {
  try {
    const inv = getInventoryFromStorage();
    const idx = _findInventoryIdx(
      inv,
      unit.inventoryId || unit.assetName || unit.name,
    );
    if (idx < 0) {
      notifyInventoryChange();
      return;
    }

    const item = { ...inv[idx] };
    const n = (k) => Number(item[k]) || 0;

    switch (action) {
      case "toRepair":
        item.repairQuantity = n("repairQuantity") + 1;
        item.availableQuantity = Math.max(0, n("availableQuantity") - 1);
        break;
      case "toNotWorking":
        item.notWorkingQuantity = n("notWorkingQuantity") + 1;
        item.availableQuantity = Math.max(0, n("availableQuantity") - 1);
        break;
      case "fromRepairToAvailable":
        item.repairQuantity = Math.max(0, n("repairQuantity") - 1);
        item.availableQuantity = n("availableQuantity") + 1;
        break;
      case "fromNotWorkingToRepair":
        item.notWorkingQuantity = Math.max(0, n("notWorkingQuantity") - 1);
        item.repairQuantity = n("repairQuantity") + 1;
        break;
      case "fromRepairDelete":
        item.repairQuantity = Math.max(0, n("repairQuantity") - 1);
        item.totalQuantity = Math.max(0, n("totalQuantity") - 1);
        break;
      case "fromNotWorkingDelete":
        item.notWorkingQuantity = Math.max(0, n("notWorkingQuantity") - 1);
        item.totalQuantity = Math.max(0, n("totalQuantity") - 1);
        break;
      case "permanentDelete":
        item.totalQuantity = Math.max(0, n("totalQuantity") - 1);
        item.availableQuantity = Math.max(0, n("availableQuantity") - 1);
        break;
      default:
        break;
    }

    const nextInv =
      Number(item.totalQuantity) <= 0 && action.includes("Delete")
        ? inv.filter((_, i) => i !== idx)
        : inv.map((it, i) => (i === idx ? item : it));

    saveInventoryToStorage(nextInv);
  } catch (e) {
    console.error("[Data] syncInventoryCount:", e);
  }
  notifyInventoryChange();
};

// ══════════════════════════════════════════════════════════════════════════════
//  SUMMARY COUNTS  — derived entirely from assetUnits + inventory catalog
//  No mixing of independent sources.
// ══════════════════════════════════════════════════════════════════════════════

export const getInventoryCounts = () => {
  try {
    const units = getAssetUnitsFromStorage();
    const deleted = getDeletedAssetsFromStorage();
    const removedIT = getRemovedITAssets();
    const inventory = getInventoryFromStorage();

    // Total = sum of inventory catalog totalQuantity (excluding Software).
    const total = inventory
      .filter((i) => i.category !== "Software")
      .reduce((s, i) => s + (Number(i.totalQuantity) || 0), 0);

    return {
      total,
      notWorking: units.filter((u) => u.status === "notWorking").length,
      inRepair: units.filter((u) => u.status === "repair").length,
      removedAssets: deleted.length,
      removedIT: removedIT.length,
    };
  } catch {
    return {
      total: 0,
      notWorking: 0,
      inRepair: 0,
      removedAssets: 0,
      removedIT: 0,
    };
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  EMPLOYEES — CRUD
// ══════════════════════════════════════════════════════════════════════════════

export const getEmployees = () =>
  JSON.parse(localStorage.getItem(EMPLOYEES_KEY) || "[]");
export const saveEmployees = (d) =>
  localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(d));
export const getEmployeeById = (id) =>
  getEmployees().find(
    (e) =>
      (e.id || "").toUpperCase() === id.toUpperCase() ||
      (e.empId || "").toUpperCase() === id.toUpperCase(),
  ) || null;

// ══════════════════════════════════════════════════════════════════════════════
//  SOFTWARE LICENSES — individual seat pool
// ══════════════════════════════════════════════════════════════════════════════

export const getSoftwareInventory = () =>
  JSON.parse(localStorage.getItem(SOFTWARE_KEY) || "[]");
export const saveSoftwareInventory = (d) =>
  localStorage.setItem(SOFTWARE_KEY, JSON.stringify(d));

export const returnSoftwareLicense = (licenseId) => {
  const sw = getSoftwareInventory();
  const idx = sw.findIndex((i) => i.id === licenseId);
  if (idx === -1) return;
  const licenseName = sw[idx].name;
  sw[idx] = { ...sw[idx], status: "available", assignedTo: null };
  saveSoftwareInventory(sw);

  // Keep the catalog counts in sync
  const inv = getInventoryFromStorage();
  const invIdx = inv.findIndex(
    (i) =>
      (i.category || "").toLowerCase() === "software" &&
      (i.name || "").trim().toLowerCase() ===
        (licenseName || "").trim().toLowerCase(),
  );
  if (invIdx !== -1) {
    inv[invIdx] = {
      ...inv[invIdx],
      availableQuantity: (Number(inv[invIdx].availableQuantity) || 0) + 1,
      assignedQuantity: Math.max(
        0,
        (Number(inv[invIdx].assignedQuantity) || 0) - 1,
      ),
    };
    saveInventoryToStorage(inv);
  }
  notifyInventoryChange();
};

export const addSoftwareLicensesToPool = ({
  name,
  subscriptionStart,
  subscriptionEnd,
  quantity,
}) => {
  const existing = getSoftwareInventory();
  // Deterministic IDs: SW-{NAME_SLUG}-{sequential}
  const slug = name.replace(/\s+/g, "").toUpperCase().slice(0, 8);
  const maxSeq = existing
    .filter((s) => s.id.startsWith(`SW-${slug}-`))
    .map((s) => parseInt(s.id.split("-").pop(), 10) || 0)
    .reduce((m, n) => Math.max(m, n), 0);

  const newLicenses = Array.from({ length: quantity }, (_, i) => ({
    id: `SW-${slug}-${String(maxSeq + i + 1).padStart(3, "0")}`,
    name,
    subscriptionStart,
    subscriptionEnd,
    status: "available",
    assignedTo: null,
  }));
  saveSoftwareInventory([...existing, ...newLicenses]);
};

// ══════════════════════════════════════════════════════════════════════════════
//  TICKETS — CRUD
// ══════════════════════════════════════════════════════════════════════════════

export const getTickets = () =>
  JSON.parse(localStorage.getItem(TICKETS_KEY) || "[]");
export const saveTickets = (d) =>
  localStorage.setItem(TICKETS_KEY, JSON.stringify(d));
export const resolveTicket = (ticketId) =>
  saveTickets(
    getTickets().map((t) =>
      t.id === ticketId ? { ...t, status: "completed" } : t,
    ),
  );

// ══════════════════════════════════════════════════════════════════════════════
//  REMOVED IT ASSETS — CRUD
// ══════════════════════════════════════════════════════════════════════════════

export const getRemovedITAssets = () => {
  try {
    return JSON.parse(localStorage.getItem(REMOVED_IT_KEY)) || [];
  } catch {
    return [];
  }
};
export const saveRemovedITAssets = (d) =>
  localStorage.setItem(REMOVED_IT_KEY, JSON.stringify(d));

export const addRemovedITAsset = (asset) => {
  const existing = getRemovedITAssets();
  // Deterministic ID: rit-{assetId or name}-{count}
  const baseId =
    asset.id ||
    asset.assetId ||
    (asset.name || "asset").replace(/\s+/g, "-").toLowerCase();
  existing.unshift({
    id: `rit-${baseId}-${existing.length}`,
    name: asset.name || asset.assetName || "",
    category: asset.category || "Hardware",
    owner: asset.owner || asset.assignedTo || "—",
    ownerId: asset.ownerId || asset.empId || null,
    itReason: asset.itReason || "",
    flaggedAt: asset.flaggedAt || new Date().toISOString(),
  });
  saveRemovedITAssets(existing);
};

export const removeFromRemovedIT = (id) =>
  saveRemovedITAssets(getRemovedITAssets().filter((a) => a.id !== id));

// ══════════════════════════════════════════════════════════════════════════════
//  REAL-TIME SYNC
// ══════════════════════════════════════════════════════════════════════════════

export const notifyInventoryChange = () => {
  try {
    window.dispatchEvent(new Event("inventory-updated"));
  } catch {}
};

// ══════════════════════════════════════════════════════════════════════════════
//  IMAGE COMPRESSION HELPER
// ══════════════════════════════════════════════════════════════════════════════

export const compressImage = (
  file,
  { maxWidth = 800, maxHeight = 800, quality = 0.65 } = {},
) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
