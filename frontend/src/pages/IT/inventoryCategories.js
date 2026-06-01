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
export function filterInventoryByCategory(items, inventoryCategory) {
  if (!inventoryCategory) return items;
  return (items || []).filter(
    (i) => (i.inventoryCategory || "IT Assets") === inventoryCategory,
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
  brand: { label: "Site / location", placeholder: "e.g. Server room A" },
  make: { label: "Make", placeholder: "e.g. Cisco" },
  model: { label: "Model", placeholder: "e.g. 2960" },
  serialNumber: { label: "Asset tag / ID", placeholder: "e.g. INF-001" },
};

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

export function hideAssignedColumnForCategory(inventoryCategory) {
  return isNonItInventoryCategory(inventoryCategory);
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
  return (row.inventoryCategory || "IT Assets") === inventoryCategory;
}
