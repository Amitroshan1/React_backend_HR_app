/** Shared inventory top-level categories (tabs) and add-assets configuration. */

export const INV_CATEGORIES = [
  "IT Assets",
  "Office Assets",
  "Transport Assets",
  "Infrastructure Assets",
];

export const ASSET_TYPE_TABS = [
  { label: "IT Assets", key: "it", inventoryCategory: "IT Assets" },
  { label: "Office Assets", key: "office", inventoryCategory: "Office Assets" },
  { label: "Transport Assets", key: "transport", inventoryCategory: "Transport Assets" },
  {
    label: "Infrastructure Assets",
    key: "infrastructure",
    inventoryCategory: "Infrastructure Assets",
  },
];

const KEY_BY_CATEGORY = Object.fromEntries(
  ASSET_TYPE_TABS.map((t) => [t.inventoryCategory, t.key]),
);

const CATEGORY_BY_KEY = Object.fromEntries(
  ASSET_TYPE_TABS.map((t) => [t.key, t.inventoryCategory]),
);

export const INVENTORY_CATEGORY_CONFIG = {
  "IT Assets": {
    hwTypes: ["Laptop", "Mobile", "Desktop", "Tablet", "Other"],
    mobileHwType: "Mobile",
    itemCategories: ["Hardware", "Software", "Accessories", "Consumables"],
  },
  "Office Assets": {
    stockMode: true,
    hwTypes: ["Furniture", "Electronics", "Appliances", "Safety Equipment", "Other"],
    mobileHwType: null,
    itemCategories: ["Hardware", "Accessories", "Consumables"],
  },
  "Transport Assets": {
    vehicleMode: true,
    hwTypes: ["Car", "Bike", "Scooter", "Van", "Truck", "Bus", "Other"],
    mobileHwType: null,
    hardwareFields: {
      brand: { label: "Fleet / Owner", placeholder: "e.g. Company Fleet" },
      make: { label: "Make", placeholder: "e.g. Toyota, Honda" },
      model: { label: "Model", placeholder: "e.g. Innova Crysta" },
      serialNumber: { label: "Registration No.", placeholder: "e.g. MH12AB1234" },
    },
  },
  "Infrastructure Assets": {
    stockMode: true,
    equipmentMode: true,
    equipmentTypes: ["Networking", "Power", "Cooling", "Security", "Other"],
    hwTypes: ["Networking", "Power", "Cooling", "Security", "Other"],
    mobileHwType: null,
    itemCategories: ["Hardware", "Accessories", "Consumables"],
  },
};

export function inventoryCategoryToKey(inventoryCategory) {
  return KEY_BY_CATEGORY[inventoryCategory] || "it";
}

export function keyToInventoryCategory(key) {
  return CATEGORY_BY_KEY[key] || "IT Assets";
}

export function isValidInventoryCategory(cat) {
  return INV_CATEGORIES.includes(cat);
}

/** Filter inventory rows by `inventoryCategory` field. */
/** Resolve top-level inventory tab from API/local row (never treat Stock/Vehicle as IT by default). */
export function resolveInventoryCategory(item) {
  const explicit = String(
    item?.inventoryCategory ?? item?.inventory_category ?? "",
  ).trim();
  const cat = String(item?.category ?? "").trim().toLowerCase();

  if (cat === "vehicle") return "Transport Assets";
  if (cat === "equipment") return "Infrastructure Assets";

  if (cat === "stock") {
    if (
      explicit === "Office Assets" ||
      explicit === "Infrastructure Assets" ||
      explicit === "Transport Assets"
    ) {
      return explicit;
    }
    return "";
  }

  if (
    ["hardware", "software", "accessories", "consumables", "consumable", "accessory"].includes(
      cat,
    )
  ) {
    return explicit && INV_CATEGORIES.includes(explicit) ? explicit : "IT Assets";
  }

  if (explicit && INV_CATEGORIES.includes(explicit)) return explicit;
  return "";
}

export function filterInventoryByCategory(items, inventoryCategory) {
  if (!inventoryCategory) return items;
  return (items || []).filter(
    (i) => resolveInventoryCategory(i) === inventoryCategory,
  );
}

/** Resolve parent inventory row for a unit. */
export function getInventoryRowForUnit(unit, inventory = null) {
  if (!unit) return null;
  const inv = inventory || [];
  return (
    inv.find((i) => String(i.id) === String(unit.inventoryId)) ||
    inv.find((i) => String(i.id) === String(unit.assetId)) ||
    null
  );
}

export const DEFAULT_HARDWARE_FIELDS = {
  brand: { label: "Brand", placeholder: "Enter Brand" },
  make: { label: "Make", placeholder: "Enter Make" },
  model: { label: "Model", placeholder: "Enter Model" },
  serialNumber: { label: "Serial Number", placeholder: "Serial No." },
};

const INFRA_EQUIPMENT_HARDWARE_FIELDS = {
  brand: { label: "Make", placeholder: "e.g. Cisco" },
  make: { label: "Make", placeholder: "e.g. Cisco" },
  model: { label: "Model", placeholder: "e.g. 2960" },
  serialNumber: { label: "Asset tag / ID", placeholder: "e.g. INF-001" },
};

/** Brand / Name column for unit rows (fixes legacy rows where site was stored in brand). */
export function getUnitBrandModelDisplay(unit, inventoryCategory) {
  const cat = String(unit?.category || "").trim().toLowerCase();
  if (inventoryCategory === "Infrastructure Assets" && cat === "equipment") {
    const make = String(unit?.make || "").trim();
    const model = String(unit?.model || "").trim();
    const assetName = String(unit?.assetName || "").trim();
    const primary =
      make && make !== "—" && make !== assetName
        ? make
        : assetName || make || String(unit?.brand || "").trim() || "—";
    const secondary = model && model !== "—" ? model : "";
    return { primary, secondary };
  }
  const primary = String(unit?.brand || unit?.assetName || unit?.name || "").trim() || "—";
  const secondary = String(unit?.model || "").trim();
  return { primary, secondary };
}

export function getHardwareFields(inventoryCategory, itemCategory = null) {
  const cat = String(itemCategory || "").trim().toLowerCase();
  if (inventoryCategory === "Infrastructure Assets" && cat === "equipment") {
    return INFRA_EQUIPMENT_HARDWARE_FIELDS;
  }
  const config = INVENTORY_CATEGORY_CONFIG[inventoryCategory];
  return config?.hardwareFields || DEFAULT_HARDWARE_FIELDS;
}

export function isStockInventoryCategory(inventoryCategory) {
  return Boolean(INVENTORY_CATEGORY_CONFIG[inventoryCategory]?.stockMode);
}

export function isVehicleInventoryCategory(inventoryCategory) {
  return Boolean(INVENTORY_CATEGORY_CONFIG[inventoryCategory]?.vehicleMode);
}

/** Office, Transport, Infrastructure — no HR employee assign flow. */
export function isNonItInventoryCategory(inventoryCategory) {
  return inventoryCategory !== "IT Assets";
}

const DEPLOY_INVENTORY_CATEGORIES = new Set([
  "Office Assets",
  "Transport Assets",
  "Infrastructure Assets",
]);

/** Issue / return (location deploy) for Office, Transport, Infrastructure. */
export function showInventoryDeploy(inventoryCategory) {
  return DEPLOY_INVENTORY_CATEGORIES.has(inventoryCategory);
}

/** Show In use / Assigned column on IT and deploy-enabled inventory tabs. */
export function hideAssignedColumnForCategory(inventoryCategory) {
  if (inventoryCategory === "IT Assets") return false;
  return !showInventoryDeploy(inventoryCategory);
}

export function isOfficeInventoryCategory(inventoryCategory) {
  return inventoryCategory === "Office Assets";
}

/** @deprecated use showInventoryDeploy */
export function showOfficeStockAssign(inventoryCategory) {
  return showInventoryDeploy(inventoryCategory);
}

export function getAssignedColumnLabel(inventoryCategory) {
  return DEPLOY_INVENTORY_CATEGORIES.has(inventoryCategory) ? "In use" : "Assigned";
}

export function isUnitDeployRow(row, inventoryCategory) {
  const cat = String(row?.category || "").trim().toLowerCase();
  if (inventoryCategory === "Transport Assets") return cat === "vehicle";
  if (inventoryCategory === "Infrastructure Assets") return cat === "equipment";
  return false;
}

export function isStockDeployRow(row) {
  return String(row?.category || "").trim().toLowerCase() === "stock";
}

export function rowSupportsInventoryDeploy(row, inventoryCategory) {
  if (!showInventoryDeploy(inventoryCategory)) return false;
  return isStockDeployRow(row) || isUnitDeployRow(row, inventoryCategory);
}

const DEPLOY_LABEL_DEFAULTS = {
  deployLabel: "Deploy",
  returnLabel: "Return",
  deployModalTitle: "Deploy to location",
  returnModalTitle: "Return to available",
  deployTitle: "Deploy to a location (moves qty to In use)",
  deployDisabledTitle: "Nothing available to deploy",
  returnTitle: "Return deployed quantity to available",
  returnDisabledTitle: "Nothing currently in use",
  deployedAtLabel: "Deployed at",
  loadingDeployed: "Loading deployed records…",
  noDeployed: "Nothing is currently deployed for this item.",
};

export function getDeployModalConfig(inventoryCategory) {
  if (inventoryCategory === "Transport Assets") {
    return {
      ...DEPLOY_LABEL_DEFAULTS,
      label: "Transport",
      locationLabel: "Route / base / depot",
      locationPlaceholder: "e.g. Mumbai depot, Site A",
      hint: "Mark an available vehicle as in use at a location.",
      deployTitle: "Mark vehicle in use at a route or depot",
    };
  }
  if (inventoryCategory === "Infrastructure Assets") {
    return {
      ...DEPLOY_LABEL_DEFAULTS,
      label: "Infrastructure",
      locationLabel: "Site / location",
      locationPlaceholder: "e.g. Server room A, Plant 2",
      hint: "Deploy stock or an installed unit to a site.",
    };
  }
  return {
    ...DEPLOY_LABEL_DEFAULTS,
    label: "Office",
    locationLabel: "Location / department",
    locationPlaceholder: "e.g. 3rd floor pantry, Reception",
    hint: "Move quantity from Available to In use at a location.",
  };
}

/** Category tabs on Not Working / In Repair / Dead Assets (IT only). */
export const IT_INVENTORY_STATUS_TABS = [
  "All",
  "Hardware",
  "Accessories",
  "Consumables",
];

export function getInventoryStatusCategoryTabs(inventoryCategory) {
  if (isNonItInventoryCategory(inventoryCategory)) {
    return ["All"];
  }
  return IT_INVENTORY_STATUS_TABS;
}

export function showInventoryStatusCategoryTabs(inventoryCategory) {
  return !isNonItInventoryCategory(inventoryCategory);
}

export function unitBelongsToInventoryCategory(unit, inventoryCategory, inventory = null) {
  if (!inventoryCategory) return true;
  const row = getInventoryRowForUnit(unit, inventory);
  if (!row) return false;
  return resolveInventoryCategory(row) === inventoryCategory;
}

/** Scope dead-asset audit rows to Office / Transport / Infrastructure / IT tabs. */
export function deletedLogBelongsToInventoryCategory(
  record,
  inventoryCategory,
  { inventory = [], units = [] } = {},
) {
  if (!inventoryCategory) return true;

  const invId = record?.inventoryId ?? record?.inventory_item_id;
  if (invId != null && invId !== "") {
    const row = inventory.find((i) => String(i.id) === String(invId));
    if (row) return resolveInventoryCategory(row) === inventoryCategory;
  }

  const explicit = String(
    record?.inventoryCategory ?? record?.inventory_category ?? "",
  ).trim();
  if (explicit && INV_CATEGORIES.includes(explicit)) {
    return explicit === inventoryCategory;
  }

  const unitId = record?.assetUnitId ?? record?.asset_unit_id;
  if (unitId != null && unitId !== "") {
    const unit = units.find((u) => String(u.id) === String(unitId));
    if (unit) {
      const row = getInventoryRowForUnit(unit, inventory);
      if (row) return resolveInventoryCategory(row) === inventoryCategory;
      const fromUnit = resolveInventoryCategory({
        category: unit.category,
        inventoryCategory: unit.inventoryCategory,
      });
      if (fromUnit) return fromUnit === inventoryCategory;
    }
  }

  const cat = String(record?.category || "").trim().toLowerCase();
  if (cat === "vehicle") return inventoryCategory === "Transport Assets";
  if (cat === "equipment") return inventoryCategory === "Infrastructure Assets";
  if (cat === "stock") {
    if (explicit) return explicit === inventoryCategory;
    return inventoryCategory === "Office Assets";
  }
  if (
    inventoryCategory === "IT Assets" &&
    ["hardware", "software", "accessories", "consumables", "consumable", "accessory"].includes(
      cat,
    )
  ) {
    return true;
  }

  return false;
}
