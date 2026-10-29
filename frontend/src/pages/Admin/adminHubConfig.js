/** Admin Command Center — module groups and navigation targets. */

export const ADMIN_HUB_SECTIONS = [
  {
    id: "departments",
    title: "Department workspaces",
    subtitle: "Jump into each team's full workspace",
    modules: [
      {
        id: "hr-workspace",
        title: "HR Management",
        description: "Employees, leave, holidays, org updates",
        icon: "🏢",
        route: "/hr",
        accent: "rose",
      },
      {
        id: "accounts-workspace",
        title: "Accounts Management",
        description: "CTC, payroll, tax, finance",
        icon: "📊",
        route: "/account",
        accent: "teal",
      },
      {
        id: "it-panel",
        title: "IT Management",
        description: "IT panel, tickets, assets, support",
        icon: "🛠️",
        route: "/it",
        accent: "sky",
      },
      {
        id: "it-workspace",
        title: "Inventory Management",
        description: "Assets, tickets, returns",
        icon: "💻",
        route: "/it/inventory",
        accent: "indigo",
      },
    ],
  },
  {
    id: "time",
    title: "Time & Leave",
    subtitle: "Leave and separations across the company",
    modules: [
      {
        id: "leaves",
        title: "All Leaves",
        description: "Review and act on leave requests",
        icon: "📅",
        route: "/admin/leaves",
        statKey: "total_leaves",
        badgeKey: "pending_leaves",
        accent: "purple",
      },
      {
        id: "resignations",
        title: "Resignations",
        description: "Separation notices and approvals",
        icon: "📝",
        route: "/admin/resignations",
        statKey: "total_resignations",
        accent: "red",
      },
    ],
  },
];

export const ADMIN_PLATFORM_SECTION = {
  id: "platform",
  title: "Platform",
  subtitle: "Shared-DB SaaS — register companies (tenant_id)",
  modules: [
    {
      id: "customers",
      title: "Customers",
      description: "Register a company and create its tenant",
      icon: "🏗️",
      route: "/admin/customers",
      accent: "blue",
    },
  ],
};

/** Featured hub cards shown at the top of Command Center. */
export const ADMIN_FEATURED_WORKFORCE = {
  id: "workforce",
  title: "Employees",
  description: "Company workforce overview",
  icon: "👥",
  route: "/employees",
  accent: "amber",
};

export const ADMIN_FEATURED_QUERIES = {
  id: "queries",
  title: "All Queries",
  description: "Inbox for every department query",
  icon: "💬",
  route: "/admin/queries",
  statKey: "total_queries",
  badgeKey: "pending_queries",
  accent: "gold",
};

export const ADMIN_FEATURED_PLATFORM = ADMIN_PLATFORM_SECTION.modules;
