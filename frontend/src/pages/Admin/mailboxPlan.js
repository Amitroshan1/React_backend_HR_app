export const MAILBOX_FIELDS = [
  { key: 'mailbox_hr', label: 'HR mailbox', hint: 'Leave and HR workflows', placeholder: 'hr@company.com', accent: 'rose', feature: null },
  { key: 'mailbox_admin', label: 'Admin mailbox', hint: 'Admin notices', placeholder: 'admin@company.com', accent: 'blue', feature: null },
  { key: 'mailbox_accounts', label: 'Accounts mailbox', hint: 'Claims and payroll', placeholder: 'accounts@company.com', accent: 'teal', feature: 'account_panel' },
  { key: 'mailbox_finance', label: 'Finance mailbox', hint: 'Budget and payouts', placeholder: 'finance@company.com', accent: 'amber', feature: 'finance_panel' },
  { key: 'mailbox_it', label: 'IT mailbox', hint: 'Tickets and IT workflows', placeholder: 'it@company.com', accent: 'indigo', feature: 'it_panel' },
  { key: 'mailbox_inventory', label: 'Inventory mailbox', hint: 'Purchase and inventory workflows', placeholder: 'inventory@company.com', accent: 'slate', feature: 'it_panel' },
];

const BASIC_OFF = new Set(['account_panel', 'finance_panel', 'it_panel']);
const ESSENTIAL_OFF = new Set(['it_panel']);

export function emptyMailboxes() {
  return Object.fromEntries(MAILBOX_FIELDS.map((field) => [field.key, '']));
}

export function mailboxFieldsForPlan(plan) {
  const p = String(plan || 'essential').toLowerCase();
  return MAILBOX_FIELDS.filter((field) => {
    if (!field.feature) return true;
    if (p === 'enterprise') return true;
    if (p === 'basic') return !BASIC_OFF.has(field.feature);
    return !ESSENTIAL_OFF.has(field.feature);
  });
}
