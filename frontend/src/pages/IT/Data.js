import {
  getInventoryRowForUnit,
  resolveInventoryCategory,
} from "./inventoryCategories";

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
const ASSIGNED_SHAPE_MIGRATION_KEY = "it_assigned_shape_migrated_v1";

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

const runAssignedToShapeMigrationOnce = () => {
  try {
    const done = localStorage.getItem(ASSIGNED_SHAPE_MIGRATION_KEY) === "true";
    if (done) return;

    const employees = JSON.parse(localStorage.getItem(EMPLOYEES_KEY) || "[]");
    const byEmpId = new Map();
    const byAdminId = new Map();
    for (const e of employees) {
      const empId = String(e.empId || e.id || "").trim();
      const adminId = String(e.adminId || "").trim();
      const name = e.name || "—";
      if (empId) byEmpId.set(empId.toUpperCase(), { empId, name });
      if (adminId) byAdminId.set(adminId, { empId: empId || adminId, name });
    }

    const mapAssignedTo = (assignedTo) => {
      if (!assignedTo) return assignedTo;
      if (assignedTo != null && typeof assignedTo === "object" && assignedTo.empId) {
        return assignedTo;
      }

      const raw = String(assignedTo).trim();
      if (!raw) return null;

      if (/^\d+$/.test(raw)) {
        const match = byAdminId.get(raw);
        return {
          adminId: Number(raw),
          empId: match?.empId || raw,
          name: match?.name || "—",
        };
      }

      const match = byEmpId.get(raw.toUpperCase());
      return {
        adminId: null,
        empId: match?.empId || raw,
        name: match?.name || "—",
      };
    };

    const units = JSON.parse(localStorage.getItem(UNITS_KEY) || "[]");
    let changedUnits = false;
    const nextUnits = units.map((u) => {
      if (!u || !u.assignedTo || (u.assignedTo != null && typeof u.assignedTo === "object")) {
        return u;
      }
      changedUnits = true;
      return { ...u, assignedTo: mapAssignedTo(u.assignedTo) };
    });
    if (changedUnits) localStorage.setItem(UNITS_KEY, JSON.stringify(nextUnits));

    const sw = JSON.parse(localStorage.getItem(SOFTWARE_KEY) || "[]");
    let changedSw = false;
    const nextSw = sw.map((s) => {
      if (!s || !s.assignedTo || (s.assignedTo != null && typeof s.assignedTo === "object")) {
        return s;
      }
      changedSw = true;
      return { ...s, assignedTo: mapAssignedTo(s.assignedTo) };
    });
    if (changedSw) localStorage.setItem(SOFTWARE_KEY, JSON.stringify(nextSw));

    localStorage.setItem(ASSIGNED_SHAPE_MIGRATION_KEY, "true");
    sessionStorage.setItem(ASSIGNED_SHAPE_MIGRATION_KEY, "true");
  } catch (e) {
    console.warn("[Data] Assigned-shape migration skipped:", e);
  }
};

runAssignedToShapeMigrationOnce();

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

const _toInventoryItemId = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const buildDeletedLogApiPayload = (unit, deletedBy, reason, deleteCode) => ({
  delete_code: deleteCode,
  asset_unit_id: unit?.id ?? null,
  inventory_item_id: _toInventoryItemId(unit?.inventoryId),
  deleted_by_name: deletedBy,
  asset_name: (unit?.assetName || unit?.brand || "").trim() || "Asset",
  category: unit?.category || "Hardware",
  serial_number: unit?.serialNumber || "",
  reason,
});

export const buildLocalDeletedEntry = (unit, deletedBy, reason, deletedId) => {
  const inventory = getInventoryFromStorage() || [];
  const invRow = getInventoryRowForUnit(unit, inventory);
  const inventoryCategory = invRow
    ? resolveInventoryCategory(invRow)
    : resolveInventoryCategory({ category: unit?.category, inventoryCategory: unit?.inventoryCategory });

  return {
    deletedId,
    assetUnitId: unit?.id ?? null,
    inventoryId: unit?.inventoryId ?? null,
    inventoryCategory: inventoryCategory || null,
    assetName: unit?.assetName || unit?.brand || "",
    brand: unit?.brand || unit?.assetName || null,
    model: unit?.model || null,
    category: unit?.category || "Hardware",
    hwType: unit?.hwType || null,
    serialNumber: unit?.serialNumber || null,
    repairDate: unit?.repairDate || null,
    deletedAt: new Date().toISOString(),
    deletedBy,
    deleteReason: reason,
  };
};

export const logDeletedAsset = (unit, deletedBy, deleteReason) => {
  const deleted = getDeletedAssetsFromStorage();
  const deletedId = `del-${unit.id || unit.assetId || unit.assetName}-${deleted.length}`;
  deleted.unshift(buildLocalDeletedEntry(unit, deletedBy, deleteReason, deletedId));
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
      notWorking: units.filter((u) => u.status === "notWorking" || u.status === "not-working").length,
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
    assetUnitId: asset.assetUnitId ?? asset.id ?? null,
    inventoryId: asset.inventoryId ?? null,
    serialNumber: asset.serialNumber || "",
    itReason: asset.itReason || asset.reason || "",
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

// ══════════════════════════════════════════════════════════════════════════════
//  BACKEND API BRIDGE (IT MODULE)
// ══════════════════════════════════════════════════════════════════════════════

const IT_API_BASE = "/api/it";

const _tokenHeaders = () => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function _itFetch(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${IT_API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ..._tokenHeaders(),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(data?.message || `IT API request failed (${res.status})`);
  }
  return data;
}

/** User-visible message from IT API / network errors (for react-toastify). */
export function getITApiErrorMessage(
  err,
  fallback = "Something went wrong. Please try again.",
) {
  if (err == null) return fallback;
  if (typeof err === "string") {
    const s = err.trim();
    return s || fallback;
  }
  const msg = err?.message;
  if (typeof msg === "string" && msg.trim()) return msg.trim();
  return fallback;
}

const _toLocalInventory = (item) => {
  const row = {
    id: item.id,
    name: item.name,
    category: item.category,
    inventory_category: item.inventory_category,
    inventoryCategory: item.inventory_category || item.inventoryCategory,
    hwType: item.hw_type || null,
    photos: item.photos || [],
    totalQuantity: Number(item.totalQuantity ?? item.total_quantity ?? 0),
    availableQuantity: Number(item.availableQuantity ?? item.available_quantity ?? 0),
    assignedQuantity: Number(item.assignedQuantity ?? item.assigned_quantity ?? 0),
    notWorkingQuantity: Number(item.notWorkingQuantity ?? item.not_working_quantity ?? 0),
    repairQuantity: Number(item.repairQuantity ?? item.repair_quantity ?? 0),
    vendor: item.vendor || "",
    purchaseDate: item.purchase_date || item.purchaseDate || null,
    receipts: item.receipts || [],
    location: item.location || "",
    notes: item.notes || "",
    isStock: String(item.category || "").toLowerCase() === "stock",
  };
  return {
    ...row,
    inventoryCategory: resolveInventoryCategory(row),
  };
};

const _toLocalUnit = (u) => ({
  id: u.id,
  assetId: u.unitCode || u.unit_code || u.id,
  inventoryId: u.inventoryId ?? u.inventory_item_id,
  assetName: u.assetName || "",
  category: u.category || "Hardware",
  hwType: u.hwType || null,
  brand: u.brand || "",
  make: u.make || "",
  model: u.model || "",
  serialNumber: u.serialNumber || "",
  imei1: u.imei1 || null,
  imei2: u.imei2 || null,
  status: u.status || "available",
  assignedTo:
    u.assignedTo == null
      ? null
      : {
          adminId: u.assignedTo,
          empId: u.assignedToEmpId || String(u.assignedTo),
          name: u.assignedToName || "—",
        },
  assignedDate: u.assignedDate || null,
  assetTag: u.assetTag || "",
  photos: u.photos || [],
  assignmentPhotos: u.assignmentPhotos || [],
  repairDate: u.repairDate || null,
});

const _toLocalSoftware = (s) => ({
  id: s.id,
  inventoryId: s.inventoryId ?? s.inventory_item_id ?? null,
  name: s.name,
  subscriptionStart: s.subscriptionStart || null,
  subscriptionEnd: s.subscriptionEnd || null,
  status: s.status || "available",
  assignedTo:
    s.assignedTo == null
      ? null
      : {
          adminId: s.assignedTo,
          empId: s.assignedToEmpId || String(s.assignedTo),
          name: s.assignedToName || "—",
        },
});

const _toLocalTicket = (t) => ({
  id: t.id,
  empId: String(t.requesterAdminId ?? "—"),
  email: t.requesterName || "—",
  query: t.description || t.title || "",
  date: t.created_at || new Date().toISOString(),
  status: t.status || "pending",
});

const _toLocalParcelImport = (r) => ({
  id: r.importCode || r.id,
  assetName: r.assetName || "",
  count: Number(r.count || 0),
  from: r.from || "",
  date: (r.date || "").split("T")[0] || "",
  idNo: r.idNo || "",
  receivedBy: r.receivedBy || "",
  photos: r.photos || [],
});

const _toLocalParcelExport = (r) => ({
  id: r.exportCode || r.id,
  assetName: r.assets?.length
    ? [...new Set(r.assets.map((a) => a.assetName).filter(Boolean))].join(", ")
    : "",
  count: Number(r.count || r.assets?.length || 0),
  to: r.to || "",
  date: (r.date || "").split("T")[0] || "",
  idNo: r.idNo || "",
  exportedBy: r.exportedBy || "",
  serialNumbers: (r.assets || []).map((a) => a.serialNo).filter(Boolean),
  assets: (r.assets || []).map((a) => ({
    id: a.id,
    assetName: a.assetName || "",
    serialNo: a.serialNo || "",
    brand: a.brand || "",
    model: a.model || "",
    individualPhoto: a.individualPhoto || null,
  })),
  photos: r.photos || [],
});

export const syncITDataFromAPI = async () => {
  const [invRes, unitRes, swRes, ticketRes, employeeAssignedRes] = await Promise.all([
    _itFetch("/inventory/items"),
    _itFetch("/units"),
    _itFetch("/software/licenses"),
    _itFetch("/tickets"),
    _itFetch("/employees/assigned-assets"),
  ]);

  const inv = (invRes.items || []).map(_toLocalInventory);
  const units = (unitRes.units || []).map(_toLocalUnit);
  const sw = (swRes.licenses || []).map(_toLocalSoftware);
  const tickets = (ticketRes.tickets || []).map(_toLocalTicket);

  saveInventoryToStorage(inv);
  saveAssetUnitsToStorage(units);
  saveSoftwareInventory(sw);
  saveTickets(tickets);

  const assignedEmployees = Array.isArray(employeeAssignedRes?.employees)
    ? employeeAssignedRes.employees
    : [];
  if (assignedEmployees.length) {
    const current = getEmployees();
    const byEmpId = new Map(
      assignedEmployees.map((e) => [String(e.empId || e.id || "").toUpperCase(), e]),
    );
    const merged = current.map((emp) => {
      const key = String(emp.empId || emp.id || "").toUpperCase();
      const hit = byEmpId.get(key);
      if (!hit) return emp;
      return {
        ...emp,
        adminId: hit.adminId || emp.adminId || null,
        name: hit.name || emp.name || "",
        email: hit.email || emp.email || "",
        type: hit.type || emp.type || "",
        circle: hit.circle || emp.circle || "",
        activated: Boolean(hit.activated || emp.activated),
        assignedAssets: Array.isArray(hit.assignedAssets) ? hit.assignedAssets : (emp.assignedAssets || []),
      };
    });
    const existingKeys = new Set(merged.map((e) => String(e.empId || e.id || "").toUpperCase()));
    for (const e of assignedEmployees) {
      const key = String(e.empId || e.id || "").toUpperCase();
      if (!key || existingKeys.has(key)) continue;
      merged.push({
        id: e.id || e.empId || "",
        empId: e.empId || e.id || "",
        adminId: e.adminId || null,
        name: e.name || "",
        email: e.email || "",
        type: e.type || "",
        circle: e.circle || "",
        photo: e.photo || "",
        activated: Boolean(e.activated),
        assignedAssets: Array.isArray(e.assignedAssets) ? e.assignedAssets : [],
      });
    }
    saveEmployees(merged);
  }
  notifyInventoryChange();
};

export const createInventoryItemAPI = async ({
  name,
  category,
  inventoryCategory = "IT Assets",
  hwType = null,
  quantity = null,
  photos = [],
  vendor = null,
  purchaseDate = null,
  receipts = [],
  location = null,
  notes = null,
}) =>
  _itFetch("/inventory/items", {
    method: "POST",
    body: {
      name,
      category,
      inventory_category: inventoryCategory,
      hw_type: hwType,
      initial_quantity: quantity,
      photos,
      vendor,
      purchase_date: purchaseDate,
      receipts,
      location,
      notes,
    },
  });

export const updateInventoryItemAPI = async (itemId, payload = {}) =>
  _itFetch(`/inventory/items/${itemId}`, {
    method: "PATCH",
    body: payload,
  });

export const createHardwareUnitsAPI = async ({
  inventoryItemId,
  assetName,
  category = "Hardware",
  hwType = null,
  rows = [],
}) =>
  _itFetch("/units/bulk", {
    method: "POST",
    body: {
      inventory_item_id: inventoryItemId,
      units: rows.map((r) => ({
        unit_code: r.serialNumber,
        asset_name: assetName,
        category,
        hw_type: hwType,
        brand: r.brand,
        make: r.make,
        model: r.model,
        serial_number: r.serialNumber,
        imei1: r.imei1 || null,
        imei2: r.imei2 || null,
        photos: r.photos || [],
      })),
    },
  });

export const createSoftwareLicensesAPI = async ({
  inventoryItemId,
  name,
  subscriptionStart,
  subscriptionEnd,
  quantity,
}) =>
  _itFetch("/software/licenses/bulk", {
    method: "POST",
    body: {
      inventory_item_id: inventoryItemId,
      name,
      subscription_start: subscriptionStart,
      subscription_end: subscriptionEnd,
      quantity,
    },
  });

export const resolveTicketAPI = async (ticketId) => {
  await _itFetch(`/tickets/${ticketId}/resolve`, { method: "PATCH" });
  const res = await _itFetch("/tickets");
  const tickets = (res.tickets || []).map(_toLocalTicket);
  saveTickets(tickets);
  return tickets;
};

export const fetchTicketsAPI = async () => {
  const res = await _itFetch("/tickets");
  const tickets = (res.tickets || []).map(_toLocalTicket);
  saveTickets(tickets);
  return tickets;
};

export const assignUnitToEmployeeAPI = async ({
  unitId,
  adminId,
  empId,
  assetTag,
  assignmentPhotos = [],
}) =>
  _itFetch("/assignments/units", {
    method: "POST",
    body: {
      unit_id: unitId,
      assigned_to_admin_id: adminId || null,
      assigned_to_emp_id: empId || null,
      asset_tag: assetTag,
      assignment_photos: assignmentPhotos,
    },
  });

export const assignSoftwareToEmployeeAPI = async ({ licenseId, adminId, empId }) =>
  _itFetch("/assignments/software", {
    method: "POST",
    body: {
      license_id: licenseId,
      assigned_to_admin_id: adminId || null,
      assigned_to_emp_id: empId || null,
    },
  });

export const assignInventoryQuantityAPI = async ({
  inventoryItemId,
  quantity = 1,
  action = "assign",
  adminId = null,
  empId = null,
}) =>
  _itFetch("/assignments/inventory-quantity", {
    method: "POST",
    body: {
      inventory_item_id: inventoryItemId,
      quantity,
      action,
      assigned_to_admin_id: adminId,
      assigned_to_emp_id: empId,
    },
  });

/** Issue office / transport / infrastructure stock or unit to a location. */
export const inventoryStockDeployAPI = async ({
  inventoryItemId,
  quantity = 1,
  deploymentLocation,
  custodianName = null,
  notes = null,
  assetUnitId = null,
}) =>
  _itFetch("/inventory-stock/deploy", {
    method: "POST",
    body: {
      inventory_item_id: inventoryItemId,
      quantity,
      deployment_location: deploymentLocation,
      custodian_name: custodianName,
      notes,
      asset_unit_id: assetUnitId,
    },
  });

export const officeStockDeployAPI = inventoryStockDeployAPI;

/** Return issued qty or unit back to available. */
export const inventoryStockReturnAPI = async ({ deploymentId, quantity = 1 }) =>
  _itFetch("/inventory-stock/return", {
    method: "POST",
    body: {
      deployment_id: deploymentId,
      quantity,
    },
  });

export const officeStockReturnAPI = inventoryStockReturnAPI;

export const fetchOfficeStockDeploymentsAPI = async (inventoryItemId = null) => {
  const q = inventoryItemId != null ? `?inventory_item_id=${inventoryItemId}` : "";
  const res = await _itFetch(`/inventory-stock/deployments${q}`);
  return res?.deployments || res?.data?.deployments || [];
};

export const createParcelImportsAPI = async (entries = []) =>
  Promise.all(
    entries.map((row) =>
      _itFetch("/parcels/imports", {
        method: "POST",
        body: {
          source: row.from,
          assetName: row.assetName,
          count: Number(row.count || 1),
          idNo: row.idNo || "",
          date: row.date,
          received_by_name: String(row.receivedBy || "").trim() || null,
          received_by_admin_id: Number(row.receivedByAdminId || 0) || null,
          photos: row.photos || [],
        },
      }),
    ),
  );

export const createParcelExportAPI = async ({
  destination,
  idNo = "",
  exportedBy = "",
  exportedByAdminId = null,
  photos = [],
  assets = [],
}) =>
  _itFetch("/parcels/exports", {
    method: "POST",
    body: {
      destination,
      idNo,
      exported_by_name: String(exportedBy || "").trim() || null,
      exported_by_admin_id: exportedByAdminId,
      photos,
      assets: assets.map((a) => ({
        asset_unit_id: a.asset_unit_id || a.id,
        assetName: a.assetName,
        serialNo: a.serialNo,
        brand: a.brand,
        model: a.model,
        individualPhoto: a.individualPhoto || null,
      })),
    },
  });

async function _fetchAllParcelPages(path, listKey) {
  const perPage = 200;
  let page = 1;
  let hasNext = true;
  const allRows = [];

  while (hasNext) {
    const res = await _itFetch(`${path}?page=${page}&per_page=${perPage}`);
    const chunk = Array.isArray(res?.[listKey]) ? res[listKey] : [];
    allRows.push(...chunk);

    // Backward-compatible fallback: old API without pagination metadata
    if (typeof res?.has_next === "boolean") {
      hasNext = res.has_next;
      page += 1;
    } else {
      hasNext = false;
    }
  }

  return allRows;
}

export const syncParcelsFromAPI = async () => {
  const [importsRows, exportsRows] = await Promise.all([
    _fetchAllParcelPages("/parcels/imports", "imports"),
    _fetchAllParcelPages("/parcels/exports", "exports"),
  ]);
  const imports = importsRows.map(_toLocalParcelImport);
  const exports = exportsRows.map(_toLocalParcelExport);
  localStorage.setItem("pcl_imported", JSON.stringify(imports));
  localStorage.setItem("pcl_exported", JSON.stringify(exports));
  notifyInventoryChange();
  return { imports, exports };
};

export const createRemovedAssetAPI = async (payload) =>
  _itFetch("/removed-assets", {
    method: "POST",
    body: payload,
  });

const _toLocalDeletedLog = (d) => {
  const inventory = getInventoryFromStorage() || [];
  const invId = d.inventoryId ?? d.inventory_item_id ?? null;
  const invRow = invId != null
    ? inventory.find((i) => String(i.id) === String(invId))
    : null;
  const inventoryCategory = invRow
    ? resolveInventoryCategory(invRow)
    : resolveInventoryCategory({ category: d.category });

  return {
    deletedId: d.deleteCode || d.id,
    assetUnitId: d.assetUnitId ?? d.asset_unit_id ?? null,
    inventoryId: invId,
    inventoryCategory: inventoryCategory || null,
    assetName: d.assetName || "",
    brand: d.assetName || "",
    model: "",
    category: d.category || "Hardware",
    serialNumber: d.serialNumber || "",
    deletedBy: d.deletedByName || "",
    deleteReason: d.reason || "",
    deletedAt: d.deletedAt || new Date().toISOString(),
  };
};

export const createDeletedLogAPI = async (payload) =>
  _itFetch("/deleted-logs", {
    method: "POST",
    body: payload,
  });

export const syncDeletedLogsFromAPI = async () => {
  const res = await _itFetch("/deleted-logs");
  const rows = (res.logs || []).map(_toLocalDeletedLog);
  localStorage.setItem(DELETED_KEY, JSON.stringify(rows));
  notifyInventoryChange();
  return rows;
};

export const wipeDeletedLogAPI = async (deleteCode) =>
  _itFetch(`/deleted-logs/${encodeURIComponent(deleteCode)}`, { method: "DELETE" });

export const wipeAllDeletedLogsAPI = async () =>
  _itFetch("/deleted-logs", { method: "DELETE" });

const _toLocalRemovedIT = (r) => ({
  id: r.id,
  name: r.name || "",
  category: r.category || "Hardware",
  owner: r.ownerName || "—",
  ownerId: r.ownerAdminId || null,
  assetUnitId: r.assetUnitId ?? r.asset_unit_id ?? null,
  inventoryId: r.inventoryId ?? r.inventory_item_id ?? null,
  serialNumber: r.serialNumber || "",
  itReason: r.reason || "",
  flaggedAt: r.removedAt || new Date().toISOString(),
});

export const syncRemovedITFromAPI = async () => {
  const res = await _itFetch("/removed-assets");
  const rows = (res.removed_assets || []).map(_toLocalRemovedIT);
  saveRemovedITAssets(rows);
  notifyInventoryChange();
  return rows;
};

export const removeRemovedITAssetAPI = async (removedId) =>
  _itFetch(`/removed-assets/${removedId}`, { method: "DELETE" });

export const setUnitStatusAPI = async ({ unitId, status }) =>
  _itFetch(`/units/${unitId}/status`, {
    method: "PATCH",
    body: { status },
  });

export const deleteAssetUnitAPI = async (unitId) =>
  _itFetch(`/units/${unitId}`, { method: "DELETE" });

export const fetchEmployeeAssetsAPI = async (empId) => {
  const res = await _itFetch(`/employees/${encodeURIComponent(empId)}/assets`);
  return res.employee || null;
};

export const lookupEmployeeByEmpIdOrEmailAPI = async (query) => {
  const q = String(query || "").trim();
  if (!q) return [];
  const res = await _itFetch(`/employees/lookup?q=${encodeURIComponent(q)}`);
  return Array.isArray(res?.employees) ? res.employees : [];
};

export const returnAssetUnitAPI = async (unitId, status = "available") =>
  _itFetch(`/assignments/units/${unitId}/return`, {
    method: "POST",
    body: { status },
  });

export const returnSoftwareLicenseAPI = async (licenseId) =>
  _itFetch(`/assignments/software/${licenseId}/return`, {
    method: "POST",
    body: {},
  });

export const createReturnRequestAPI = async ({
  reason,
  assetUnitId = null,
  softwareLicenseId = null,
  inventoryItemId = null,
  quantity = 1,
  returnDestination = "available",
  photos = [],
}) =>
  _itFetch("/return-requests", {
    method: "POST",
    body: {
      reason,
      asset_unit_id: assetUnitId,
      software_license_id: softwareLicenseId,
      inventory_item_id: inventoryItemId,
      quantity,
      return_destination: returnDestination,
      photos,
    },
  });

export const listReturnRequestsAPI = async ({ status = "", mine = false, empId = "" } = {}) => {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (mine) params.set("mine", "1");
  if (empId) params.set("emp_id", String(empId).trim());
  const q = params.toString();
  const res = await _itFetch(`/return-requests${q ? `?${q}` : ""}`);
  return Array.isArray(res?.requests) ? res.requests : [];
};

/** Return requests for the employee on the assets page (same person who submits Return). */
export const listEmployeeReturnRequestsAPI = async (empId, { status = "" } = {}) => {
  const id = String(empId || "").trim();
  if (!id) return [];
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const q = params.toString();
  const res = await _itFetch(
    `/employees/${encodeURIComponent(id)}/return-requests${q ? `?${q}` : ""}`,
  );
  return Array.isArray(res?.requests) ? res.requests : [];
};

export const approveReturnRequestAPI = async (requestId) =>
  _itFetch(`/return-requests/${requestId}/approve`, { method: "PATCH" });

export const rejectReturnRequestAPI = async (requestId, rejectionReason) =>
  _itFetch(`/return-requests/${requestId}/reject`, {
    method: "PATCH",
    body: { rejection_reason: rejectionReason },
  });

export const completeReturnRequestAPI = async (requestId) =>
  _itFetch(`/return-requests/${requestId}/complete`, { method: "PATCH" });

export const renewSoftwareLicenseAPI = async ({ licenseId, subscriptionEnd }) =>
  _itFetch(`/software/licenses/${licenseId}/renew`, {
    method: "PATCH",
    body: {
      subscription_end: subscriptionEnd,
    },
  });
