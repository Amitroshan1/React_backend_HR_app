/** User-facing department workspace titles (replaces legacy "X Panel" naming). */

export const DEPARTMENT_TITLES = {
  hr: "HR Management",
  account: "Accounts Management",
  accounts: "Accounts Management",
  admin: "Admin Management",
  it: "IT Management",
  inventory: "Inventory Management",
};

export const PANEL_ROUTE_LABELS = {
  "/hr": DEPARTMENT_TITLES.hr,
  "/account": DEPARTMENT_TITLES.account,
  "/admin": DEPARTMENT_TITLES.admin,
  "/it": DEPARTMENT_TITLES.it,
  "/it/inventory": DEPARTMENT_TITLES.inventory,
};

export function getPanelLinkLabel(item) {
  if (!item) return "";
  return PANEL_ROUTE_LABELS[item.route] || `${item.display} Panel`;
}
