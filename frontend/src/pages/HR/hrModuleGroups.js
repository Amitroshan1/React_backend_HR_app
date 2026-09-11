/** HR module hub — lifecycle categories (Phase 1). */

/**
 * Temporary: hide Pay tab + Compensation / Workforce Planning.
 * Set to `true` when ready to show again.
 */
export const HR_SHOW_PAY_MODULES = false;

export const HR_PAY_MODULE_TITLES = ['Compensation', 'Workforce Planning'];

export function isPayModuleTitle(title) {
  return HR_PAY_MODULE_TITLES.includes(title);
}

export const HR_PAY_VIEWS = ['compensation', 'workforce_plan'];

export function isPayView(view) {
  return HR_PAY_VIEWS.includes(view);
}

export const HR_MODULE_DISPLAY_NAMES = {
  'Sign Up': 'Recruitment',
  'Update_SignUp': 'Edit employee profile',
  'Add Department And Circle': 'Departments & circles',
  'Leave Application Updation': 'Leave requests (admin)',
  'Bulk Employee Import': 'Bulk employee import',
  'Ex-Employee Document Sharing': 'Ex-employee documents',
  'Leave Accrual Monitor': 'Leave accrual monitor',
  'Circle Transfer History': 'Circle transfers',
  'Offboarding Dashboard': 'Offboarding',
  'Workforce Planning': 'Workforce planning',
  'Assessment Invite': 'Assessment invite',
  'Probation Reviews': 'Probation reviews',
  'NOC Requests': 'NOC requests',
  'Add Locations': 'Office locations',
  'Geo Analytics': 'Geo monitoring',
  'News Feed': 'News feed',
  'Organization Chart': 'Org chart',
  'Update Manager': 'Update manager',
  'Holiday Calendar': 'Holiday calendar',
  'Biometric Attendance': 'Biometric attendance',
};

export function moduleLabel(option) {
  if (!option) return '';
  return option.label || HR_MODULE_DISPLAY_NAMES[option.title] || option.title;
}

export function enrichModuleOption(option) {
  return {
    ...option,
    label: HR_MODULE_DISPLAY_NAMES[option.title] || option.title,
  };
}

export function groupIdForTitle(title) {
  for (const group of HR_MODULE_GROUPS) {
    if (group.titles.includes(title)) return group.id;
  }
  return 'people';
}

export const HR_MODULE_TABS = [
  { id: 'all', label: 'All' },
  { id: 'hire', label: 'Hire' },
  { id: 'people', label: 'People' },
  { id: 'leave', label: 'Leave' },
  ...(HR_SHOW_PAY_MODULES ? [{ id: 'pay', label: 'Pay' }] : []),
  { id: 'exit', label: 'Exit' },
  { id: 'admin', label: 'Admin' },
];

export const HR_MODULE_GROUPS = [
  {
    id: 'hire',
    fullLabel: 'Hire & onboard',
    description: 'Recruitment, onboarding, assessments, and probation confirmation',
    titles: [
      'Sign Up',
      'Bulk Employee Import',
      'Assessment Invite',
      'Probation Reviews',
    ],
  },
  {
    id: 'people',
    fullLabel: 'Employee records',
    description: 'Profiles, managers, org structure, and transfers',
    titles: [
      'Update_SignUp',
      'Update Manager',
      'Organization Chart',
      'Circle Transfer History',
    ],
  },
  {
    id: 'leave',
    fullLabel: 'Time & leave',
    description: 'Leave balances, applications, accrual jobs, and holidays',
    titles: [
      'Leave Application Updation',
      'Leave Accrual Monitor',
      'Holiday Calendar',
      'Biometric Attendance',
    ],
  },
  {
    id: 'pay',
    fullLabel: 'Compensation & planning',
    description: 'Increment cycles, salary revisions, and headcount budgets',
    titles: [
      'Compensation',
      'Workforce Planning',
    ],
  },
  {
    id: 'exit',
    fullLabel: 'Exit & offboarding',
    description: 'NOC, separation pipeline, exit via offboarding, and ex-employee docs',
    titles: [
      'NOC Requests',
      'Offboarding Dashboard',
      'Ex-Employee Document Sharing',
    ],
  },
  {
    id: 'admin',
    fullLabel: 'Admin & setup',
    description: 'Master data, locations, geo monitoring, and company announcements',
    titles: [
      'Add Department And Circle',
      'Add Locations',
      'Geo Analytics',
      'News Feed',
    ],
  },
];

/** Dashboard sidebar pins (Phase 2) — inbox only; browse all tools via “All HR modules”. */
export const HR_DASHBOARD_PINNED_TITLES = [];

const PINNED_GROUP_BY_TITLE = {
  'Sign Up': 'hire',
  'Compensation': 'pay',
  'Offboarding Dashboard': 'exit',
};

export function resolvePinnedModules(updateOptions, { titles = HR_DASHBOARD_PINNED_TITLES, isAllowed = () => true } = {}) {
  const byTitle = new Map(updateOptions.map((o) => [o.title, o]));
  return titles
    .map((title) => {
      const option = byTitle.get(title);
      if (!option || !isAllowed(title)) return null;
      return { ...option, groupId: PINNED_GROUP_BY_TITLE[title] || groupIdForTitle(title) };
    })
    .filter(Boolean);
}

export function buildGroupedModules(updateOptions, { search = '', category = 'all', isAllowed = () => true }) {
  const q = search.trim().toLowerCase();
  const byTitle = new Map(updateOptions.map((o) => [o.title, o]));

  const matchesQuery = (option) => {
    if (!q) return true;
    const label = (option.label || moduleLabel(option) || '').toLowerCase();
    return (
      option.title.toLowerCase().includes(q)
      || label.includes(q)
      || (option.description || '').toLowerCase().includes(q)
    );
  };

  return HR_MODULE_GROUPS
    .filter((group) => HR_SHOW_PAY_MODULES || group.id !== 'pay')
    .filter((group) => category === 'all' || group.id === category)
    .map((group) => ({
      ...group,
      modules: group.titles
        .map((title) => byTitle.get(title))
        .filter(Boolean)
        .filter((o) => isAllowed(o.title))
        .filter(matchesQuery),
    }))
    .filter((group) => group.modules.length > 0);
}
