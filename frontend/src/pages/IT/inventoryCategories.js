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
    hwTypes: ["Furniture", "Electronics", "Appliances", "Safety Equipment", "Other"],
    mobileHwType: null,
    itemCategories: ["Hardware", "Accessories", "Consumables"],
  },
  "Transport Assets": {
    hwTypes: ["Car", "Bike", "Scooter", "Van", "Truck", "Bus", "Other"],
    mobileHwType: null,
    itemCategories: ["Hardware", "Accessories", "Consumables"],
    vehicleMode: true,
    otherHwPlaceholder: "e.g. Forklift, Trailer, E-Rickshaw",
    hardwareFields: {
      brand: { label: "Fleet / Owner", placeholder: "e.g. Company Fleet" },
      make: { label: "Make", placeholder: "e.g. Toyota, Honda" },
      model: { label: "Model", placeholder: "e.g. Innova Crysta" },
      serialNumber: { label: "Registration No.", placeholder: "e.g. MH12AB1234" },
    },
  },
  "Infrastructure Assets": {
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

export function getHardwareFields(inventoryCategory) {
  const config = INVENTORY_CATEGORY_CONFIG[inventoryCategory];
  return config?.hardwareFields || DEFAULT_HARDWARE_FIELDS;
}

export function isVehicleInventoryCategory(inventoryCategory) {
  return Boolean(INVENTORY_CATEGORY_CONFIG[inventoryCategory]?.vehicleMode);
}

export function unitBelongsToInventoryCategory(unit, inventoryCategory, inventory = null) {
  if (!inventoryCategory) return true;
  const row = getInventoryRowForUnit(unit, inventory);
  if (!row) return false;
  return (row.inventoryCategory || "IT Assets") === inventoryCategory;
}
