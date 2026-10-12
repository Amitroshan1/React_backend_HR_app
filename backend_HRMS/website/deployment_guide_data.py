"""Platform checklist for registering a company in the shared HRMS database."""

DEPLOYMENT_GUIDE = {
    "title": "Register a company",
    "subtitle": (
        "One app and one database. Each company is a tenant. "
        "Everyone uses the same login page. After sign-in, data is isolated by tenant."
    ),
    "model": "shared_database",
    "sections": [
        {
            "id": "prep",
            "title": "Before you register",
            "items": [
                "Company name and plan agreed (Basic, Essential, or Enterprise)",
                "First admin email ready — this is the login account, not the contact email",
                "Optional contact email and HR, Accounts, IT, and Admin mailboxes",
                "Short slug in mind (generated from the company name, used internally)",
            ],
        },
        {
            "id": "register",
            "title": "1. Register the company",
            "items": [
                "Open Admin → Register company",
                "Enter the company name, plan, and initial status (Active, or Provisioning if sign-in should wait)",
                "Admin email is required. Name and mobile are optional",
                "The first admin is created as Super Admin with employee id ADM0001",
                "They sign in on this app’s login page with a one-time code",
                "If that email is already an admin in another company, login asks which company to open",
            ],
        },
        {
            "id": "created",
            "title": "2. What gets created",
            "items": [
                "A tenants row: name, slug, plan, status, contact email, mailboxes, and notes",
                "A deployed_customers row so the company shows on Customers",
                "Files for the company stored under tenants/{id}/",
                "No new server and no separate MySQL database",
            ],
        },
        {
            "id": "after",
            "title": "3. After the company is active",
            "items": [
                "Admin signs in with the admin email and the one-time code",
                "HR adds departments and circles",
                "Holiday calendar is set for the current year",
                "Employees are added",
                "Company mailboxes can be changed later under Company mailboxes",
                "Smoke test the modules included in the plan",
            ],
        },
        {
            "id": "isolation",
            "title": "4. Confirm isolation",
            "items": [
                "Every company uses the same login URL",
                "The login token carries tenant_id",
                "Employees, leave, queries, claims, and files stay inside that tenant",
                "A suspended company cannot sign in",
                "This guide and the customer list stay on the platform instance only (SHOW_DEPLOYMENT_GUIDE=1)",
            ],
        },
    ],
    "env_template": [
        {
            "key": "SHOW_DEPLOYMENT_GUIDE",
            "hint": "1 on this platform instance only. Companies do not get their own server.",
        },
        {
            "key": "CUSTOMER_PLAN",
            "hint": "basic, essential, or enterprise. Fallback when a tenant has no plan. tenants.plan is the source of truth.",
        },
        {
            "key": "DATABASE_URI",
            "hint": "One database for every company. Do not create a database per company.",
        },
        {
            "key": "SILO_PROVISION_LEGACY",
            "hint": "Leave unset. Set to 1 only if a customer must run on a dedicated database.",
        },
    ],
    "plans": [
        {
            "id": "basic",
            "label": "Basic",
            "notes": "Core HR, attendance, and leave. No Accounts panel, IT, payslips, claims, or assets.",
        },
        {
            "id": "essential",
            "label": "Essential",
            "notes": "Basic plus payslips, claims, and the Accounts panel. No IT panel or assets.",
        },
        {
            "id": "enterprise",
            "label": "Enterprise",
            "notes": "All modules: HR, Accounts, IT, payroll, queries, assets, and claims.",
        },
    ],
}
