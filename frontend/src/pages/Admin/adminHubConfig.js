/** Admin Command Center — module groups and navigation targets. */

export const ADMIN_HUB_SECTIONS = [
  {
    id: "people",
    title: "People & HR",
    subtitle: "Workforce directory, HR operations, and separations",
    modules: [
      {
        id: "employees",
        title: "Employees",
        description: "Browse, filter, and open employee records",
        icon: "👥",
        route: "/employees",
        statKey: "total_employees",
        accent: "blue",
      },
      {
        id: "archive",
        title: "Employee Archive",
        description: "Historical records for exited staff",
        icon: "🗄️",
        route: "/archive-employees",
        accent: "slate",
      },
      {
        id: "exit",
        title: "Exit & Separation",
        description: "Process employee exits",
        icon: "🚪",
        route: "/exit-employees",
        accent: "rose",
      },
    ],
  },
  {
    id: "time",
    title: "Time & Leave",
    subtitle: "Leave applications and resignations org-wide",
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
  {
    id: "finance",
    title: "Finance",
    subtitle: "Claims and accounts",
    modules: [
      {
        id: "claims",
        title: "Expense Claims",
        description: "All employee reimbursement requests",
        icon: "💰",
        route: "/admin/claims",
        statKey: "total_claims",
        badgeKey: "pending_claims",
        accent: "teal",
      },
    ],
  },
  {
    id: "it",
    title: "IT & Assets",
    subtitle: "Inventory, assignments, tickets, and returns",
    modules: [
      {
        id: "inventory",
        title: "IT Inventory",
        description: "All asset categories and stock",
        icon: "📦",
        route: "/it/inventory",
        statKey: "total_inventory_assets",
        accent: "indigo",
      },
      {
        id: "assets",
        title: "Asset Management",
        description: "Assign and track devices",
        icon: "💻",
        route: "/it/Assets",
        accent: "sky",
      },
      {
        id: "tickets",
        title: "Support Tickets",
        description: "Open IT support queue",
        icon: "🎫",
        route: "/it/OpenTicket",
        statKey: "open_tickets",
        badgeKey: "open_tickets",
        accent: "amber",
      },
      {
        id: "returns",
        title: "Return Requests",
        description: "Pending asset returns",
        icon: "↩️",
        route: "/it/return-requests",
        badgeKey: "pending_return_requests",
        accent: "orange",
      },
      {
        id: "noc",
        title: "NOC Requests",
        description: "No-objection certificate workflow",
        icon: "📄",
        route: "/it/noc-requests",
        accent: "cyan",
      },
    ],
  },
  {
    id: "support",
    title: "Support & Communication",
    subtitle: "Employee queries across departments",
    modules: [
      {
        id: "queries",
        title: "All Queries",
        description: "Inbox for every department query",
        icon: "💬",
        route: "/admin/queries",
        statKey: "total_queries",
        badgeKey: "pending_queries",
        accent: "gold",
      },
    ],
  },
];

/** Sidebar: open full department workspaces from Admin Panel. */
export const ADMIN_DEPARTMENTS = [
  {
    id: "hr",
    label: "HR",
    description: "Payroll, holidays, org updates",
    icon: "🏢",
    route: "/hr",
  },
  {
    id: "account",
    label: "Accounts",
    description: "CTC, payroll, finance",
    icon: "📊",
    route: "/account",
  },
  {
    id: "it",
    label: "IT & Inventory",
    description: "Assets, tickets, returns",
    icon: "💻",
    route: "/it/inventory",
  },
  {
    id: "manager",
    label: "Manager",
    description: "Teams & performance",
    icon: "👔",
    route: "/manager",
  },
];

export const ADMIN_SIDEBAR_ORG = [
  { label: "Employees", route: "/employees", icon: "👥", external: true },
  { label: "All Leaves", route: "/admin/leaves", icon: "📅" },
  { label: "All Queries", route: "/admin/queries", icon: "💬" },
  { label: "Expense Claims", route: "/admin/claims", icon: "💰" },
  { label: "Resignations", route: "/admin/resignations", icon: "📝" },
];

export const ADMIN_PLATFORM_LINKS = [
  { label: "Customers", route: "/admin/customers", icon: "🏗️" },
  { label: "Deployment Guide", route: "/admin/deployment-guide", icon: "🚀" },
];

export const ADMIN_PLATFORM_SECTION = {
  id: "platform",
  title: "Platform & Deployment",
  subtitle: "Multi-tenant customers and deployment tooling",
  modules: [
    {
      id: "customers",
      title: "Customers",
      description: "Manage deployed company instances",
      icon: "🏗️",
      route: "/admin/customers",
      accent: "blue",
    },
    {
      id: "deployment-guide",
      title: "Deployment Guide",
      description: "Server and database setup steps",
      icon: "🚀",
      route: "/admin/deployment-guide",
      accent: "teal",
    },
  ],
};
